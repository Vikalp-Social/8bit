import { useEffect, useState, useCallback } from "react";

const ACCENT = "#4fc3f7";
const GOLD   = "#ffd860";

const STARS = ["✦", "★", "✧", "✦", "★", "✧", "✦", "★"];

interface TitleAwardPopupProps {
  title: string;
  description: string;
  level: number;
  levelUp: number;
  onDismiss: () => void;
}

export function TitleAwardPopup({ title, description, level, levelUp, onDismiss }: TitleAwardPopupProps) {
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");
  const [displayedTitle, setDisplayedTitle] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);

  // Typewriter for the title text
  useEffect(() => {
    if (phase !== "show") return;
    setDisplayedTitle("");
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayedTitle(title.slice(0, i));
      if (i >= title.length) {
        clearInterval(interval);
        setTimeout(() => setShowPrompt(true), 400);
      }
    }, 55);
    return () => clearInterval(interval);
  }, [phase, title]);

  // Enter → show transition
  useEffect(() => {
    const t = setTimeout(() => setPhase("show"), 80);
    return () => clearTimeout(t);
  }, []);

  const handleDismiss = useCallback(() => {
    setPhase("exit");
    setTimeout(onDismiss, 340);
  }, [onDismiss]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") handleDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleDismiss]);

  const isEntering = phase === "enter";
  const isExiting  = phase === "exit";

  return (
    <div
      onClick={handleDismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isExiting
          ? "rgba(0,0,0,0)"
          : isEntering
            ? "rgba(0,0,0,0)"
            : "rgba(0,0,0,0.82)",
        transition: "background 0.34s ease",
      }}
    >
      {/* Sparkle ring */}
      {phase === "show" && (
        <div style={{ position: "absolute", pointerEvents: "none" }}>
          {STARS.map((s, i) => {
            const angle = (360 / STARS.length) * i;
            const rad = angle * Math.PI / 180;
            const dist = 210;
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: Math.cos(rad) * dist - 8,
                  top: Math.sin(rad) * dist - 8,
                  fontSize: i % 2 === 0 ? 18 : 13,
                  color: i % 3 === 0 ? GOLD : ACCENT,
                  opacity: 0.7,
                  animation: `starPulse ${1.2 + (i % 3) * 0.4}s ease-in-out infinite alternate`,
                  animationDelay: `${i * 0.15}s`,
                }}
              >
                {s}
              </span>
            );
          })}
        </div>
      )}

      {/* Main card */}
      <div
        style={{
          background: "#0c1220",
          border: `2px solid ${GOLD}`,
          boxShadow: isExiting
            ? "none"
            : `0 0 0 4px #0c1220, 0 0 0 6px ${GOLD}55, 0 0 40px ${GOLD}33, inset 0 0 30px rgba(0,0,0,0.5)`,
          borderRadius: 8,
          padding: "36px 44px 28px",
          maxWidth: 440,
          width: "88vw",
          textAlign: "center",
          fontFamily: "ui-monospace, 'Courier New', monospace",
          transform: isEntering || isExiting ? "scale(0.82) translateY(24px)" : "scale(1) translateY(0)",
          opacity: isEntering || isExiting ? 0 : 1,
          transition: "transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease",
          position: "relative",
        }}
      >
        {/* Corner decorations */}
        {["topLeft", "topRight", "bottomLeft", "bottomRight"].map((corner) => (
          <span
            key={corner}
            style={{
              position: "absolute",
              fontSize: 11,
              color: GOLD,
              opacity: 0.6,
              top: corner.includes("top") ? 8 : undefined,
              bottom: corner.includes("bottom") ? 8 : undefined,
              left: corner.includes("Left") ? 10 : undefined,
              right: corner.includes("Right") ? 10 : undefined,
            }}
          >
            ✦
          </span>
        ))}

        {/* Sage announcement */}
        <div style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.45)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 18,
        }}>
          ✦ The Sage Bestows ✦
        </div>

        {/* Level row — always shown if level > 0 */}
        {level > 0 && phase === "show" && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 16,
            animation: "fadeInUp 0.4s ease",
          }}>
            <span style={{
              fontSize: 15,
              fontWeight: "bold",
              color: "#ffd860",
              background: "rgba(255,216,96,0.1)",
              border: "1px solid rgba(255,216,96,0.4)",
              borderRadius: 5,
              padding: "3px 12px",
              letterSpacing: "0.08em",
            }}>
              LEVEL {level}
            </span>
            {levelUp > 0 && (
              <span style={{
                fontSize: 13,
                color: "#4fc3f7",
                animation: "levelUpBounce 0.6s cubic-bezier(0.34,1.56,0.64,1)",
                display: "inline-block",
              }}>
                +{levelUp} {levelUp === 1 ? "level" : "levels"} ↑
              </span>
            )}
          </div>
        )}

        {/* "A title has been awarded" label */}
        <div style={{
          fontSize: 13,
          color: ACCENT,
          marginBottom: 22,
          letterSpacing: "0.06em",
        }}>
          A title has been awarded to you
        </div>

        {/* Title — typewriter reveal */}
        <div style={{
          fontSize: 30,
          fontWeight: "bold",
          color: GOLD,
          letterSpacing: "0.04em",
          lineHeight: 1.25,
          minHeight: 38,
          textShadow: `0 0 18px ${GOLD}88`,
        }}>
          {displayedTitle}
          {displayedTitle.length < title.length && (
            <span style={{ animation: "cursorBlink 0.6s step-end infinite", color: GOLD }}>▮</span>
          )}
        </div>

        {/* Description */}
        {description && phase === "show" && displayedTitle.length >= title.length && (
          <div style={{
            marginTop: 14,
            fontSize: 12,
            color: "rgba(255,255,255,0.5)",
            fontStyle: "italic",
            lineHeight: 1.5,
            animation: "fadeInUp 0.5s ease",
          }}>
            {description}
          </div>
        )}

        {/* Dismiss prompt */}
        <div style={{
          marginTop: 28,
          fontSize: 11,
          color: "rgba(255,255,255,0.25)",
          letterSpacing: "0.1em",
          opacity: showPrompt ? 1 : 0,
          transition: "opacity 0.4s ease",
          animation: showPrompt ? "blinkPrompt 1.1s step-end infinite" : "none",
        }}>
          ▶ PRESS ENTER OR CLICK TO CONTINUE
        </div>
      </div>

      <style>{`
        @keyframes starPulse {
          from { transform: scale(0.85) rotate(-8deg); opacity: 0.5; }
          to   { transform: scale(1.15) rotate(8deg);  opacity: 1; }
        }
        @keyframes cursorBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes blinkPrompt {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes levelUpBounce {
          0%   { opacity: 0; transform: translateY(8px) scale(0.8); }
          60%  { opacity: 1; transform: translateY(-4px) scale(1.1); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
