import { useEffect, useMemo, useRef, useState } from "react";
import type { MotionPermissionState, Page, RoomPlayer } from "../App";
import WeaponCanvas from "../components/WeaponCanvas";
import { DEFAULT_WEAPON_LAYOUT } from "../components/weaponCanvasConfig";
import player1 from "../assets/characters/player1.png";
import player2 from "../assets/characters/player2.png";
import { unlockGameAudio } from "../lib/gameAudio";

type Props = {
  roomCode: string;
  setCurrentPage: (page: Page) => void;
  useSocketFlow?: boolean;
  currentPlayerNumber?: 1 | 2 | null;
  roomPlayers?: RoomPlayer[];
  onToggleReady?: () => void;
  motionPermission: MotionPermissionState;
  setMotionPermission: (value: MotionPermissionState) => void;
  fallbackCurrentNickname?: string;
  fallbackOpponentNickname?: string;
  isPreparingMatch?: boolean;
};

type IOSDeviceMotionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

async function requestMotionAccess() {
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
    return "unavailable" as MotionPermissionState;
  }

  const motionEvent = DeviceMotionEvent as IOSDeviceMotionEvent;
  if (typeof motionEvent.requestPermission === "function") {
    const permission = await motionEvent.requestPermission();
    return permission === "granted" ? "granted" : "denied";
  }

  return "granted" as MotionPermissionState;
}

function ReadyRoomPage({
  roomCode,
  setCurrentPage,
  useSocketFlow = false,
  currentPlayerNumber = null,
  roomPlayers = [],
  onToggleReady,
  motionPermission,
  setMotionPermission,
  fallbackCurrentNickname = "Rocket Duck",
  fallbackOpponentNickname = "Chaos Banana",
  isPreparingMatch = false,
}: Props) {
  const [player1Ready, setPlayer1Ready] = useState(false);
  const [player2Ready, setPlayer2Ready] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "failed">("idle");
  const socketCountdownStartedRef = useRef(false);
  const isTouchDevice =
    typeof window !== "undefined" &&
    (navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches === true);

  const socketPlayer1 = useMemo(
    () => roomPlayers.find((player) => player.playerNumber === 1),
    [roomPlayers],
  );
  const socketPlayer2 = useMemo(
    () => roomPlayers.find((player) => player.playerNumber === 2),
    [roomPlayers],
  );

  const requestPermissionAndReady = async (playerNumber: 1 | 2) => {
    unlockGameAudio();

    const triggerReady = () => {
      setPermissionMessage(null);

      if (useSocketFlow) {
        if (currentPlayerNumber === playerNumber) {
          onToggleReady?.();
        }
        return;
      }

      if (playerNumber === 1) {
        const nextPlayer1Ready = !player1Ready;
        const nextBothReady = nextPlayer1Ready && player2Ready;
        setPlayer1Ready(nextPlayer1Ready);
        setCountdown(nextBothReady ? 3 : null);
        return;
      }

      const nextPlayer2Ready = !player2Ready;
      const nextBothReady = player1Ready && nextPlayer2Ready;
      setPlayer2Ready(nextPlayer2Ready);
      setCountdown(nextBothReady ? 3 : null);
    };

    if (!isTouchDevice) {
      triggerReady();
      return;
    }

    if (motionPermission === "granted") {
      triggerReady();
      return;
    }

    try {
      setMotionPermission("requesting");
      const result = await requestMotionAccess();

      if (result === "granted") {
        setMotionPermission("granted");
        triggerReady();
        return;
      }

      setMotionPermission(result);
      setPermissionMessage("Motion access is required to play on mobile. Please enable motion permission and try again.");
    } catch {
      setMotionPermission("denied");
      setPermissionMessage("Motion access is required to play on mobile. Please enable motion permission and try again.");
    }
  };

  const handlePlayer1Toggle = () => {
    if (useSocketFlow && currentPlayerNumber !== 1) {
      return;
    }
    void requestPermissionAndReady(1);
  };

  const handlePlayer2Toggle = () => {
    if (useSocketFlow && currentPlayerNumber !== 2) {
      return;
    }
    void requestPermissionAndReady(2);
  };

  const handleCopyRoomCode = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopyFeedback("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("failed");
    }
  };

  useEffect(() => {
    if (!useSocketFlow) {
      return;
    }

    const bothPlayersReady = Boolean(socketPlayer1?.ready && socketPlayer2?.ready);

    if (bothPlayersReady && !socketCountdownStartedRef.current) {
      socketCountdownStartedRef.current = true;
      const timer = window.setTimeout(() => setCountdown(3), 0);
      return () => window.clearTimeout(timer);
    }

    if (!bothPlayersReady) {
      socketCountdownStartedRef.current = false;
      const timer = window.setTimeout(() => setCountdown(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [socketPlayer1?.ready, socketPlayer2?.ready, useSocketFlow]);

  useEffect(() => {
    if (countdown === null) {
      return;
    }

    if (countdown === 0) {
      if (isPreparingMatch) {
        return;
      }
      setCurrentPage("assembly");
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((current) => (current === null ? null : current - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdown, isPreparingMatch, setCurrentPage]);

  useEffect(() => {
    if (copyFeedback === "idle") {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopyFeedback("idle");
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const displayPlayer1Ready = useSocketFlow ? (socketPlayer1?.ready ?? false) : player1Ready;
  const displayPlayer2Ready = useSocketFlow ? (socketPlayer2?.ready ?? false) : player2Ready;
  const displayCountdown = countdown;
  const player1IsCurrent = !useSocketFlow || currentPlayerNumber === 1;
  const player2IsCurrent = !useSocketFlow || currentPlayerNumber === 2;
  const player1Present = useSocketFlow ? Boolean(socketPlayer1) : true;
  const player2Present = useSocketFlow ? Boolean(socketPlayer2) : true;
  const player1Name = useSocketFlow
    ? socketPlayer1?.nickname ?? "Waiting..."
    : currentPlayerNumber === 2
      ? fallbackOpponentNickname
      : fallbackCurrentNickname;
  const player2Name = useSocketFlow
    ? socketPlayer2?.nickname ?? "Waiting..."
    : currentPlayerNumber === 2
      ? fallbackCurrentNickname
      : fallbackOpponentNickname;

  const getActionLabel = (isCurrentPlayer: boolean, isReady: boolean) => {
    if (isReady) {
      return "READY";
    }

    if (!isCurrentPlayer) {
      return "NOT READY";
    }

    if (!isTouchDevice) {
      return "READY";
    }

    if (motionPermission === "requesting") {
      return "CHECKING...";
    }

    if (motionPermission === "denied" || motionPermission === "unavailable") {
      return "TRY AGAIN";
    }

    if (motionPermission === "granted") {
      return "READY";
    }

    return "ENABLE MOTION";
  };

  const getOtherPlayerStatus = (isPresent: boolean, isReady: boolean) => {
    if (!isPresent) {
      return "WAITING";
    }

    if (isReady) {
      return "READY";
    }

    return "NOT READY";
  };

  const renderPlayerAction = (
    isCurrentPlayer: boolean,
    isPresent: boolean,
    isReady: boolean,
    onToggle: () => void,
  ) => {
    if (!isCurrentPlayer) {
      return (
        <div className="ready-status ready-status-passive ready-opponent-status">
          {isReady && <span className="ready-checkmark">✓</span>}
          <span>{getOtherPlayerStatus(isPresent, isReady)}</span>
        </div>
      );
    }

    if (isReady) {
      return (
        <div className="ready-status ready-status-active ready-badge ready-badge-on">
          <span className="ready-checkmark">✓</span>
          <span>READY</span>
        </div>
      );
    }

    return (
      <button type="button" className="ready-badge ready-badge-off" onClick={onToggle}>
        <span>{getActionLabel(isCurrentPlayer, isReady)}</span>
      </button>
    );
  };

  return (
    <main className="screen ready-screen">
      <section className="ready-shell">
        <div className="ready-stars" aria-hidden="true">
          <span className="ready-dot dot-yellow dot-1" />
          <span className="ready-dot dot-white dot-2" />
          <span className="ready-dot dot-blue dot-3" />
          <span className="ready-star star-1">★</span>
          <span className="ready-star star-2">✦</span>
          <span className="ready-star star-3">★</span>
          <span className="ready-splash splash-left" />
          <span className="ready-splash splash-right" />
        </div>

        <article className={`ready-stage ${displayCountdown !== null ? "is-counting-down" : ""}`}>
          {displayCountdown !== null ? (
            <div className="ready-tutorial" role="status" aria-live="assertive">
              <div className="ready-tutorial-count">
                <span className="ready-tutorial-eyebrow">GET READY</span>
                <span key={displayCountdown} className="ready-tutorial-number">
                  {displayCountdown > 0 ? displayCountdown : "GO"}
                </span>
              </div>

              <div className="ready-tutorial-demo" aria-hidden="true">
                <div className="ready-tutorial-steps">
                  <div className="ready-tutorial-step ready-tutorial-step-assemble">
                    <span className="ready-tutorial-step-icon">✦</span>
                    <span>ASSEMBLE</span>
                  </div>
                  <span className="ready-tutorial-step-arrow">›</span>
                  <div className="ready-tutorial-step ready-tutorial-step-fire">
                    <span className="ready-tutorial-step-icon ready-tutorial-phone-icon" />
                    <span>SHAKE TO FIRE</span>
                  </div>
                </div>

                <div className="ready-tutorial-assembly">
                  <div className="ready-tutorial-canvas">
                    <WeaponCanvas
                      layout={DEFAULT_WEAPON_LAYOUT}
                      partClassName="ready-tutorial-weapon-part"
                      showLabels={false}
                    />
                  </div>
                  <span className="ready-tutorial-snap ready-tutorial-snap-magazine">✦</span>
                  <span className="ready-tutorial-snap ready-tutorial-snap-slide">✦</span>
                </div>

                <div className="ready-tutorial-fire">
                  <span className="ready-tutorial-motion ready-tutorial-motion-left" />
                  <div className="ready-tutorial-phone">
                    <span className="ready-tutorial-speaker" />
                    <span className="ready-tutorial-phone-screen">
                      <span className="ready-tutorial-mini-gun" />
                    </span>
                  </div>
                  <span className="ready-tutorial-motion ready-tutorial-motion-right" />
                  <span className="ready-tutorial-muzzle-flash">✦</span>
                  <span className="ready-tutorial-fire-ring" />
                </div>
              </div>

              <p className="visually-hidden">Assemble the weapon, then shake your phone to fire.</p>
            </div>
          ) : (
            <>
              <div className="ready-room-code">
                <div className="ready-room-code-copy">
                  <div className="ready-room-code-text">
                    <span className="ready-room-code-label">ROOM CODE</span>
                    <strong className="ready-room-code-value">{roomCode}</strong>
                  </div>
                  <button type="button" className="ready-copy-button" onClick={handleCopyRoomCode}>
                    {copyFeedback === "copied" ? "COPIED" : "COPY"}
                  </button>
                </div>
                {copyFeedback === "failed" ? <span className="ready-copy-feedback">Copy unavailable</span> : null}
              </div>

              <h1 className="ready-title">READY?</h1>

              <div className="ready-lineup">
                <div className="ready-player">
                  <div className="ready-avatar ready-avatar-blue">
                    <img src={player1} alt="Player 1 avatar" className="ready-avatar-image" />
                  </div>
                  <div className="ready-label ready-label-blue">
                    {player1Name}
                    {player1IsCurrent ? <span className="ready-you-label">(YOU)</span> : null}
                  </div>
                  {renderPlayerAction(player1IsCurrent, player1Present, displayPlayer1Ready, handlePlayer1Toggle)}
                </div>

                <div className="ready-count-zone ready-count-hidden" />

                <div className="ready-player">
                  <div className="ready-avatar ready-avatar-pink">
                    <img
                      src={player2}
                      alt="Player 2 avatar"
                      className="ready-avatar-image ready-avatar-image-player2"
                    />
                  </div>
                  <div className="ready-label ready-label-red">
                    {player2Name}
                    {player2IsCurrent ? <span className="ready-you-label">(YOU)</span> : null}
                  </div>
                  {renderPlayerAction(player2IsCurrent, player2Present, displayPlayer2Ready, handlePlayer2Toggle)}
                </div>
              </div>

              {permissionMessage ? <p className="section-text ready-permission-message">{permissionMessage}</p> : null}
              {isPreparingMatch ? <p className="section-text ready-permission-message">Loading the duel gear...</p> : null}
            </>
          )}

        </article>
      </section>
    </main>
  );
}

export default ReadyRoomPage;
