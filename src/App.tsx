import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import HomePage from "./pages/HomePage";
import CreateRoomPage from "./pages/CreateRoomPage";
import JoinRoomPage from "./pages/JoinRoomPage";
import MotionSetupPage from "./pages/MotionSetupPage";
import ReadyRoomPage from "./pages/ReadyRoomPage";
import WeaponAssemblyPage from "./pages/WeaponAssemblyPage";
import WeaponReadyPage from "./pages/WeaponReadyPage";
import FirePhasePage from "./pages/FirePhasePage";
import ResultPage from "./pages/ResultPage";
import WeaponLayoutEditor from "./pages/WeaponLayoutEditor";
import PwaInstallPrompt from "./components/PwaInstallPrompt";
import GameAppBar from "./components/GameAppBar";
import { getSocket } from "./lib/socket";
import { unlockGameAudio } from "./lib/gameAudio";
import { clearActiveInputFocus, requestGamePresentation } from "./lib/gamePresentation";
import { WEAPON_PARTS } from "./components/weaponCanvasConfig";

export type Page =
  | "home"
  | "create"
  | "join"
  | "motion-setup"
  | "ready"
  | "assembly"
  | "weapon-ready"
  | "fire"
  | "result"
  | "layout-editor";

const APPBAR_PAGES = new Set<Page>(["create", "join", "ready", "result", "layout-editor"]);
const ROOM_CODE_APPBAR_PAGES = new Set<Page>(["ready", "result"]);

export type MotionPermissionState =
  | "unknown"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable";

export type RoomPlayer = {
  socketId: string;
  playerNumber: 1 | 2;
  nickname: string;
  ready: boolean;
  reactionTimeMs: number | null;
};

export type DuelResult = {
  outcome: "win" | "lose";
  playerCompletionTimeMs: number | null;
  winnerCompletionTimeMs: number | null;
  multiplayer: boolean;
};

type RoomStatePayload = {
  roomCode: string;
  players: RoomPlayer[];
};

const SOCKET_CONNECT_TIMEOUT_MS = 8000;
const WEAPON_ASSET_URLS = WEAPON_PARTS.map((part) => part.src);

type SocketDebugInfo = {
  timestamp: string;
  action: "createRoom" | "joinRoom" | "general";
  stage:
    | "idle"
    | "connect-start"
    | "connect-success"
    | "connect-error"
    | "connect-timeout"
    | "failed-before-emit"
    | "emit-start"
    | "emit-callback";
  socketServerUrl: string;
  browserUrl: string;
  pageProtocol: string;
  userAgent: string;
  socketConnected: boolean;
  socketId: string | null;
  transportConfigured: string[];
  activeTransport: string | null;
  timedOut: boolean;
  connectErrorMessage: string | null;
  connectErrorName: string | null;
  connectErrorDescription: string | null;
  connectErrorContext: string | null;
  failedBeforeEmit: boolean;
  roomCode: string | null;
  callbackPayload: unknown;
};

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

const NICKNAME_ADJECTIVES = [
  "Rocket",
  "Chaos",
  "Disco",
  "Space",
  "Turbo",
  "Lucky",
  "Sneaky",
  "Tiny",
  "Sleepy",
  "Dancing",
  "Grumpy",
  "Confused",
];

const NICKNAME_NOUNS = [
  "Duck",
  "Potato",
  "Banana",
  "Penguin",
  "Frog",
  "Carrot",
  "Whale",
  "Panda",
  "Dragon",
  "Ghost",
  "Cactus",
  "Marshmallow",
];

function generateFunNickname() {
  const adjective = NICKNAME_ADJECTIVES[Math.floor(Math.random() * NICKNAME_ADJECTIVES.length)];
  const noun = NICKNAME_NOUNS[Math.floor(Math.random() * NICKNAME_NOUNS.length)];
  return `${adjective} ${noun}`;
}

function normalizeNicknameInput(input: string) {
  return input.trim().replace(/\s+/g, " ").slice(0, 24);
}

function getJoinRoomValidationError(input: string) {
  const trimmedRoomCode = input.trim().toUpperCase();

  if (!trimmedRoomCode) {
    return "Please enter a room code.";
  }

  if (!/^[A-Z0-9]{4,6}$/.test(trimmedRoomCode)) {
    return "Enter a valid room code.";
  }

  return null;
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [roomCode, setRoomCode] = useState(generateRoomCode());
  const [reactionTimeMs, setReactionTimeMs] = useState<number | null>(null);
  const [assemblyStartTimestamp, setAssemblyStartTimestamp] = useState<number | null>(null);
  const [motionPermission, setMotionPermission] = useState<MotionPermissionState>("unknown");
  const [pendingGameplayPage] = useState<Page>("ready");
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [currentPlayerNumber, setCurrentPlayerNumber] = useState<1 | 2 | null>(null);
  const [duelResult, setDuelResult] = useState<DuelResult | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomActionLoading, setRoomActionLoading] = useState(false);
  const [roomActionLabel, setRoomActionLabel] = useState<string | null>(null);
  const [socketAvailable, setSocketAvailable] = useState(false);
  const [socketDebugInfo, setSocketDebugInfo] = useState<SocketDebugInfo | null>(null);
  const [weaponAssetsReady, setWeaponAssetsReady] = useState(false);
  const [gameplayAssetsLoading, setGameplayAssetsLoading] = useState(false);
  const [nicknameInput] = useState("");
  const [sessionNickname, setSessionNickname] = useState("");
  const [fallbackOpponentNickname] = useState(() => generateFunNickname());
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  }));
  const socket = useMemo(() => getSocket(), []);
  const currentPageRef = useRef<Page>("home");
  const roomActionAttemptRef = useRef(0);
  const weaponAssetsPromiseRef = useRef<Promise<void> | null>(null);
  const isDev = import.meta.env.DEV;
  const isPortrait = viewport.height > viewport.width;
  const isMobileSized = Math.min(viewport.width, viewport.height) < 900;
  const showRotateOverlay = isPortrait && isMobileSized;
  const useSocketReadyFlow = socketAvailable && currentPlayerNumber !== null && roomPlayers.length > 0;

  const navigateTo = useCallback((page: Page) => {
    const current = currentPageRef.current;
    if (page === current) {
      return;
    }

    currentPageRef.current = page;
    setCurrentPage(page);
  }, []);

  const replaceCurrentPage = useCallback((page: Page) => {
    currentPageRef.current = page;
    setCurrentPage(page);
  }, []);

  const buildSocketDebugInfo = (
    action: SocketDebugInfo["action"],
    stage: SocketDebugInfo["stage"],
    extras: Partial<SocketDebugInfo> = {},
  ): SocketDebugInfo => {
    const browserUrl = typeof window === "undefined" ? "" : window.location.href;
    const pageProtocol = typeof window === "undefined" ? "" : window.location.protocol;
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const activeTransport = socket.io.engine?.transport?.name ?? null;
    const transportConfigured = Array.isArray(socket.io.opts.transports)
      ? socket.io.opts.transports.map(String)
      : [];

    return {
      timestamp: new Date().toISOString(),
      action,
      stage,
      socketServerUrl: import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001",
      browserUrl,
      pageProtocol,
      userAgent,
      socketConnected: socket.connected,
      socketId: socket.id ?? null,
      transportConfigured,
      activeTransport,
      timedOut: false,
      connectErrorMessage: null,
      connectErrorName: null,
      connectErrorDescription: null,
      connectErrorContext: null,
      failedBeforeEmit: false,
      roomCode: null,
      callbackPayload: null,
      ...extras,
    };
  };

  const publishSocketDebug = (info: SocketDebugInfo) => {
    console.log("[SocketDebug]", info);
    setSocketDebugInfo(info);
  };

  const socketDebugText = socketDebugInfo ? JSON.stringify(socketDebugInfo, null, 2) : null;

  const ensureWeaponAssetsReady = async () => {
    if (weaponAssetsReady) {
      return;
    }

    if (!weaponAssetsPromiseRef.current) {
      weaponAssetsPromiseRef.current = Promise.all(
        WEAPON_ASSET_URLS.map(
          (src) =>
            new Promise<void>((resolve) => {
              const image = new Image();
              image.decoding = "async";
              image.onload = () => resolve();
              image.onerror = () => resolve();
              image.src = src;
            }),
        ),
      ).then(() => {
        setWeaponAssetsReady(true);
      });
    }

    await weaponAssetsPromiseRef.current;
  };

  useEffect(() => {
    void ensureWeaponAssetsReady();
  }, []);

  const resetRoomSession = () => {
    setRoomPlayers([]);
    setCurrentPlayerNumber(null);
    setDuelResult(null);
    setReactionTimeMs(null);
    setAssemblyStartTimestamp(null);
    setRoomError(null);
    setRoomActionLoading(false);
    setRoomActionLabel(null);
  };

  const resolveSessionNickname = () => {
    const normalizedNickname = normalizeNicknameInput(nicknameInput);

    if (normalizedNickname) {
      setSessionNickname(normalizedNickname);
      return normalizedNickname;
    }

    if (sessionNickname) {
      return sessionNickname;
    }

    const generatedNickname = generateFunNickname();
    setSessionNickname(generatedNickname);
    return generatedNickname;
  };

  const ensureSocketConnection = async () => {
    publishSocketDebug(buildSocketDebugInfo("general", "connect-start"));

    if (socket.connected) {
      setSocketAvailable(true);
      publishSocketDebug(buildSocketDebugInfo("general", "connect-success"));
      return { connected: true, timedOut: false };
    }

    return await new Promise<{ connected: boolean; timedOut: boolean }>((resolve) => {
      let settled = false;
      let timeoutId = 0;

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        socket.off("connect", handleConnect);
        socket.off("connect_error", handleError);
      };

      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        setSocketAvailable(value);
        resolve({ connected: value, timedOut: false });
      };

      const handleConnect = () => {
        console.log("[SocketDebug] connect event received", { socketId: socket.id });
        publishSocketDebug(buildSocketDebugInfo("general", "connect-success"));
        finish(true);
      };

      const handleError = (error: Error & { description?: unknown; context?: unknown; data?: unknown }) => {
        console.log("[socket] connect_error", error.message);
        publishSocketDebug(
          buildSocketDebugInfo("general", "connect-error", {
            connectErrorMessage: error.message ?? null,
            connectErrorName: error.name ?? null,
            connectErrorDescription:
              typeof error.description === "string"
                ? error.description
                : error.description
                  ? JSON.stringify(error.description)
                  : null,
            connectErrorContext:
              typeof error.context === "string"
                ? error.context
                : error.context
                  ? JSON.stringify(error.context)
                  : error.data
                    ? JSON.stringify(error.data)
                    : null,
          }),
        );
        finish(false);
      };

      timeoutId = window.setTimeout(() => {
        publishSocketDebug(buildSocketDebugInfo("general", "connect-timeout", { timedOut: true }));
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        setSocketAvailable(false);
        resolve({ connected: false, timedOut: true });
      }, SOCKET_CONNECT_TIMEOUT_MS);

      socket.off("connect", handleConnect);
      socket.off("connect_error", handleError);
      socket.on("connect", handleConnect);
      socket.on("connect_error", handleError);
      console.log("[SocketDebug] connect() called", {
        socketServerUrl: import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001",
        timeoutMs: SOCKET_CONNECT_TIMEOUT_MS,
        transportConfigured: Array.isArray(socket.io.opts.transports) ? socket.io.opts.transports : [],
      });
      socket.connect();
    });
  };

  const handleCreateRoom = async () => {
    const attemptId = ++roomActionAttemptRef.current;
    clearActiveInputFocus();
    unlockGameAudio();
    void requestGamePresentation();
    const nextRoomCode = roomCode || generateRoomCode();
    const nickname = resolveSessionNickname();
    setRoomCode(nextRoomCode);
    setDuelResult(null);
    setReactionTimeMs(null);
    setAssemblyStartTimestamp(null);
    setRoomError(null);
    setRoomActionLoading(true);
    setRoomActionLabel("Connecting...");

    const connectionResult = await ensureSocketConnection();
    if (attemptId !== roomActionAttemptRef.current) {
      return;
    }

    if (!connectionResult.connected) {
      console.log("[socket] createRoom connection failed", nextRoomCode);
      publishSocketDebug(
        buildSocketDebugInfo("createRoom", "failed-before-emit", {
          failedBeforeEmit: true,
          timedOut: connectionResult.timedOut,
          roomCode: nextRoomCode,
        }),
      );
      setSocketAvailable(false);
      resetRoomSession();
      setRoomError("Cannot connect to multiplayer server. Please start the server and try again.");
      setRoomActionLoading(false);
      setRoomActionLabel(null);
      navigateTo("home");
      return;
    }

    setRoomActionLabel("Connecting...");
    publishSocketDebug(buildSocketDebugInfo("createRoom", "emit-start", { roomCode: nextRoomCode }));
    console.log("[SocketDebug] createRoom emit sent", { roomCode: nextRoomCode, socketId: socket.id });
    socket.emit(
      "createRoom",
      { roomCode: nextRoomCode, nickname },
      (result: { ok: boolean; error?: string; room?: RoomStatePayload; playerNumber?: 1 | 2 }) => {
        console.log("[socket] createRoom result", result);
        if (attemptId !== roomActionAttemptRef.current) {
          if (result?.ok && socket.connected) {
            socket.emit("leaveRoom", { roomCode: nextRoomCode });
          }
          return;
        }

        publishSocketDebug(
          buildSocketDebugInfo("createRoom", "emit-callback", {
            roomCode: nextRoomCode,
            callbackPayload: result,
          }),
        );
        setRoomActionLoading(false);
        setRoomActionLabel(null);

        if (!result?.ok || !result.room || !result.playerNumber) {
          setRoomError(result?.error || "Unable to create room.");
          return;
        }

        setRoomCode(result.room.roomCode);
        setCurrentPlayerNumber(result.playerNumber);
        setRoomPlayers(result.room.players);
        navigateTo("ready");
      },
    );
  };

  const handleJoinRoom = async (nextRoomCode: string) => {
    clearActiveInputFocus();
    unlockGameAudio();
    void requestGamePresentation();
    const trimmedRoomCode = nextRoomCode.trim().toUpperCase();
    const validationError = getJoinRoomValidationError(trimmedRoomCode);
    const nickname = resolveSessionNickname();
    setDuelResult(null);
    setReactionTimeMs(null);
    setAssemblyStartTimestamp(null);

    if (validationError) {
      setRoomError(validationError);
      setRoomActionLoading(false);
      setRoomActionLabel(null);
      return;
    }

    const attemptId = ++roomActionAttemptRef.current;

    setRoomError(null);
    setRoomActionLoading(true);
    setRoomActionLabel("Connecting...");
    setRoomCode(trimmedRoomCode);

    const connectionResult = await ensureSocketConnection();
    if (attemptId !== roomActionAttemptRef.current) {
      return;
    }

    if (!connectionResult.connected) {
      console.log("[socket] joinRoom connection failed", trimmedRoomCode);
      publishSocketDebug(
        buildSocketDebugInfo("joinRoom", "failed-before-emit", {
          failedBeforeEmit: true,
          timedOut: connectionResult.timedOut,
          roomCode: trimmedRoomCode,
        }),
      );
      setSocketAvailable(false);
      resetRoomSession();
      setRoomError("Cannot connect to multiplayer server. Please start the server and try again.");
      setRoomActionLoading(false);
      setRoomActionLabel(null);
      navigateTo("join");
      return;
    }

    setRoomActionLabel("Connecting...");
    publishSocketDebug(buildSocketDebugInfo("joinRoom", "emit-start", { roomCode: trimmedRoomCode }));
    console.log("[SocketDebug] joinRoom emit sent", { roomCode: trimmedRoomCode, socketId: socket.id });
    socket.emit(
      "joinRoom",
      { roomCode: trimmedRoomCode, nickname },
      (result: { ok: boolean; error?: string; room?: RoomStatePayload; playerNumber?: 1 | 2 }) => {
        console.log("[socket] joinRoom result", result);
        if (attemptId !== roomActionAttemptRef.current) {
          if (result?.ok && socket.connected) {
            socket.emit("leaveRoom", { roomCode: trimmedRoomCode });
          }
          return;
        }

        publishSocketDebug(
          buildSocketDebugInfo("joinRoom", "emit-callback", {
            roomCode: trimmedRoomCode,
            callbackPayload: result,
          }),
        );
        setRoomActionLoading(false);
        setRoomActionLabel(null);

        if (!result?.ok || !result.room || !result.playerNumber) {
          const normalizedError =
            result?.error === "Room not found" || result?.error === "Room not found."
              ? "Room not found."
              : result?.error === "Room is full" || result?.error === "Room is full."
                ? "Room is full."
                : result?.error || "Unable to join room.";
          setRoomError(normalizedError);
          return;
        }

        setRoomCode(result.room.roomCode);
        setCurrentPlayerNumber(result.playerNumber);
        setRoomPlayers(result.room.players);
        navigateTo("ready");
      },
    );
  };

  const handleSocketReadyToggle = () => {
    if (!socket.connected || !currentPlayerNumber) {
      return;
    }

    const currentPlayer = roomPlayers.find((player) => player.playerNumber === currentPlayerNumber);
    const nextReady = !currentPlayer?.ready;

    socket.emit(
      "playerReady",
      { roomCode, ready: nextReady },
      (result: { ok: boolean; error?: string; room?: RoomStatePayload }) => {
        console.log("[socket] playerReady", result);
        if (!result?.ok) {
          setRoomError(result?.error || "Unable to update ready state.");
        }
      },
    );
  };

  const handleGoHome = () => {
    roomActionAttemptRef.current += 1;
    if (socket.connected && currentPlayerNumber) {
      socket.emit("leaveRoom", { roomCode }, (result: { ok: boolean }) => {
        console.log("[socket] leaveRoom", result);
      });
    }

    resetRoomSession();
    setRoomCode(generateRoomCode());
    replaceCurrentPage("home");
  };

  const handlePlayAgain = async () => {
    setDuelResult(null);
    setReactionTimeMs(null);
    setAssemblyStartTimestamp(null);

    if (useSocketReadyFlow && socket.connected && currentPlayerNumber) {
      socket.emit(
        "playerReady",
        { roomCode, ready: false },
        (result: { ok: boolean; error?: string; room?: RoomStatePayload }) => {
          console.log("[socket] resetForReplay", result);
          if (!result?.ok) {
            setRoomError(result?.error || "Unable to reset the room.");
          }
        },
      );
      navigateTo("ready");
      return;
    }

    setGameplayAssetsLoading(true);
    try {
      await ensureWeaponAssetsReady();
    } finally {
      setGameplayAssetsLoading(false);
    }
    navigateTo("assembly");
  };

  useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  useEffect(() => {
    const orientationApi = screen.orientation;
    if (!orientationApi?.lock) {
      return;
    }

    orientationApi.lock("landscape").catch(() => {
      // Some browsers require fullscreen or a user gesture. We fall back to the rotate overlay.
    });
  }, []);

  useEffect(() => {
    const handleConnect = () => {
      console.log("[socket] connected", socket.id);
      setSocketAvailable(true);
    };

    const handleDisconnect = (reason: string) => {
      console.log("[socket] disconnected", reason);
      setSocketAvailable(false);
    };

    const handleRoomUpdated = (room: RoomStatePayload) => {
      setRoomCode(room.roomCode);
      setRoomPlayers(room.players);
    };

    const handlePlayerJoined = (payload: { room: RoomStatePayload; playerNumber: 1 | 2 }) => {
      console.log("[socket] playerJoined", payload);
      setRoomCode(payload.room.roomCode);
      setRoomPlayers(payload.room.players);
    };

    const handlePlayerLeft = (room: RoomStatePayload) => {
      console.log("[socket] playerLeft", room);
      setRoomCode(room.roomCode);
      setRoomPlayers(room.players);
    };

    const handleBothPlayersReady = (room: RoomStatePayload) => {
      console.log("[socket] bothPlayersReady", room);
      setRoomCode(room.roomCode);
      setRoomPlayers(room.players);
      setDuelResult(null);
      setReactionTimeMs(null);
      setAssemblyStartTimestamp(null);
      setGameplayAssetsLoading(true);
      void ensureWeaponAssetsReady().finally(() => {
        setGameplayAssetsLoading(false);
      });
    };

    const handleGameResult = (payload: {
      winnerPlayerNumber: 1 | 2;
      winnerReactionTimeMs: number | null;
      loserPlayerNumber: 1 | 2 | null;
      loserReactionTimeMs: number | null;
      players: RoomPlayer[];
    }) => {
      console.log("[socket] gameResult", payload);
      setRoomPlayers(payload.players);

      if (!currentPlayerNumber) {
        return;
      }

      const didWin = payload.winnerPlayerNumber === currentPlayerNumber;
      const playerCompletionTimeMs = didWin ? payload.winnerReactionTimeMs : payload.loserReactionTimeMs;

      setDuelResult({
        outcome: didWin ? "win" : "lose",
        playerCompletionTimeMs,
        winnerCompletionTimeMs: payload.winnerReactionTimeMs,
        multiplayer: true,
      });
      setReactionTimeMs(playerCompletionTimeMs);
      navigateTo("result");
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("roomUpdated", handleRoomUpdated);
    socket.on("playerJoined", handlePlayerJoined);
    socket.on("playerLeft", handlePlayerLeft);
    socket.on("bothPlayersReady", handleBothPlayersReady);
    socket.on("gameResult", handleGameResult);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("roomUpdated", handleRoomUpdated);
      socket.off("playerJoined", handlePlayerJoined);
      socket.off("playerLeft", handlePlayerLeft);
      socket.off("bothPlayersReady", handleBothPlayersReady);
      socket.off("gameResult", handleGameResult);
    };
  }, [currentPlayerNumber, socket]);

  useEffect(() => {
    if (currentPage === "create" && !socketAvailable && roomPlayers.length === 0 && !currentPlayerNumber) {
      setRoomCode(generateRoomCode());
      setRoomError(null);
    }
  }, [currentPage, currentPlayerNumber, roomPlayers.length, socketAvailable]);

  return (
    <div className="app-shell">
      {currentPage === "home" ? <PwaInstallPrompt /> : null}
      {showRotateOverlay ? (
        <div className="rotate-overlay" role="dialog" aria-modal="true" aria-label="Rotate phone to play">
          <div className="rotate-overlay-card">
            <div className="rotate-phone-icon" aria-hidden="true">
              <span className="rotate-phone-device" />
              <span className="rotate-phone-arrow">↻</span>
            </div>
            <h1 className="rotate-overlay-title">Please rotate your phone to play</h1>
            <p className="rotate-overlay-text">Velocity Duel is designed for landscape mode.</p>
          </div>
        </div>
      ) : (
        <>
          {APPBAR_PAGES.has(currentPage) ? (
            <GameAppBar
              onHome={handleGoHome}
              roomCode={ROOM_CODE_APPBAR_PAGES.has(currentPage) ? roomCode : null}
            />
          ) : null}

          {isDev && currentPage !== "layout-editor" ? (
            <button
              className="dev-layout-toggle"
              aria-label="Open weapon layout editor"
              onClick={() => navigateTo("layout-editor")}
            >
              Open Layout Editor
            </button>
          ) : null}

          {currentPage === "home" && (
            <HomePage
              setCurrentPage={navigateTo}
              onStartGame={handleCreateRoom}
              isDev={isDev}
              socketDebugText={socketDebugText}
              roomActionLoading={roomActionLoading}
              roomActionLabel={roomActionLabel}
              roomError={roomError}
            />
          )}
          {currentPage === "create" && (
            <CreateRoomPage
              roomCode={roomCode}
              startGame={navigateTo}
              onCreateRoom={handleCreateRoom}
              roomActionLoading={roomActionLoading}
              roomError={roomError}
            />
          )}
          {currentPage === "join" && (
            <JoinRoomPage
              roomCode={roomCode}
              startGame={navigateTo}
              onJoinRoom={handleJoinRoom}
              isDev={isDev}
              socketDebugText={socketDebugText}
              roomActionLoading={roomActionLoading}
              roomActionLabel={roomActionLabel}
              roomError={roomError}
            />
          )}
          {currentPage === "motion-setup" && (
            <MotionSetupPage
              motionPermission={motionPermission}
              pendingGameplayPage={pendingGameplayPage}
              setCurrentPage={navigateTo}
              setMotionPermission={setMotionPermission}
            />
          )}
          {currentPage === "ready" && (
            <ReadyRoomPage
              setCurrentPage={navigateTo}
              useSocketFlow={useSocketReadyFlow}
              currentPlayerNumber={currentPlayerNumber}
              roomPlayers={roomPlayers}
              onToggleReady={handleSocketReadyToggle}
              motionPermission={motionPermission}
              setMotionPermission={setMotionPermission}
              fallbackCurrentNickname={sessionNickname || normalizeNicknameInput(nicknameInput) || "Rocket Duck"}
              fallbackOpponentNickname={fallbackOpponentNickname}
              isPreparingMatch={gameplayAssetsLoading}
            />
          )}
          {currentPage === "assembly" && (
            <WeaponAssemblyPage
              setCurrentPage={navigateTo}
              setReactionTimeMs={setReactionTimeMs}
              onAssemblyStart={setAssemblyStartTimestamp}
            />
          )}
          {currentPage === "weapon-ready" && <WeaponReadyPage setCurrentPage={navigateTo} />}
          {currentPage === "fire" && (
            <FirePhasePage
              motionPermission={motionPermission}
              roomCode={roomCode}
              useSocketFlow={useSocketReadyFlow}
              assemblyStartTimestamp={assemblyStartTimestamp}
              setCurrentPage={navigateTo}
              setReactionTimeMs={setReactionTimeMs}
            />
          )}
          {currentPage === "result" && (
            <ResultPage
              duelResult={duelResult}
              onPlayAgain={handlePlayAgain}
              reactionTimeMs={reactionTimeMs}
            />
          )}
          {isDev && currentPage === "layout-editor" && <WeaponLayoutEditor />}
        </>
      )}
    </div>
  );
}

export default App;
