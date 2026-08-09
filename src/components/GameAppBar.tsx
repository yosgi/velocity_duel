import { useEffect, useState } from "react";

type Props = {
  onBack: () => void;
  roomCode?: string | null;
};

function GameAppBar({ onBack, roomCode }: Props) {
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (copyFeedback === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setCopyFeedback("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const handleCopyRoomCode = async () => {
    if (!roomCode) {
      return;
    }
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

  return (
    <nav className="game-appbar" aria-label="Game navigation">
      <button className="game-appbar-button" type="button" onClick={onBack} aria-label="Back">
        <span aria-hidden="true">←</span>
        <span>BACK</span>
      </button>

      {roomCode ? (
        <button
          type="button"
          className="game-appbar-code"
          onClick={handleCopyRoomCode}
          aria-label={`Room code ${roomCode}, tap to copy`}
        >
          <span className="game-appbar-code-label">ROOM</span>
          <span className="game-appbar-code-value">{roomCode}</span>
          <span className="game-appbar-code-status" aria-hidden="true">
            {copyFeedback === "copied" ? "✓" : copyFeedback === "failed" ? "!" : "⧉"}
          </span>
        </button>
      ) : null}
    </nav>
  );
}

export default GameAppBar;
