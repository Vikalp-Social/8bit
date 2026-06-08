import { useCallback, useEffect, useState } from "react";

function tilesBase(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return b.endsWith("/") ? b : `${b}/`;
}

export function storySpritePublicUrl(spriteFile: string): string {
  return `${tilesBase()}tiles/${spriteFile}`;
}

interface StoryDialogOverlayProps {
  open: boolean;
  title: string;
  lines: string[];
  /** Portrait URLs (neutral + optional happy). */
  portraitNeutralSrc: string;
  portraitHappySrc: string;
  /** After intro key exists for this tab — happier portrait baseline. */
  repeatSessionGreeting: boolean;
  /** When user exits after seeing last line of first-intro flow. */
  onCompleteIntro: () => void;
  onClose: () => void;
  /** When true, the dark backdrop is hidden (e.g. Flora's full-screen tree shows behind). */
  transparentBackdrop?: boolean;
}

/**
 * Lightweight Pokémon-professor-style text box — advance with Space / Enter / tap / A.
 */
export function StoryDialogOverlay({
  open,
  title,
  lines,
  transparentBackdrop = false,
  portraitNeutralSrc,
  portraitHappySrc,
  repeatSessionGreeting,
  onCompleteIntro,
  onClose,
}: StoryDialogOverlayProps) {
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    if (open) setPageIdx(0);
  }, [open, lines]);

  const total = Math.max(1, lines.length);
  const isLastPage = pageIdx >= total - 1;
  const portraitSrc =
    repeatSessionGreeting || isLastPage ? portraitHappySrc : portraitNeutralSrc;

  const advance = useCallback(() => {
    if (!open) return;
    if (!isLastPage) {
      setPageIdx((p) => p + 1);
      return;
    }
    if (!repeatSessionGreeting) onCompleteIntro();
    onClose();
  }, [open, isLastPage, repeatSessionGreeting, onCompleteIntro, onClose]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, advance, onClose]);

  if (!open || lines.length === 0) return null;

  const body = lines[pageIdx] ?? "";

  return (
    <>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 54,
          background: transparentBackdrop ? "transparent" : "rgba(0,0,0,0.55)",
          pointerEvents: "auto",
        }}
      />
      <div
        role="dialog"
        aria-labelledby="story-dialog-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) advance();
        }}
        style={{
          position: "absolute",
          left: "4%",
          right: "4%",
          bottom: "max(28px, 6vh)",
          zIndex: 55,
          fontFamily: "monospace",
          pointerEvents: "auto",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        {/* Outer frame */}
        <div
          style={{
            borderRadius: 8,
            padding: 4,
            background: "#1a2842",
            boxShadow:
              "0 0 0 2px #c8b88a, inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 28px rgba(0,0,0,0.45)",
          }}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              advance();
            }}
            style={{
              background: "#0f1830ee",
              borderRadius: 4,
              border: "3px solid #2f4a73",
              display: "grid",
              gridTemplateColumns: "minmax(132px, 36%) 1fr",
              gap: 14,
              padding: "14px 16px",
              cursor: "pointer",
              color: "#e8eaf0",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
              }}
            >
              <img
                src={portraitSrc}
                alt=""
                loading="lazy"
                style={{
                  width: "min(200px, 30vw)",
                  height: "auto",
                  imageRendering: "pixelated",
                  filter: "drop-shadow(4px 4px 0 rgba(0,0,0,0.45))",
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 120 }}>
              <div
                id="story-dialog-title"
                style={{
                  alignSelf: "flex-start",
                  background: "#233b5ecc",
                  border: "2px solid #6b93c4",
                  borderRadius: 4,
                  padding: "6px 12px",
                  fontSize: 14,
                  fontWeight: "bold",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                {title}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  lineHeight: 1.55,
                  flex: 1,
                  overflow: "hidden",
                  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {body}
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                  color: "#aad3ffaa",
                  borderTop: "1px dashed #395880",
                  paddingTop: 8,
                  marginTop: 4,
                }}
              >
                <span>{isLastPage ? "Close" : "Next"} ▶ Space / Enter / tap</span>
                <span>
                  ({pageIdx + 1}/{total})
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
