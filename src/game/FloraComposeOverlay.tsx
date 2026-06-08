import { useCallback, useEffect, useRef, useState } from "react";

const GREEN = "#5a9e3a";
const LIGHT = "#a8d878";
const MAX_LEN = 500;

interface FloraComposeOverlayProps {
  postsMade: number;
  onPost: (content: string) => Promise<boolean>;
  onSkip: () => void;
}

export function FloraComposeOverlay({ postsMade, onPost, onSkip }: FloraComposeOverlayProps) {
  const [text, setText]       = useState("");
  const [phase, setPhase]     = useState<"compose" | "posting" | "success" | "error">("compose");
  const [visible, setVisible] = useState(false);
  const textareaRef           = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(true);
      textareaRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, []);

  const handleSkip = useCallback(() => {
    setVisible(false);
    setTimeout(onSkip, 280);
  }, [onSkip]);

  const handlePost = useCallback(async () => {
    if (!text.trim() || phase !== "compose") return;
    setPhase("posting");
    const ok = await onPost(text.trim());
    setPhase(ok ? "success" : "error");
    if (ok) setTimeout(() => { setVisible(false); setTimeout(onSkip, 280); }, 1800);
  }, [text, phase, onPost, onSkip]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { handleSkip(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void handlePost();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSkip, handlePost]);

  const remaining = MAX_LEN - text.length;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) handleSkip(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: visible ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0)",
        transition: "background 0.28s ease",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        background: "rgba(13,26,15,0.92)",
        border: `2px solid ${GREEN}`,
        boxShadow: `0 0 0 4px rgba(13,26,15,0.5), 0 0 0 6px ${GREEN}55, 0 0 48px ${GREEN}22`,
        borderRadius: 10,
        padding: "22px 28px 18px",
        maxWidth: 460, width: "88vw",
        fontFamily: "ui-monospace, 'Courier New', monospace",
        transform: visible ? "scale(1) translateY(0)" : "scale(0.88) translateY(20px)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.28s cubic-bezier(0.34,1.4,0.64,1), opacity 0.28s ease",
        backdropFilter: "blur(2px)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 11, color: LIGHT, letterSpacing: "0.1em",
          textTransform: "uppercase", marginBottom: 16,
        }}>
          <span>🌿 Speak to the World</span>
          <span style={{ fontSize: 12, letterSpacing: "0.05em", color: GREEN }}>
            🍃 {phase === "success" ? postsMade + 1 : postsMade}
          </span>
        </div>

        {phase === "success" ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>🍃</div>
            <div style={{ color: LIGHT, fontSize: 14 }}>Your words bloom as a leaf.</div>
          </div>
        ) : phase === "error" ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "#ef9a9a", fontSize: 13 }}>
            Something went wrong — your words were not sent.
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              disabled={phase === "posting"}
              placeholder="What's on your mind?"
              rows={5}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${GREEN}66`,
                borderRadius: 4, padding: "10px 12px",
                color: "#e0e0e0", fontSize: 13,
                fontFamily: "inherit", resize: "vertical",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 12 }}>
              <span style={{ fontSize: 11, color: remaining < 50 ? "#ef9a9a" : "rgba(255,255,255,0.3)" }}>
                {remaining} left
              </span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  onClick={handleSkip}
                  style={{
                    background: "none", border: "none",
                    color: "rgba(255,255,255,0.35)", cursor: "pointer",
                    fontFamily: "inherit", fontSize: 12, padding: "4px 8px",
                  }}
                >
                  Not now
                </button>
                <button
                  onClick={() => { void handlePost(); }}
                  disabled={!text.trim() || phase === "posting"}
                  style={{
                    background: text.trim() ? GREEN : "rgba(255,255,255,0.06)",
                    border: "none", borderRadius: 4,
                    color: text.trim() ? "#fff" : "rgba(255,255,255,0.25)",
                    cursor: text.trim() ? "pointer" : "default",
                    fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                    padding: "6px 20px",
                    opacity: phase === "posting" ? 0.6 : 1,
                    transition: "background 0.15s",
                  }}
                >
                  {phase === "posting" ? "Posting…" : "Post"}
                </button>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "right" }}>
              Ctrl+Enter to post · Esc to close
            </div>
          </>
        )}
      </div>
    </div>
  );
}
