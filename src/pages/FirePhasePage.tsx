import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MotionPermissionState, Page } from "../App";
import WeaponCanvas from "../components/WeaponCanvas";
import { readSavedWeaponLayout } from "../components/weaponCanvasConfig";
import { playGameSound, unlockGameAudio } from "../lib/gameAudio";
import { getSocket } from "../lib/socket";
import { clearActiveInputFocus } from "../lib/gamePresentation";

type Props = {
  motionPermission: MotionPermissionState;
  roomCode: string;
  useSocketFlow?: boolean;
  assemblyStartTimestamp: number | null;
  setCurrentPage: (page: Page) => void;
  setReactionTimeMs: (value: number | null) => void;
};

const SHAKE_THRESHOLD = 12;
const FIRE_BUTTON_DELAY_MS = 1000;

function FirePhasePage({
  motionPermission,
  roomCode,
  useSocketFlow = false,
  assemblyStartTimestamp,
  setCurrentPage,
  setReactionTimeMs,
}: Props) {
  const layout = useMemo(() => readSavedWeaponLayout(), []);
  const socket = useMemo(() => getSocket(), []);
  const [isFired, setIsFired] = useState(false);
  const [isRecoiling, setIsRecoiling] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [showShake, setShowShake] = useState(false);
  const [reactionMs, setReactionMs] = useState<number | null>(null);
  const [showFireButton, setShowFireButton] = useState(false);
  const hasFiredRef = useRef(false);
  const isArmedRef = useRef(false);
  const hasBaselineRef = useRef(false);
  const lastAccelerationRef = useRef({ x: 0, y: 0, z: 0 });
  const recoilTimeoutRef = useRef<number | null>(null);
  const shakeTimeoutRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const resultTimeoutRef = useRef<number | null>(null);
  const fireButtonTimeoutRef = useRef<number | null>(null);
  const screenRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    clearActiveInputFocus();
    screenRef.current?.focus({ preventScroll: true });
    console.log("[FirePhase] reset fire state");
    console.log("[FirePhase] mount");
    setReactionTimeMs(null);
    setIsFired(false);
    setIsRecoiling(false);
    setShowFlash(false);
    setShowShake(false);
    setReactionMs(null);
    setShowFireButton(false);
    hasFiredRef.current = false;
    isArmedRef.current = true;
    hasBaselineRef.current = false;
    lastAccelerationRef.current = { x: 0, y: 0, z: 0 };

    fireButtonTimeoutRef.current = window.setTimeout(() => setShowFireButton(true), FIRE_BUTTON_DELAY_MS);

    return () => {
      if (recoilTimeoutRef.current) {
        window.clearTimeout(recoilTimeoutRef.current);
      }
      if (shakeTimeoutRef.current) {
        window.clearTimeout(shakeTimeoutRef.current);
      }
      if (flashTimeoutRef.current) {
        window.clearTimeout(flashTimeoutRef.current);
      }
      if (resultTimeoutRef.current) {
        window.clearTimeout(resultTimeoutRef.current);
      }
      if (fireButtonTimeoutRef.current) {
        window.clearTimeout(fireButtonTimeoutRef.current);
      }
    };
  }, [setReactionTimeMs]);

  const handleFire = useCallback(
    (source: "motion" | "keyboard" | "tap") => {
      if (hasFiredRef.current) {
        return;
      }

      if (assemblyStartTimestamp === null) {
        console.error("[FirePhase] missing assembly start timestamp");
        return;
      }

      const fireTimestamp = performance.now();
      const elapsed = Math.round(fireTimestamp - assemblyStartTimestamp);
      console.log("[FirePhase] fire triggered", {
        source,
        assemblyStartTimestamp,
        fireTimestamp,
        totalCompletionMs: elapsed,
      });
      hasFiredRef.current = true;
      setIsFired(true);
      setReactionMs(elapsed);
      setReactionTimeMs(elapsed);
      setIsRecoiling(true);
      setShowShake(true);
      setShowFlash(true);
      playGameSound("arcade-gunshot");

      if (navigator.vibrate) {
        navigator.vibrate([60, 30, 90]);
      }

      recoilTimeoutRef.current = window.setTimeout(() => setIsRecoiling(false), 220);
      shakeTimeoutRef.current = window.setTimeout(() => setShowShake(false), 320);
      flashTimeoutRef.current = window.setTimeout(() => setShowFlash(false), 180);
      if (useSocketFlow && socket.connected && roomCode) {
        socket.emit("playerFired", { roomCode, reactionTimeMs: elapsed }, (result: { ok: boolean; error?: string }) => {
          console.log("[socket] playerFired", result);
        });
      } else {
        resultTimeoutRef.current = window.setTimeout(() => setCurrentPage("result"), 1100);
      }
    },
    [assemblyStartTimestamp, roomCode, setCurrentPage, setReactionTimeMs, socket, useSocketFlow],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        unlockGameAudio();
        handleFire("keyboard");
      }
    };

    const handleMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity ?? event.acceleration;
      const x = acceleration?.x ?? 0;
      const y = acceleration?.y ?? 0;
      const z = acceleration?.z ?? 0;
      const intensity = Math.sqrt(x * x + y * y + z * z);
      const previous = lastAccelerationRef.current;
      const deltaX = x - previous.x;
      const deltaY = y - previous.y;
      const deltaZ = z - previous.z;
      const deltaMagnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);

      lastAccelerationRef.current = { x, y, z };

      if (!hasBaselineRef.current) {
        hasBaselineRef.current = true;
        return;
      }

      if (!isArmedRef.current) {
        console.log("[FirePhase] motion ignored during warm-up", {
          magnitude: Number(intensity.toFixed(3)),
          deltaMagnitude: Number(deltaMagnitude.toFixed(3)),
        });
        return;
      }

      if (deltaMagnitude > SHAKE_THRESHOLD) {
        handleFire("motion");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    if (motionPermission === "granted" || motionPermission === "unavailable") {
      window.addEventListener("devicemotion", handleMotion);
    }

    return () => {
      console.log("[FirePhase] cleanup motion listeners");
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [handleFire, motionPermission]);

  return (
    <main
      ref={screenRef}
      tabIndex={-1}
      className={`screen fire-phase-screen ${showShake ? "fire-phase-screen-shake" : ""} ${isFired ? "is-fired" : ""}`}
    >
      <section className="layout-editor-shell">
        <header className="layout-editor-topbar" />

        <section className="layout-editor-canvas-card fire-phase-card">
          <WeaponCanvas
            layout={layout}
            partClassName={`is-readonly ${isRecoiling ? "fire-phase-weapon-recoil" : "fire-phase-weapon-idle"}`}
            selectedPartId={null}
            showLabels={false}
            visiblePartIds={["weaponMagazine", "weaponFrame", "weaponSlide"]}
          />

          <div className={`fire-phase-flash ${showFlash ? "is-visible" : ""}`} aria-hidden="true" />

          {!reactionMs ? (
            <div className="fire-phase-hint-stack">
              <p className="game-hint-banner" role="status" aria-live="polite">
                SHAKE TO FIRE
              </p>
              {showFireButton ? (
                <button
                  type="button"
                  className="button button-yellow fire-phase-fire-button"
                  onClick={() => handleFire("tap")}
                >
                  FIRE
                </button>
              ) : null}
            </div>
          ) : null}

          {reactionMs ? (
            <div className="fire-phase-overlay">
              <div className="fire-phase-reaction">Fired in {reactionMs} ms</div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

export default FirePhasePage;
