import { useCallback, useEffect, useState } from "react";

const HALLS = [
  { key: "tech",     label: "Tech",    color: "#4fc3f7" },
  { key: "art",      label: "Art",     color: "#f48fb1" },
  { key: "science",  label: "Sci",     color: "#a5d6a7" },
  { key: "nature",   label: "Nature",  color: "#81c784" },
  { key: "gaming",   label: "Game",    color: "#ce93d8" },
  { key: "music",    label: "Music",   color: "#ffcc02" },
  { key: "politics", label: "Pol",     color: "#ef9a9a" },
  { key: "general",  label: "Gen",     color: "#b0bec5" },
];

const N = HALLS.length;
const ACCENT = "#4fc3f7";

function polarToXY(angle: number, r: number, cx: number, cy: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function buildPolygon(values: number[], maxVal: number, radius: number, cx: number, cy: number) {
  return values.map((v, i) => {
    const angle = (2 * Math.PI * i) / N - Math.PI / 2;
    const r = maxVal > 0 ? (v / maxVal) * radius : 0;
    const { x, y } = polarToXY(angle, r, cx, cy);
    return `${x},${y}`;
  }).join(" ");
}

interface RadarSVGProps {
  hallCounts: Record<string, number>;
  size: number;
  animated?: boolean;
}

function RadarSVG({ hallCounts, size, animated = false }: RadarSVGProps) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.37;
  const values = HALLS.map((h) => hallCounts[h.key] ?? 0);
  const maxVal = Math.max(...values, 10);
  const rings = [0.33, 0.66, 1];

  const polygon = buildPolygon(values, maxVal, radius, cx, cy);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {/* Background */}
      <rect x={0} y={0} width={size} height={size} rx={8} fill="rgba(0,0,0,0.72)" />

      {/* Grid rings */}
      {rings.map((ratio) => {
        const pts = HALLS.map((_, i) => {
          const angle = (2 * Math.PI * i) / N - Math.PI / 2;
          const { x, y } = polarToXY(angle, radius * ratio, cx, cy);
          return `${x},${y}`;
        }).join(" ");
        return (
          <polygon key={ratio} points={pts} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        );
      })}

      {/* Axis spokes */}
      {HALLS.map((_, i) => {
        const angle = (2 * Math.PI * i) / N - Math.PI / 2;
        const { x, y } = polarToXY(angle, radius, cx, cy);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />;
      })}

      {/* Data polygon */}
      <polygon
        points={polygon}
        fill={`${ACCENT}33`}
        stroke={ACCENT}
        strokeWidth={animated ? 1.5 : 1}
        strokeLinejoin="round"
      />

      {/* Data dots */}
      {values.map((v, i) => {
        const angle = (2 * Math.PI * i) / N - Math.PI / 2;
        const r = maxVal > 0 ? (v / maxVal) * radius : 0;
        const { x, y } = polarToXY(angle, r, cx, cy);
        return v > 0 ? (
          <circle key={i} cx={x} cy={y} r={2.5} fill={HALLS[i].color} />
        ) : null;
      })}

      {/* Axis labels */}
      {HALLS.map((h, i) => {
        const angle = (2 * Math.PI * i) / N - Math.PI / 2;
        const labelR = radius + (size < 200 ? 13 : 20);
        const { x, y } = polarToXY(angle, labelR, cx, cy);
        const count = hallCounts[h.key] ?? 0;
        return (
          <text
            key={h.key}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={size < 200 ? 9 : 12}
            fontFamily="monospace"
            fill={count > 0 ? h.color : "rgba(255,255,255,0.35)"}
          >
            {size < 200 ? h.label.slice(0, 3) : `${h.label} (${count})`}
          </text>
        );
      })}
    </svg>
  );
}

function useViewportWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return w;
}

interface RadarChartProps {
  hallCounts: Record<string, number>;
  earnedTitle: { title: string; description: string; milestone: number } | null;
  level: number;
  titleFetching: boolean;
  visible: boolean;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}

export function RadarChart({ hallCounts, earnedTitle, level, titleFetching, visible, expanded, onExpand, onClose }: RadarChartProps) {
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const vw = useViewportWidth();
  const isMobile = vw < 640;
  // On mobile show a smaller widget; on desktop keep 160px
  const collapsedSize = isMobile ? 90 : 160;

  const totalRead = Object.values(hallCounts).reduce((a, b) => a + b, 0);

  if (!visible) return null;

  return (
    <>
      {/* Collapsed widget — bottom-left */}
      {!expanded && (
        <div
          onClick={onExpand}
          style={{
            position: "absolute",
            left: 10,
            bottom: isMobile ? 56 : 46,
            cursor: "pointer",
            userSelect: "none",
            zIndex: 50,
          }}
          title="Tap to expand your reading profile"
        >
          <RadarSVG hallCounts={hallCounts} size={collapsedSize} />
          {/* Show title + level badge on desktop; on mobile it's too cramped */}
          {!isMobile && (earnedTitle || level > 0) && (
            <div style={{
              marginTop: 4,
              textAlign: "center",
              background: "rgba(0,0,0,0.75)",
              border: `1px solid ${ACCENT}`,
              borderRadius: 4,
              padding: "2px 8px",
              fontFamily: "monospace",
              fontSize: 10,
              color: ACCENT,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
            }}>
              {earnedTitle && <span>✦ {earnedTitle.title}</span>}
              {level > 0 && (
                <span style={{
                  background: "rgba(255,216,96,0.15)",
                  border: "1px solid rgba(255,216,96,0.5)",
                  borderRadius: 3,
                  padding: "0 4px",
                  color: "#ffd860",
                  fontSize: 9,
                }}>Lv.{level}</span>
              )}
            </div>
          )}
          {/* On mobile, show a compact title + level line */}
          {isMobile && (earnedTitle || level > 0) && (
            <div style={{
              marginTop: 3,
              textAlign: "center",
              fontFamily: "monospace",
              fontSize: 9,
              color: ACCENT,
              whiteSpace: "nowrap",
              maxWidth: collapsedSize,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}>
              {earnedTitle && <span>✦ {earnedTitle.title}</span>}
              {level > 0 && <span style={{ color: "#ffd860" }}>Lv.{level}</span>}
            </div>
          )}
          {totalRead === 0 && !isMobile && (
            <div style={{
              marginTop: 2,
              textAlign: "center",
              fontFamily: "monospace",
              fontSize: 9,
              color: "rgba(255,255,255,0.3)",
            }}>
              Read posts to fill chart
            </div>
          )}
        </div>
      )}

      {/* Expanded overlay */}
      {expanded && (
        <div
          onClick={handleBackdropClick}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{
            background: "#111a2b",
            border: "1px solid rgba(79,195,247,0.4)",
            borderRadius: 12,
            padding: 28,
            maxWidth: 520,
            width: "90vw",
            fontFamily: "monospace",
            color: "#e0e0e0",
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 2 }}>
                  Reading Profile
                </div>
                {earnedTitle ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 20, fontWeight: "bold", color: ACCENT }}>
                      ✦ {earnedTitle.title}
                    </span>
                    {level > 0 && (
                      <span style={{
                        fontSize: 13,
                        fontWeight: "bold",
                        color: "#ffd860",
                        background: "rgba(255,216,96,0.12)",
                        border: "1px solid rgba(255,216,96,0.45)",
                        borderRadius: 4,
                        padding: "1px 7px",
                      }}>Lv.{level}</span>
                    )}
                  </div>
                ) : titleFetching ? (
                  <div style={{ fontSize: 14, color: ACCENT, marginTop: 4, opacity: 0.7 }}>
                    ✦ Consulting the oracle…
                  </div>
                ) : (
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                    {totalRead === 0 ? "No posts read yet — explore the village!" : "Keep reading to earn a title…"}
                  </div>
                )}
                {earnedTitle?.description && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4, fontStyle: "italic" }}>
                    {earnedTitle.description}
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 4,
                  color: "#aaa",
                  cursor: "pointer",
                  fontSize: 16,
                  padding: "2px 10px",
                }}
              >
                ✕
              </button>
            </div>

            {/* Large radar */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <RadarSVG hallCounts={hallCounts} size={320} animated />
            </div>

            {/* Stats table */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
              {HALLS.map((h) => {
                const count = hallCounts[h.key] ?? 0;
                const nextMilestone = MILESTONE_STEPS.find((m) => m > count);
                return (
                  <div key={h.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                    <span style={{ color: h.color, minWidth: 44 }}>{h.label}</span>
                    <span style={{ color: count > 0 ? "#e0e0e0" : "rgba(255,255,255,0.25)", minWidth: 28 }}>
                      {count}
                    </span>
                    {nextMilestone && count > 0 && (
                      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>
                        → {nextMilestone}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Milestone hint */}
            <div style={{ marginTop: 16, fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
              Return to the Sage to save progress · Milestones: {MILESTONE_STEPS.join(", ")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const MILESTONE_STEPS = [25, 50, 100, 200, 500, 1000];
