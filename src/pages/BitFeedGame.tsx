import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties } from "react";
import { loadAllTiles, drawSprite, getTile } from "../game/tileLoader";
import {
  OBJECT_SPRITES,
  BUILDING_SPRITES,
  INTERIOR_BACKDROPS,
  STORY_SPRITES,
} from "../game/tileManifest";
import {
  STORY_CHARACTER_DEFS,
  buildStoryWorldSpots,
  storySpriteSpec,
  type StorySpot,
} from "../game/storyCharacters";
import { StoryDialogOverlay, storySpritePublicUrl } from "../game/StoryDialogOverlay";
import { RadarChart } from "../game/RadarChart";
import { TitleAwardPopup } from "../game/TitleAwardPopup";
// import { FloraComposeOverlay } from "../game/FloraComposeOverlay";
// import { FloraTreeBackground, type FloraPost } from "../game/FloraTreeBackground";

// ─── Constants ────────────────────────────────────────────────────────────────
const TILE      = 48;
const COLS      = 44;
const ROWS      = 34;
const SPEED     = 2.8;
const NEARBY_DIST = 100;
const S         = 2;

// Dimetric squash factor — 1 world Y unit becomes PROJ_Y screen Y units on the
// overworld, giving the classic top-down-with-perspective look. Logical
// coordinates (px/py, npc.x/y, zone.cx/cy) stay top-down; this only affects
// rendering so input, hit-tests, door triggers and the minimap don't change.
const PROJ_Y = 0.62;
function projY(wy: number): number { return wy * PROJ_Y; }

/** Which Mastodon-derived cluster endpoint populates NPCs (`/api/mastodon/clusters?source=…`). */
type ClusterFeedSource = "home" | "public" | "trending";

const FEED_STORE_KEY = "vikalp-feed-onboarding";
const SCORES_KEY = "8bit-world-hall-scores";
const POSTS_MADE_KEY = "8bit-world-posts-made";
const COUNTED_POSTS_KEY = "8bit-world-counted-posts";
const TITLE_KEY = "8bit-world-title";
const MILESTONES_KEY = "8bit-world-milestones";
const MILESTONE_STEPS = [25, 50, 100, 200, 500, 1000];

/** Ko-fi donation page for vikalp.social. */
const KOFI_URL = "https://ko-fi.com/vikalp_social";

/** External Ko-fi donate link, styled to match the 8bit chrome. Opens safely in a new tab. */
function SupportLink({ variant }: { variant: "bar" | "drawer" | "wall" }) {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    textDecoration: "none", fontFamily: "ui-monospace, monospace",
    color: "#fff", background: "#6364ff",
    border: "none", borderRadius: 6, cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const variantStyle: CSSProperties =
    variant === "bar"
      ? { padding: "3px 16px", minHeight: 36, fontSize: 13, fontWeight: 700 }
      : variant === "drawer"
        ? { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 14px", fontSize: 13, fontWeight: 600 }
        : { width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 13 };
  const label =
    variant === "bar" ? "Support Vikalp"
      : variant === "drawer" ? "Support Vikalp"
        : "Support Vikalp on Ko-fi";
  return (
    <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" title="Support Vikalp on Ko-fi" style={{ ...base, ...variantStyle }}>
      <span aria-hidden={true} style={{ fontSize: "2.2em", lineHeight: 1 }}>☕</span>
      {label}
    </a>
  );
}

/** Branded green loading screen — shared by the initial fetch and the feed-gateway entry. */
function FeedLoadingScreen({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "#1a2e1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <div style={{ color: "#ffd700", fontFamily: "monospace", fontWeight: "bold", fontSize: 20, letterSpacing: 2 }}>Vikalp.Social</div>
      <div style={{ color: "#aaffaa", fontFamily: "monospace", fontSize: 14 }}>Fetching posts from Mastodon…</div>
      <div style={{ color: "#6a8a6a", fontFamily: "monospace", fontSize: 11 }}>
        {subtitle ?? "mastodon.social · public timeline"}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ width: 12, height: 12, background: "#5a9e3a", animation: `pulse 1s ${i * 0.2}s infinite alternate`, borderRadius: 2 }} />
        ))}
      </div>
      <style>{`@keyframes pulse { from { opacity:0.3; transform:scaleY(0.6); } to { opacity:1; transform:scaleY(1.4); } }`}</style>
    </div>
  );
}

function computeLevel(milestones: Record<string, number[]>): number {
  return Object.values(milestones).reduce((sum, arr) => sum + arr.length, 0);
}

function deriveHallCounts(zones: Zone[], visited: Set<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const z of zones) {
    const n = z.posts.filter((p) => visited.has(p.id)).length;
    counts[z.hall] = (counts[z.hall] ?? 0) + n;
  }
  return counts;
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function readStoredFeedSource(): ClusterFeedSource | null {
  try {
    const raw = localStorage.getItem(FEED_STORE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { feed?: unknown };
    if (j.feed === "home" || j.feed === "public" || j.feed === "trending") return j.feed;
    return null;
  } catch {
    return null;
  }
}

function persistFeedSource(feed: ClusterFeedSource) {
  try {
    localStorage.setItem(FEED_STORE_KEY, JSON.stringify({ feed }));
  } catch {
    /* ignore quota */
  }
}

interface GrassProceduralColors {
  base: string;
  mid: string;
  hi: string;
}
interface PathProceduralColors {
  sand: string;
  stone: string;
}

interface OverworldFeedTheme {
  grass: GrassProceduralColors;
  path: PathProceduralColors;
  chromeLabel: string;
  chromeAccent: string;
  /** Applied to outer game wrapper (same layout, different mood). */
  cssFilter: string;
}

const FEED_VISUAL_THEME: Record<ClusterFeedSource, OverworldFeedTheme> = {
  home: {
    grass: { base: "#82c956", mid: "#72b348", hi: "#aada78" },
    path: { sand: "#dcb890", stone: "#b89460" },
    chromeLabel: "Home",
    chromeAccent: "#ffb86b",
    cssFilter: "sepia(0.06) hue-rotate(-8deg) saturate(1.06)",
  },
  public: {
    grass: { base: "#78b858", mid: "#66a246", hi: "#9cce72" },
    path: { sand: "#d4b892", stone: "#b89460" },
    chromeLabel: "Public",
    chromeAccent: "#8ab4f8",
    cssFilter: "saturate(0.9) brightness(1.03)",
  },
  trending: {
    grass: { base: "#6eb8a8", mid: "#5b9f90", hi: "#8fd4cc" },
    path: { sand: "#cfa882", stone: "#a88858" },
    chromeLabel: "Trending",
    chromeAccent: "#c792ea",
    cssFilter: "hue-rotate(12deg) saturate(1.1)",
  },
};

type ForkPathGate = { feed: ClusterFeedSource; left: number; right: number; top: number; bottom: number };

/** Hit boxes: short band at each lane’s north mouth (gateway entrance) — see forkHubLayout. */
function computeForkGateRects(worldW: number, worldH: number, streetY: number): ForkPathGate[] {
  const { laneLeftXs, stubW, y0 } = forkHubLayout(worldW, worldH, streetY);
  const entranceDepth = TILE * 2.35;
  const inset = stubW * 0.07;
  const feeds: ClusterFeedSource[] = ["home", "public", "trending"];
  return feeds.map((feed, i) => {
    const base = laneLeftXs[i] ?? 0;
    return {
      feed,
      left: base + inset,
      right: base + stubW - inset,
      top: y0 + TILE * 0.04,
      bottom: y0 + entranceDepth,
    };
  });
}

/** Layout for the first-visit fork hub (roads, banners, sage stand). */
function forkHubLayout(worldW: number, worldH: number, streetY: number) {
  const mid = worldW / 2;
  const band = avenueBlendHalfThickness();
  const stubW = TILE * 2.45;
  const gap = TILE * 0.62;
  const y0 = streetY + band + TILE * 0.88;
  const stubH = TILE * 7.4;
  const laneLeftXs = [
    mid - stubW - gap - stubW * 0.5,
    mid - stubW * 0.5,
    mid + stubW * 0.5 + gap,
  ];
  const sageFeetY = y0 + stubH + TILE * 1.35;
  return { mid, band, stubW, gap, y0, stubH, laneLeftXs, sageFeetY };
}

/** South-centre dirt strip on the village map — stand here to return to the fork hub (Sage). */
function villageReturnToSageWorldRect(worldW: number, worldH: number) {
  const halfW = TILE * 0.62;
  const h = TILE * 2.1;
  const cx = worldW / 2;
  const bottom = worldH - TILE * 0.85;
  return {
    left: cx - halfW,
    right: cx + halfW,
    top: bottom - h,
    bottom,
  };
}

/** Long south-centre mud spine connecting the plaza lawns to the Sage return patch (world space). */
function villageSageReturnSpineBounds(worldW: number, worldH: number, streetY: number): WorldPathRect {
  const ret = villageReturnToSageWorldRect(worldW, worldH);
  const cx = worldW / 2;
  const blend = avenueBlendHalfThickness();
  /** South edge of main avenue mud is `streetY + blend`. Overlap slightly so dirt meets the boulevard with no grass gap. */
  const avenueSouth = streetY + blend;
  const top = avenueSouth - TILE * 0.38;
  const halfW = TILE * 0.82;
  const marginEdge = AVENUE_SIDE_MARGIN_TILES * TILE + 24;
  return {
    left: Math.max(marginEdge, cx - halfW),
    top,
    right: Math.min(worldW - marginEdge, cx + halfW),
    bottom: Math.min(worldH - TILE * 0.1, ret.bottom + TILE * 0.22),
  };
}

/** Expanded spine for skipping trees/lanterns so the Sage trail stays readable on the bake. */
function villageSageReturnTrailTreesClearance(worldW: number, worldH: number, streetY: number): WorldPathRect {
  const s = villageSageReturnSpineBounds(worldW, worldH, streetY);
  const pad = TILE * 1.05;
  return {
    left: s.left - pad,
    top: s.top - pad,
    right: s.right + pad,
    bottom: s.bottom + pad * 0.42,
  };
}

/**
 * Spawn on the south-centre spine but **north** of `villageReturnToSageWorldRect`,
 * otherwise the Sage-return dwell fires immediately after entering the village.
 */
function overworldSpawnNearSageReturnPath(worldW: number, worldH: number, streetY: number): { px: number; py: number } {
  const spine = villageSageReturnSpineBounds(worldW, worldH, streetY);
  const ret = villageReturnToSageWorldRect(worldW, worldH);
  const px = (ret.left + ret.right) / 2;
  const northOfDwell = ret.top - TILE * 2.35;
  const py = Math.max(spine.top + TILE * 1.4, Math.min(northOfDwell, spine.bottom - TILE * 5));
  return { px, py };
}

/**
 * Areas that stay pine-free — the three exit lanes plus a grassy apron connecting them to the Sage.
 * Avatar movement on `fork_hub` is clamped inside this union (circle vs rects).
 */
function forkHubWalkClearanceRects(worldW: number, worldH: number, streetY: number): WorldPathRect[] {
  const fk = forkHubLayout(worldW, worldH, streetY);
  const padLaneX = TILE * 0.24;
  const padLaneY = TILE * 0.3;
  const lanes = fk.laneLeftXs.map((lx) => ({
    left: lx - padLaneX,
    top: fk.y0 - TILE * 0.32,
    right: lx + fk.stubW + padLaneX,
    bottom: fk.y0 + fk.stubH + padLaneY,
  }));
  const leftMost = fk.laneLeftXs[0]!;
  const rightMost = fk.laneLeftXs[2]! + fk.stubW;
  const apron = {
    left: Math.max(TILE * 0.5, leftMost - TILE * 0.48),
    top: fk.y0 + fk.stubH - TILE * 0.75,
    right: Math.min(worldW - TILE * 0.5, rightMost + TILE * 0.48),
    bottom: Math.min(worldH - TILE * 1.15, fk.sageFeetY + TILE * 3.45),
  };
  return [...lanes, apron];
}

/** Stronger road visuals: lit sand + dark edging. */
function drawForkRoadStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rw: number,
  rh: number,
  pathPalette: PathProceduralColors,
) {
  const edgeX = Math.max(3, Math.min(8, rw * 0.12));
  const edgeY = Math.max(2, Math.min(6, rh * 0.04));
  ctx.save();
  ctx.fillStyle = "#4a3930";
  ctx.fillRect(x - edgeX, y - edgeY, rw + edgeX * 2, rh + edgeY * 2);
  ctx.fillStyle = "#3a3328";
  ctx.fillRect(x - edgeX * 0.65, y, rw + edgeX * 1.3, rh);
  drawPath(ctx, x, y, rw, rh, pathPalette);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  const inset = Math.max(2, Math.min(5, rw * 0.045));
  ctx.strokeRect(x + inset, y + inset * 2, rw - inset * 2, rh - inset * 3);
  ctx.restore();
}

/** Match slim top-bar breakpoint; logical canvas size = innerWidth / zoom. */
const CANVAS_MOBILE_BREAKPOINT_PX = 640;
/** Larger = more zoomed in (fewer world units visible). */
const CANVAS_ZOOM_MOBILE = 0.86;
const CANVAS_ZOOM_DESKTOP = 1.24;
/** World-units to keep visible across a phone's width (tuned at ~430px → 0.86 zoom).
 *  Scaling zoom to hold this constant means a narrow phone zooms OUT instead of
 *  over-zooming the way a flat factor does. */
const CANVAS_MOBILE_VISIBLE_W = 500;
function getOverworldCanvasZoom(): number {
  if (typeof window === "undefined") return CANVAS_ZOOM_DESKTOP;
  const w = window.innerWidth;
  if (w > CANVAS_MOBILE_BREAKPOINT_PX) return CANVAS_ZOOM_DESKTOP;
  // Keep the visible world-width roughly constant across phone sizes: never more
  // zoomed in than the tuned mobile value, with a floor so it can't over-shrink.
  return Math.max(0.6, Math.min(CANVAS_ZOOM_MOBILE, w / CANVAS_MOBILE_VISIBLE_W));
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ApiPost {
  id: string;
  content: string;
  imageUrl?: string;
  platform: string;
  likes?: number;
  reposts?: number;
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  /** Mastodon account id — follows / relationships */
  authorAccountId?: string;
  url?: string;
}
interface ApiCluster {
  clusterId: number;
  label: string;
  hall?: string;
  posts: ApiPost[];
  avgSimilarity: number;
}
interface MastodonInfo {
  instance: string;
  timeline: "home" | "public";
  hasToken?: boolean;
}
interface AuthUser {
  loggedIn: true;
  /** Mastodon account id (snowflake); may be absent for older sessions until re-login. */
  accountId?: string;
  username: string;
  displayName: string;
  avatar: string;
  instance: string;
}
type AuthState = { loggedIn: false } | AuthUser;
interface Zone {
  cx: number; cy: number;
  label: string; color: string;
  hall: string;
  posts: ApiPost[];
}
interface NpcLook {
  hatStyle: number;   // 0=cap, 1=beanie, 2=tophat
  skinTone: string;
  accentColor: string;
  hasGlasses: boolean;
}
interface NPC {
  x: number; y: number;
  post: ApiPost;
  zoneColor: string;
  zoneIndex: number;
  bubbleLines: string[];
  idleFrame?: number;
  scale: number;
  look: NpcLook;
  npcFacing: string;
  waving: boolean;
  waveTimer: number;
  happyTimer: number;
  chainDelay?: number;
  emote?: string;
  emoteTimer: number;
  emoteNext: number;
}
interface ApiComment {
  id: string; postId: string;
  authorName: string; authorHandle: string;
  content: string; likes: number; createdAt: string;
}
type Scene =
  | { type: "overworld" }
  /** Three gateways + Sage only (not the village map). */
  | { type: "fork_hub" }
  /** All zones of the same `hall` that use an interior share one multi-group room. */
  | { type: "townhall_hall_hub"; hall: string; savedPx: number; savedPy: number; entryZoneIndex: number };

/** Pending scene swap while fading. */
type PendingScene =
  | { type: "overworld"; fromForkHub?: boolean }
  | { type: "fork_hub" }
  | { type: "townhall_hall_hub"; hall: string; savedPx: number; savedPy: number; entryZoneIndex: number };

const HALL_HUB_ROOM_PREFIX = "hallHub:";

function hallHubRoomKey(hall: string): string {
  return `${HALL_HUB_ROOM_PREFIX}${hall}`;
}

const NO_MATCH_HALL = "no-match";

/** Canonical hall slug from API / ML (`no-match`, `nomatch`, … → `no-match`). */
function normalizeHallKey(raw: string | undefined): string {
  let h = (raw ?? "general").trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
  if (h === "nomatch" || h === "no-match") return NO_MATCH_HALL;
  return h;
}

function zoneHallKey(zone: Zone): string {
  return normalizeHallKey(zone.hall);
}

/** API → zone hall key; legacy `no-match` is folded into Community Hub (general) for interiors. */
function clusterHallNormalized(hall: string): string {
  const h = normalizeHallKey(hall);
  return h === NO_MATCH_HALL ? "general" : h;
}

/** Posts are experienced inside halls; every zone participates in interiors / minimap. */
function zoneEligibleForHallInterior(_zone: Zone): boolean {
  return true;
}

/** Zone indices sharing the hall's interior (all zones mapped to this hall theme). */
function hallHubZoneIndices(zones: Zone[], hall: string): number[] {
  return zones.flatMap((z, i) =>
    zoneHallKey(z) === hall && zoneEligibleForHallInterior(z) ? [i] : [],
  );
}

/** Distinct halls that currently have any interior-hub zone. */
function activeInteriorHallKeys(zones: Zone[]): string[] {
  const s = new Set<string>();
  for (let i = 0; i < zones.length; i++) {
    if (!zoneEligibleForHallInterior(zones[i])) continue;
    s.add(zoneHallKey(zones[i]));
  }
  return [...s];
}

const PLAZA_HALL_ORDER = ["general", "tech", "politics", "science", "art", "music", "nature", "gaming"] as const;

/**
 * Horizontal main street geometry (world coords, pre-projection): one avenue + hall façades.
 * North row: door / ENTER toward the avenue at ~`cy+28`. South row: north face toward avenue at ~`cy-46`.
 */
/** Half-height of procedural dirt band (classic compact-plaza proportions). */
const AVENUE_ROAD_HALF_THICK = TILE * 1.52;
function avenueBlendHalfThickness(): number {
  return AVENUE_ROAD_HALF_THICK;
}

/** Horizontal extent of avenue (narrow margin so border trees barely clear). */
const AVENUE_SIDE_MARGIN_TILES = 2;
/** Hall hub center X positions span this fraction of map width (centered); smaller = façades closer. */
const PLAZA_HUB_X_SPAN = 0.34;

function avenueCenterWorldY(worldH: number): number {
  return Math.floor(worldH / 2 / TILE) * TILE;
}

/** One façade per hub hall — world placement + which side of the boulevard. */
interface HallHubCampus {
  cx: number;
  cy: number;
  /** South side of avenue (same unflipped sprite; stub runs south from the mud band). */
  southOfStreet: boolean;
}

/** Overworld door trigger Y — matches `drawTownhall` ENTER hint (`by+H+14` vs `cy-46`). */
function campusDoorWorldY(c: Pick<HallHubCampus, "cy" | "southOfStreet">): number {
  return c.southOfStreet ? c.cy - 46 : c.cy + 28;
}

/**
 * Halls alternating north / south of the avenue, spread along X.
 */
function compactHallHubCentroids(halls: string[], worldW: number, worldH: number): Map<string, HallHubCampus> {
  const streetY = avenueCenterWorldY(worldH);
  const blendHalf = avenueBlendHalfThickness();
  /** Entire façade sits clearly north of the thick road; grass gap + thin path fill the aisle. */
  const hallCyNorth = Math.round(streetY - blendHalf - TILE * 5.05);
  /** South row sits lower so an L-shaped path (down → along → down) fits between road and door. */
  const hallCySouth = Math.round(streetY + blendHalf + TILE * 3.05);
  const margin = AVENUE_SIDE_MARGIN_TILES * TILE + 10;
  const ordered = [...halls].sort((a, b) => {
    const ia = PLAZA_HALL_ORDER.indexOf(a as (typeof PLAZA_HALL_ORDER)[number]);
    const ib = PLAZA_HALL_ORDER.indexOf(b as (typeof PLAZA_HALL_ORDER)[number]);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
  const usable = Math.max(TILE * 4, worldW - 2 * margin);
  const out = new Map<string, HallHubCampus>();
  for (let i = 0; i < ordered.length; i++) {
    const nHall = ordered.length;
    const frac = nHall <= 1 ? 0.5 : 0.5 - PLAZA_HUB_X_SPAN / 2 + (i / (nHall - 1)) * PLAZA_HUB_X_SPAN;
    const hall = ordered[i];
    const southOfStreet = i % 2 === 1;
    let cx = margin + frac * usable;
    if (ordered.length <= 8) cx += (southOfStreet ? TILE * 0.035 : TILE * -0.035);
    out.set(hall, {
      cx: Math.round(Math.min(worldW - margin, Math.max(margin, cx))),
      cy: southOfStreet ? hallCySouth : hallCyNorth,
      southOfStreet,
    });
  }
  return out;
}

/** Topic NPCs are hall-only until overworld repurposing — never draw them on outdoor grass/plaza. */
function npcShownOnOverworld(_zones: Zone[], _npcZoneIndex: number): boolean {
  return false;
}

function isTownhallInteriorScene(sc: Scene): boolean {
  return sc.type === "townhall_hall_hub";
}

function isForkHubScene(sc: Scene): boolean {
  return sc.type === "fork_hub";
}

function npcBelongsToCurrentInterior(s: GameState, npcZoneIndex: number): boolean {
  if (s.scene.type !== "townhall_hall_hub") return false;
  const z = s.zones[npcZoneIndex];
  return z !== undefined && zoneHallKey(z) === s.scene.hall;
}

/** Auto-walk to a Mastodon NPC or story character on the plaza. */
type WalkTarget =
  | { kind: "post"; npcIdx: number; x: number; y: number }
  | { kind: "story"; charId: string; x: number; y: number };

interface GameState {
  px: number; py: number;
  facing: string; animFrame: number; animTimer: number; moving: boolean;
  keys: Record<string, boolean>;
  talkingTo: number | null;
  camera: { x: number; y: number };
  npcs: NPC[]; zones: Zone[];
  worldW: number; worldH: number;
  walkTarget?: WalkTarget | null;
  scene: Scene;
  transition: number; // >0 = fading out, <0 = fading in, 0 = none
  pendingScene: PendingScene | null;
}

// ─── Zone palette ─────────────────────────────────────────────────────────────
const ZONE_PALETTE = [
  { bg: "#8fd4c8", border: "#4aabaa", sign: "#2a7a7a" },
  { bg: "#f5c87a", border: "#e0962a", sign: "#8a5500" },
  { bg: "#c8a0e8", border: "#9050cc", sign: "#5a2080" },
  { bg: "#f5a0a0", border: "#e04040", sign: "#901010" },
  { bg: "#a8d870", border: "#6aaa10", sign: "#3a6a00" },
  { bg: "#70b8f5", border: "#2070cc", sign: "#103880" },
];
// ─── Townhall themes ─────────────────────────────────────────────────────────
interface TownhallTheme {
  name: string;
  facade: string;
  wallColor: string;
  floorColor: string;
  floorAccent: string;
  accentColor: string;
  roofColor: string;
  icon: string;
  furniture: string[];
}
const TOWNHALLS: Record<string, TownhallTheme> = {
  tech:     { name: "Tech Lab",      facade: "tech",     wallColor: "#1a1a2e", floorColor: "#2d2d44", floorAccent: "#3a3a5c", accentColor: "#00d2ff", roofColor: "#0f3460", icon: "\u2699", furniture: ["\uD83D\uDCBB","\uD83D\uDDA5","\uD83D\uDCE1"] },
  politics: { name: "Town Hall",     facade: "politics", wallColor: "#2c1810", floorColor: "#3d2b1f", floorAccent: "#4e3c30", accentColor: "#c0392b", roofColor: "#7b241c", icon: "\uD83C\uDFDB", furniture: ["\uD83D\uDCDC","\u2696","\uD83C\uDFDB"] },
  art:      { name: "Art Gallery",   facade: "art",      wallColor: "#1a1a2e", floorColor: "#2d2040", floorAccent: "#3e3150", accentColor: "#e056a0", roofColor: "#6c3483", icon: "\uD83C\uDFA8", furniture: ["\uD83D\uDDBC","\uD83C\uDFAD","\u270F"] },
  nature:   { name: "Nature Lodge",  facade: "nature",   wallColor: "#1b4332", floorColor: "#2d6a4f", floorAccent: "#3e7b60", accentColor: "#95d5b2", roofColor: "#40916c", icon: "\uD83C\uDF3F", furniture: ["\uD83C\uDF31","\uD83E\uDD8B","\uD83C\uDF3B"] },
  science:  { name: "Science Lab",   facade: "science",  wallColor: "#1a1a2e", floorColor: "#2d3436", floorAccent: "#3e4547", accentColor: "#74b9ff", roofColor: "#0984e3", icon: "\uD83D\uDD2C", furniture: ["\uD83E\uDDEA","\u2697","\uD83D\uDD2D"] },
  gaming:   { name: "Arcade",        facade: "gaming",   wallColor: "#1a1a2e", floorColor: "#2d2d44", floorAccent: "#3a3a5c", accentColor: "#fd79a8", roofColor: "#e84393", icon: "\uD83C\uDFAE", furniture: ["\uD83D\uDD79","\uD83D\uDC7E","\uD83C\uDFC6"] },
  music:    { name: "Music Hall",    facade: "music",    wallColor: "#2d1b2e", floorColor: "#3d2b3e", floorAccent: "#4e3c4f", accentColor: "#fdcb6e", roofColor: "#6c5ce7", icon: "\uD83C\uDFB5", furniture: ["\uD83C\uDFB8","\uD83C\uDFB9","\uD83C\uDFA4"] },
  general:  { name: "Community Hub", facade: "general",  wallColor: "#2c3e50", floorColor: "#1e2940", floorAccent: "#455a6f", accentColor: "#f39c12", roofColor: "#2980b9", icon: "\uD83C\uDFE0", furniture: ["\uD83D\uDCCC","\uD83D\uDCAC","\uD83E\uDE91"] },
};

// Interior size in world pixels — ultrawide hall (matches interior backdrop PNGs).
const ROOM_W = 2560, ROOM_H = 1080;
/** Scale factors vs the original 1280×800 room layout (for prop placement). */
const ROOM_X_SCALE = ROOM_W / 1280;
const ROOM_Y_SCALE = ROOM_H / 800;
// Door and wall thickness scale with room so hit-tests stay proportional.
const DOOR_W = Math.round(80 * ROOM_X_SCALE), DOOR_H = Math.round(28 * ROOM_Y_SCALE);
const WALL_THICKNESS = Math.round(28 * ROOM_Y_SCALE);

/** Walkable floor bbox inside an interior bitmap (pixels). Used for backdrop PNG margins & procedural rooms. */
type InteriorFloorRect = { x0: number; y0: number; x1: number; y1: number };

function interiorDoorExtents(rw: number, rh: number): { dw: number; dh: number } {
  return {
    dw: Math.max(72, Math.round(DOOR_W * rw / ROOM_W)),
    dh: Math.max(26, Math.round(DOOR_H * rh / ROOM_H)),
  };
}

function truncateBannerLabel(label: string, ctx: CanvasRenderingContext2D, maxW: number): string {
  if (ctx.measureText(label).width <= maxW) return label;
  let s = label;
  while (s.length > 2 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

const COMMENTER_COLORS = [
  { body: "#e8a87c", accent: "#c0762a" },
  { body: "#7cb8e8", accent: "#2a70b0" },
  { body: "#a8e87c", accent: "#50a020" },
  { body: "#e87ca8", accent: "#c02060" },
  { body: "#c87ce8", accent: "#8020c0" },
];
const PLATFORM_ICON: Record<string, string> = {
  mastodon: "🐘", twitter: "𝕏", linkedin: "in", instagram: "◈",
};

// ─── NPC Look generation ─────────────────────────────────────────────────────
const SKIN_TONES = ["#f4c27f", "#d4a06a", "#8d5524", "#c68642", "#e0ac69", "#f1c27d"];
const NPC_ACCENT_COLORS = [
  "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
  "#1abc9c", "#e67e22", "#e84393", "#00cec9", "#6c5ce7",
  "#fd79a8", "#00b894", "#fdcb6e", "#74b9ff", "#a29bfe",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function npcLookFromId(id: string): NpcLook {
  const h = hashStr(id);
  return {
    hatStyle: h % 3,
    skinTone: SKIN_TONES[h % SKIN_TONES.length],
    accentColor: NPC_ACCENT_COLORS[(h >> 4) % NPC_ACCENT_COLORS.length],
    hasGlasses: (h >> 8) % 5 === 0,
  };
}

// ─── Sound Effects (Web Audio API) ───────────────────────────────────────────
const SoundFx = (() => {
  let ctx: AudioContext | null = null;
  let muted = false;
  let lastWalk = 0;

  function getCtx(): AudioContext | null {
    if (muted) return null;
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.08) {
    const c = getCtx(); if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(); osc.stop(c.currentTime + dur);
  }

  return {
    get muted() { return muted; },
    mute() { muted = true; },
    unmute() { muted = false; },
    toggleMute() { muted = !muted; return muted; },
    walk() {
      const now = performance.now();
      if (now - lastWalk < 300) return;
      lastWalk = now;
      tone(100, 0.05, "square", 0.04);
    },
    talk() {
      const c = getCtx(); if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(300, c.currentTime);
      osc.frequency.linearRampToValueAtTime(500, c.currentTime + 0.1);
      gain.gain.setValueAtTime(0.07, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(); osc.stop(c.currentTime + 0.12);
    },
    favourite() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.12, "square", 0.06), i * 60));
    },
    boost() {
      const c = getCtx(); if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(200, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, c.currentTime + 0.25);
      gain.gain.setValueAtTime(0.06, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(); osc.stop(c.currentTime + 0.3);
    },
    discover() {
      [440, 554, 659, 880].forEach((f, i) => setTimeout(() => tone(f, 0.1, "square", 0.05), i * 80));
    },
  };
})();

// ─── Day/Night Cycle ─────────────────────────────────────────────────────────
function getDayPhase(): { tint: string; alpha: number; isNight: boolean } {
  const h = new Date().getHours();
  if (h >= 6 && h < 8)   return { tint: "#ff8c42", alpha: 0.1,  isNight: false };
  if (h >= 8 && h < 18)  return { tint: "#000000", alpha: 0,    isNight: false };
  if (h >= 18 && h < 20) return { tint: "#9b59b6", alpha: 0.12, isNight: false };
  return { tint: "#1a1a4e", alpha: 0.3, isNight: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function wrapText(text: string, maxChars = 30): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + w).length > maxChars) { if (line) lines.push(line.trimEnd()); line = w + " "; }
    else line += w + " ";
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
function zoneCenters(n: number, worldW: number, worldH: number): [number, number][] {
  if (n === 0) return [];
  const cx = worldW / 2, cy = worldH / 2;
  const rx = worldW * 0.32, ry = worldH * 0.28;
  if (n === 1) return [[cx, cy]];
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
}

function npcPositions(cx: number, cy: number, count: number): [number, number][] {
  if (count === 0) return [];
  const positions: [number, number][] = [];
  const PER_RING = 8;
  const rings = Math.ceil(count / PER_RING);
  let placed = 0;
  for (let ring = 0; ring < rings; ring++) {
    const n = Math.min(PER_RING, count - placed);
    const r = 150 + ring * 100;
    const angleOffset = Math.PI * 0.55 + ring * 0.3;
    for (let i = 0; i < n; i++) {
      // Sweep from bottom, avoiding the top where the sign sits (angle ~-PI/2)
      const a = (i / n) * Math.PI * 2 + angleOffset;
      const jitter = ((placed + i) % 3) * 8 - 8;
      const yOff = 60 + ring * 10;
      positions.push([cx + Math.cos(a) * r + jitter, cy + Math.sin(a) * r + yOff]);
      placed++;
    }
  }
  // Push NPCs away from the signboard area (sign sits at roughly cy-96 to cy-20)
  const signTop = -100, signBottom = 10;
  for (let i = 0; i < positions.length; i++) {
    const dy = positions[i][1] - cy;
    const dx = Math.abs(positions[i][0] - cx);
    if (dy > signTop && dy < signBottom && dx < 80) {
      positions[i][1] = cy + signBottom + 30 + (i % 3) * 12;
    }
  }
  return positions;
}
function popularityScale(likes: number, reposts: number): number {
  const base = likes + reposts * 2;
  return Math.max(S, Math.min(S * 2.5, S + Math.log1p(base) * 0.35));
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────
// Stable 0..1 hash for tile-based decoration
function tileHash(tx: number, ty: number, salt = 0): number {
  let h = (tx * 374761393 + ty * 668265263 + salt * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

const FLOWER_COLORS = ["#ff5d6c", "#ffd166", "#f3a0ff", "#ffffff", "#74e0ff"];

function drawGrass(ctx: CanvasRenderingContext2D, tx: number, ty: number, palette: GrassProceduralColors) {
  const x = tx * TILE, y = ty * TILE;
  ctx.fillStyle = palette.base;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = palette.mid;
  for (let i = 0; i < 5; i++) {
    const px = (i * 11 + tx * 7) % (TILE - 3);
    const py = (i * 17 + ty * 5) % (TILE - 3);
    ctx.fillRect(x + px, y + py, 2, 3);
  }
  ctx.fillStyle = palette.hi;
  for (let i = 0; i < 2; i++) {
    const px = (i * 23 + tx * 13 + 7) % (TILE - 2);
    const py = (i * 29 + ty * 11 + 4) % (TILE - 2);
    ctx.fillRect(x + px, y + py, 2, 2);
  }
  // Occasional small flower (deterministic)
  const r = tileHash(tx, ty, 1);
  if (r > 0.86) {
    const fx = x + 6 + Math.floor(tileHash(tx, ty, 2) * (TILE - 14));
    const fy = y + 6 + Math.floor(tileHash(tx, ty, 3) * (TILE - 14));
    const color = FLOWER_COLORS[Math.floor(tileHash(tx, ty, 4) * FLOWER_COLORS.length)];
    ctx.fillStyle = "#f4e7a1";
    ctx.fillRect(fx + 1, fy + 1, 2, 2);
    ctx.fillStyle = color;
    ctx.fillRect(fx, fy, 2, 2);
    ctx.fillRect(fx + 2, fy, 2, 2);
    ctx.fillRect(fx, fy + 2, 2, 2);
    ctx.fillRect(fx + 2, fy + 2, 2, 2);
  }
}

// Dense flower bed (cluster of small flowers) at world pixel position.
function drawFlowerBed(ctx: CanvasRenderingContext2D, cx: number, cy: number, size = 3, seed = 0) {
  if (size <= 0) {
    const padW = 26;
    const padH = 9;
    ctx.fillStyle = "#3d8a26";
    ctx.fillRect(cx - padW / 2, cy - 1, padW, padH);
    for (let k = 0; k < 6; k++) {
      const r = tileHash(cx + k * 2, cy, seed + k * 13);
      if (r < 0.12) continue;
      const color = FLOWER_COLORS[Math.floor(r * FLOWER_COLORS.length)];
      const fx = cx + (k - 2.5) * 5 + Math.floor(tileHash(cx, cy, k) * 2);
      const fy = cy - 5 + Math.floor(tileHash(seed, cx, k) * 2);
      ctx.fillStyle = "#2a6a1e";
      ctx.fillRect(fx - 1, fy + 2, 3, 1);
      ctx.fillStyle = color;
      ctx.fillRect(fx, fy, 2, 2);
      ctx.fillStyle = "#fff7c8";
      ctx.fillRect(fx + 1, fy + 1, 1, 1);
    }
    return;
  }
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      const r = tileHash(cx + dx * 5, cy + dy * 5, seed);
      if (r < 0.55) continue;
      const x = cx + dx * 6 + Math.floor(tileHash(cx, cy, dx + dy + 11) * 2);
      const y = cy + dy * 6 + Math.floor(tileHash(cx, cy, dx + dy + 22) * 2);
      const color = FLOWER_COLORS[Math.floor(r * FLOWER_COLORS.length)];
      // green pad
      ctx.fillStyle = "#3d8a26";
      ctx.fillRect(x - 1, y + 2, 4, 1);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 2, 2);
      ctx.fillRect(x + 2, y, 1, 2);
      ctx.fillStyle = "#fff7c8";
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pathPalette: PathProceduralColors,
) {
  ctx.fillStyle = pathPalette.sand;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = pathPalette.stone;
  const isHorizontal = w > h;
  if (isHorizontal) {
    const n = Math.floor(w / 14);
    for (let i = 0; i < n; i++) {
      const px = x + i * 14 + ((i * 7) % 6);
      const py = y + 4 + ((i * 11) % Math.max(2, h - 8));
      ctx.fillRect(px, py, 4, 2);
    }
    // Darker borders top + bottom
    ctx.fillStyle = "#9d7a4b";
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
  } else {
    const n = Math.floor(h / 14);
    for (let i = 0; i < n; i++) {
      const py = y + i * 14 + ((i * 7) % 6);
      const px = x + 4 + ((i * 11) % Math.max(2, w - 8));
      ctx.fillRect(px, py, 2, 4);
    }
    ctx.fillStyle = "#9d7a4b";
    ctx.fillRect(x, y, 2, h);
    ctx.fillRect(x + w - 2, y, 2, h);
  }
}

/** Broad east–west procedural dirt strip (single fill, no gradient shoulders). */
function drawBroadHorizontalAvenue(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  centerY: number,
  pathPalette: PathProceduralColors,
) {
  const w = right - left;
  if (w <= 2) return;
  const half = avenueBlendHalfThickness();
  const yTop = Math.round(centerY - half);
  const bandH = Math.round(half * 2);
  drawPath(ctx, left, yTop, w, bandH, pathPalette);
}

/**
 * Narrow footpaths only — thick mud is exclusively `drawBroadHorizontalAvenue`.
 * Half-width of each thin tributary strip (pixels from center-line).
 */
const THIN_PATH_HALF_W = Math.round(TILE * 0.34);
const thinPathBandPx = (): number => THIN_PATH_HALF_W * 2;

/**
 * Façade faces the main road (north row): thin path from door sill (`cy+28`, same as ENTER) to mud.
 */
function drawThinHallPathFacingRoad(
  ctx: CanvasRenderingContext2D,
  cx: number,
  hallCy: number,
  streetY: number,
  pathPalette: PathProceduralColors,
) {
  const band = avenueBlendHalfThickness();
  const mudNorth = streetY - band;
  /** South face sill / ENTER row — aligns with `campusDoorWorldY` north. */
  const doorFootY = hallCy + 28;
  const thinTop = doorFootY - TILE * 0.48;
  const thinBot = mudNorth + TILE * 0.32;
  if (thinBot <= thinTop + 10) return;
  const hw = THIN_PATH_HALF_W;
  drawPath(ctx, cx - hw, thinTop, thinPathBandPx(), thinBot - thinTop, pathPalette);
}

/**
 * Back toward main road (south row): thin trail runs along road, then bends around one flank
 * (deterministic left vs right per hall key) before reaching the entrance.
 */
function drawThinHallPathWrappedFromRoad(
  ctx: CanvasRenderingContext2D,
  cx: number,
  hallCy: number,
  streetY: number,
  worldW: number,
  hallKey: string,
  pathPalette: PathProceduralColors,
) {
  const tw = THIN_PATH_HALF_W;
  const band = avenueBlendHalfThickness();
  const yRoadSouth = streetY + band;
  const sep = 12;
  const marginPx = AVENUE_SIDE_MARGIN_TILES * TILE + tw * 2;

  let salt = 0;
  for (let i = 0; i < hallKey.length; i++) salt += hallKey.charCodeAt(i) * (i + 3);
  const goLeft = tileHash(salt, Math.floor(cx), 502) > 0.5;

  let flankCX = goLeft
    ? cx - HALL_W / 2 - sep - tw
    : cx + HALL_W / 2 + sep + tw;
  if (goLeft) flankCX = Math.max(marginPx, flankCX);
  else flankCX = Math.min(worldW - marginPx, flankCX);

  const bandPH = thinPathBandPx() + 10;
  const bendMidY = hallCy + 24;
  const yBandTop = bendMidY - Math.floor(bandPH / 2);

  /** Flank leg fully overlaps the bent band row so contours never gap. */
  const yLegTop = yRoadSouth - 6;
  const yLegEnd = bendMidY + Math.ceil(bandPH / 2) + 10;
  if (yLegEnd > yLegTop + 10) {
    drawPath(ctx, flankCX - tw, yLegTop, thinPathBandPx(), yLegEnd - yLegTop, pathPalette);
  }

  const pathReach = TILE * 0.92;
  if (goLeft) {
    const x0 = flankCX - tw;
    const x1 = cx + tw + pathReach;
    if (x1 > x0 + 8) drawPath(ctx, x0, yBandTop, x1 - x0, bandPH, pathPalette);
  } else {
    const x0 = cx - tw - pathReach;
    const x1 = flankCX + tw;
    if (x1 > x0 + 8) drawPath(ctx, x0, yBandTop, x1 - x0, bandPH, pathPalette);
  }

  /** North-face door (`cy - 46`); stem overlaps horizontal band so elbows stay continuous. */
  const doorApproachY = hallCy - 46;
  const stemTop = doorApproachY - TILE * 0.52;
  const stemBottom = Math.max(yBandTop + bandPH - 14, bendMidY + tw);
  if (stemBottom > stemTop + 12) {
    drawPath(ctx, cx - tw, stemTop, thinPathBandPx(), stemBottom - stemTop, pathPalette);
  }
}

function drawAllHallAccessPaths(
  ctx: CanvasRenderingContext2D,
  interiorHallKeys: string[],
  hubMap: Map<string, HallHubCampus>,
  streetY: number,
  worldW: number,
  pathPalette: PathProceduralColors,
) {
  for (const h of interiorHallKeys) {
    const c = hubMap.get(h);
    if (!c) continue;
    if (!c.southOfStreet) {
      drawThinHallPathFacingRoad(ctx, c.cx, c.cy, streetY, pathPalette);
    } else {
      drawThinHallPathWrappedFromRoad(ctx, c.cx, c.cy, streetY, worldW, h, pathPalette);
    }
  }
}

/** Axis-aligned world rect (pre-projection Y); used to keep decorative props off footpaths. */
type WorldPathRect = { left: number; top: number; right: number; bottom: number };

const PATH_PROP_CLEARANCE = TILE * 0.55;

function worldCircleHitsAnyPathRect(px: number, py: number, pr: number, rects: WorldPathRect[]): boolean {
  const r2 = pr * pr;
  for (const b of rects) {
    const nx = Math.max(b.left, Math.min(px, b.right));
    const ny = Math.max(b.top, Math.min(py, b.bottom));
    if ((px - nx) ** 2 + (py - ny) ** 2 <= r2) return true;
  }
  return false;
}

function worldRectHitsAnyPathRect(box: WorldPathRect, rects: WorldPathRect[]): boolean {
  for (const b of rects) {
    if (box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top) return true;
  }
  return false;
}

function flowerBedWorldBounds(cx: number, cy: number, size: number): WorldPathRect {
  if (size <= 0) {
    const hw = 18;
    const hh = 12;
    return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
  }
  const half = size * 8 + 14;
  return { left: cx - half, top: cy - half, right: cx + half, bottom: cy + half };
}

/** Single PNG flower bed footprint (scaled overworld coords, objects/flower_bed.png). */
function flowerBedSpriteFootprint(cx: number, cy: number): WorldPathRect {
  const hw = TILE * 2.35;
  const hh = TILE * 1.18;
  return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
}

function drawFlowerBedMaybeSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  seed: number,
  rects: WorldPathRect[],
) {
  if (!worldRectHitsAnyPathRect(flowerBedSpriteFootprint(cx, cy), rects)) {
    if (drawSprite(ctx, OBJECT_SPRITES.flowerBed, cx, cy)) return;
  }
  const bw = flowerBedWorldBounds(cx, cy, size);
  if (!worldRectHitsAnyPathRect(bw, rects)) drawFlowerBed(ctx, cx, cy, size, seed);
}

function appendSouthWrappedHallThinPathRects(
  rects: WorldPathRect[],
  cx: number,
  hallCy: number,
  streetY: number,
  worldW: number,
  hallKey: string,
  pad: number,
) {
  const tw = THIN_PATH_HALF_W;
  const band = avenueBlendHalfThickness();
  const yRoadSouth = streetY + band;
  const sep = 12;
  const marginPx = AVENUE_SIDE_MARGIN_TILES * TILE + tw * 2;

  let salt = 0;
  for (let i = 0; i < hallKey.length; i++) salt += hallKey.charCodeAt(i) * (i + 3);
  const goLeft = tileHash(salt, Math.floor(cx), 502) > 0.5;

  let flankCX = goLeft
    ? cx - HALL_W / 2 - sep - tw
    : cx + HALL_W / 2 + sep + tw;
  if (goLeft) flankCX = Math.max(marginPx, flankCX);
  else flankCX = Math.min(worldW - marginPx, flankCX);

  const bandPH = thinPathBandPx() + 10;
  const bendMidY = hallCy + 24;
  const yBandTop = bendMidY - Math.floor(bandPH / 2);

  const yLegTop = yRoadSouth - 6;
  const yLegEnd = bendMidY + Math.ceil(bandPH / 2) + 10;
  const hwPad = tw + pad;
  if (yLegEnd > yLegTop + 10) {
    rects.push({
      left: flankCX - hwPad,
      top: yLegTop - pad,
      right: flankCX + hwPad,
      bottom: yLegEnd + pad,
    });
  }

  const pathReach = TILE * 0.92;
  if (goLeft) {
    const x0 = flankCX - tw;
    const x1 = cx + tw + pathReach;
    if (x1 > x0 + 8) {
      rects.push({ left: x0 - pad, top: yBandTop - pad, right: x1 + pad, bottom: yBandTop + bandPH + pad });
    }
  } else {
    const x0 = cx - tw - pathReach;
    const x1 = flankCX + tw;
    if (x1 > x0 + 8) {
      rects.push({ left: x0 - pad, top: yBandTop - pad, right: x1 + pad, bottom: yBandTop + bandPH + pad });
    }
  }

  const doorApproachY = hallCy - 46;
  const stemTop = doorApproachY - TILE * 0.52;
  const stemBottom = Math.max(yBandTop + bandPH - 14, bendMidY + tw);
  if (stemBottom > stemTop + 12) {
    rects.push({
      left: cx - hwPad,
      top: stemTop - pad,
      right: cx + hwPad,
      bottom: stemBottom + pad,
    });
  }
}

/** Footprint of foot-traffic paths (avenue + thin hall spokes), inflated so props stay visually clear. */
function collectOverworldPathClearanceRects(
  interiorHallKeys: string[],
  hallHubCentroidByHall: Map<string, HallHubCampus>,
  streetY: number,
  worldW: number,
  aveLeft: number,
  aveRight: number,
): WorldPathRect[] {
  const pad = PATH_PROP_CLEARANCE;
  const blendHalf = avenueBlendHalfThickness();
  const rects: WorldPathRect[] = [
    {
      left: aveLeft - pad,
      top: streetY - blendHalf - pad,
      right: aveRight + pad,
      bottom: streetY + blendHalf + pad,
    },
  ];
  const tw = THIN_PATH_HALF_W;
  const hwPad = tw + pad;

  for (const h of interiorHallKeys) {
    const c = hallHubCentroidByHall.get(h);
    if (!c) continue;
    if (!c.southOfStreet) {
      const band = avenueBlendHalfThickness();
      const mudNorth = streetY - band;
      const doorFootY = c.cy + 28;
      const thinTop = doorFootY - TILE * 0.48;
      const thinBot = mudNorth + TILE * 0.32;
      if (thinBot > thinTop + 10) {
        rects.push({
          left: c.cx - hwPad,
          top: thinTop - pad,
          right: c.cx + hwPad,
          bottom: thinBot + pad,
        });
      }
    } else {
      appendSouthWrappedHallThinPathRects(rects, c.cx, c.cy, streetY, worldW, h, pad);
    }
  }
  return rects;
}

/** Pine from `objects/tree_alt_pine.png` only — no procedural tree canvas art. */
function drawTree(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
  const x = tx * TILE + TILE / 2;
  const groundY = Math.max(36, projY(ty * TILE + TILE / 2 + 8));
  drawSprite(ctx, OBJECT_SPRITES.tree, x, groundY);
}

/** Second pine offset from tile center world coords (clusters / groves). */
function drawTreeOffset(ctx: CanvasRenderingContext2D, wx: number, wyWorld: number) {
  const groundY = Math.max(36, projY(wyWorld));
  drawSprite(ctx, OBJECT_SPRITES.tree, wx, groundY);
}

/** Flora's growing tree. Trunk + leaves via golden-angle spiral (deterministic from postCount). */
function drawFloraTree(ctx: CanvasRenderingContext2D, cx: number, groundY: number, postCount: number) {
  const maturity = Math.min(postCount / 30, 1);
  const trunkH = 22 + maturity * 52;
  const trunkW = 4 + maturity * 7;
  const canopyR = 12 + maturity * 36;
  const canopyCY = groundY - trunkH - canopyR * 0.15;
  ctx.save();
  // Trunk
  ctx.fillStyle = "#5c3317";
  ctx.beginPath();
  ctx.roundRect(cx - trunkW / 2, groundY - trunkH, trunkW, trunkH, 2);
  ctx.fill();
  if (postCount === 0) {
    // Sapling bud
    ctx.fillStyle = "#6abf45";
    ctx.beginPath();
    ctx.ellipse(cx, groundY - trunkH - 5, 7, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Bottom shadow layer
    ctx.fillStyle = "#285e14";
    ctx.beginPath();
    ctx.ellipse(cx, canopyCY + canopyR * 0.28, canopyR * 0.88, canopyR * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    // Main canopy
    ctx.fillStyle = "#4a9e28";
    ctx.beginPath();
    ctx.ellipse(cx, canopyCY, canopyR, canopyR * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    // Left highlight
    ctx.fillStyle = "#6ecf40";
    ctx.beginPath();
    ctx.ellipse(cx - canopyR * 0.22, canopyCY - canopyR * 0.18, canopyR * 0.62, canopyR * 0.52, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Top shine
    ctx.fillStyle = "#90e858";
    ctx.beginPath();
    ctx.ellipse(cx, canopyCY - canopyR * 0.38, canopyR * 0.32, canopyR * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    // Individual leaf dots (golden-angle, deterministic)
    const leafCount = Math.min(postCount, 32);
    for (let i = 0; i < leafCount; i++) {
      const angle = (i * 137.508 * Math.PI) / 180;
      const r = canopyR * (0.12 + (i % 8) * 0.1);
      const lx = cx + r * Math.cos(angle);
      const ly = canopyCY + r * Math.sin(angle) * 0.68;
      ctx.fillStyle = `hsl(${95 + (i % 7) * 9},72%,${40 + (i % 4) * 7}%)`;
      ctx.beginPath();
      ctx.ellipse(lx, ly, 3.5, 2.5, angle * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Stable 0..1 from grid cell — used for baked fork forest (no per-frame noise). */
function forkCellHash01(tx: number, ty: number, salt: number): number {
  let n = (tx * 374761393 + ty * 668265263 + salt * 982451653) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n >>> 0) / 0xffff_ffff;
}

/** Pine with scale + lean for the fork hub bake; foot stays at (wx, wyGround). */
function drawForkForestPine(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wyGround: number,
  scale: number,
  rotationRad: number,
  alpha = 1,
): boolean {
  const spec = OBJECT_SPRITES.tree;
  const tile = getTile(spec);
  if (!tile) {
    drawSprite(ctx, spec, wx, wyGround);
    return false;
  }
  const { w, h } = spec.size;
  const { x: ax, y: ay } = spec.anchor;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(wx, wyGround);
  ctx.rotate(rotationRad);
  ctx.scale(scale, scale);
  ctx.drawImage(tile.img, -ax, -ay, w, h);
  ctx.restore();
  return true;
}

// Bush — PNG or rounded green blob
function drawBush(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale = 1) {
  if (scale === 1 && drawSprite(ctx, OBJECT_SPRITES.bush, cx, cy)) return;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 6 * scale, 14 * scale, 3 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2d8a26";
  ctx.beginPath();
  ctx.arc(cx - 5 * scale, cy + 1 * scale, 7 * scale, 0, Math.PI * 2);
  ctx.arc(cx + 5 * scale, cy + 1 * scale, 7 * scale, 0, Math.PI * 2);
  ctx.arc(cx, cy - 4 * scale, 7 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3fb036";
  ctx.beginPath();
  ctx.arc(cx - 3 * scale, cy - 3 * scale, 4 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5fd84d";
  ctx.fillRect(cx - 2 * scale, cy - 6 * scale, 2 * scale, 2 * scale);
}

// Lantern (decorative)
function drawLantern(ctx: CanvasRenderingContext2D, cx: number, cy: number, glow = false) {
  if (!glow && drawSprite(ctx, OBJECT_SPRITES.lantern, cx, cy + 22)) return;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 22, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a2a1a";
  ctx.fillRect(cx - 1, cy + 4, 2, 18);
  ctx.fillRect(cx - 4, cy + 22, 8, 2);
  ctx.fillRect(cx - 4, cy - 2, 8, 2);
  ctx.fillStyle = glow ? "#ffd76a" : "#c89a3a";
  ctx.fillRect(cx - 3, cy, 6, 6);
  if (glow) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#fff3a0";
    ctx.beginPath();
    ctx.arc(cx, cy + 3, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
function drawSignboard(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, signColor: string, glow = false) {
  ctx.font = "bold 13px monospace";
  const textW = ctx.measureText(label).width;
  const BOARD_W = Math.max(120, textW + 24), BOARD_H = 32, POST_H = 44;
  const bx = cx - BOARD_W / 2, by = cy - POST_H - BOARD_H;
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(cx - BOARD_W / 2 + 8, by + BOARD_H, 8, POST_H);
  ctx.fillRect(cx + BOARD_W / 2 - 16, by + BOARD_H, 8, POST_H);
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(bx + 4, by + 4, BOARD_W, BOARD_H);
  ctx.fillStyle = signColor; ctx.fillRect(bx, by, BOARD_W, BOARD_H);
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, BOARD_W, BOARD_H);
  if (glow) {
    ctx.save();
    ctx.fillStyle = "rgba(255,215,0,0.1)";
    ctx.fillRect(bx - 2, by - 2, BOARD_W + 4, BOARD_H + 4);
    ctx.restore();
  }
  ctx.fillStyle = "#fff"; ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
  ctx.fillText(label, cx, by + BOARD_H - 9); ctx.textAlign = "left";
}

// ─── Townhall building facade (overworld) ─────────────────────────────────────
// New townhall dimensions — taller for richer detail
const HALL_W = 180, HALL_H = 140;
// 3D cube shell parameters (used by drawTownhall to give every facade depth)
const HALL_DEPTH = 22;     // how far back the right side / roof tilt extends
const ROOF_OVERHANG = 8;   // roof sticks past the front face on each side

/**
 * Draw the 3D "cube shell" behind a facade: a right-side parallelogram and a
 * top-roof parallelogram, both tilting up-and-to-the-right by HALL_DEPTH.
 * The actual facade front (windows/door/sign) is painted on top by the
 * per-hall renderer, so we keep all hand-tuned detail.
 */
function drawCubeShell(
  ctx: CanvasRenderingContext2D,
  fx: number, fy: number, fw: number, fh: number,
  sideColor: string, sideShade: string,
  roofColor: string, roofTile: string, roofHighlight: string
) {
  const d = HALL_DEPTH;
  const o = ROOF_OVERHANG;

  // ── Right side face (parallelogram) ──────────────────────────────────────
  ctx.fillStyle = sideColor;
  ctx.beginPath();
  ctx.moveTo(fx + fw,         fy);
  ctx.lineTo(fx + fw + d,     fy - d);
  ctx.lineTo(fx + fw + d,     fy + fh - d);
  ctx.lineTo(fx + fw,         fy + fh);
  ctx.closePath();
  ctx.fill();
  // Side shade gradient (darker near the back edge)
  ctx.fillStyle = sideShade;
  ctx.beginPath();
  ctx.moveTo(fx + fw + d - 6, fy - d + 6);
  ctx.lineTo(fx + fw + d,     fy - d);
  ctx.lineTo(fx + fw + d,     fy + fh - d);
  ctx.lineTo(fx + fw + d - 6, fy + fh - d);
  ctx.closePath();
  ctx.fill();
  // Side trim line at the bottom
  ctx.fillStyle = sideShade;
  ctx.fillRect(fx + fw, fy + fh - 2, d, 2);

  // ── Top roof face (parallelogram seen from above-front) ──────────────────
  ctx.fillStyle = roofColor;
  ctx.beginPath();
  ctx.moveTo(fx - o,              fy);
  ctx.lineTo(fx - o + d,          fy - d);
  ctx.lineTo(fx + fw + o + d,     fy - d);
  ctx.lineTo(fx + fw + o,         fy);
  ctx.closePath();
  ctx.fill();
  // Roof tile lines (parallel to the top edge, walking back into the depth)
  ctx.fillStyle = roofTile;
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const y0 = fy - d * t;
    ctx.fillRect(fx - o + d * t + 2, y0, fw + o * 2 - 4, 1);
  }
  // Roof front edge highlight
  ctx.fillStyle = roofHighlight;
  ctx.fillRect(fx - o, fy - 1, fw + o * 2, 1);
  // Roof back-right corner shadow (2px) so the parallelogram reads
  ctx.fillStyle = roofTile;
  ctx.fillRect(fx + fw + o + d - 2, fy - d, 2, 2);
}

// Shared exterior helpers
function drawShadowEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHipRoof(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  main: string, dark: string
) {
  ctx.fillStyle = main;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w * 0.14, y);
  ctx.lineTo(x + w * 0.86, y);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  // Tile lines
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? dark : "rgba(255,255,255,0.08)";
    ctx.fillRect(x + 4 + i * 4, y + 4 + i * 3, w - 8 - i * 8, 2);
  }
  // Bottom shadow
  ctx.fillStyle = dark;
  ctx.fillRect(x, y + h - 3, w, 3);
}

function drawWoodPlanks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base = "#9c6b3a", dark = "#724820") {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = dark;
  // Horizontal plank seams
  for (let py = y + 8; py < y + h; py += 8) {
    ctx.fillRect(x, py, w, 1);
  }
  // Vertical plank breaks (offset per row)
  for (let py = y; py < y + h; py += 8) {
    const offset = ((py / 8) % 2) * 14;
    for (let px = x + 6 + offset; px < x + w - 4; px += 28) {
      ctx.fillRect(px, py + 1, 1, 7);
    }
  }
}

function drawWindow(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  glassColor: string, frameColor: string, lit: boolean
) {
  ctx.fillStyle = lit ? "rgba(255,215,120,0.7)" : glassColor;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  // Cross bar
  ctx.fillStyle = frameColor;
  ctx.fillRect(x + Math.floor(w / 2) - 1, y, 2, h);
  ctx.fillRect(x, y + Math.floor(h / 2) - 1, w, 2);
  // Top sill highlight
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
}

function drawSignBanner(
  ctx: CanvasRenderingContext2D, cx: number, by: number,
  label: string, signColor: string
) {
  ctx.font = "bold 12px monospace";
  const tw = ctx.measureText(label).width;
  const bannerW = Math.min(HALL_W + 50, Math.max(110, tw + 22));
  const bannerH = 20;
  // Posts
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(cx - bannerW / 2 + 6, by + bannerH, 4, 12);
  ctx.fillRect(cx + bannerW / 2 - 10, by + bannerH, 4, 12);
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(cx - bannerW / 2 + 3, by + 3, bannerW, bannerH);
  // Board
  ctx.fillStyle = signColor;
  ctx.fillRect(cx - bannerW / 2, by, bannerW, bannerH);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - bannerW / 2, by, bannerW, bannerH);
  // Highlight
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(cx - bannerW / 2 + 1, by + 1, bannerW - 2, 1);
  // Text
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  const display = label.length > 22 ? label.slice(0, 20) + "…" : label;
  ctx.fillText(display, cx, by + 14);
  ctx.textAlign = "left";
}

function drawEnterHint(ctx: CanvasRenderingContext2D, cx: number, y: number) {
  ctx.save();
  ctx.globalAlpha = 0.5 + 0.25 * Math.sin(Date.now() / 380);
  ctx.font = "bold 9px monospace";
  ctx.fillStyle = "#fff8c5";
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 3;
  ctx.textAlign = "center";
  ctx.strokeText("ENTER", cx, y);
  ctx.fillText("ENTER", cx, y);
  ctx.textAlign = "left";
  ctx.restore();
}

// ── Per-hall facade renderers ──
type FacadeFn = (
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  theme: TownhallTheme, palette: { bg: string; border: string; sign: string },
  glow: boolean
) => void;

// "general" — simple country cottage, red hip roof, wood door, no logo/seal.
function drawGeneralHub(ctx: CanvasRenderingContext2D, cx: number, cy: number, theme: TownhallTheme, _palette: { bg: string; border: string; sign: string }, glow: boolean) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  // Cream walls
  ctx.fillStyle = "#eee2c4";
  ctx.fillRect(bx, by + 50, W, H - 50);
  // Wall trim
  ctx.fillStyle = "#caaf80";
  ctx.fillRect(bx, by + H - 8, W, 8);
  // Red hip roof (overhang)
  drawHipRoof(ctx, bx - 10, by, W + 20, 56, "#d62828", "#9b1c1c");
  // Roof gutter
  ctx.fillStyle = "#7a1a1a";
  ctx.fillRect(bx - 10, by + 52, W + 20, 4);
  // Two windows
  drawWindow(ctx, bx + 18, by + 64, 28, 22, "#a8d8ff", "#3a5a7a", glow);
  drawWindow(ctx, bx + W - 46, by + 64, 28, 22, "#a8d8ff", "#3a5a7a", glow);
  // Wooden door (no seal)
  const dW = 36, dH = 50;
  const dX = cx - dW / 2, dY = by + H - dH;
  ctx.fillStyle = "#8b4513";
  ctx.fillRect(dX, dY, dW, dH);
  ctx.fillStyle = "#6b3410";
  ctx.fillRect(dX + dW / 2 - 1, dY, 2, dH);
  // Door panels
  ctx.fillStyle = "#a0521a";
  ctx.fillRect(dX + 4, dY + 6, dW / 2 - 6, 14);
  ctx.fillRect(dX + dW / 2 + 2, dY + 6, dW / 2 - 6, 14);
  ctx.fillRect(dX + 4, dY + 26, dW / 2 - 6, 14);
  ctx.fillRect(dX + dW / 2 + 2, dY + 26, dW / 2 - 6, 14);
  // Handle
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(dX + dW - 8, dY + dH / 2, 3, 3);
  // Stoop
  ctx.fillStyle = "#a07a4a";
  ctx.fillRect(dX - 4, dY + dH, dW + 8, 5);
  // Chimney
  ctx.fillStyle = "#a35a4a";
  ctx.fillRect(bx + W - 36, by - 14, 12, 22);
  ctx.fillStyle = "#823e30";
  ctx.fillRect(bx + W - 36, by - 14, 12, 4);
  // Smoke puff
  if (theme && Math.sin(Date.now() / 700) > 0) {
    ctx.fillStyle = "rgba(220,220,220,0.7)";
    ctx.beginPath();
    ctx.arc(bx + W - 30, by - 22, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTechLab(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  _theme: TownhallTheme, _palette: { bg: string; border: string; sign: string },
  glow: boolean
) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  // Slightly wider footprint for the octagonal shoulders
  const chamfer = 18;
  const wallTop = by + 28;

  // ── Side flag poles (drawn first so they appear behind building shoulders) ──
  const poleColor = "#9aa1b0";
  const flagBlue = "#3b6ea5";
  const flagDark = "#1f3a60";
  // Left pole
  ctx.fillStyle = poleColor;
  ctx.fillRect(bx - 28, by - 18, 2, 80);
  ctx.fillStyle = "#cdd2dc";
  ctx.fillRect(bx - 30, by - 20, 6, 4);
  // Left flag (waving)
  ctx.fillStyle = flagBlue;
  ctx.beginPath();
  ctx.moveTo(bx - 26, by - 16);
  ctx.lineTo(bx - 6, by - 14);
  ctx.lineTo(bx - 4, by + 4);
  ctx.lineTo(bx - 26, by + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = flagDark;
  ctx.fillRect(bx - 26, by - 16, 1, 22);
  // Circuit decoration on flag
  ctx.fillStyle = "#74e0ff";
  ctx.fillRect(bx - 22, by - 10, 2, 2);
  ctx.fillRect(bx - 18, by - 10, 8, 1);
  ctx.fillRect(bx - 14, by - 6, 2, 4);
  ctx.fillRect(bx - 10, by - 2, 4, 1);
  // Right pole
  ctx.fillStyle = poleColor;
  ctx.fillRect(bx + W + 26, by - 18, 2, 80);
  ctx.fillStyle = "#cdd2dc";
  ctx.fillRect(bx + W + 24, by - 20, 6, 4);
  // Right flag
  ctx.fillStyle = flagBlue;
  ctx.beginPath();
  ctx.moveTo(bx + W + 28, by - 16);
  ctx.lineTo(bx + W + 48, by - 14);
  ctx.lineTo(bx + W + 50, by + 4);
  ctx.lineTo(bx + W + 28, by + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = flagDark;
  ctx.fillRect(bx + W + 28, by - 16, 1, 22);
  ctx.fillStyle = "#74e0ff";
  ctx.fillRect(bx + W + 32, by - 10, 2, 2);
  ctx.fillRect(bx + W + 36, by - 10, 8, 1);
  ctx.fillRect(bx + W + 40, by - 6, 2, 4);
  ctx.fillRect(bx + W + 44, by - 2, 4, 1);

  // ── Building shadow ──
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(bx + 4, by + H - 4, W, 6);

  // ── Octagonal silver body ──
  // Outer silhouette (octagon-like via chamfered rectangle)
  const wallBase = "#c9cfdc";  // light silver
  const wallShade = "#a4abbb"; // mid silver
  const wallDark = "#7d8497";  // edge shadow
  ctx.fillStyle = wallBase;
  ctx.beginPath();
  ctx.moveTo(bx + chamfer, wallTop);
  ctx.lineTo(bx + W - chamfer, wallTop);
  ctx.lineTo(bx + W, wallTop + chamfer);
  ctx.lineTo(bx + W, by + H - 4);
  ctx.lineTo(bx, by + H - 4);
  ctx.lineTo(bx, wallTop + chamfer);
  ctx.closePath();
  ctx.fill();

  // Vertical shading on the right edge
  ctx.fillStyle = wallShade;
  ctx.beginPath();
  ctx.moveTo(bx + W - 6, wallTop + chamfer - 2);
  ctx.lineTo(bx + W, wallTop + chamfer);
  ctx.lineTo(bx + W, by + H - 4);
  ctx.lineTo(bx + W - 6, by + H - 4);
  ctx.closePath();
  ctx.fill();
  // Top shoulder shading (left chamfer)
  ctx.fillStyle = wallShade;
  ctx.beginPath();
  ctx.moveTo(bx, wallTop + chamfer);
  ctx.lineTo(bx + chamfer, wallTop);
  ctx.lineTo(bx + chamfer, wallTop + 4);
  ctx.lineTo(bx + 4, wallTop + chamfer);
  ctx.closePath();
  ctx.fill();
  // Right shoulder shading
  ctx.fillStyle = wallDark;
  ctx.beginPath();
  ctx.moveTo(bx + W - chamfer, wallTop);
  ctx.lineTo(bx + W, wallTop + chamfer);
  ctx.lineTo(bx + W - 4, wallTop + chamfer);
  ctx.lineTo(bx + W - chamfer, wallTop + 4);
  ctx.closePath();
  ctx.fill();

  // ── Roof cap / cornice (darker top trim) ──
  ctx.fillStyle = "#5a6273";
  ctx.beginPath();
  ctx.moveTo(bx + chamfer - 2, wallTop - 6);
  ctx.lineTo(bx + W - chamfer + 2, wallTop - 6);
  ctx.lineTo(bx + W - chamfer + 2, wallTop);
  ctx.lineTo(bx + W - chamfer, wallTop);
  ctx.lineTo(bx + chamfer, wallTop);
  ctx.lineTo(bx + chamfer - 2, wallTop);
  ctx.closePath();
  ctx.fill();
  // Cornice highlight
  ctx.fillStyle = "#b6bccd";
  ctx.fillRect(bx + chamfer - 2, wallTop - 6, W - 2 * chamfer + 4, 2);

  // ── Bottom plinth (slightly darker base strip) ──
  ctx.fillStyle = "#9aa0b0";
  ctx.fillRect(bx + 2, by + H - 10, W - 4, 6);
  ctx.fillStyle = "#7c8294";
  ctx.fillRect(bx + 2, by + H - 6, W - 4, 2);

  // ── Central recessed bay (entrance area) ──
  const bayW = 56;
  const bayX = cx - bayW / 2;
  const bayTop = wallTop - 8; // peeks above the cornice slightly
  // Vertical bay walls (a bit darker silver to suggest recession… but here we want a bright center)
  ctx.fillStyle = "#dde2ec";
  ctx.fillRect(bayX, bayTop, bayW, by + H - 8 - bayTop);
  // Bay cornice cap
  ctx.fillStyle = "#5a6273";
  ctx.fillRect(bayX - 2, bayTop - 4, bayW + 4, 4);
  ctx.fillStyle = "#b6bccd";
  ctx.fillRect(bayX - 2, bayTop - 4, bayW + 4, 1);
  // Pediment-like little gable on top of bay
  ctx.fillStyle = "#c9cfdc";
  ctx.beginPath();
  ctx.moveTo(bayX - 2, bayTop - 4);
  ctx.lineTo(cx, bayTop - 14);
  ctx.lineTo(bayX + bayW + 2, bayTop - 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#5a6273";
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── "TECH" sign band over door ──
  const signY = bayTop + 6;
  ctx.fillStyle = "#1f3a60";
  ctx.fillRect(bayX + 4, signY, bayW - 8, 12);
  ctx.fillStyle = "#3b6ea5";
  ctx.fillRect(bayX + 4, signY, bayW - 8, 2);
  ctx.fillStyle = "#74e0ff";
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "center";
  ctx.fillText("TECH", cx, signY + 9);
  ctx.textAlign = "left";

  // ── Two columns flanking the entrance ──
  const colTop = signY + 14;
  const colBottom = by + H - 8;
  [bayX + 4, bayX + bayW - 8].forEach((x0) => {
    ctx.fillStyle = "#dde2ec";
    ctx.fillRect(x0, colTop, 4, colBottom - colTop);
    ctx.fillStyle = "#9aa0b0";
    ctx.fillRect(x0 + 3, colTop, 1, colBottom - colTop);
    // Capital
    ctx.fillStyle = "#a4abbb";
    ctx.fillRect(x0 - 1, colTop, 6, 2);
    // Base
    ctx.fillStyle = "#a4abbb";
    ctx.fillRect(x0 - 1, colBottom - 2, 6, 2);
  });

  // ── Glass entrance door (tall blue panel between columns) ──
  const dX = bayX + 10, dY = colTop + 4;
  const dW = bayW - 20, dH = colBottom - dY - 2;
  // Dark frame
  ctx.fillStyle = "#1a2538";
  ctx.fillRect(dX - 2, dY - 2, dW + 4, dH + 4);
  // Glass panel (gradient-ish via 3 stripes)
  ctx.fillStyle = "#86d6ff";
  ctx.fillRect(dX, dY, dW, dH);
  ctx.fillStyle = "#a3e3ff";
  ctx.fillRect(dX, dY, dW, Math.floor(dH * 0.5));
  ctx.fillStyle = "#d6f3ff";
  ctx.fillRect(dX, dY, dW, 6);
  // Vertical bright streak (light reflection)
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(dX + Math.floor(dW * 0.5) - 1, dY + 2, 2, dH - 4);
  // Center seam (sliding door)
  ctx.fillStyle = "#1f3a60";
  ctx.fillRect(dX + Math.floor(dW / 2), dY, 1, dH);
  // Door frame outline
  ctx.strokeStyle = "#3b6ea5";
  ctx.lineWidth = 1;
  ctx.strokeRect(dX, dY, dW, dH);
  // Glow when night
  if (glow) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#86d6ff";
    ctx.fillRect(dX - 6, dY - 6, dW + 12, dH + 12);
    ctx.restore();
  }

  // ── Side windows with circuit patterns ──
  const winY = wallTop + 22;
  const winH = 26;
  const leftWinX = bx + 14;
  const rightWinX = bx + W - 14 - 38;
  [leftWinX, rightWinX].forEach((wx) => {
    // Frame
    ctx.fillStyle = "#1f3a60";
    ctx.fillRect(wx - 2, winY - 2, 42, winH + 4);
    // Glass
    ctx.fillStyle = glow ? "#86d6ff" : "#5a8bb8";
    ctx.fillRect(wx, winY, 38, winH);
    // Circuit lines
    ctx.fillStyle = "#74e0ff";
    ctx.fillRect(wx + 4, winY + 6, 14, 1);
    ctx.fillRect(wx + 18, winY + 6, 1, 6);
    ctx.fillRect(wx + 18, winY + 12, 8, 1);
    ctx.fillRect(wx + 4, winY + 18, 6, 1);
    ctx.fillRect(wx + 10, winY + 14, 1, 5);
    ctx.fillRect(wx + 22, winY + 18, 12, 1);
    // Tiny LEDs
    ctx.fillStyle = "#fdcb6e";
    ctx.fillRect(wx + 30, winY + 4, 2, 2);
    ctx.fillStyle = "#a8e6a3";
    ctx.fillRect(wx + 34, winY + 4, 2, 2);
    // Glass reflection
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(wx + 2, winY + 1, 8, 3);
  });

  // ── Wall circuit-pattern panel between bay and side windows ──
  ctx.fillStyle = "#9aa0b0";
  // Left panel
  ctx.fillRect(leftWinX + 38 + 4, winY + 2, bayX - (leftWinX + 38 + 4) - 4, winH);
  // Right panel
  ctx.fillRect(bayX + bayW + 4, winY + 2, rightWinX - 4 - (bayX + bayW + 4), winH);
  // Etched circuit lines on those panels
  ctx.strokeStyle = "#3b6ea5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Left
  const lpx = leftWinX + 38 + 8;
  ctx.moveTo(lpx, winY + 8);
  ctx.lineTo(lpx + 6, winY + 8);
  ctx.lineTo(lpx + 6, winY + 16);
  ctx.lineTo(lpx + 14, winY + 16);
  // Right
  const rpx = bayX + bayW + 8;
  ctx.moveTo(rpx + 2, winY + 10);
  ctx.lineTo(rpx + 12, winY + 10);
  ctx.lineTo(rpx + 12, winY + 22);
  ctx.stroke();
  ctx.fillStyle = "#74e0ff";
  ctx.fillRect(lpx + 14, winY + 16, 2, 2);
  ctx.fillRect(rpx + 12, winY + 22, 2, 2);

  // ── Roof ornaments ──
  // Central tall antenna spire with cyan tips
  const spireBaseX = cx;
  const spireBaseY = bayTop - 14;
  ctx.fillStyle = "#5a6273";
  ctx.beginPath();
  ctx.moveTo(spireBaseX - 3, spireBaseY);
  ctx.lineTo(spireBaseX + 3, spireBaseY);
  ctx.lineTo(spireBaseX + 1, spireBaseY - 24);
  ctx.lineTo(spireBaseX - 1, spireBaseY - 24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#74e0ff";
  ctx.fillRect(spireBaseX - 1, spireBaseY - 28, 2, 5);
  // Side rings on spire (cyan accents)
  ctx.fillStyle = "#74e0ff";
  ctx.fillRect(spireBaseX - 4, spireBaseY - 14, 8, 1);
  ctx.fillRect(spireBaseX - 5, spireBaseY - 8, 10, 1);
  // Side antenna dishes
  [bx + 16, bx + W - 24].forEach((dCx, idx) => {
    const dCy = wallTop - 8;
    // Mast
    ctx.fillStyle = "#5a6273";
    ctx.fillRect(dCx, dCy, 2, 12);
    // Dish (semi-circle)
    ctx.fillStyle = "#dde2ec";
    ctx.beginPath();
    ctx.arc(dCx + 1, dCy - 2, 6, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#7d8497";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Receiver dot
    ctx.fillStyle = idx === 0 ? "#74e0ff" : "#fdcb6e";
    ctx.fillRect(dCx, dCy - 4, 2, 2);
  });
}

function drawTownHall(ctx: CanvasRenderingContext2D, cx: number, cy: number, _theme: TownhallTheme, _palette: { bg: string; border: string; sign: string }, _glow: boolean) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  // Stone walls
  ctx.fillStyle = "#aea48c";
  ctx.fillRect(bx, by + 50, W, H - 50);
  // Stone block pattern
  ctx.fillStyle = "#8a7e64";
  for (let py = by + 56; py < by + H - 4; py += 10) {
    const offset = (((py - by) / 10) % 2) * 20;
    for (let px = bx + 4 + offset; px < bx + W - 4; px += 40) {
      ctx.fillRect(px, py, 1, 8);
    }
    ctx.fillRect(bx, py, W, 1);
  }
  // Pediment (gold triangle)
  ctx.fillStyle = "#c9a227";
  ctx.beginPath();
  ctx.moveTo(bx - 4, by + 50);
  ctx.lineTo(cx, by + 6);
  ctx.lineTo(bx + W + 4, by + 50);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#a48618";
  ctx.fillRect(bx - 4, by + 48, W + 8, 4);
  // Triangle inner
  ctx.fillStyle = "#e8d89c";
  ctx.beginPath();
  ctx.moveTo(bx + 18, by + 48);
  ctx.lineTo(cx, by + 18);
  ctx.lineTo(bx + W - 18, by + 48);
  ctx.closePath();
  ctx.fill();
  // Clock face on pediment
  ctx.fillStyle = "#1a1a2e";
  ctx.beginPath();
  ctx.arc(cx, by + 36, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Hour marks
  ctx.fillStyle = "#fff";
  ctx.fillRect(cx - 0.5, by + 28, 1, 2);
  ctx.fillRect(cx - 0.5, by + 42, 1, 2);
  ctx.fillRect(cx - 7, by + 35.5, 2, 1);
  ctx.fillRect(cx + 5, by + 35.5, 2, 1);
  // Hands
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, by + 36); ctx.lineTo(cx + 4, by + 33);
  ctx.moveTo(cx, by + 36); ctx.lineTo(cx, by + 30);
  ctx.stroke();
  // 4 columns
  const colYTop = by + 50, colH = H - 60;
  [cx - 60, cx - 22, cx + 22, cx + 60].forEach((x0) => {
    ctx.fillStyle = "#dcd0b8";
    ctx.fillRect(x0 - 5, colYTop, 10, colH);
    ctx.fillStyle = "#c4b89c";
    ctx.fillRect(x0 - 4, colYTop, 1, colH);
    ctx.fillStyle = "#a89e80";
    ctx.fillRect(x0 + 3, colYTop, 1, colH);
    // Capital
    ctx.fillStyle = "#e8dcc0";
    ctx.fillRect(x0 - 7, colYTop, 14, 4);
    // Base
    ctx.fillStyle = "#e8dcc0";
    ctx.fillRect(x0 - 7, by + H - 10, 14, 4);
  });
  // Steps
  ctx.fillStyle = "#9c917b";
  ctx.fillRect(bx - 8, by + H - 4, W + 16, 4);
  ctx.fillStyle = "#ada28c";
  ctx.fillRect(bx - 4, by + H, W + 8, 5);
  // Double doors
  const dY = by + H - 38;
  ctx.fillStyle = "#3a5a8a";
  ctx.fillRect(cx - 18, dY, 17, 38);
  ctx.fillRect(cx + 1, dY, 17, 38);
  ctx.strokeStyle = "#1a3060";
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 18, dY, 17, 38);
  ctx.strokeRect(cx + 1, dY, 17, 38);
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(cx - 6, dY + 18, 2, 2);
  ctx.fillRect(cx + 4, dY + 18, 2, 2);
}

function drawArtGallery(ctx: CanvasRenderingContext2D, cx: number, cy: number, theme: TownhallTheme, _palette: { bg: string; border: string; sign: string }, glow: boolean) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  // White walls
  ctx.fillStyle = "#f0eef0";
  ctx.fillRect(bx, by + 38, W, H - 38);
  // Pink/magenta steep roof
  ctx.fillStyle = "#c52f7d";
  ctx.beginPath();
  ctx.moveTo(bx - 6, by + 38);
  ctx.lineTo(bx + 18, by);
  ctx.lineTo(bx + W - 18, by);
  ctx.lineTo(bx + W + 6, by + 38);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#8c1f5a";
  ctx.fillRect(bx - 6, by + 36, W + 12, 4);
  ctx.fillStyle = "#e056a0";
  ctx.fillRect(bx + 18, by + 8, W - 36, 3);
  // Big display window with paintings inside
  const winX = bx + 16, winY = by + 50, winW = W - 32, winH = 50;
  ctx.fillStyle = "#222";
  ctx.fillRect(winX, winY, winW, winH);
  // 3 paintings inside
  const paintColors = ["#ff6f6f", "#ffd166", "#74c8ff", "#a8e6a3", "#c8a0e8"];
  for (let i = 0; i < 3; i++) {
    const px = winX + 8 + i * (winW / 3);
    const pw = winW / 3 - 12;
    ctx.fillStyle = "#5a3a1a";
    ctx.fillRect(px, winY + 6, pw, winH - 14);
    ctx.fillStyle = paintColors[(i * 2) % paintColors.length];
    ctx.fillRect(px + 2, winY + 8, pw - 4, winH - 18);
    // Random splash
    ctx.fillStyle = paintColors[(i * 3 + 1) % paintColors.length];
    ctx.fillRect(px + 4, winY + 14 + (i * 4) % 12, 8, 6);
    ctx.fillStyle = paintColors[(i * 5 + 2) % paintColors.length];
    ctx.fillRect(px + 14, winY + 22, 6, 4);
  }
  // Glass overlay reflection
  if (glow) {
    ctx.fillStyle = "rgba(255,215,120,0.15)";
    ctx.fillRect(winX, winY, winW, winH);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(winX, winY, winW, winH);
  }
  // Window frame
  ctx.strokeStyle = theme.accentColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(winX, winY, winW, winH);
  // Door (brown)
  const dW = 34, dH = 38;
  const dX = cx - dW / 2, dY = by + H - dH;
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(dX, dY, dW, dH);
  ctx.strokeStyle = theme.accentColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(dX, dY, dW, dH);
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(dX + dW - 6, dY + dH / 2, 3, 3);
  // Awning under window
  ctx.fillStyle = theme.accentColor;
  ctx.fillRect(winX - 4, winY + winH, winW + 8, 4);
}

function drawNatureLodge(ctx: CanvasRenderingContext2D, cx: number, cy: number, theme: TownhallTheme, _palette: { bg: string; border: string; sign: string }, glow: boolean) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  // Log wall
  drawWoodPlanks(ctx, bx, by + 50, W, H - 50);
  // A-frame green roof
  ctx.fillStyle = "#2d6a4f";
  ctx.beginPath();
  ctx.moveTo(bx - 12, by + 50);
  ctx.lineTo(cx, by - 4);
  ctx.lineTo(bx + W + 12, by + 50);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1e4f3a";
  ctx.fillRect(bx - 12, by + 48, W + 24, 4);
  // Roof shingles
  ctx.fillStyle = "#3e8a68";
  for (let i = 0; i < 5; i++) {
    const offset = i * 3;
    ctx.fillRect(bx - 10 + offset, by + 18 + i * 6, W + 20 - offset * 2, 1);
  }
  // Gable beam pattern (X)
  ctx.strokeStyle = "#724820";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 16, by + 18);
  ctx.lineTo(cx + 16, by + 44);
  ctx.moveTo(cx + 16, by + 18);
  ctx.lineTo(cx - 16, by + 44);
  ctx.stroke();
  // Two warm windows
  drawWindow(ctx, bx + 20, by + 64, 28, 24, "rgba(255,200,100,0.45)", "#724820", glow);
  drawWindow(ctx, bx + W - 48, by + 64, 28, 24, "rgba(255,200,100,0.45)", "#724820", glow);
  // Wooden door with hinges
  const dW = 36, dH = 48;
  const dX = cx - dW / 2, dY = by + H - dH;
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(dX, dY, dW, dH);
  ctx.fillStyle = "#3e2510";
  for (let py = dY + 4; py < dY + dH; py += 8) ctx.fillRect(dX, py, dW, 1);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(dX + 2, dY + 4, 3, 6);
  ctx.fillRect(dX + 2, dY + dH - 10, 3, 6);
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(dX + dW - 7, dY + dH / 2, 3, 3);
  // Stone chimney with smoke
  ctx.fillStyle = "#7a7064";
  ctx.fillRect(bx + W - 38, by - 16, 16, 30);
  ctx.fillStyle = "#5a5048";
  for (let py = by - 16; py < by + 14; py += 6) {
    ctx.fillRect(bx + W - 38, py, 16, 1);
    ctx.fillRect(bx + W - 30 + ((py / 6) % 2) * 4, py, 1, 6);
  }
  // Smoke
  ctx.fillStyle = "rgba(220,220,220,0.7)";
  const t = Date.now() / 600;
  for (let i = 0; i < 3; i++) {
    const sy = by - 22 - i * 6;
    const sx = bx + W - 30 + Math.sin(t + i) * 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 3 + i * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawScienceLab(ctx: CanvasRenderingContext2D, cx: number, cy: number, theme: TownhallTheme, _palette: { bg: string; border: string; sign: string }, glow: boolean) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  // Light walls
  ctx.fillStyle = "#d8e0e8";
  ctx.fillRect(bx, by + 60, W, H - 60);
  // Base trim
  ctx.fillStyle = "#7a8a98";
  ctx.fillRect(bx, by + H - 8, W, 8);
  // Flat dark roof slab
  ctx.fillStyle = "#3a4254";
  ctx.fillRect(bx - 4, by + 50, W + 8, 14);
  ctx.fillStyle = theme.accentColor;
  ctx.fillRect(bx - 4, by + 48, W + 8, 3);
  // Big dome on top
  const domeCx = cx, domeCy = by + 52, domeR = 36;
  ctx.fillStyle = "#a8b0c0";
  ctx.beginPath();
  ctx.arc(domeCx, domeCy, domeR, Math.PI, 0);
  ctx.lineTo(domeCx + domeR, domeCy);
  ctx.lineTo(domeCx - domeR, domeCy);
  ctx.closePath();
  ctx.fill();
  // Dome ribs
  ctx.strokeStyle = "#6e7a90";
  ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(domeCx, domeCy);
    ctx.lineTo(domeCx + i * 15, domeCy - domeR + Math.abs(i) * 4);
    ctx.stroke();
  }
  // Telescope opening
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(domeCx - 6, domeCy - domeR + 4, 12, 14);
  ctx.fillStyle = theme.accentColor;
  ctx.fillRect(domeCx - 4, domeCy - domeR + 4, 8, 2);
  // Star sparkle inside
  ctx.fillStyle = "#fff";
  ctx.fillRect(domeCx - 1, domeCy - domeR + 10, 2, 2);
  // Big square windows
  for (let i = 0; i < 3; i++) {
    drawWindow(ctx, bx + 14 + i * 52, by + 72, 32, 24, "rgba(116,185,255,0.3)", theme.accentColor, glow);
  }
  // Door
  const dW = 38, dH = 42;
  const dX = cx - dW / 2, dY = by + H - dH;
  ctx.fillStyle = "#1e3a4a";
  ctx.fillRect(dX, dY, dW, dH);
  ctx.fillStyle = "rgba(116,185,255,0.4)";
  ctx.fillRect(dX + 4, dY + 4, dW - 8, 18);
  ctx.fillStyle = theme.accentColor;
  ctx.fillRect(dX + dW / 2 - 1, dY, 2, dH);
  ctx.strokeStyle = theme.accentColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(dX, dY, dW, dH);
}

function drawArcade(ctx: CanvasRenderingContext2D, cx: number, cy: number, theme: TownhallTheme, _palette: { bg: string; border: string; sign: string }, glow: boolean) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  // Dark walls
  ctx.fillStyle = "#10101a";
  ctx.fillRect(bx, by + 36, W, H - 36);
  // Neon zigzag canopy
  const zigY = by + 36;
  const zigPoints: [number, number][] = [];
  zigPoints.push([bx - 8, zigY]);
  for (let i = 0; i <= 8; i++) {
    const x = bx + (W * i) / 8;
    const y = (i % 2 === 0) ? by + 8 : by + 26;
    zigPoints.push([x, y]);
  }
  zigPoints.push([bx + W + 8, zigY]);
  ctx.fillStyle = "#e84393";
  ctx.beginPath();
  ctx.moveTo(zigPoints[0][0], zigPoints[0][1]);
  zigPoints.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(bx + W + 8, zigY + 12);
  ctx.lineTo(bx - 8, zigY + 12);
  ctx.closePath();
  ctx.fill();
  // Neon outline
  ctx.strokeStyle = "#ff79b0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(zigPoints[0][0], zigPoints[0][1]);
  zigPoints.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.stroke();
  // Blinking lights along bottom of canopy
  for (let i = 0; i < 9; i++) {
    const lx = bx - 4 + (W + 8) * (i / 8);
    ctx.fillStyle = ((Math.floor(Date.now() / 220) + i) % 2 === 0) ? "#fdcb6e" : "#74e0ff";
    ctx.fillRect(lx, zigY + 6, 4, 4);
  }
  // Big glowing window with pixel monster
  const winX = bx + 18, winY = by + 52, winW = W - 36, winH = 38;
  ctx.fillStyle = "#2e0a3a";
  ctx.fillRect(winX, winY, winW, winH);
  // CRT scan lines
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let py = winY; py < winY + winH; py += 3) {
    ctx.fillRect(winX, py, winW, 1);
  }
  // Pixel ghost
  const gx = winX + winW / 2 - 8, gy = winY + 8;
  ctx.fillStyle = "#fdcb6e";
  ctx.fillRect(gx + 2, gy, 12, 4);
  ctx.fillRect(gx, gy + 2, 16, 12);
  // Eyes
  ctx.fillStyle = "#fff";
  ctx.fillRect(gx + 3, gy + 4, 3, 4);
  ctx.fillRect(gx + 10, gy + 4, 3, 4);
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(gx + 4, gy + 5, 2, 2);
  ctx.fillRect(gx + 11, gy + 5, 2, 2);
  // Wavy bottom
  ctx.fillStyle = "#fdcb6e";
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(gx + i * 4, gy + 14, 2, 2);
    ctx.fillRect(gx + i * 4 + 2, gy + 14, 2, 1);
  }
  // Frame
  ctx.strokeStyle = theme.accentColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(winX, winY, winW, winH);
  // INSERT COIN text
  ctx.fillStyle = "#fdcb6e";
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "center";
  if (Math.sin(Date.now() / 300) > 0) {
    ctx.fillText("INSERT COIN", cx, winY + winH - 4);
  }
  ctx.textAlign = "left";
  // Door (black with pink frame)
  const dW = 38, dH = 36;
  const dX = cx - dW / 2, dY = by + H - dH;
  ctx.fillStyle = "#000";
  ctx.fillRect(dX, dY, dW, dH);
  ctx.strokeStyle = "#ff79b0";
  ctx.lineWidth = 2;
  ctx.strokeRect(dX, dY, dW, dH);
  if (glow) {
    ctx.fillStyle = "rgba(255,121,176,0.2)";
    ctx.fillRect(dX, dY, dW, dH);
  }
}

function drawMusicHall(ctx: CanvasRenderingContext2D, cx: number, cy: number, theme: TownhallTheme, _palette: { bg: string; border: string; sign: string }, glow: boolean) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  // Purple walls
  ctx.fillStyle = "#3d2b4e";
  ctx.fillRect(bx, by + 50, W, H - 50);
  // Mansard purple roof
  ctx.fillStyle = "#6c3483";
  ctx.beginPath();
  ctx.moveTo(bx - 8, by + 50);
  ctx.lineTo(bx + 22, by + 8);
  ctx.lineTo(bx + W - 22, by + 8);
  ctx.lineTo(bx + W + 8, by + 50);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#4a2562";
  ctx.fillRect(bx - 8, by + 48, W + 16, 4);
  // Gold trim
  ctx.fillStyle = "#fdcb6e";
  ctx.fillRect(bx + 22, by + 12, W - 44, 3);
  // Marquee with notes
  ctx.fillStyle = "#fdcb6e";
  ctx.fillRect(bx + 16, by + 18, W - 32, 24);
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(bx + 18, by + 20, W - 36, 20);
  // Notes (♪ shapes drawn with rects)
  for (let i = 0; i < 4; i++) {
    const nx = bx + 24 + i * 28;
    const ny = by + 26;
    const blink = ((Math.floor(Date.now() / 400) + i) % 2 === 0);
    ctx.fillStyle = blink ? "#fdcb6e" : "#a87a3a";
    ctx.fillRect(nx, ny, 2, 6);
    ctx.fillRect(nx + 2, ny + 6, 4, 2);
    ctx.fillRect(nx + 2, ny - 1, 6, 2);
  }
  // Arched window above door
  const archCx = cx, archCy = by + 70, archR = 18;
  ctx.fillStyle = glow ? "rgba(255,200,140,0.7)" : "rgba(255,200,140,0.45)";
  ctx.beginPath();
  ctx.arc(archCx, archCy, archR, Math.PI, 0);
  ctx.lineTo(archCx + archR, archCy + 18);
  ctx.lineTo(archCx - archR, archCy + 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#fdcb6e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(archCx, archCy, archR, Math.PI, 0);
  ctx.stroke();
  ctx.strokeRect(archCx - archR, archCy, archR * 2, 18);
  // Side flanking windows
  drawWindow(ctx, bx + 12, by + 64, 18, 24, "rgba(255,200,140,0.4)", "#fdcb6e", glow);
  drawWindow(ctx, bx + W - 30, by + 64, 18, 24, "rgba(255,200,140,0.4)", "#fdcb6e", glow);
  // Double red doors
  const dY = by + H - 38;
  ctx.fillStyle = "#8b1a1a";
  ctx.fillRect(cx - 18, dY, 17, 38);
  ctx.fillRect(cx + 1, dY, 17, 38);
  ctx.strokeStyle = "#fdcb6e";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 18, dY, 17, 38);
  ctx.strokeRect(cx + 1, dY, 17, 38);
  ctx.fillStyle = "#fdcb6e";
  ctx.fillRect(cx - 6, dY + 18, 2, 2);
  ctx.fillRect(cx + 4, dY + 18, 2, 2);
  // Step
  ctx.fillStyle = "#a07a4a";
  ctx.fillRect(cx - 24, by + H, 48, 5);
}

const FACADES: Record<string, FacadeFn> = {
  general:  drawGeneralHub,
  tech:     drawTechLab,
  politics: drawTownHall,
  art:      drawArtGallery,
  nature:   drawNatureLodge,
  science:  drawScienceLab,
  gaming:   drawArcade,
  music:    drawMusicHall,
};

// ── Per-hall exterior props (decorative, drawn in front of building) ──
function drawExteriorProps(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  hall: string, _theme: TownhallTheme, glow: boolean
) {
  // Front-of-building props at y = cy + offsets
  const baseY = cy + 6;
  if (hall === "art") {
    // 2 painting easels at the front
    [-46, 46].forEach((dx) => {
      const px = cx + dx, py = baseY;
      // Tripod
      ctx.fillStyle = "#5a3a1a";
      ctx.fillRect(px - 1, py - 2, 2, 14);
      ctx.fillRect(px - 6, py + 12, 14, 2);
      ctx.beginPath();
      ctx.strokeStyle = "#5a3a1a";
      ctx.lineWidth = 2;
      ctx.moveTo(px, py);
      ctx.lineTo(px - 6, py + 14);
      ctx.moveTo(px, py);
      ctx.lineTo(px + 6, py + 14);
      ctx.stroke();
      // Canvas
      ctx.fillStyle = "#fff";
      ctx.fillRect(px - 8, py - 16, 16, 14);
      ctx.fillStyle = ["#ff6f6f", "#74c8ff", "#ffd166"][(dx + 100) % 3];
      ctx.fillRect(px - 6, py - 14, 12, 4);
      ctx.fillStyle = ["#74c8ff", "#a8e6a3", "#c8a0e8"][(dx + 100) % 3];
      ctx.fillRect(px - 6, py - 9, 12, 5);
      ctx.strokeStyle = "#5a3a1a";
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 8, py - 16, 16, 14);
    });
  } else if (hall === "nature") {
    // Bushes flanking, wood barrel right
    drawBush(ctx, cx - 50, baseY + 8);
    drawBush(ctx, cx + 50, baseY + 8);
    // Barrel
    const bx = cx + 64, by = baseY - 4;
    ctx.fillStyle = "#a07752";
    ctx.fillRect(bx - 6, by, 12, 14);
    ctx.fillStyle = "#7e5b3a";
    ctx.fillRect(bx - 6, by + 4, 12, 1);
    ctx.fillRect(bx - 6, by + 10, 12, 1);
    ctx.fillStyle = "#5a3e22";
    ctx.fillRect(bx - 6, by + 13, 12, 2);
  } else if (hall === "gaming") {
    // 2 small arcade cabinets at corners
    [-58, 58].forEach((dx) => {
      const px = cx + dx, py = baseY - 2;
      ctx.fillStyle = "#000";
      ctx.fillRect(px - 6, py, 12, 18);
      ctx.fillStyle = "#74e0ff";
      ctx.fillRect(px - 5, py + 2, 10, 6);
      ctx.fillStyle = "#fdcb6e";
      ctx.fillRect(px - 5, py + 9, 10, 1);
      ctx.fillStyle = "#ff79b0";
      ctx.fillRect(px - 4, py + 12, 3, 3);
      ctx.fillStyle = "#74e0ff";
      ctx.fillRect(px + 1, py + 12, 3, 3);
    });
  } else if (hall === "politics") {
    // 2 flag poles flanking
    [-72, 72].forEach((dx) => {
      const px = cx + dx, py = baseY - 30;
      ctx.fillStyle = "#888";
      ctx.fillRect(px, py, 2, 36);
      ctx.fillStyle = "#c0392b";
      ctx.fillRect(px + 2, py, 14, 8);
      ctx.fillStyle = "#fff";
      ctx.fillRect(px + 2, py + 8, 14, 4);
      ctx.fillStyle = "#3a5a8a";
      ctx.fillRect(px + 2, py + 12, 14, 4);
    });
  } else if (hall === "tech") {
    // Two silver benches flanking the entrance walkway
    [-58, 58].forEach((dx) => {
      const px = cx + dx, py = baseY + 2;
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(px - 18, py + 8, 36, 3);
      // Bench seat
      ctx.fillStyle = "#c9cfdc";
      ctx.fillRect(px - 18, py, 36, 5);
      ctx.fillStyle = "#9aa0b0";
      ctx.fillRect(px - 18, py + 4, 36, 1);
      // Legs
      ctx.fillStyle = "#5a6273";
      ctx.fillRect(px - 16, py + 5, 3, 6);
      ctx.fillRect(px + 13, py + 5, 3, 6);
    });
    // Trim hedges between benches and flower beds
    [-32, 32].forEach((dx) => {
      const px = cx + dx, py = baseY + 4;
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(px, py + 8, 10, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3d8a26";
      ctx.fillRect(px - 9, py - 2, 18, 10);
      ctx.fillStyle = "#5fd84d";
      ctx.fillRect(px - 9, py - 2, 18, 2);
      ctx.fillStyle = "#7be060";
      ctx.fillRect(px - 7, py - 2, 4, 1);
      ctx.fillRect(px + 1, py - 2, 5, 1);
    });
    // Small holographic fountain in the front center
    const fx = cx, fy = baseY + 18;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(fx, fy + 8, 14, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9aa0b0";
    ctx.beginPath();
    ctx.ellipse(fx, fy + 6, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#dde2ec";
    ctx.beginPath();
    ctx.ellipse(fx, fy + 4, 12, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Cyan plasma orb
    ctx.fillStyle = glow ? "#a3e3ff" : "#74e0ff";
    ctx.beginPath();
    ctx.arc(fx, fy - 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.arc(fx - 2, fy - 4, 2, 0, Math.PI * 2);
    ctx.fill();
    // Sparks around orb
    const t = Date.now() / 220;
    for (let i = 0; i < 3; i++) {
      const ang = t + i * 2.094;
      const sx = fx + Math.cos(ang) * 8;
      const sy = fy - 2 + Math.sin(ang) * 4;
      ctx.fillStyle = "#cdf2ff";
      ctx.fillRect(sx, sy, 1, 1);
    }
  } else if (hall === "science") {
    // Telescope on the lawn
    const px = cx - 60, py = baseY + 4;
    // Tripod
    ctx.strokeStyle = "#3a3a48";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - 6, py + 12);
    ctx.lineTo(px, py);
    ctx.moveTo(px + 6, py + 12);
    ctx.lineTo(px, py);
    ctx.stroke();
    // Tube
    ctx.save();
    ctx.translate(px, py - 4);
    ctx.rotate(-0.45);
    ctx.fillStyle = "#3a3a48";
    ctx.fillRect(-3, -10, 6, 20);
    ctx.fillStyle = "#74b9ff";
    ctx.fillRect(-2, -10, 4, 2);
    ctx.restore();
  } else if (hall === "music") {
    // Speaker stacks
    [-58, 58].forEach((dx) => {
      const px = cx + dx, py = baseY;
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(px - 7, py - 6, 14, 22);
      // Speaker cones
      ctx.fillStyle = "#444";
      ctx.beginPath();
      ctx.arc(px, py - 1, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py + 9, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#888";
      ctx.fillRect(px - 1, py - 2, 2, 2);
      ctx.fillRect(px - 1, py + 8, 2, 2);
      // Pulse glow
      if (glow || Math.sin(Date.now() / 300 + dx) > 0.6) {
        ctx.fillStyle = "rgba(253,203,110,0.25)";
        ctx.beginPath();
        ctx.arc(px, py + 4, 12, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  } else {
    // general — wooden notice board
    const px = cx + 56, py = baseY;
    ctx.fillStyle = "#7a5230";
    ctx.fillRect(px - 1, py + 4, 2, 12);
    ctx.fillRect(px + 11, py + 4, 2, 12);
    ctx.fillStyle = "#c8a07a";
    ctx.fillRect(px - 4, py - 6, 18, 14);
    ctx.fillStyle = "#7a5230";
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#7a5230";
    ctx.strokeRect(px - 4, py - 6, 18, 14);
    // Pinned papers
    ctx.fillStyle = "#fff";
    ctx.fillRect(px - 2, py - 4, 6, 4);
    ctx.fillRect(px + 6, py - 4, 6, 5);
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(px + 1, py - 5, 1, 1);
    ctx.fillRect(px + 9, py - 5, 1, 1);
  }
}

// ── Townhall dispatcher ──
function drawTownhall(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  label: string, theme: TownhallTheme, palette: { bg: string; border: string; sign: string },
  glow: boolean,
  /** North row: path & stub south of façade. South row: path north — hint/banner tuck toward approach. */
  southOfStreet: boolean,
) {
  const W = HALL_W, H = HALL_H;
  const bx = cx - W / 2, by = cy - H + 14;
  const hall = (theme.facade ?? "general");

  const buildingSprite = BUILDING_SPRITES[hall as keyof typeof BUILDING_SPRITES];
  const drawGlowBox = () => {
    if (!glow) return;
    ctx.save();
    ctx.fillStyle = "rgba(255,215,0,0.045)";
    ctx.fillRect(bx - 6, by - 20, W + 12, H + 28);
    ctx.restore();
  };

  if (buildingSprite && drawSprite(ctx, buildingSprite, cx, cy + 14)) {
    drawExteriorProps(ctx, cx, cy, hall, theme, glow);
    drawGlowBox();
    drawSignBanner(ctx, cx, by - 26, label, palette.sign);
    drawEnterHint(ctx, cx, southOfStreet ? cy - 46 : by + H + 14);
    return;
  }

  // ── Procedural fallback: cube shell + per-hall facade renderer. ──────────
  drawShadowEllipse(ctx, cx + HALL_DEPTH / 2, cy + 8, W * 0.6, 9);

  const shells: Record<string, { side: string; sideShade: string; roof: string; roofTile: string; roofHi: string }> = {
    general:  { side: "#caaf80", sideShade: "#9a8050", roof: "#d62828", roofTile: "#8a1414", roofHi: "#ff6a4a" },
    tech:     { side: "#9aa0b0", sideShade: "#6e7488", roof: "#5a6273", roofTile: "#3a4254", roofHi: "#cdd2dc" },
    politics: { side: "#8a7e64", sideShade: "#5a5040", roof: "#c9a227", roofTile: "#7a5e10", roofHi: "#e8d89c" },
    art:      { side: "#cdc4d2", sideShade: "#9a8aa8", roof: "#c52f7d", roofTile: "#8c1f5a", roofHi: "#f08abe" },
    nature:   { side: "#724820", sideShade: "#4a2e10", roof: "#2d6a4f", roofTile: "#1e4f3a", roofHi: "#5fd84d" },
    science:  { side: "#a8b0c0", sideShade: "#7a8090", roof: "#3a4254", roofTile: "#1f2640", roofHi: "#74b9ff" },
    gaming:   { side: "#000000", sideShade: "#000000", roof: "#e84393", roofTile: "#8a1f5a", roofHi: "#fdcb6e" },
    music:    { side: "#2d1b32", sideShade: "#1a0e1f", roof: "#6c3483", roofTile: "#4a2562", roofHi: "#fdcb6e" },
  };
  const shell = shells[hall] ?? shells.general;
  const frontX = bx, frontY = by + 6, frontW = W, frontH = H - 6;
  drawCubeShell(ctx, frontX, frontY, frontW, frontH,
    shell.side, shell.sideShade, shell.roof, shell.roofTile, shell.roofHi);

  const fn = FACADES[hall] ?? drawGeneralHub;
  fn(ctx, cx, cy, theme, palette, glow);
  drawExteriorProps(ctx, cx, cy, hall, theme, glow);
  drawGlowBox();

  drawSignBanner(ctx, cx, by - 26, label, palette.sign);
  drawEnterHint(ctx, cx, southOfStreet ? cy - 46 : by + H + 14);
}

// ─── Interior room drawing ────────────────────────────────────────────────────
// Shared room frame: walls, banner with topic label, exit door (no furniture/floor).
function drawRoomFrame(
  ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string,
  palette: { bg: string; border: string; sign: string }
) {
  const W = ROOM_W, H = ROOM_H;

  // Walls (top, left, right)
  ctx.fillStyle = theme.wallColor;
  ctx.fillRect(0, 0, W, WALL_THICKNESS + 30);
  ctx.fillRect(0, 0, WALL_THICKNESS, H);
  ctx.fillRect(W - WALL_THICKNESS, 0, WALL_THICKNESS, H);

  // Wall trim
  ctx.fillStyle = theme.accentColor;
  ctx.fillRect(0, WALL_THICKNESS + 28, W, 3);
  ctx.fillRect(WALL_THICKNESS - 3, WALL_THICKNESS + 30, 3, H - WALL_THICKNESS - 30);
  ctx.fillRect(W - WALL_THICKNESS, WALL_THICKNESS + 30, 3, H - WALL_THICKNESS - 30);

  // Banner with topic label at top center
  ctx.font = "bold 14px monospace";
  const tw = ctx.measureText(label).width;
  const bannerW = Math.max(180, tw + 36);
  ctx.fillStyle = palette.sign;
  ctx.fillRect(W / 2 - bannerW / 2, 8, bannerW, 22);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(W / 2 - bannerW / 2, 8, bannerW, 22);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(label, W / 2, 25);
  ctx.textAlign = "left";

  // Exit door at bottom center
  const doorX = W / 2 - DOOR_W / 2, doorY = H - DOOR_H;
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(doorX, doorY, DOOR_W, DOOR_H);
  ctx.strokeStyle = theme.accentColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(doorX, doorY, DOOR_W, DOOR_H);
  // Door mat
  ctx.fillStyle = "rgba(180,120,60,0.4)";
  ctx.fillRect(doorX - 10, doorY - 6, DOOR_W + 20, 8);

  // EXIT label
  ctx.save();
  ctx.globalAlpha = 0.6 + 0.2 * Math.sin(Date.now() / 400);
  ctx.font = "bold 8px monospace";
  ctx.fillStyle = "#ffd700";
  ctx.textAlign = "center";
  ctx.fillText("EXIT", W / 2, doorY - 10);
  ctx.textAlign = "left";
  ctx.restore();
}

// Floor utilities used by interior renderers
function fillCheckerFloor(ctx: CanvasRenderingContext2D, a: string, b: string) {
  const W = ROOM_W, H = ROOM_H, tileS = 32;
  for (let ty = 0; ty < Math.ceil(H / tileS); ty++) {
    for (let tx = 0; tx < Math.ceil(W / tileS); tx++) {
      ctx.fillStyle = (tx + ty) % 2 === 0 ? a : b;
      ctx.fillRect(tx * tileS, ty * tileS, tileS, tileS);
    }
  }
}

function fillPlankFloor(ctx: CanvasRenderingContext2D, base: string, dark: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, ROOM_W, ROOM_H);
  ctx.fillStyle = dark;
  for (let py = 24; py < ROOM_H; py += 24) {
    ctx.fillRect(0, py, ROOM_W, 1);
  }
  for (let py = 0; py < ROOM_H; py += 24) {
    const offset = ((py / 24) % 2) * 60;
    for (let px = 40 + offset; px < ROOM_W; px += 120) {
      ctx.fillRect(px, py + 1, 1, 22);
    }
  }
}

function fillStripeFloor(ctx: CanvasRenderingContext2D, a: string, b: string) {
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, ROOM_W, ROOM_H);
  ctx.fillStyle = b;
  for (let py = 0; py < ROOM_H; py += 28) {
    ctx.fillRect(0, py, ROOM_W, 14);
  }
}

// ── Per-hall interior renderers ──
type InteriorFn = (
  ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string,
  palette: { bg: string; border: string; sign: string }
) => void;

// general — bulletin board, sofa, plant
function drawGeneralInterior(ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string, palette: { bg: string; border: string; sign: string }) {
  fillPlankFloor(ctx, "#a37b48", "#7e5a30");
  drawRoomFrame(ctx, theme, label, palette);
  // Back wall: wooden bulletin board
  const bbX = WALL_THICKNESS + 80, bbY = WALL_THICKNESS + 50, bbW = 220, bbH = 60;
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(bbX, bbY, bbW, bbH);
  ctx.fillStyle = "#c8a07a";
  ctx.fillRect(bbX + 4, bbY + 4, bbW - 8, bbH - 8);
  // Sticky notes
  const noteColors = ["#fdf196", "#a4f4b6", "#fbb6c8", "#cfe1ff"];
  for (let i = 0; i < 6; i++) {
    const nx = bbX + 12 + (i % 3) * 70;
    const ny = bbY + 8 + Math.floor(i / 3) * 26;
    ctx.fillStyle = noteColors[i % noteColors.length];
    ctx.fillRect(nx, ny, 50, 18);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(nx + 8, ny + 6, 30, 1);
    ctx.fillRect(nx + 8, ny + 10, 24, 1);
  }
  // Sofa right side
  const sx = ROOM_W - WALL_THICKNESS - 200, sy = ROOM_H - 200;
  ctx.fillStyle = "#3a5a8a";
  ctx.fillRect(sx, sy + 20, 160, 36);
  ctx.fillRect(sx, sy, 160, 30);
  ctx.fillStyle = "#5a7aaa";
  ctx.fillRect(sx + 4, sy + 24, 50, 28);
  ctx.fillRect(sx + 60, sy + 24, 50, 28);
  ctx.fillRect(sx + 116, sy + 24, 40, 28);
  // Sofa legs
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(sx + 6, sy + 56, 6, 6);
  ctx.fillRect(sx + 148, sy + 56, 6, 6);
  // Plant left
  const px = WALL_THICKNESS + 60, py = ROOM_H - 160;
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(px - 14, py + 24, 28, 18);
  ctx.fillStyle = "#3fb036";
  ctx.beginPath();
  ctx.arc(px, py, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5fd84d";
  ctx.beginPath();
  ctx.arc(px - 6, py - 6, 8, 0, Math.PI * 2);
  ctx.arc(px + 8, py + 4, 6, 0, Math.PI * 2);
  ctx.fill();
}

// art — paintings on walls, gallery floor
function drawGalleryInterior(ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string, palette: { bg: string; border: string; sign: string }) {
  fillCheckerFloor(ctx, "#e6e0e9", "#cdc4d2");
  drawRoomFrame(ctx, theme, label, palette);
  // 5 paintings on the back wall
  const wallY = WALL_THICKNESS + 38;
  const paintColors = ["#ff6f6f", "#ffd166", "#74c8ff", "#a8e6a3", "#c8a0e8"];
  const startX = 120;
  for (let i = 0; i < 5; i++) {
    const px = startX + i * 220;
    if (px > ROOM_W - 220) break;
    // Frame
    ctx.fillStyle = "#5a3a1a";
    ctx.fillRect(px, wallY, 160, 100);
    ctx.fillStyle = "#3a2410";
    ctx.fillRect(px, wallY, 160, 4);
    ctx.fillRect(px, wallY + 96, 160, 4);
    // Canvas
    ctx.fillStyle = paintColors[i % paintColors.length];
    ctx.fillRect(px + 8, wallY + 8, 144, 84);
    // Splotches
    ctx.fillStyle = paintColors[(i + 2) % paintColors.length];
    ctx.fillRect(px + 16, wallY + 20, 30, 24);
    ctx.fillStyle = paintColors[(i + 3) % paintColors.length];
    ctx.fillRect(px + 60, wallY + 40, 28, 28);
    ctx.fillStyle = paintColors[(i + 1) % paintColors.length];
    ctx.fillRect(px + 100, wallY + 16, 24, 32);
    // Plaque
    ctx.fillStyle = "#fff";
    ctx.fillRect(px + 56, wallY + 108, 48, 8);
    ctx.fillStyle = "#666";
    ctx.fillRect(px + 60, wallY + 110, 40, 1);
    ctx.fillRect(px + 60, wallY + 113, 30, 1);
  }
  // Display pedestal in middle (small sculpture)
  const pcx = ROOM_W / 2, pcy = ROOM_H - 180;
  ctx.fillStyle = "#aaa";
  ctx.fillRect(pcx - 18, pcy + 10, 36, 50);
  ctx.fillStyle = "#888";
  ctx.fillRect(pcx - 20, pcy + 8, 40, 6);
  // Sphere
  ctx.fillStyle = theme.accentColor;
  ctx.beginPath();
  ctx.arc(pcx, pcy + 4, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.arc(pcx - 4, pcy, 4, 0, Math.PI * 2);
  ctx.fill();
}

// nature — log walls, fireplace, plants
function drawLodgeInterior(ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string, palette: { bg: string; border: string; sign: string }) {
  fillPlankFloor(ctx, "#7a5230", "#5a3e22");
  drawRoomFrame(ctx, theme, label, palette);
  // Re-skin walls: log pattern (drawn over the existing wall fill)
  drawWoodPlanks(ctx, 0, 0, ROOM_W, WALL_THICKNESS + 30);
  drawWoodPlanks(ctx, 0, 0, WALL_THICKNESS, ROOM_H);
  drawWoodPlanks(ctx, ROOM_W - WALL_THICKNESS, 0, WALL_THICKNESS, ROOM_H);
  // Fireplace at the back
  const fX = ROOM_W / 2 - 60, fY = WALL_THICKNESS + 38;
  ctx.fillStyle = "#7a7064";
  ctx.fillRect(fX, fY, 120, 86);
  ctx.fillStyle = "#5a5048";
  for (let py = fY + 4; py < fY + 86; py += 8) {
    const offset = (((py - fY) / 8) % 2) * 16;
    for (let px = fX + 4 + offset; px < fX + 120; px += 32) {
      ctx.fillRect(px, py, 1, 6);
    }
    ctx.fillRect(fX, py, 120, 1);
  }
  // Fire opening
  ctx.fillStyle = "#1a0a00";
  ctx.fillRect(fX + 26, fY + 28, 68, 50);
  // Animated flames
  const t = Date.now() / 300;
  for (let i = 0; i < 4; i++) {
    const flameH = 22 + Math.sin(t + i * 1.7) * 4;
    ctx.fillStyle = "#ff8a3a";
    ctx.beginPath();
    ctx.moveTo(fX + 36 + i * 14, fY + 78);
    ctx.lineTo(fX + 40 + i * 14, fY + 78 - flameH);
    ctx.lineTo(fX + 44 + i * 14, fY + 78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fdcb6e";
    ctx.beginPath();
    ctx.moveTo(fX + 38 + i * 14, fY + 78);
    ctx.lineTo(fX + 40 + i * 14, fY + 78 - flameH * 0.6);
    ctx.lineTo(fX + 42 + i * 14, fY + 78);
    ctx.closePath();
    ctx.fill();
  }
  // Logs
  ctx.fillStyle = "#724820";
  ctx.fillRect(fX + 30, fY + 76, 60, 4);
  ctx.fillStyle = "#a07752";
  ctx.fillRect(fX + 32, fY + 74, 14, 4);
  ctx.fillRect(fX + 50, fY + 74, 14, 4);
  // Plants in corners
  [[WALL_THICKNESS + 50, ROOM_H - 140], [ROOM_W - WALL_THICKNESS - 50, ROOM_H - 140]].forEach(([px, py]) => {
    ctx.fillStyle = "#7a5230";
    ctx.fillRect(px - 16, py + 24, 32, 22);
    ctx.fillStyle = "#3fb036";
    ctx.beginPath();
    ctx.arc(px, py, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5fd84d";
    ctx.beginPath();
    ctx.arc(px - 10, py - 10, 10, 0, Math.PI * 2);
    ctx.arc(px + 12, py + 6, 8, 0, Math.PI * 2);
    ctx.fill();
  });
}

// politics — marble floor, banners, clock
function drawTownHallInterior(ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string, palette: { bg: string; border: string; sign: string }) {
  fillCheckerFloor(ctx, "#d8d2c0", "#beb6a0");
  drawRoomFrame(ctx, theme, label, palette);
  // Red carpet down the middle
  ctx.fillStyle = "#8b1a1a";
  ctx.fillRect(ROOM_W / 2 - 80, WALL_THICKNESS + 40, 160, ROOM_H - WALL_THICKNESS - 100);
  ctx.fillStyle = "#a82828";
  ctx.fillRect(ROOM_W / 2 - 76, WALL_THICKNESS + 40, 152, 4);
  ctx.fillRect(ROOM_W / 2 - 76, ROOM_H - 70, 152, 4);
  // Hanging banners on the back wall
  for (let i = 0; i < 3; i++) {
    const bx = 200 + i * 320;
    if (bx > ROOM_W - 200) break;
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(bx, WALL_THICKNESS + 40, 60, 110);
    ctx.fillStyle = "#a8281a";
    ctx.fillRect(bx, WALL_THICKNESS + 40, 60, 6);
    // Triangular bottom
    ctx.beginPath();
    ctx.moveTo(bx, WALL_THICKNESS + 150);
    ctx.lineTo(bx + 30, WALL_THICKNESS + 170);
    ctx.lineTo(bx + 60, WALL_THICKNESS + 150);
    ctx.closePath();
    ctx.fillStyle = "#c0392b";
    ctx.fill();
    // Gold star
    ctx.fillStyle = "#fdcb6e";
    ctx.fillRect(bx + 28, WALL_THICKNESS + 80, 4, 14);
    ctx.fillRect(bx + 22, WALL_THICKNESS + 84, 16, 4);
    ctx.fillRect(bx + 24, WALL_THICKNESS + 92, 4, 6);
    ctx.fillRect(bx + 32, WALL_THICKNESS + 92, 4, 6);
  }
  // Big clock on back wall (between banners area)
  const clkCx = ROOM_W / 2, clkCy = WALL_THICKNESS + 110;
  ctx.fillStyle = "#1a1a2e";
  ctx.beginPath();
  ctx.arc(clkCx, clkCy, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fdcb6e";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    ctx.fillRect(clkCx + Math.cos(a) * 24 - 1, clkCy + Math.sin(a) * 24 - 1, 2, 2);
  }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(clkCx, clkCy);
  ctx.lineTo(clkCx + 10, clkCy - 6);
  ctx.moveTo(clkCx, clkCy);
  ctx.lineTo(clkCx, clkCy - 18);
  ctx.stroke();
}

// music — stage at the back, mic stand, instruments
function drawMusicHallInterior(ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string, palette: { bg: string; border: string; sign: string }) {
  fillStripeFloor(ctx, "#3a2540", "#2d1b32");
  drawRoomFrame(ctx, theme, label, palette);
  // Stage platform
  const stY = WALL_THICKNESS + 38, stH = 50;
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(WALL_THICKNESS + 40, stY, ROOM_W - (WALL_THICKNESS + 40) * 2, stH);
  ctx.fillStyle = "#a07752";
  ctx.fillRect(WALL_THICKNESS + 40, stY, ROOM_W - (WALL_THICKNESS + 40) * 2, 4);
  // Curtains
  ctx.fillStyle = "#8b1a1a";
  ctx.fillRect(WALL_THICKNESS + 4, WALL_THICKNESS + 36, 80, 80);
  ctx.fillRect(ROOM_W - WALL_THICKNESS - 84, WALL_THICKNESS + 36, 80, 80);
  ctx.fillStyle = "#a82828";
  for (let py = WALL_THICKNESS + 36; py < WALL_THICKNESS + 116; py += 6) {
    ctx.fillRect(WALL_THICKNESS + 8 + (py % 12), py, 4, 4);
    ctx.fillRect(ROOM_W - WALL_THICKNESS - 78 + (py % 12), py, 4, 4);
  }
  // Mic stand
  const micCx = ROOM_W / 2;
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(micCx - 1, stY - 36, 2, 36);
  ctx.fillStyle = "#fdcb6e";
  ctx.beginPath();
  ctx.arc(micCx, stY - 38, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(micCx - 8, stY - 1, 16, 4);
  // Guitar leaning right
  const gx = micCx + 80, gy = stY - 32;
  ctx.fillStyle = "#a07752";
  ctx.beginPath();
  ctx.ellipse(gx, gy + 18, 10, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(gx, gy + 14, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7e5b3a";
  ctx.fillRect(gx - 1, gy - 14, 2, 18);
  // Music notes flying
  const t = Date.now() / 300;
  for (let i = 0; i < 4; i++) {
    const nx = WALL_THICKNESS + 80 + i * 140 + Math.sin(t + i) * 6;
    const ny = WALL_THICKNESS + 200 + Math.cos(t + i * 0.7) * 10;
    ctx.fillStyle = theme.accentColor;
    ctx.fillRect(nx, ny, 2, 8);
    ctx.fillRect(nx + 2, ny + 8, 4, 2);
    ctx.fillRect(nx + 2, ny - 1, 6, 2);
  }
  // Drum on stage left
  const dx = WALL_THICKNESS + 120, dy = stY - 6;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(dx, dy - 14, 18, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(dx - 18, dy - 14, 36, 22);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(dx - 18, dy - 4, 36, 2);
}

// gaming — arcade cabinets, neon strips
function drawArcadeInterior(ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string, palette: { bg: string; border: string; sign: string }) {
  // Dark grid floor with neon stripes
  ctx.fillStyle = "#0d0d18";
  ctx.fillRect(0, 0, ROOM_W, ROOM_H);
  ctx.fillStyle = "#1a0a2e";
  for (let py = 0; py < ROOM_H; py += 32) {
    ctx.fillRect(0, py, ROOM_W, 1);
  }
  for (let px = 0; px < ROOM_W; px += 32) {
    ctx.fillRect(px, 0, 1, ROOM_H);
  }
  // Neon stripe horizontal
  ctx.fillStyle = "rgba(232,67,147,0.4)";
  ctx.fillRect(0, ROOM_H / 2 - 1, ROOM_W, 2);
  ctx.fillStyle = "rgba(116,224,255,0.3)";
  ctx.fillRect(0, ROOM_H / 2 + 30, ROOM_W, 1);
  drawRoomFrame(ctx, theme, label, palette);
  // Row of arcade cabinets along the back wall
  const cabY = WALL_THICKNESS + 40;
  for (let i = 0; i < 6; i++) {
    const cabX = 100 + i * 180;
    if (cabX > ROOM_W - 180) break;
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(cabX, cabY, 80, 110);
    // Screen
    ctx.fillStyle = "#000";
    ctx.fillRect(cabX + 8, cabY + 14, 64, 40);
    // Pixel content (random pattern)
    const colors = ["#74e0ff", "#fdcb6e", "#ff79b0", "#a8e6a3"];
    for (let p = 0; p < 12; p++) {
      ctx.fillStyle = colors[(i + p) % colors.length];
      const xx = cabX + 12 + (p % 4) * 14;
      const yy = cabY + 18 + Math.floor(p / 4) * 10;
      ctx.fillRect(xx, yy, 6, 6);
    }
    // Marquee
    ctx.fillStyle = "#e84393";
    ctx.fillRect(cabX + 6, cabY + 4, 68, 8);
    ctx.fillStyle = "#fdcb6e";
    if ((Math.floor(Date.now() / 250 + i) % 2) === 0) {
      ctx.fillRect(cabX + 8, cabY + 6, 64, 4);
    }
    // Joystick + buttons
    ctx.fillStyle = "#000";
    ctx.fillRect(cabX + 8, cabY + 60, 64, 30);
    ctx.fillStyle = "#ff5252";
    ctx.beginPath();
    ctx.arc(cabX + 24, cabY + 75, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fdcb6e";
    ctx.fillRect(cabX + 36, cabY + 73, 4, 4);
    ctx.fillStyle = "#74e0ff";
    ctx.fillRect(cabX + 46, cabY + 73, 4, 4);
    ctx.fillStyle = "#a8e6a3";
    ctx.fillRect(cabX + 56, cabY + 73, 4, 4);
    // Base
    ctx.fillStyle = "#0a0a18";
    ctx.fillRect(cabX, cabY + 96, 80, 14);
  }
  // Pinball machine on the right side
  const pX = ROOM_W - 220, pY = ROOM_H - 220;
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(pX, pY, 100, 80);
  ctx.fillStyle = "#74e0ff";
  ctx.fillRect(pX + 4, pY + 4, 92, 30);
  ctx.fillStyle = "#fdcb6e";
  ctx.fillRect(pX + 8, pY + 8, 4, 4);
  ctx.fillRect(pX + 18, pY + 12, 4, 4);
  ctx.fillRect(pX + 30, pY + 8, 4, 4);
  // DJ booth on left
  const djX = WALL_THICKNESS + 80, djY = ROOM_H - 200;
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(djX, djY, 120, 60);
  ctx.fillStyle = "#444";
  ctx.beginPath();
  ctx.arc(djX + 30, djY + 30, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(djX + 90, djY + 30, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e84393";
  ctx.fillRect(djX + 28, djY + 28, 4, 4);
  ctx.fillRect(djX + 88, djY + 28, 4, 4);
}

// tech — server racks, monitors
function drawTechInterior(ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string, palette: { bg: string; border: string; sign: string }) {
  fillCheckerFloor(ctx, "#1f253a", "#262d44");
  drawRoomFrame(ctx, theme, label, palette);
  // Server racks along the back
  for (let i = 0; i < 5; i++) {
    const rx = 120 + i * 220;
    if (rx > ROOM_W - 200) break;
    const ry = WALL_THICKNESS + 40;
    ctx.fillStyle = "#0e1226";
    ctx.fillRect(rx, ry, 100, 130);
    ctx.fillStyle = "#1a1f3a";
    ctx.fillRect(rx + 4, ry + 4, 92, 122);
    // Rack slots
    for (let s = 0; s < 6; s++) {
      const sy = ry + 10 + s * 18;
      ctx.fillStyle = "#000";
      ctx.fillRect(rx + 10, sy, 80, 12);
      // LEDs
      const ledOn = (Math.floor(Date.now() / 220 + i + s) % 3) === 0;
      ctx.fillStyle = ledOn ? "#74e0ff" : "#1a3a5a";
      ctx.fillRect(rx + 14, sy + 4, 4, 4);
      ctx.fillStyle = ledOn ? "#a8e6a3" : "#1a4a3a";
      ctx.fillRect(rx + 22, sy + 4, 4, 4);
      ctx.fillStyle = ledOn ? "#fdcb6e" : "#3a3a1a";
      ctx.fillRect(rx + 30, sy + 4, 4, 4);
      // Detail lines
      ctx.fillStyle = "#3a4a6a";
      ctx.fillRect(rx + 40, sy + 4, 40, 1);
      ctx.fillRect(rx + 40, sy + 8, 30, 1);
    }
  }
  // Big monitor wall on left
  const mX = WALL_THICKNESS + 30, mY = ROOM_H - 280;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const sx = mX + c * 90, sy = mY + r * 60;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(sx, sy, 80, 50);
      ctx.fillStyle = "#003a4a";
      ctx.fillRect(sx + 4, sy + 4, 72, 42);
      // Scrolling lines
      ctx.fillStyle = theme.accentColor;
      const t = Math.floor(Date.now() / 200) + r * 3 + c;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.6 - i * 0.18;
        ctx.fillRect(sx + 8, sy + 8 + ((t + i * 5) % 30), 64, 1);
      }
      ctx.globalAlpha = 1;
    }
  }
  // Holo table center
  const ht = Date.now() / 500;
  const htX = ROOM_W / 2, htY = ROOM_H - 180;
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(htX - 40, htY + 20, 80, 24);
  ctx.fillStyle = theme.accentColor;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.arc(htX, htY, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#fff";
  ctx.fillRect(htX - 1, htY - 1 + Math.sin(ht) * 6, 2, 2);
  ctx.fillRect(htX + 8 + Math.cos(ht) * 4, htY + 4, 2, 2);
  ctx.fillRect(htX - 8 + Math.cos(ht * 1.3) * 4, htY + 6, 2, 2);
  ctx.globalAlpha = 1;
}

// science — workbenches, beakers, blackboard
function drawScienceInterior(ctx: CanvasRenderingContext2D, theme: TownhallTheme, label: string, palette: { bg: string; border: string; sign: string }) {
  fillCheckerFloor(ctx, "#dde4ec", "#c4cdd6");
  drawRoomFrame(ctx, theme, label, palette);
  // Big blackboard back wall
  const bbX = ROOM_W / 2 - 200, bbY = WALL_THICKNESS + 40, bbW = 400, bbH = 100;
  ctx.fillStyle = "#1a3a2a";
  ctx.fillRect(bbX, bbY, bbW, bbH);
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(bbX - 6, bbY - 4, bbW + 12, 4);
  ctx.fillRect(bbX - 6, bbY + bbH, bbW + 12, 4);
  // Equations
  ctx.fillStyle = "#fff";
  ctx.font = "12px monospace";
  ctx.fillText("E = mc²", bbX + 20, bbY + 24);
  ctx.fillText("F = ma", bbX + 20, bbY + 44);
  ctx.fillText("Σ ψ = ∫ φ dx", bbX + 100, bbY + 24);
  ctx.fillText("π · r²", bbX + 220, bbY + 24);
  // Sketches
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bbX + 320, bbY + 60, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bbX + 320, bbY + 60, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#74b9ff";
  ctx.beginPath();
  ctx.arc(bbX + 320, bbY + 60, 4, 0, Math.PI * 2);
  ctx.fill();
  // Workbench rows
  for (let r = 0; r < 2; r++) {
    const wbY = ROOM_H - 240 + r * 100;
    ctx.fillStyle = "#7a8a98";
    ctx.fillRect(WALL_THICKNESS + 60, wbY, ROOM_W - (WALL_THICKNESS + 60) * 2, 14);
    ctx.fillStyle = "#5a6a78";
    ctx.fillRect(WALL_THICKNESS + 60, wbY + 14, 8, 30);
    ctx.fillRect(ROOM_W - WALL_THICKNESS - 68, wbY + 14, 8, 30);
    // Beakers and flasks on top
    for (let i = 0; i < 5; i++) {
      const ex = WALL_THICKNESS + 100 + i * 150;
      // Beaker
      ctx.fillStyle = "#888";
      ctx.fillRect(ex - 8, wbY - 18, 16, 18);
      const liquidColors = ["#74b9ff", "#fdcb6e", "#fd79a8", "#a8e6a3", "#c8a0e8"];
      ctx.fillStyle = liquidColors[(i + r) % liquidColors.length];
      ctx.fillRect(ex - 6, wbY - 12, 12, 10);
      // Bubbles
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      const t = Math.sin(Date.now() / 400 + i) > 0;
      if (t) ctx.fillRect(ex - 2, wbY - 8, 2, 2);
    }
  }
  // Atom model
  const aX = ROOM_W - 160, aY = ROOM_H - 280;
  ctx.strokeStyle = theme.accentColor;
  ctx.lineWidth = 1;
  for (let r = 0; r < 3; r++) {
    ctx.beginPath();
    ctx.ellipse(aX, aY, 30, 10, r * Math.PI / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#fdcb6e";
  ctx.beginPath();
  ctx.arc(aX, aY, 5, 0, Math.PI * 2);
  ctx.fill();
}

const INTERIORS: Record<string, InteriorFn> = {
  general:  drawGeneralInterior,
  art:      drawGalleryInterior,
  nature:   drawLodgeInterior,
  politics: drawTownHallInterior,
  music:    drawMusicHallInterior,
  gaming:   drawArcadeInterior,
  tech:     drawTechInterior,
  science:  drawScienceInterior,
};

/** Opaque-region placement after stretching an interior PNG onto `w`×`h`; used for centered draw & walk rects. */
type BackdropOpaqueLayout = {
  destX: number;
  destY: number;
  destW: number;
  destH: number;
  draw(ctx: CanvasRenderingContext2D): void;
};

function analyzeBackdropLayout(img: HTMLImageElement, w: number, h: number): BackdropOpaqueLayout {
  const iw = Math.max(1, img.naturalWidth || img.width || 1);
  const ih = Math.max(1, img.naturalHeight || img.height || 1);
  const scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  const sctx = scratch.getContext("2d");

  const fullStretch = (): BackdropOpaqueLayout => ({
    destX: 0,
    destY: 0,
    destW: w,
    destH: h,
    draw(destCtx: CanvasRenderingContext2D): void {
      destCtx.drawImage(img, 0, 0, w, h);
    },
  });

  if (!sctx) return fullStretch();

  sctx.drawImage(img, 0, 0, w, h);
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  try {
    const { data, width, height } = sctx.getImageData(0, 0, w, h);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * 4 + 3];
        if (a > 8) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
  } catch {
    return fullStretch();
  }

  if (maxX < minX || maxY < minY) return fullStretch();

  const sw = maxX - minX + 1;
  const sh = maxY - minY + 1;
  const destX = Math.round((w - sw) / 2);
  const destY = Math.round((h - sh) / 2);
  const sxNat = (minX / w) * iw;
  const syNat = (minY / h) * ih;
  const swNat = (sw / w) * iw;
  const shNat = (sh / h) * ih;

  return {
    destX,
    destY,
    destW: sw,
    destH: sh,
    draw(destCtx: CanvasRenderingContext2D): void {
      destCtx.drawImage(img, sxNat, syNat, swNat, shNat, destX, destY, sw, sh);
    },
  };
}

function drawBackdropCentered(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
) {
  // Many generated backdrop PNGs include transparent side/bottom margins.
  analyzeBackdropLayout(img, w, h).draw(ctx);
}

function loadInteriorBackdropLayout(
  facade: string,
  rw: number,
  rh: number,
): BackdropOpaqueLayout | null {
  if (!(facade in INTERIOR_BACKDROPS)) return null;
  const tile = getTile(INTERIOR_BACKDROPS[facade as keyof typeof INTERIOR_BACKDROPS]);
  return tile?.img ? analyzeBackdropLayout(tile.img, rw, rh) : null;
}

/** Insets inside the opaque *placed* backdrop (margins cropped by `analyzeBackdropLayout`). */
const INTERIOR_FLOOR_FRAC_BACKDROP: Record<string, { left: number; right: number; top: number; bottom: number }> = {
  tech: { left: 0.11, right: 0.11, top: 0.37, bottom: 0.15 },
  general: { left: 0.088, right: 0.088, top: 0.345, bottom: 0.14 },
  politics: { left: 0.088, right: 0.088, top: 0.34, bottom: 0.13 },
  // Art room: walkable slab sits higher and stops short of the doorway so signs/NPCs are not glued to EXIT.
  art: { left: 0.1, right: 0.1, top: 0.46, bottom: 0.22 },
  // Music stage room should keep crowds in front of the stage, not on wall panels.
  music: { left: 0.1, right: 0.1, top: 0.53, bottom: 0.13 },
  // Gaming arcade backdrop — walkable floor in front of cabinets; tune after art pass.
  gaming: { left: 0.1, right: 0.1, top: 0.5, bottom: 0.13 },
  // Nature lodge — wide room; tune floor band after in-game check.
  nature: { left: 0.1, right: 0.1, top: 0.48, bottom: 0.14 },
};

/** Fallback when there is no backdrop PNG — procedural interior fills full `rw×rh`. */
const INTERIOR_FLOOR_FRAC_PROCEDURAL: Record<string, { left: number; right: number; top: number; bottom: number }> = {
  tech: { left: 0.05, right: 0.05, top: 0.22, bottom: 0.17 },
};
const INTERIOR_PROCEDURAL_DEFAULT_FRAC = { left: 0.048, right: 0.048, top: 0.2, bottom: 0.155 };

function interiorFracBackdrop(facade: string): { left: number; right: number; top: number; bottom: number } {
  return INTERIOR_FLOOR_FRAC_BACKDROP[facade] ?? { left: 0.088, right: 0.088, top: 0.345, bottom: 0.14 };
}

function interiorFracProcedural(facade: string): { left: number; right: number; top: number; bottom: number } {
  return INTERIOR_FLOOR_FRAC_PROCEDURAL[facade] ?? INTERIOR_PROCEDURAL_DEFAULT_FRAC;
}

function interiorFloorRect(
  rw: number,
  rh: number,
  opaque: BackdropOpaqueLayout | null,
  facade: string,
): InteriorFloorRect {
  const fac = facade || "general";
  const fra = opaque ? interiorFracBackdrop(fac) : interiorFracProcedural(fac);
  const pad = opaque
    ? { ox: opaque.destX, oy: opaque.destY, ow: opaque.destW, oh: opaque.destH, fr: fra }
    : { ox: 0, oy: 0, ow: rw, oh: rh, fr: fra };
  const fr = pad.fr;
  let x0 = pad.ox + pad.ow * fr.left;
  let y0 = pad.oy + pad.oh * fr.top;
  let x1 = pad.ox + pad.ow * (1 - fr.right);
  let y1 = pad.oy + pad.oh * (1 - fr.bottom);
  if (x1 - x0 < 100) {
    const mid = (x0 + x1) / 2;
    x0 = mid - 50;
    x1 = mid + 50;
  }
  if (y1 - y0 < 80) {
    const mid = (y0 + y1) / 2;
    y0 = mid - 40;
    y1 = mid + 40;
  }
  const rx0 = Math.max(0, Math.min(rw - 8, Math.round(x0)));
  const ry0 = Math.max(0, Math.min(rh - 8, Math.round(y0)));
  const rx1 = Math.max(rx0 + 8, Math.min(rw, Math.round(x1)));
  const ry1 = Math.max(ry0 + 8, Math.min(rh, Math.round(y1)));
  return { x0: rx0, y0: ry0, x1: rx1, y1: ry1 };
}

const HALL_HUB_BASE_RW = ROOM_W;
const HALL_HUB_BASE_RH = ROOM_H;

function hallHubInteriorSize(groupCount: number): { rw: number; rh: number } {
  const g = Math.max(1, groupCount);
  const rw = Math.min(4864, HALL_HUB_BASE_RW + Math.max(0, g - 1) * 340);
  const rh = Math.min(1512, HALL_HUB_BASE_RH + Math.max(0, g - 1) * 70);
  return { rw, rh };
}

/** Y coordinate passed to `drawSignboard` (post bases); kept inside walkable floor. */
function hallHubSignPostAnchorY(fr: InteriorFloorRect, facade = "general"): number {
  const fh = Math.max(1, fr.y1 - fr.y0);
  const target = fr.y0 + Math.round(fh * 0.11 + 102);
  let y = Math.max(fr.y0 + 100, Math.min(fr.y1 - 36, target));
  /** Art hall: pin sign in the upper–mid walkable band (fraction of floor height), well clear of EXIT. */
  if (facade === "art") {
    const prefer = fr.y0 + Math.round(fh * 0.26);
    y = Math.max(fr.y0 + 78, Math.min(fr.y1 - 240, prefer));
  }
  return y;
}

function drawHallHubInteriorOverlays(
  ctx: CanvasRenderingContext2D,
  rw: number,
  rh: number,
  zones: Zone[],
  hallZi: number[],
  theme: TownhallTheme,
  floorRect: InteriorFloorRect,
) {
  const floor = floorRect;
  const { dw, dh } = interiorDoorExtents(rw, rh);
  ctx.save();
  ctx.font = "bold 15px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = theme.accentColor;
  const titleY = Math.min(22, Math.max(16, floor.y0 * 0.35 + 8));
  ctx.fillText(theme.name, rw / 2, titleY);

  const feedsTop = Math.min(floor.y0 - 8, titleY + 18);
  const feedsH = Math.max(22, dh - 12);
  ctx.fillStyle = "#3d2e22";
  ctx.fillRect(Math.round(rw / 2 - dw / 2), feedsTop, dw, feedsH);
  ctx.strokeStyle = "#7ee2ff";
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(rw / 2 - dw / 2), feedsTop, dw, feedsH);
  ctx.fillStyle = "rgba(100,200,255,0.2)";
  ctx.fillRect(Math.round(rw / 2 - dw / 2 - 8), feedsTop + feedsH - 2, dw + 16, 6);
  ctx.font = "bold 8px monospace";
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#9ef";
  ctx.fillText("FEEDS — THREE GATEWAYS", rw / 2, feedsTop - 2);
  ctx.globalAlpha = 1;

  const g = hallZi.length;
  const facade = theme.facade ?? "general";
  ctx.font = "bold 13px monospace";
  const span = Math.max(8, floor.x1 - floor.x0);
  const colW = span / Math.max(g, 1);
  const signCy = hallHubSignPostAnchorY(floor, facade);
  for (let i = 0; i < g; i++) {
    const zi = hallZi[i];
    const cx = Math.round(floor.x0 + ((i + 0.5) / g) * span);
    const raw = zones[zi]?.label ?? "Topic";
    if (!raw.trim()) continue; /* hall floor only — omitted posts / orphans with no subgroup title */
    const palette = ZONE_PALETTE[zi % ZONE_PALETTE.length];
    const maxTextW = Math.max(56, Math.min(220, colW - 40));
    const label = truncateBannerLabel(raw, ctx, maxTextW);
    drawSignboard(ctx, cx, signCy, label, palette.sign, false);
  }

  const doorY = rh - dh;
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(180,120,60,0.35)";
  ctx.fillRect(Math.round(rw / 2 - dw / 2 - 10), doorY - 6, dw + 20, 8);
  ctx.globalAlpha = 0.72;
  ctx.font = "bold 8px monospace";
  ctx.fillStyle = "#ffd700";
  ctx.fillText("EXIT", rw / 2, doorY - 10);
  ctx.restore();
}

function drawHallHubRoomBitmap(
  ctx: CanvasRenderingContext2D,
  rw: number,
  rh: number,
  zones: Zone[],
  hallZi: number[],
  theme: TownhallTheme,
  backdropOpaque: BackdropOpaqueLayout | null,
  floorRect: InteriorFloorRect,
) {
  const facade = theme.facade ?? "general";
  const palette = ZONE_PALETTE[(hallZi[0] ?? 0) % ZONE_PALETTE.length];
  ctx.fillStyle = theme.floorColor;
  ctx.fillRect(0, 0, rw, rh);
  if (backdropOpaque) {
    backdropOpaque.draw(ctx);
  } else {
    ctx.save();
    ctx.scale(rw / ROOM_W, rh / ROOM_H);
    const fn = INTERIORS[facade] ?? drawGeneralInterior;
    fn(ctx, theme, "", palette);
    ctx.restore();
  }
  drawHallHubInteriorOverlays(ctx, rw, rh, zones, hallZi, theme, floorRect);
}

/** Keep NPC feet this far above the door band so crowds do not stack on the EXIT strip. */
const HALL_HUB_NPC_ENTRANCE_PAD = 96;

function computeHallHubNpcLayouts(
  zones: Zone[],
  hallZi: number[],
  rw: number,
  rh: number,
  floorRect: InteriorFloorRect,
  facade: string,
): Map<number, [number, number][]> {
  const floor = floorRect;
  const layouts = new Map<number, [number, number][]>();
  const g = hallZi.length;
  if (g === 0) return layouts;

  const { dh } = interiorDoorExtents(rw, rh);
  const span = Math.max(8, floor.x1 - floor.x0);
  /** Wider gutters between topic columns so each cluster reads as one sub-group. */
  const insetX = Math.max(22, span * 0.056);
  /** Vertical gap from sign post feet to first NPC row — larger on art hall (sign sits lower in room). */
  const belowSignGap = facade === "art" ? 118 : 36;
  let topY = hallHubSignPostAnchorY(floor, facade) + belowSignGap;
  const entrancePad = facade === "art" ? 158 : HALL_HUB_NPC_ENTRANCE_PAD;
  let botY = Math.min(floor.y1 - (facade === "art" ? 52 : 28), rh - dh - entrancePad);
  if (botY <= topY + 40) {
    botY = Math.min(rh - dh - Math.max(72, HALL_HUB_NPC_ENTRANCE_PAD - 24), floor.y1 - 12);
    topY = Math.max(floor.y0 + Math.round((botY - floor.y0) * 0.35), floor.y0 + 72);
    if (botY <= topY + 36) botY = topY + 80;
  }

  hallZi.forEach((zi, i) => {
    const zn = zones[zi]?.posts.length ?? 0;
    if (zn === 0) {
      layouts.set(zi, []);
      return;
    }
    let x0 = floor.x0 + (i / g) * span + insetX;
    let x1 = floor.x0 + ((i + 1) / g) * span - insetX;
    if (g === 1) {
      const midX = (x0 + x1) / 2;
      const halfW = Math.max(120, Math.min(260, 90 + Math.ceil(Math.sqrt(zn || 1)) * 26));
      x0 = Math.max(floor.x0 + 24, midX - halfW);
      x1 = Math.min(floor.x1 - 24, midX + halfW);
    }
    const localBotY = g === 1
      ? Math.min(
          botY,
          topY + Math.max(130, Math.min(220, 110 + Math.ceil(Math.sqrt(zn || 1)) * 24)),
        )
      : botY;
    const usableW = Math.max(48, x1 - x0);
    const usableH = Math.max(48, localBotY - topY);
    /** Tight blob per topic; art uses a slightly larger footprint so NPCs breathe vs signboards. */
    const clusterFracW = facade === "art" ? 0.80 : 0.74;
    const clusterFracH = facade === "art" ? 0.76 : 0.68;
    const cxMid = (x0 + x1) / 2;
    const clusterW = usableW * clusterFracW;
    const clusterH = usableH * clusterFracH;
    const gx0 = Math.max(x0 + 6, cxMid - clusterW / 2);
    const gx1 = Math.min(x1 - 6, cxMid + clusterW / 2);
    let gy0 = topY + Math.max(10, (usableH - clusterH) * (facade === "art" ? 0.2 : 0.16));
    if (facade === "art") gy0 += 12;
    const clusterBotPad = facade === "art" ? 44 : 26;
    let gy1 = Math.min(localBotY - clusterBotPad, gy0 + clusterH);
    if (gy1 < gy0 + 44) gy1 = Math.min(localBotY - 18, gy0 + Math.max(56, usableH * 0.72));

    const innerW = Math.max(40, gx1 - gx0);
    const innerH = Math.max(40, gy1 - gy0);
    const cols = Math.min(zn, Math.max(2, Math.ceil(Math.sqrt(zn * 1.2))));
    const rows = Math.ceil(zn / cols);
    /** Floor the spacing so post NPCs never overlap, even in a narrow topic column. */
    const spacingX = cols > 1 ? Math.max(52, innerW / (cols - 1)) : 0;
    const spacingY = rows > 1 ? Math.max(66, innerH / (rows - 1)) : innerH;
    const gridW = (cols - 1) * spacingX;
    const startX = cxMid - gridW / 2; // centre the (possibly widened) grid in the column
    const pos: [number, number][] = [];
    let placed = 0;
    for (let r = 0; r < rows && placed < zn; r++) {
      const rowCount = Math.min(cols, zn - placed);
      const rowOffset = cols > 1 ? (cols - rowCount) * spacingX / 2 : 0;
      for (let c = 0; c < rowCount && placed < zn; c++) {
        const rowJog = facade === "art" ? 0.06 : 0.1;
        const x = startX + rowOffset + c * spacingX + ((r % 2) * spacingX * rowJog);
        const y = gy0 + r * spacingY;
        // Clamp to the topic's column, not the tight blob, so the floored spacing holds.
        pos.push([
          Math.max(x0 + 8, Math.min(x1 - 8, x)),
          Math.max(topY + 14, Math.min(localBotY - 12, y)),
        ]);
        placed++;
      }
    }
    layouts.set(zi, pos);
  });
  return layouts;
}

function drawCharacter(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  bodyColor: string, accentColor: string,
  frame: number, isPlayer: boolean, facing: string,
  scale: number = S, waving = false, look?: NpcLook
) {
  const w = 8 * scale, h = 18 * scale;
  const x = cx - w / 2, y = cy - h;
  const skinColor = look?.skinTone ?? "#f4c27f";
  // Soft elliptical ground shadow (read as 3D)
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 1, 6 * scale, 2.2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2c3e50";
  if (frame % 2 === 0) {
    ctx.fillRect(x, y + 13 * scale, 3 * scale, 5 * scale);
    ctx.fillRect(x + 5 * scale, y + 12 * scale, 3 * scale, 5 * scale);
  } else {
    ctx.fillRect(x, y + 12 * scale, 3 * scale, 5 * scale);
    ctx.fillRect(x + 5 * scale, y + 13 * scale, 3 * scale, 5 * scale);
  }
  ctx.fillStyle = "#1a252f";
  ctx.fillRect(x, y + 16 * scale, 3 * scale, 2 * scale);
  ctx.fillRect(x + 5 * scale, y + 16 * scale, 3 * scale, 2 * scale);
  ctx.fillStyle = bodyColor; ctx.fillRect(x + scale, y + 7 * scale, 6 * scale, 6 * scale);
  ctx.fillStyle = accentColor; ctx.fillRect(x + 2 * scale, y + 8 * scale, 4 * scale, 2 * scale);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(x - scale, y + 7 * scale, 2 * scale, 5 * scale);
  if (waving) {
    ctx.fillRect(x + 8 * scale, y, 2 * scale, 6 * scale);
    ctx.fillStyle = skinColor;
    ctx.fillRect(x + 8 * scale, y - scale, 2 * scale, 2 * scale);
    ctx.fillStyle = bodyColor;
  } else {
    ctx.fillRect(x + 7 * scale, y + 7 * scale, 2 * scale, 5 * scale);
  }
  ctx.fillStyle = skinColor; ctx.fillRect(x + scale, y + 2 * scale, 6 * scale, 6 * scale);
  if (facing !== "up") {
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(x + 2 * scale, y + 4 * scale, scale, scale);
    ctx.fillRect(x + 5 * scale, y + 4 * scale, scale, scale);
  }

  // Glasses
  if (look?.hasGlasses && facing !== "up") {
    ctx.fillStyle = "rgba(100,180,255,0.5)";
    ctx.fillRect(x + 1.5 * scale, y + 3.5 * scale, 2 * scale, 1.5 * scale);
    ctx.fillRect(x + 4.5 * scale, y + 3.5 * scale, 2 * scale, 1.5 * scale);
    ctx.fillStyle = "#333";
    ctx.fillRect(x + 3.5 * scale, y + 4 * scale, scale, 0.5 * scale);
  }

  // Hat — varies by look.hatStyle for NPCs
  const hatColor = isPlayer ? "#2c3e50" : (look?.accentColor ?? accentColor);
  const hatStyle = isPlayer ? -1 : (look?.hatStyle ?? 0);

  if (hatStyle === 1) {
    // Beanie — rounded, no brim
    ctx.fillStyle = hatColor;
    ctx.fillRect(x + scale, y + scale, 6 * scale, 2 * scale);
    ctx.fillRect(x + 2 * scale, y, 4 * scale, scale);
    // Pom-pom
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + 3 * scale, y - scale, 2 * scale, scale);
  } else if (hatStyle === 2) {
    // Top hat — tall
    ctx.fillStyle = hatColor;
    ctx.fillRect(x, y + 2 * scale, 8 * scale, scale);
    ctx.fillRect(x + scale, y - scale, 6 * scale, 4 * scale);
  } else {
    // Cap (default NPC + player base)
    ctx.fillStyle = hatColor;
    ctx.fillRect(x + scale, y + scale, 6 * scale, 3 * scale);
    ctx.fillRect(x, y + 2 * scale, scale, 2 * scale);
    ctx.fillRect(x + 7 * scale, y + 2 * scale, scale, 2 * scale);
  }

  if (isPlayer) {
    ctx.fillStyle = "#e74c3c";
    ctx.fillRect(x + scale, y, 6 * scale, 2 * scale);
    ctx.fillRect(x, y + scale, 8 * scale, scale);
  }
}

// ─── Speech Bubble drawing ───────────────────────────────────────────────────
function drawSpeechBubble(
  ctx: CanvasRenderingContext2D, sx: number, sy: number,
  lines: string[], alpha: number, scale: number
) {
  const maxLines = 5;
  const showLines = lines.slice(0, maxLines);
  if (showLines.length === 0) return;
  const fontSize = 13;
  const lineHeight = fontSize + 5;
  ctx.font = `bold ${fontSize}px monospace`;
  const maxW = Math.max(...showLines.map((l) => ctx.measureText(l).width));
  const padX = 12, padY = 10;
  const bw = Math.min(maxW + padX * 2, 240);
  const bh = showLines.length * lineHeight + padY * 2;
  const bx = sx - bw / 2;
  const by = sy - 50 * scale - bh;

  ctx.save();
  ctx.globalAlpha = Math.min(alpha, 0.92);
  // Bubble body
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 4);
  ctx.fill();
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.stroke();
  // Pointer triangle
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(sx - 4, by + bh);
  ctx.lineTo(sx + 4, by + bh);
  ctx.lineTo(sx, by + bh + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#222";
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = "left";
  showLines.forEach((line, i) => {
    ctx.fillText(line, bx + padX, by + padY + (i + 1) * lineHeight - 4);
  });
  ctx.textAlign = "left";
  ctx.restore();
}


// ─── Night stars ─────────────────────────────────────────────────────────────
let _stars: [number, number, number][] | null = null;
function getStars(cw: number, ch: number): [number, number, number][] {
  if (_stars && _stars.length > 0) return _stars;
  _stars = [];
  for (let i = 0; i < 60; i++) {
    _stars.push([Math.random() * cw, Math.random() * ch, 0.3 + Math.random() * 0.7]);
  }
  return _stars;
}

function drawNightStars(ctx: CanvasRenderingContext2D, cw: number, ch: number, now: number) {
  const stars = getStars(cw, ch);
  ctx.save();
  stars.forEach(([x, y, brightness], i) => {
    const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(now / 1000 + i * 1.7));
    ctx.globalAlpha = brightness * twinkle * 0.7;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, 2, 2);
  });
  ctx.restore();
}

// ─── SpriteCanvas ─────────────────────────────────────────────────────────────
function SpriteCanvas({ bodyColor, accentColor, scale, look }: { bodyColor: string; accentColor: string; scale: number; look?: NpcLook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCharacter(ctx, canvas.width / 2, canvas.height - 2, bodyColor, accentColor, 0, false, "down", scale, false, look);
  }, [bodyColor, accentColor, scale, look]);
  return (
    <canvas ref={ref} width={10 * scale} height={20 * scale}
      style={{ imageRendering: "pixelated", display: "block", flexShrink: 0 }} />
  );
}

// ─── Virtual Joystick ─────────────────────────────────────────────────────────
function VirtualJoystick({ joystickRef }: { joystickRef: React.MutableRefObject<{ dx: number; dy: number }> }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const RADIUS  = 44;

  const applyMove = (clientX: number, clientY: number) => {
    const base = baseRef.current; if (!base) return;
    const rect = base.getBoundingClientRect();
    const bx = rect.left + rect.width / 2, by = rect.top + rect.height / 2;
    let dx = clientX - bx, dy = clientY - by;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > RADIUS) { dx = (dx / dist) * RADIUS; dy = (dy / dist) * RADIUS; }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px,${dy}px)`;
    joystickRef.current = { dx: dx / RADIUS, dy: dy / RADIUS };
  };

  const reset = () => {
    if (knobRef.current) knobRef.current.style.transform = "translate(0,0)";
    joystickRef.current = { dx: 0, dy: 0 };
  };

  return (
    <div
      style={{ position: "fixed", bottom: "calc(88px + env(safe-area-inset-bottom, 0px))", right: "calc(28px + env(safe-area-inset-right, 0px))", zIndex: 50, userSelect: "none", touchAction: "none" }}
      onPointerDown={(e) => { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); applyMove(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (e.buttons > 0) applyMove(e.clientX, e.clientY); }}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      <div ref={baseRef} style={{
        width: RADIUS * 2, height: RADIUS * 2, borderRadius: "50%",
        background: "rgba(255,255,255,0.07)",
        border: "2px solid rgba(255,255,255,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}>
        {[
          { symbol: "▲", top: 4, left: "50%", transform: "translateX(-50%)" },
          { symbol: "▼", bottom: 4, left: "50%", transform: "translateX(-50%)" },
          { symbol: "◀", left: 4, top: "50%", transform: "translateY(-50%)" },
          { symbol: "▶", right: 4, top: "50%", transform: "translateY(-50%)" },
        ].map(({ symbol, ...style }) => (
          <span key={symbol} style={{
            position: "absolute", ...style as React.CSSProperties,
            fontSize: 9, color: "rgba(255,255,255,0.25)",
            fontFamily: "monospace", lineHeight: 1,
          }}>{symbol}</span>
        ))}
        <div ref={knobRef} style={{
          width: 34, height: 34, borderRadius: "50%",
          background: "rgba(255,215,0,0.65)",
          border: "2px solid rgba(255,215,0,0.9)",
          boxShadow: "0 0 10px rgba(255,215,0,0.3)",
          position: "absolute", top: "50%", left: "50%",
          marginTop: -17, marginLeft: -17,
          pointerEvents: "none",
        }} />
      </div>
      <div style={{ textAlign: "center", marginTop: 4, fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: 0.5 }}>MOVE</div>
    </div>
  );
}

// ─── Bottom Sheet (bar → auto-expands into full encounter) ──────────────────
function BottomSheet({
  npc, expanded, visible, hasToken,
  comments, commentsLoading,
  onFavourite, onBoost, favourited, boosted, localLikes, localReposts,
  authUser,
  sheetAuthorFollowing, sheetFollowBusy, onToggleFollowAuthor,
  onReply, onExpand, onClose,
}: {
  npc: NPC | null;
  expanded: boolean;
  visible: boolean;
  hasToken: boolean;
  comments: ApiComment[];
  commentsLoading: boolean;
  onFavourite: () => void;
  onBoost: () => void;
  favourited: boolean;
  boosted: boolean;
  localLikes: number;
  localReposts: number;
  authUser: AuthState | null;
  /** null = unavailable or loading initial state handled by caller */
  sheetAuthorFollowing: boolean | null;
  sheetFollowBusy: boolean;
  onToggleFollowAuthor?: () => void;
  onReply: (postId: string, content: string) => Promise<boolean>;
  onExpand: () => void;
  onClose: () => void;
}) {
  const palette = npc ? ZONE_PALETTE[npc.zoneIndex % ZONE_PALETTE.length] : ZONE_PALETTE[0];
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 600;
  const content = npc?.post.content ?? "";
  const preview = content.length > 140 ? content.slice(0, 137) + "…" : content;

  const authorAcctId = npc?.post.authorAccountId;
  const selfAcctId = authUser?.loggedIn && authUser.accountId ? authUser.accountId : "";
  const showFollowAuthor =
    hasToken &&
    Boolean(authorAcctId && onToggleFollowAuthor) &&
    (!selfAcctId || authorAcctId !== selfAcctId);

  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const postId = npc?.post.id ?? null;

  useEffect(() => {
    if (!expanded) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [expanded, onClose]);

  useEffect(() => {
    setReplyText(""); setReplySent(false); setReplySending(false);
  }, [postId]);

  const handleLocalReply = async () => {
    if (!npc || !replyText.trim() || replySending) return;
    setReplySending(true);
    const ok = await onReply(npc.post.id, replyText.trim());
    setReplySending(false);
    if (ok) { setReplySent(true); setReplyText(""); }
  };

  const barH = isMobile ? 120 : 130;

  return (
    <>
      <style>{`
        .bsheet-scroll::-webkit-scrollbar { width: 3px; }
        .bsheet-scroll::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
        @keyframes btn-pop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.35); }
          100% { transform: scale(1); }
        }
        @keyframes comment-pop {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .bsheet-action { transition: background 0.15s, color 0.15s, opacity 0.15s; }
        .bsheet-action:active { transform: scale(0.92); }
        .bsheet-action.popped { animation: btn-pop 0.28s ease-out both; }
        .bsheet-comment { animation: comment-pop 0.16s ease-out both; }
        .bsheet-reply:focus { outline: none; border-color: ${palette.sign} !important; box-shadow: 0 0 0 2px ${palette.sign}44; }
        @keyframes npcBob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
      `}</style>

      {/* Backdrop (when expanded) */}
      <div
        onClick={expanded ? onClose : undefined}
        style={{
          position: "absolute", inset: 0, zIndex: 24,
          background: "rgba(0,0,0,0.65)",
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? "auto" : "none",
          transition: "opacity 0.4s ease",
        }}
      />

      {/* Sheet wrapper — sizes to content, no clipping, so NPC can sit above */}
      <div style={{
        position: "absolute",
        bottom: 0, left: 0, right: 0,
        zIndex: 25,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(40px)",
        transition: "transform 0.25s ease-out, opacity 0.2s ease",
        pointerEvents: visible ? "auto" : "none",
      }}>
        {/* NPC sprite — bottom:100% keeps it exactly on the sheet's top edge */}
        <div style={{
          position: "absolute",
          bottom: "100%",
          right: `max(28px, calc((100% - 560px) / 2 + 22px))`,
          marginBottom: -6,
          zIndex: 2,
          pointerEvents: "none",
          filter: `drop-shadow(0 3px 8px rgba(0,0,0,0.6))`,
        }}>
          <div style={{ animation: visible ? "npcBob 1.4s ease-in-out infinite" : "none" }}>
            <SpriteCanvas bodyColor={palette.bg} accentColor={palette.sign} scale={expanded ? 5 : 4} look={npc?.look} />
          </div>
        </div>

        {/* Clipping container — maxHeight transition creates the reveal animation */}
        <div style={{
          maxHeight: !visible ? 0 : expanded ? "calc(100dvh - 30px)" : barH,
          overflow: "hidden",
          transition: expanded
            ? "max-height 1.4s cubic-bezier(0.22, 1, 0.36, 1)"
            : "max-height 0.5s cubic-bezier(0.4, 0, 1, 1)",
        }}>
        <div
          className="bsheet-scroll"
          style={{
            maxWidth: 560,
            margin: "0 auto",
            background: "rgba(10, 14, 24, 0.96)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: `2px solid ${palette.border}`,
            borderBottom: "none",
            borderRadius: "16px 16px 0 0",
            overflowY: expanded ? "auto" : "hidden",
            maxHeight: expanded ? "calc(100dvh - 30px)" : "none",
            paddingBottom: `max(12px, env(safe-area-inset-bottom))`,
            boxShadow: `0 -8px 32px rgba(0,0,0,0.5)`,
          }}
        >
          {/* ── Bar header (always visible — tap to expand) ── */}
          <div
            onClick={!expanded ? onExpand : undefined}
            style={{
              padding: isMobile ? "10px 12px 8px" : "12px 16px 10px",
              cursor: !expanded ? "pointer" : "default",
            }}
          >
            {/* Drag handle */}
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: expanded ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.22)",
              margin: "0 auto 8px",
              transition: "background 0.3s",
            }} />

            {expanded ? (
              <>
                {/* Expanded: author row on top with full name */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 6, flexShrink: 0,
                    overflow: "hidden", background: "#1a1a2e",
                    border: `2px solid ${palette.sign}`,
                  }}>
                    {npc?.post.authorAvatar ? (
                      <img src={npc.post.authorAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🐘</div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: "bold", color: "#eee", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {npc?.post.authorName ?? "User"}
                    </div>
                    {npc?.post.authorHandle && (
                      <div style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {npc.post.authorHandle}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={onClose}
                    style={{
                      flexShrink: 0, width: 34, height: 34, borderRadius: "50%",
                      background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                      color: "#aaa", fontSize: 16, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace",
                    }}
                  >✕</button>
                </div>
                {/* Post text */}
                <div style={{
                  fontFamily: "monospace", fontSize: isMobile ? 13 : 15,
                  lineHeight: isMobile ? 1.6 : 1.75, color: "#eaeaea",
                }}>
                  {content}
                </div>
              </>
            ) : (
              <>
                {/* Collapsed bar: compact avatar + preview */}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 44 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 6,
                      overflow: "hidden", background: "#1a1a2e",
                      border: `2px solid ${palette.sign}`,
                    }}>
                      {npc?.post.authorAvatar ? (
                        <img src={npc.post.authorAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🐘</div>
                      )}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 8, color: palette.sign, whiteSpace: "nowrap", maxWidth: 50, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {npc?.post.authorName ?? "User"}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: "monospace", fontSize: isMobile ? 12 : 13,
                      lineHeight: 1.5, color: "#e8e8e8",
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
                      overflow: "hidden",
                    }}>
                      {preview}
                    </div>
                    {npc?.post.imageUrl && (
                      <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace", marginTop: 3 }}>🖼 has image</div>
                    )}
                  </div>
                  <div style={{
                    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, borderRadius: "50%",
                    background: palette.sign + "22", border: `1px solid ${palette.sign}44`,
                    color: palette.sign, fontSize: 16, fontFamily: "monospace", alignSelf: "center",
                  }}>↑</div>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.25)", textAlign: "center", marginTop: 5 }}>
                  tap to expand
                </div>
              </>
            )}
          </div>

          {/* ── Expanded content (revealed by max-height transition) ── */}

          {/* Post image */}
          {npc?.post.imageUrl && (
            <div style={{ padding: "0 12px 8px" }}>
              <img src={npc.post.imageUrl} alt="" style={{
                width: "100%", maxHeight: 280, objectFit: "contain", display: "block",
                borderRadius: 8, border: `2px solid ${palette.border}`, background: "rgba(0,0,0,0.3)",
              }} />
            </div>
          )}

          {/* Actions */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px",
            borderTop: `1px solid rgba(255,255,255,0.06)`,
            fontFamily: "monospace", fontSize: 12,
          }}>
            {showFollowAuthor && (
              <button
                type="button"
                className="bsheet-action"
                onClick={
                  sheetAuthorFollowing !== null && !sheetFollowBusy ? onToggleFollowAuthor : undefined
                }
                style={{
                  background:
                    sheetAuthorFollowing === true
                      ? "rgba(99,100,255,0.22)"
                      : "rgba(255,255,255,0.05)",
                  border: `1px solid ${
                    sheetAuthorFollowing === true ? "#6364ff" : "rgba(255,255,255,0.10)"
                  }`,
                  color:
                    sheetAuthorFollowing === true ? "#a8aaff" : hasToken ? "#8888bb" : "#555",
                  padding: "8px 14px",
                  borderRadius: 6,
                  minHeight: 44,
                  fontFamily: "monospace",
                  fontSize: 14,
                  cursor:
                    sheetFollowBusy || sheetAuthorFollowing === null ? "wait" : "pointer",
                  opacity: sheetFollowBusy ? 0.65 : 1,
                }}
              >
                {sheetFollowBusy ? "…" : sheetAuthorFollowing ? "Following" : "Follow"}
              </button>
            )}
            <button
              className={`bsheet-action${favourited ? " popped" : ""}`}
              onClick={hasToken ? onFavourite : undefined}
              style={{
                background: favourited ? "rgba(232,67,147,0.22)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${favourited ? "#e84393" : "rgba(255,255,255,0.10)"}`,
                color: favourited ? "#e84393" : hasToken ? "#c06080" : "#555",
                padding: "8px 14px", borderRadius: 6, minHeight: 44, minWidth: 44,
                fontFamily: "monospace", fontSize: 14,
                cursor: hasToken ? "pointer" : "default",
                opacity: hasToken ? 1 : 0.55,
                display: "flex", alignItems: "center", gap: 4,
              }}
            ><span>♥</span><span>{localLikes}</span></button>
            <button
              className={`bsheet-action${boosted ? " popped" : ""}`}
              onClick={hasToken ? onBoost : undefined}
              style={{
                background: boosted ? "rgba(74,171,170,0.22)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${boosted ? "#4aabaa" : "rgba(255,255,255,0.10)"}`,
                color: boosted ? "#4aabaa" : hasToken ? "#407a7a" : "#555",
                padding: "8px 14px", borderRadius: 6, minHeight: 44, minWidth: 44,
                fontFamily: "monospace", fontSize: 14,
                cursor: hasToken ? "pointer" : "default",
                opacity: hasToken ? 1 : 0.55,
                display: "flex", alignItems: "center", gap: 4,
              }}
            ><span>↺</span><span>{localReposts}</span></button>
            <span style={{ flex: 1 }} />
            {npc?.post.url && (
              <a href={npc.post.url} target="_blank" rel="noopener noreferrer"
                style={{ color: "#7aa8d4", textDecoration: "none", fontSize: 12, padding: "8px 0", display: "inline-block", minHeight: 44, lineHeight: "28px" }}>↗ mastodon</a>
            )}
          </div>

          {/* Reply box */}
          <div style={{
            padding: "6px 14px 8px",
            display: "flex", alignItems: "center", gap: 8,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}>
            <div style={{ flexShrink: 0, opacity: 0.9 }}>
              <SpriteCanvas bodyColor="#3a7ecf" accentColor="#e84393" scale={2} />
            </div>
            {hasToken ? (
              replySent ? (
                <div style={{ fontFamily: "monospace", fontSize: 13, color: "#6fcf6f", flex: 1 }}>Reply sent!</div>
              ) : (
                <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="bsheet-reply"
                    type="text"
                    placeholder="Type your reply…"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onFocus={e => { setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300); }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleLocalReply(); } }}
                    disabled={replySending}
                    style={{
                      flex: 1, background: "rgba(255,255,255,0.06)",
                      border: "2px solid rgba(255,255,255,0.12)", borderRadius: 6,
                      padding: "8px 12px", fontFamily: "monospace", fontSize: 13, color: "#eee",
                      transition: "border-color 0.15s, box-shadow 0.15s",
                    }}
                  />
                  <button
                    onClick={handleLocalReply}
                    disabled={replySending || !replyText.trim()}
                    style={{
                      background: replyText.trim() ? palette.sign : "rgba(255,255,255,0.05)",
                      border: "none", borderRadius: 6, padding: "8px 14px",
                      fontFamily: "monospace", fontSize: 12, fontWeight: "bold",
                      color: replyText.trim() ? "#fff" : "#555",
                      cursor: replyText.trim() ? "pointer" : "default",
                      opacity: replySending ? 0.5 : 1,
                    }}
                  >{replySending ? "…" : "Reply"}</button>
                </div>
              )
            ) : (
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#555", flex: 1 }}>
                Connect Mastodon to reply
              </div>
            )}
          </div>

          {/* Comments — vertical thread below the post */}
          <div style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "8px 14px 4px",
          }}>
            <div style={{
              fontFamily: "monospace", fontSize: 10, fontWeight: "bold",
              color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
              letterSpacing: 1, marginBottom: 8,
            }}>
              Replies {!commentsLoading && comments.length > 0 && `(${comments.length})`}
            </div>
            {commentsLoading && (
              <div style={{ color: "#555", fontFamily: "monospace", fontSize: 12, padding: "8px 0" }}>Loading replies…</div>
            )}
            {!commentsLoading && comments.length === 0 && (
              <div style={{ color: "#444", fontFamily: "monospace", fontSize: 12, padding: "8px 0" }}>No replies yet.</div>
            )}
            {comments.map((comment, i) => (
              <div key={comment.id} className="bsheet-comment"
                style={{
                  display: "flex", gap: 10, padding: "10px 0",
                  borderBottom: i < comments.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  animationDelay: `${Math.min(i * 0.04, 0.3)}s`,
                }}>
                <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: "#1a1a2e", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🐘</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: "bold", color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                      {comment.authorName}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                      {comment.authorHandle}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: "monospace", fontSize: 13, lineHeight: 1.5,
                    color: "#ccc", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {comment.content}
                  </div>
                  {comment.likes > 0 && (
                    <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, color: "#e84393" }}>♥ {comment.likes}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
type LoadState =
  | { status: "loading" }
  | { status: "error"; msg: string }
  | { status: "ready"; zones: Zone[]; npcs: NPC[]; source: string; computedAt: string };

export function BitFeedGame() {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const frameRef        = useRef<number>(0);
  const activeNpcRef    = useRef<number | null>(null);
  const dismissedNpcRef = useRef<number | null>(null);
  const dismissedStoryCharIdRef = useRef<string | null>(null);
  const storyDismissedMustExitRef = useRef(false);
  const storySpotsRef = useRef<StorySpot[]>([]);
  const forkPathsRef = useRef<ForkPathGate[]>([]);
  const forkCommitRef = useRef<(feed: ClusterFeedSource) => void>(() => {});
  const feedGatewayBusyRef = useRef(false);
  /** Same payload as overlay state; updated synchronously so the canvas can paint immediately. */
  const feedGatewayOverlayRef = useRef<{ label: string } | null>(null);
  const hasTokenGameRef = useRef(false);
  const openLoginPromptRef = useRef<() => void>(() => {});
  const storyOpenRef = useRef(false);
  const joystickRef     = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const triggerHappyRef = useRef<number | null>(null);
  const chainTriggerRef = useRef<{ idx: number; type: "fav" | "boost" } | null>(null);
  const shakeRef        = useRef(0);
  const heartParticlesRef = useRef<{ x: number; y: number; vy: number; age: number; maxAge: number }[]>([]);

  const [load, setLoad]                       = useState<LoadState>({ status: "loading" });
  const [mastodonInfo, setMastodonInfo]       = useState<MastodonInfo | null>(null);
  const [authUser, setAuthUser]               = useState<AuthState | null>(null);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [instanceInput, setInstanceInput]     = useState("fosstodon.org");
  const [activeNpc, setActiveNpc]             = useState<number | null>(null);
  const [panelNpc, setPanelNpc]               = useState<NPC | null>(null);
  const [comments, setComments]               = useState<ApiComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [refreshing, setRefreshing]           = useState(false);
  // Always start at the fork hub (The Sage), regardless of any remembered feed.
  const [feedForkPending, setFeedForkPending] = useState<boolean>(true);
  const [feedSource, setFeedSource]           = useState<ClusterFeedSource>(
    () => readStoredFeedSource() ?? "public",
  );
  const [favourited, setFavourited]           = useState<Record<string, boolean>>({});
  const [boosted, setBoosted]                 = useState<Record<string, boolean>>({});
  const [localLikes, setLocalLikes]           = useState<Record<string, number>>({});
  const [localReposts, setLocalReposts]       = useState<Record<string, number>>({});
  const [sheetAuthorFollowing, setSheetAuthorFollowing] = useState<boolean | null>(null);
  const [sheetFollowBusy, setSheetFollowBusy] = useState(false);
  const [visited, setVisited]                 = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem("visited-posts");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [muted, setMuted]                     = useState(false);
  /** Canvas stays mounted; fullscreen overlay during feed gateway → cluster load. */
  const [feedGatewayBusy, setFeedGatewayBusy] = useState<{ label: string } | null>(null);
  const [savedHallCounts, setSavedHallCounts] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(SCORES_KEY) ?? "{}"); } catch { return {}; }
  });
  const [countedPostIds, setCountedPostIds] = useState<Set<string>>(() => {
    try {
      const arr: string[] = JSON.parse(localStorage.getItem(COUNTED_POSTS_KEY) ?? "[]");
      return new Set(arr);
    } catch { return new Set<string>(); }
  });
  const [earnedTitle, setEarnedTitle] = useState<{ title: string; description: string; milestone: number } | null>(() => {
    try { return JSON.parse(localStorage.getItem(TITLE_KEY) ?? "null"); } catch { return null; }
  });
  const [level, setLevel] = useState(() => {
    try {
      const m: Record<string, number[]> = JSON.parse(localStorage.getItem(MILESTONES_KEY) ?? "{}");
      return computeLevel(m);
    } catch { return 0; }
  });
  const [levelGained, setLevelGained] = useState(0);
  const [radarExpanded, setRadarExpanded] = useState(false);
  const [titleFetching, setTitleFetching] = useState(false);
  const [showTitlePopup, setShowTitlePopup] = useState(false);
  // const [postsMade, setPostsMade] = useState(() =>
  //   parseInt(localStorage.getItem(POSTS_MADE_KEY) ?? "0", 10)
  // );
  // const [floraComposeOpen, setFloraComposeOpen] = useState(false);
  // const [floraPosts, setFloraPosts]             = useState<FloraPost[]>([]);
  // const floraPostsFetchedRef                    = useRef(false);
  const [pendingTitleAnalysis, setPendingTitleAnalysis] = useState(false);
  const pendingTitleCountsRef = useRef<Record<string, number> | null>(null);
  const savedHallCountsRef = useRef(savedHallCounts);
  savedHallCountsRef.current = savedHallCounts;
  const countedPostIdsRef = useRef(countedPostIds);
  countedPostIdsRef.current = countedPostIds;
  const visitedRef = useRef(visited);
  visitedRef.current = visited;
  const earnedTitleRef = useRef(earnedTitle);
  earnedTitleRef.current = earnedTitle;
  // const postsMadeRef = useRef(postsMade);
  // postsMadeRef.current = postsMade;

  const totalHallCounts = useMemo(() => {
    const zones = load.status === "ready" ? load.zones : [];
    const uncommitted = new Set([...visited].filter((id) => !countedPostIds.has(id)));
    return mergeCounts(savedHallCounts, deriveHallCounts(zones, uncommitted));
  }, [savedHallCounts, countedPostIds, visited, load]);

  // Commit read progress to localStorage on every post visit, so reads survive a
  // tab close before reaching the Sage. This mirrors the Sage-return checkpoint's
  // localStorage write (Firestore sync + milestones still happen there); the
  // countedPostIds dedup keeps each post counted exactly once.
  useEffect(() => {
    if (load.status !== "ready") return;
    const uncommitted = new Set([...visited].filter((id) => !countedPostIdsRef.current.has(id)));
    if (uncommitted.size === 0) return;
    const total = mergeCounts(savedHallCountsRef.current, deriveHallCounts(load.zones, uncommitted));
    try { localStorage.setItem(SCORES_KEY, JSON.stringify(total)); } catch { /* quota — non-fatal */ }
    setSavedHallCounts(total);
    const newCounted = new Set([...countedPostIdsRef.current, ...visited]);
    try { localStorage.setItem(COUNTED_POSTS_KEY, JSON.stringify([...newCounted])); } catch { /* ignore */ }
    setCountedPostIds(newCounted);
  }, [visited, load]);

  const fetchTitle = useCallback(async (hallCounts: Record<string, number>) => {
    setTitleFetching(true);
    try {
      const res = await fetch("/api/user/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hall_counts: hallCounts }),
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json() as { title: string; description: string; milestone: number };
      const titleObj = { title: data.title, description: data.description, milestone: data.milestone };
      localStorage.setItem(TITLE_KEY, JSON.stringify(titleObj));
      setEarnedTitle(titleObj);
      setShowTitlePopup(true);
    } catch { /* network error — silently ignore */ } finally {
      setTitleFetching(false);
    }
  }, []);

  const checkMilestones = useCallback((total: Record<string, number>): { newLevels: number; shouldFetch: boolean } => {
    try {
      const saved: Record<string, number[]> = JSON.parse(localStorage.getItem(MILESTONES_KEY) ?? "{}");
      let newLevels = 0;
      for (const [hall, count] of Object.entries(total)) {
        for (const m of MILESTONE_STEPS) {
          if (count >= m && !(saved[hall]?.includes(m))) {
            saved[hall] = [...(saved[hall] ?? []), m];
            newLevels++;
          }
        }
      }
      const titleAlreadyEarned = Boolean(localStorage.getItem(TITLE_KEY));
      const anyMilestoneEver = Object.values(saved).some((arr) => arr.length > 0);
      if (newLevels > 0) {
        localStorage.setItem(MILESTONES_KEY, JSON.stringify(saved));
        return { newLevels, shouldFetch: true };
      }
      // Previous fetch failed — retry via Sage dialogue
      return { newLevels: 0, shouldFetch: !titleAlreadyEarned && anyMilestoneEver };
    } catch { return { newLevels: 0, shouldFetch: false }; }
  }, []);

  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("onboarding-seen"));
  const [nearbyNpc, setNearbyNpc] = useState<NPC | null>(null);
  const nearbyNpcIdxRef = useRef<number | null>(null);
  const [storyOverlayOpen, setStoryOverlayOpen] = useState(false);
  /** Which story character overlay is showing (matches `STORY_CHARACTER_DEFS` id). */
  const [storyOverlayCharId, setStoryOverlayCharId] = useState<string | null>(null);

  storyOpenRef.current = storyOverlayOpen;

  // // Fetch the player's own posts when Flora interaction opens, once per session
  // useEffect(() => {
  //   const floraActive = storyOverlayCharId === "motherFlora" || floraComposeOpen;
  //   if (!floraActive) {
  //     floraPostsFetchedRef.current = false;
  //     return;
  //   }
  //   if (floraPostsFetchedRef.current) return;
  //   if (!hasTokenGameRef.current) return;
  //   floraPostsFetchedRef.current = true;
  //   fetch("/api/mastodon/my-posts", { credentials: "include", cache: "no-store" })
  //     .then(r => (r.ok ? r.json() : Promise.resolve([])))
  //     .then((posts: FloraPost[]) => setFloraPosts(posts))
  //     .catch(() => {});
  // }, [storyOverlayCharId, floraComposeOpen]);

  const handleCloseStoryOverlay = useCallback(() => {
    const closingCharId = storyOverlayCharId;
    if (closingCharId !== null) {
      dismissedStoryCharIdRef.current = closingCharId;
      storyDismissedMustExitRef.current = true;
    }
    setStoryOverlayOpen(false);
    setStoryOverlayCharId(null);
    if (pendingTitleAnalysis && pendingTitleCountsRef.current) {
      setPendingTitleAnalysis(false);
      void fetchTitle(pendingTitleCountsRef.current);
      pendingTitleCountsRef.current = null;
    }
    // if (closingCharId === "motherFlora" && hasTokenGameRef.current) {
    //   setFloraComposeOpen(true);
    // }
  }, [storyOverlayCharId, pendingTitleAnalysis, fetchTitle]);

  const handleStoryIntroComplete = useCallback(() => {
    if (!storyOverlayCharId) return;
    const def = STORY_CHARACTER_DEFS[storyOverlayCharId];
    if (!def) return;
    try {
      sessionStorage.setItem(def.sessionIntroKey, "1");
    } catch {
      /* ignore quota */
    }
  }, [storyOverlayCharId]);
  const isLoggedIn = authUser?.loggedIn ?? false;
  const hasToken   = Boolean(mastodonInfo?.hasToken) || isLoggedIn;

  useEffect(() => {
    if (!isLoggedIn) return;
    const send = () => {
      if (document.hidden) return;
      void fetch("/api/heartbeat", { method: "POST", credentials: "include" });
    };
    send();
    const id = setInterval(send, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [isLoggedIn]);

  // On login, fetch persisted profile from Firestore and merge into local state.
  // Merge strategy: take Math.max per hall (handles multi-device), union milestones.
  useEffect(() => {
    if (!isLoggedIn) return;
    void (async () => {
      try {
        const res = await fetch("/api/user/profile", { credentials: "include" });
        if (!res.ok) return;
        const remote = await res.json() as {
          hallCounts: Record<string, number>;
          earnedTitle: { title: string; description: string; milestone: number } | null;
          milestones: Record<string, number[]>;
        };
        // Merge hall counts
        setSavedHallCounts(prev => {
          const merged: Record<string, number> = { ...prev };
          for (const [k, v] of Object.entries(remote.hallCounts))
            merged[k] = Math.max(merged[k] ?? 0, v);
          return merged;
        });
        // Adopt remote earned title if we don't have one locally
        if (remote.earnedTitle) {
          setEarnedTitle(t => {
            if (t) return t;
            try { localStorage.setItem(TITLE_KEY, JSON.stringify(remote.earnedTitle)); } catch { /* ignore */ }
            return remote.earnedTitle;
          });
        }
        // Merge milestones: for each hall, take the array with more entries
        const localMilestones: Record<string, number[]> =
          (() => { try { return JSON.parse(localStorage.getItem(MILESTONES_KEY) ?? "{}"); } catch { return {}; } })();
        const mergedMilestones: Record<string, number[]> = { ...localMilestones };
        let changed = false;
        for (const [hall, arr] of Object.entries(remote.milestones)) {
          if ((mergedMilestones[hall]?.length ?? 0) < arr.length) {
            mergedMilestones[hall] = arr;
            changed = true;
          }
        }
        if (changed) {
          try { localStorage.setItem(MILESTONES_KEY, JSON.stringify(mergedMilestones)); } catch { /* ignore */ }
          setLevel(computeLevel(mergedMilestones));
        }
      } catch { /* non-fatal — localStorage is the fallback */ }
    })();
  }, [isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  hasTokenGameRef.current = hasToken;
  openLoginPromptRef.current = () => setLoginPromptOpen(true);

  /** Stack feed / sound / auth in a drawer below 640px so the top row stays readable. */
  const [narrowTopbar, setNarrowTopbar] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => {
      const m = mq.matches;
      setNarrowTopbar(m);
      if (!m) setMobileMenuOpen(false);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    if (!mobileMenuOpen || !narrowTopbar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen, narrowTopbar]);

  // Persist visited to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem("visited-posts", JSON.stringify([...visited])); } catch {}
  }, [visited]);

  // ── Load tile sprites once on mount; falls back to procedural drawing if any are missing.
  const [tilesReady, setTilesReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadAllTiles().then(() => { if (!cancelled) setTilesReady(true); });
    return () => { cancelled = true; };
  }, []);

  // ── Fetch Mastodon info ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/mastodon/info", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setMastodonInfo(d); })
      .catch(() => {});
  }, []);

  // ── Fetch clusters ──────────────────────────────────────────────────────────
  const feedSourceRef = useRef(feedSource);
  feedSourceRef.current = feedSource;

  const fetchClusters = useCallback((
    bust = false,
    overrideSource?: ClusterFeedSource,
    opts?: { skipLoadingSpinner?: boolean },
  ) => {
    const worldW = COLS * TILE, worldH = ROWS * TILE;
    const src = overrideSource ?? feedSourceRef.current;
    const CACHE_TTL = 60 * 60 * 1000; // 1 hour
    const cacheKey = `vikalp-clusters:${src}`;
    const silent = Boolean(opts?.skipLoadingSpinner);

    const applyData = (data: { clusters: ApiCluster[]; source: string; computedAt: string }) => {
      const clusters = data.clusters ?? [];
      const centers = zoneCenters(clusters.length, worldW, worldH);
      const zones: Zone[] = clusters.map((c, i) => ({
        cx: centers[i]![0],
        cy: centers[i]![1],
        label: c.label,
        color: ZONE_PALETTE[i % ZONE_PALETTE.length].bg,
        hall: clusterHallNormalized(c.hall ?? "general"),
        posts: c.posts,
      }));
      const npcs: NPC[] = zones.flatMap((zone, zi) => {
        const palette   = ZONE_PALETTE[zi % ZONE_PALETTE.length];
        const positions = npcPositions(zone.cx, zone.cy, zone.posts.length);
        return zone.posts.map((post, pi) => {
          const sc = popularityScale(post.likes ?? 0, post.reposts ?? 0);
          return {
            x: positions[pi][0], y: positions[pi][1],
            post, zoneColor: palette.sign, zoneIndex: zi,
            bubbleLines: wrapText(post.content, 22),
            scale: sc,
            look: npcLookFromId(post.id),
            npcFacing: "down",
            waving: false, waveTimer: 0,
            happyTimer: 0,
            emoteTimer: 0,
            emoteNext: 200 + Math.random() * 400,
          };
        });
      });
      const likes: Record<string, number> = {};
      const reposts: Record<string, number> = {};
      npcs.forEach((n) => {
        likes[n.post.id]   = n.post.likes ?? 0;
        reposts[n.post.id] = n.post.reposts ?? 0;
      });
      setLocalLikes(likes);
      setLocalReposts(reposts);
      setLoad({ status: "ready", zones, npcs, source: data.source ?? "", computedAt: data.computedAt ?? "" });
    };

    // Try browser cache first (unless explicit refresh)
    if (!bust) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as { data: { clusters: ApiCluster[]; source: string; computedAt: string }; savedAt: number };
          if (Date.now() - cached.savedAt < CACHE_TTL) {
            if (!silent) setLoad({ status: "loading" });
            return Promise.resolve().then(() => {
              applyData(cached.data);
            });
          }
        }
      } catch { /* corrupt cache — ignore */ }
    }

    if (!silent) setLoad({ status: "loading" });

    const doFetch = () =>
      fetch(`/api/mastodon/clusters?source=${encodeURIComponent(src)}`, { credentials: "include" })
        .then((r) => {
          if (r.status === 401) { openLoginPromptRef.current(); return Promise.reject("login-required"); }
          return r.ok ? r.json() : r.json().then((e: { error: string }) => Promise.reject(e.error));
        })
        .then((data: { clusters: ApiCluster[]; source: string; computedAt: string }) => {
          // Save to browser cache
          try { localStorage.setItem(cacheKey, JSON.stringify({ data, savedAt: Date.now() })); } catch {}
          applyData(data);
        })
        .catch((e: string | unknown) => {
          if (e === "login-required") { setLoad({ status: "ready", zones: [], npcs: [], source: "", computedAt: "" }); return; }
          setLoad({ status: "error", msg: String(e) });
        });

    if (bust) {
      // Explicit refresh — clear browser cache + server cache, then refetch
      try { localStorage.removeItem(cacheKey); } catch {}
      return fetch("/api/mastodon/clusters/refresh", { method: "POST", credentials: "include" })
        .then(() => doFetch())
        .catch(() => doFetch());
    } else {
      return doFetch();
    }
  }, []);

  useEffect(() => {
    forkCommitRef.current = (feed: ClusterFeedSource) => {
      const label = FEED_VISUAL_THEME[feed].chromeLabel;
      feedGatewayBusyRef.current = true;
      feedGatewayOverlayRef.current = { label };
      setFeedGatewayBusy({ label });
      persistFeedSource(feed);
      setFeedForkPending(false);
      setFeedSource(feed);
      void Promise.resolve(
        fetchClusters(false, feed, { skipLoadingSpinner: true }),
      ).finally(() => {
        feedGatewayBusyRef.current = false;
        feedGatewayOverlayRef.current = null;
        setFeedGatewayBusy(null);
      });
    };
  }, [fetchClusters]);

  // ── Fetch auth state + clusters on mount ────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: AuthState | null) => { if (d) setAuthUser(d); })
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    if (params.get("loggedin") === "1") {
      history.replaceState(null, "", window.location.pathname);
    }

    // Always begin at the fork hub (The Sage) so the player picks a feed each
    // session — never auto-skip into the overworld based on a remembered feed.
    // (feedSource is still seeded from the remembered choice as the default.)
    setFeedForkPending(true);
    setLoad({ status: "ready", zones: [], npcs: [], source: "", computedAt: "" });
  }, [fetchClusters]);

  // ── Fetch comments when NPC changes ────────────────────────────────────────
  useEffect(() => {
    if (!panelNpc) return;
    const postId = panelNpc.post.id;

    // Mark as visited + play discover sound
    if (!visitedRef.current.has(postId)) {
      setVisited((prev) => new Set(prev).add(postId));
      SoundFx.discover();
    }
    SoundFx.talk();

    setCommentsLoading(true);
    setComments([]);
    fetch(`/api/mastodon/posts/${postId}/comments`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ApiComment[]) => { setComments(data); setCommentsLoading(false); })
      .catch(() => { setComments([]); setCommentsLoading(false); });
  }, [panelNpc]);

  useEffect(() => {
    const n = nearbyNpc ?? panelNpc;
    const aid = n?.post.authorAccountId;
    if (!hasToken || !aid) {
      setSheetAuthorFollowing(null);
      return;
    }
    let cancelled = false;
    setSheetAuthorFollowing(null);
    fetch(`/api/mastodon/accounts/relationships?id=${encodeURIComponent(aid)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((rel: unknown) => {
        if (cancelled) return;
        const row =
          Array.isArray(rel) &&
          rel[0] !== undefined &&
          typeof rel[0] === "object" &&
          "following" in (rel[0] as object)
            ? (rel[0] as { following?: boolean })
            : null;
        setSheetAuthorFollowing(row ? Boolean(row.following) : false);
      })
      .catch(() => {
        if (!cancelled) setSheetAuthorFollowing(false);
      });
    return () => { cancelled = true; };
  }, [nearbyNpc, panelNpc, hasToken]);

  // ── Favourite / Boost handlers (toggle on/off) ─────────────────────────────
  const handleFavourite = () => {
    if (!panelNpc) return;
    const postId = panelNpc.post.id;
    const alreadyFaved = favourited[postId];

    if (alreadyFaved) {
      setFavourited((p) => ({ ...p, [postId]: false }));
      setLocalLikes((p) => ({ ...p, [postId]: Math.max(0, (p[postId] ?? 1) - 1) }));
      fetch(`/api/mastodon/posts/${postId}/unfavourite`, { method: "POST", credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((d: { favourites_count?: number } | null) => {
          if (d?.favourites_count !== undefined)
            setLocalLikes((p) => ({ ...p, [postId]: d.favourites_count! }));
        })
        .catch(() => {});
    } else {
      setFavourited((p) => ({ ...p, [postId]: true }));
      setLocalLikes((p) => ({ ...p, [postId]: (p[postId] ?? 0) + 1 }));
      triggerHappyRef.current = activeNpcRef.current;
      if (activeNpcRef.current !== null) chainTriggerRef.current = { idx: activeNpcRef.current, type: "fav" };
      if (panelNpc) {
        for (let h = 0; h < 6; h++) {
          heartParticlesRef.current.push({
            x: panelNpc.x + (Math.random() - 0.5) * 16,
            y: panelNpc.y - 20,
            vy: -0.3 - Math.random() * 0.4,
            age: 0,
            maxAge: 50 + Math.random() * 30,
          });
        }
      }
      try { navigator.vibrate?.(50); } catch {}
      SoundFx.favourite();
      fetch(`/api/mastodon/posts/${postId}/favourite`, { method: "POST", credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((d: { favourites_count?: number } | null) => {
          if (d?.favourites_count !== undefined)
            setLocalLikes((p) => ({ ...p, [postId]: d.favourites_count! }));
        })
        .catch(() => {});
    }
  };

  const handleBoost = () => {
    if (!panelNpc) return;
    const postId = panelNpc.post.id;
    const alreadyBoosted = boosted[postId];

    if (alreadyBoosted) {
      setBoosted((p) => ({ ...p, [postId]: false }));
      setLocalReposts((p) => ({ ...p, [postId]: Math.max(0, (p[postId] ?? 1) - 1) }));
      fetch(`/api/mastodon/posts/${postId}/unboost`, { method: "POST", credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((d: { reblogs_count?: number } | null) => {
          if (d?.reblogs_count !== undefined)
            setLocalReposts((p) => ({ ...p, [postId]: d.reblogs_count! }));
        })
        .catch(() => {});
    } else {
      setBoosted((p) => ({ ...p, [postId]: true }));
      setLocalReposts((p) => ({ ...p, [postId]: (p[postId] ?? 0) + 1 }));
      triggerHappyRef.current = activeNpcRef.current;
      if (activeNpcRef.current !== null) chainTriggerRef.current = { idx: activeNpcRef.current, type: "boost" };
      shakeRef.current = 12;
      try { navigator.vibrate?.(80); } catch {}
      SoundFx.boost();
      fetch(`/api/mastodon/posts/${postId}/boost`, { method: "POST", credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((d: { reblogs_count?: number } | null) => {
          if (d?.reblogs_count !== undefined)
            setLocalReposts((p) => ({ ...p, [postId]: d.reblogs_count! }));
        })
        .catch(() => {});
    }
  };

  const handleReply = useCallback(async (postId: string, content: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/mastodon/posts/${postId}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        // const n = parseInt(localStorage.getItem(POSTS_MADE_KEY) ?? "0", 10) + 1;
        // localStorage.setItem(POSTS_MADE_KEY, String(n));
        // setPostsMade(n);  // flora tree growth tracking — re-enable with Flora feature
      }
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const handleToggleFollowAuthor = useCallback(async () => {
    const n = nearbyNpc ?? panelNpc;
    const aid = n?.post.authorAccountId;
    if (!hasToken || !aid || sheetAuthorFollowing === null) return;
    const unfollowing = sheetAuthorFollowing === true;
    setSheetFollowBusy(true);
    try {
      const r = await fetch(
        `/api/mastodon/accounts/${encodeURIComponent(aid)}/${unfollowing ? "unfollow" : "follow"}`,
        { method: "POST", credentials: "include" },
      );
      if (r.ok) setSheetAuthorFollowing(!unfollowing);
    } finally {
      setSheetFollowBusy(false);
    }
  }, [nearbyNpc, panelNpc, hasToken, sheetAuthorFollowing]);

  const handleCloseModal = useCallback(() => {
    if (nearbyNpcIdxRef.current !== null) dismissedNpcRef.current = nearbyNpcIdxRef.current;
    else if (activeNpcRef.current !== null) dismissedNpcRef.current = activeNpcRef.current;
    activeNpcRef.current = null;
    setActiveNpc(null);
    nearbyNpcIdxRef.current = null;
    setNearbyNpc(null);
  }, []);

  const handleExpandBar = useCallback(() => {
    if (!nearbyNpc) return;
    const idx = nearbyNpcIdxRef.current;
    if (idx === null) return;
    activeNpcRef.current = idx;
    setActiveNpc(idx);
    setPanelNpc(nearbyNpc);
    SoundFx.talk();
  }, [nearbyNpc]);

  // ── Game loop ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (load.status !== "ready") return;
    if (!tilesReady) return; // wait for tile sprite load (or fallback) to settle
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const zoom = getOverworldCanvasZoom();
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
      _stars = null;
    };
    resize();
    window.addEventListener("resize", resize);

    const worldW = COLS * TILE, worldH = ROWS * TILE;
    const { zones, npcs } = load;
    const streetYBootstrap = avenueCenterWorldY(worldH);
    const forkHubActive = zones.length === 0;
    const forkBootstrap = forkHubLayout(worldW, worldH, streetYBootstrap);
    const owFeedKey: ClusterFeedSource = forkHubActive ? "public" : feedSource;
    const owTheme = FEED_VISUAL_THEME[owFeedKey];
    const startInForkHub = feedForkPending; // fork_hub only until user commits a feed source
    forkPathsRef.current = computeForkGateRects(worldW, worldH, streetYBootstrap);

    const villageSpawn = overworldSpawnNearSageReturnPath(worldW, worldH, streetYBootstrap);
    const state: GameState = {
      px: startInForkHub ? forkBootstrap.mid : villageSpawn.px,
      py: startInForkHub ? forkBootstrap.y0 + forkBootstrap.stubH * 0.48 : villageSpawn.py,
      facing: startInForkHub ? "up" : "up",
      animFrame: 0,
      animTimer: 0,
      moving: false,
      keys: {}, talkingTo: null,
      camera: { x: 0, y: 0 },
      npcs, zones, worldW, worldH,
      scene: startInForkHub ? { type: "fork_hub" } : { type: "overworld" },
      transition: 0,
      pendingScene: null,
    };

    const isTyping = () => {
      const tag = document.activeElement?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement)?.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      state.keys[e.key] = true;
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isTyping()) return;
      state.keys[e.key] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // Tap-to-interact: tap on canvas to auto-walk to nearest NPC
    const onCanvasTap = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (state.transition !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const tapZoom = getOverworldCanvasZoom();
      const cx = (e.clientX - rect.left) / tapZoom;
      const cy = (e.clientY - rect.top) / tapZoom;
      const worldX = cx + state.camera.x;
      // Overworld is rendered with vertical squash, so unproject the click y
      // back to world coordinates. Interiors stay flat.
      const screenY = cy + state.camera.y;
      const worldY = isTownhallInteriorScene(state.scene) ? screenY : screenY / PROJ_Y;
      let best: WalkTarget | null = null;
      let bestDist = 120;
      state.npcs.forEach((npc, i) => {
        if (isTownhallInteriorScene(state.scene) && !npcBelongsToCurrentInterior(state, npc.zoneIndex)) return;
        if (state.scene.type === "overworld" && !npcShownOnOverworld(state.zones, npc.zoneIndex)) return;
        if (state.scene.type === "fork_hub") return;
        const d = Math.hypot(npc.x - worldX, npc.y - worldY);
        if (d < bestDist) {
          bestDist = d;
          best = { kind: "post", npcIdx: i, x: npc.x, y: npc.y };
        }
      });
      if (state.scene.type === "overworld" || state.scene.type === "fork_hub") {
        for (const spot of storySpotsRef.current) {
          const d = Math.hypot(spot.worldX - worldX, spot.worldY - worldY);
          if (d < bestDist) {
            bestDist = d;
            best = {
              kind: "story",
              charId: spot.charId,
              x: spot.worldX,
              y: spot.worldY,
            };
          }
        }
      }
      if (best) state.walkTarget = best;
    };
    canvas.addEventListener("pointerup", onCanvasTap);

    // Build offscreen worlds (dimetric: world is squashed vertically by PROJ_Y).
    const projectedWorldH = Math.ceil(worldH * PROJ_Y);
    const offVillage = document.createElement("canvas");
    offVillage.width = worldW; offVillage.height = projectedWorldH;
    const oc = offVillage.getContext("2d")!;
    const interiorHallKeys = activeInteriorHallKeys(zones);
    const hallHubDimensions = new Map<string, { rw: number; rh: number }>();
    const hallHubCentroidByHall = compactHallHubCentroids(interiorHallKeys, worldW, worldH);
    for (const h of interiorHallKeys) {
      const ziList = hallHubZoneIndices(zones, h);
      if (ziList.length === 0) continue;
      hallHubDimensions.set(h, hallHubInteriorSize(ziList.length));
    }

    // ── Ground layer: grass tiles + paths + flower beds, squashed via scale ──
    oc.save();
    oc.scale(1, PROJ_Y);
    // 1) Grass base
    for (let ty = 0; ty < ROWS; ty++)
      for (let tx = 0; tx < COLS; tx++) drawGrass(oc, tx, ty, owTheme.grass);
    // 3) Single broad horizontal avenue (+ grass shoulders); halls sit north of strip
    const midX = Math.floor(COLS / 2) * TILE;
    const streetY = avenueCenterWorldY(worldH);
    const aveLeft = AVENUE_SIDE_MARGIN_TILES * TILE;
    const aveRight = worldW - AVENUE_SIDE_MARGIN_TILES * TILE;
    drawBroadHorizontalAvenue(oc, aveLeft, aveRight, streetY, owTheme.path);
    const fkBake = forkHubLayout(worldW, worldH, streetY);
    const forkMidX = fkBake.mid;
    const forkSageGroundY = fkBake.sageFeetY;
    const storySpotsForkHub = buildStoryWorldSpots({
      worldW,
      worldH,
      streetY,
      aveLeft,
      aveRight,
      tile: TILE,
      forkPlazaMidX: forkMidX,
      forkPlazaWorldY: forkSageGroundY,
      activeScene: "fork_hub",
    });
    const storySpotsVillageOnly = buildStoryWorldSpots({
      worldW,
      worldH,
      streetY,
      aveLeft,
      aveRight,
      tile: TILE,
      forkPlazaMidX: forkMidX,
      forkPlazaWorldY: forkSageGroundY,
      activeScene: "overworld",
    });
    storySpotsRef.current = startInForkHub ? storySpotsForkHub : storySpotsVillageOnly;
    drawAllHallAccessPaths(oc, interiorHallKeys, hallHubCentroidByHall, streetY, worldW, owTheme.path);
    let pathClearanceRects = collectOverworldPathClearanceRects(
      interiorHallKeys,
      hallHubCentroidByHall,
      streetY,
      worldW,
      aveLeft,
      aveRight,
    );
    if (zones.length > 0)
      pathClearanceRects = [
        ...pathClearanceRects,
        villageSageReturnTrailTreesClearance(worldW, worldH, streetY),
      ];
    const decoNorthGrassY = streetY - avenueBlendHalfThickness() - TILE * 0.55;
    const decoSouthGrassY = streetY + avenueBlendHalfThickness() + TILE * 0.62;

    for (const h of interiorHallKeys) {
      const c = hallHubCentroidByHall.get(h);
      if (!c) continue;
      const fx = Math.round((midX + c.cx) / 2);
      const fy = Math.round((streetY + c.cy) / 2);
      drawFlowerBedMaybeSprite(oc, fx, fy - 2, 0, fx + fy + 17, pathClearanceRects);
    }
    // 4) Decorative flower beds at fixed seeds across the map (PNG flower_bed + procedural fallback)
    [[7 * TILE, 6 * TILE], [35 * TILE, 8 * TILE], [10 * TILE, 25 * TILE], [33 * TILE, 24 * TILE], [22 * TILE, 27 * TILE]]
      .forEach(([fx, fy], i) => {
        const cx = fx + 12;
        const cy = fy + 14;
        drawFlowerBedMaybeSprite(oc, cx, cy, 0, i + 1, pathClearanceRects);
      });
    // Bouquet strip along avenue shoulders (outside mud band)
    for (let decoS = 0, xw = aveLeft + 28; xw < aveRight - 22; xw += 154, decoS++) {
      const ox = tileHash(decoS, 0, 712) > 0.48 ? TILE * 0.32 : -TILE * 0.08;
      const northY = decoNorthGrassY + (decoS % 5) * 5 - 8;
      const southY = decoSouthGrassY + (decoS % 6) * 4 + 10;
      const useNorth = tileHash(decoS, 503, 88) > 0.45;
      const bx = xw + ox + (useNorth ? 0 : TILE * 0.92 + ox * 0.4);
      const by = useNorth ? northY : southY;
      drawFlowerBedMaybeSprite(oc, bx, by, 0, 800 + decoS, pathClearanceRects);
    }
    /** South-centre trail to Sage — long spine plus highlighted stand band (baked on village only). */
    if (zones.length > 0) {
      const spine = villageSageReturnSpineBounds(worldW, worldH, streetY);
      drawPath(oc, spine.left, spine.top, spine.right - spine.left, spine.bottom - spine.top, owTheme.path);
      const retR = villageReturnToSageWorldRect(worldW, worldH);
      oc.strokeStyle = "rgba(255,210,120,0.5)";
      oc.lineWidth = 2;
      oc.strokeRect(retR.left + 1, retR.top + 1, retR.right - retR.left - 2, retR.bottom - retR.top - 2);
    }
    oc.restore();

    // ── Tall layer: trees, bushes, lanterns. These are vertical sprites
    // that "stand on" their projected ground point, so we project the y anchor
    // but keep full pixel height upward (drawn in unprojected scale).

    // 2) Border tree wall + interior tree clusters (varied)
    for (let i = 0; i < COLS; i++) {
      drawTree(oc, i, 0);
      const bx = i * TILE + TILE / 2;
      const byWorld = (ROWS - 1) * TILE + TILE / 2 + 8;
      if (!worldCircleHitsAnyPathRect(bx, byWorld, 36, pathClearanceRects)) drawTree(oc, i, ROWS - 1);
    }
    for (let i = 1; i < ROWS - 1; i++) { drawTree(oc, 0, i); drawTree(oc, COLS - 1, i); }
    const treeClusters: [number, number][] = [
      [5, 6], [11, 5], [18, 4], [26, 4], [33, 5], [38, 7],
      [4, 13], [39, 14], [4, 20], [39, 21],
      [8, 26], [15, 28], [24, 28], [31, 27], [37, 25],
      [7, 10], [22, 8], [32, 10], [16, 16], [28, 16], [12, 22], [34, 20],
      [6, 29], [20, 30], [40, 12], [29, 6],
    ];
    treeClusters.forEach(([tx, ty], i) => {
      drawTree(oc, tx, ty);
      const bx = tx * TILE + TILE / 2 + 26;
      const by = ty * TILE + TILE / 2 + 8;
      if (!worldCircleHitsAnyPathRect(bx, by, 24, pathClearanceRects)) {
        if (i % 2 === 0) drawBush(oc, bx, projY(by), 1);
        else {
          const ox = bx + 24;
          const oyWorld = ty * TILE + TILE / 2 + 26;
          if (!worldCircleHitsAnyPathRect(ox, oyWorld, 28, pathClearanceRects)) {
            drawTreeOffset(oc, ox, oyWorld);
          }
        }
      }
      const ubX = tx * TILE + 8;
      const ubY = ty * TILE + TILE - 4;
      if (!worldCircleHitsAnyPathRect(ubX, ubY, 18, pathClearanceRects)) {
        drawBush(oc, ubX, projY(ubY), 0.8);
      }
    });
    for (let ty = 5; ty <= ROWS - 6; ty += 4) {
      for (let tx = 4; tx <= COLS - 5; tx += 5) {
        if ((tx + ty * 13) % 7 === 0) continue;
        if (tileHash(tx, ty, 601) > 0.78) continue;
        const tcx = tx * TILE + TILE / 2;
        const tcy = ty * TILE + TILE / 2 + 8;
        if (worldCircleHitsAnyPathRect(tcx, tcy, 32, pathClearanceRects)) continue;
        drawTree(oc, tx, ty);
      }
    }

    // Lanterns along the avenue (corners + mid accents)
    const aveHalfBand = avenueBlendHalfThickness();
    const lanternPadR = 22;
    const yLanternN = streetY - aveHalfBand * 0.42;
    const yLanternS = streetY + aveHalfBand * 0.4;
    const yMidN = streetY - TILE * 0.35;
    const yMidS = streetY + TILE * 0.42;
    if (!worldCircleHitsAnyPathRect(aveLeft + 22, yLanternN, lanternPadR, pathClearanceRects)) {
      drawLantern(oc, aveLeft + 22, projY(yLanternN));
    }
    if (!worldCircleHitsAnyPathRect(aveRight - 22, yLanternN, lanternPadR, pathClearanceRects)) {
      drawLantern(oc, aveRight - 22, projY(yLanternN));
    }
    if (!worldCircleHitsAnyPathRect(aveLeft + 22, yLanternS, lanternPadR, pathClearanceRects)) {
      drawLantern(oc, aveLeft + 22, projY(yLanternS));
    }
    if (!worldCircleHitsAnyPathRect(aveRight - 22, yLanternS, lanternPadR, pathClearanceRects)) {
      drawLantern(oc, aveRight - 22, projY(yLanternS));
    }
    if (!worldCircleHitsAnyPathRect(midX - 26, yMidN, lanternPadR, pathClearanceRects)) {
      drawLantern(oc, midX - 26, projY(yMidN));
    }
    if (!worldCircleHitsAnyPathRect(midX + 26, yMidS, lanternPadR, pathClearanceRects)) {
      drawLantern(oc, midX + 26, projY(yMidS));
    }
    const bushPadR = 22;
    if (!worldCircleHitsAnyPathRect(aveLeft + 6, yMidN, bushPadR, pathClearanceRects)) {
      drawBush(oc, aveLeft + 6, projY(yMidN), 1);
    }
    if (!worldCircleHitsAnyPathRect(aveRight - 6, yMidN, bushPadR, pathClearanceRects)) {
      drawBush(oc, aveRight - 6, projY(yMidN), 1);
    }
    if (!worldCircleHitsAnyPathRect(aveLeft + 10, yMidS, bushPadR, pathClearanceRects)) {
      drawBush(oc, aveLeft + 10, projY(yMidS), 0.95);
    }
    if (!worldCircleHitsAnyPathRect(aveRight - 10, yMidS, bushPadR, pathClearanceRects)) {
      drawBush(oc, aveRight - 10, projY(yMidS), 0.95);
    }

    for (let k = 0, xw = aveLeft + 84; xw < aveRight - 66; xw += 206, k++) {
      const nx = xw + (k % 2) * 42;
      const nyN = decoNorthGrassY + (k % 3) * 6 - 4;
      if (!worldCircleHitsAnyPathRect(nx, nyN, 17, pathClearanceRects)) {
        drawLantern(oc, nx, projY(nyN));
      }
      const sx = xw + 102 + ((k + 1) % 3) * 28;
      const nyS = decoSouthGrassY - (k % 4) * 5 + 2;
      if (!worldCircleHitsAnyPathRect(sx, nyS, 17, pathClearanceRects)) {
        drawLantern(oc, sx, projY(nyS));
      }
    }
    for (let k = 0, xw = aveLeft + 48; xw < aveRight - 36; xw += 134, k++) {
      const bx = xw + (k % 3) * 20;
      if (!worldCircleHitsAnyPathRect(bx, decoNorthGrassY - 8, 19, pathClearanceRects)) {
        drawBush(oc, bx, projY(decoNorthGrassY - 8), 0.92);
      }
      const bx2 = xw + 58 + ((k + 2) % 4) * 14;
      if (!worldCircleHitsAnyPathRect(bx2, decoSouthGrassY + 10, 19, pathClearanceRects)) {
        drawBush(oc, bx2, projY(decoSouthGrassY + 10), 0.9);
      }
    }

    // 5) Townhall façade decorations — props sit between hall and avenue on each row
    for (const h of interiorHallKeys) {
      const c = hallHubCentroidByHall.get(h);
      if (!c) continue;
      const { cx, cy, southOfStreet } = c;
      const lanternYw = southOfStreet ? cy - 18 : cy - 20;
      const fbYw = southOfStreet ? cy - 36 : cy + 36;
      const bushYw = southOfStreet ? cy - 6 : cy - 4;
      if (!worldCircleHitsAnyPathRect(cx - HALL_W / 2 - 14, lanternYw, 20, pathClearanceRects)) {
        drawLantern(oc, cx - HALL_W / 2 - 14, projY(lanternYw));
      }
      if (!worldCircleHitsAnyPathRect(cx + HALL_W / 2 + 14, lanternYw, 20, pathClearanceRects)) {
        drawLantern(oc, cx + HALL_W / 2 + 14, projY(lanternYw));
      }
      oc.save();
      oc.scale(1, PROJ_Y);
      drawFlowerBedMaybeSprite(oc, cx, fbYw, 0, cx + cy * 3, pathClearanceRects);
      oc.restore();
      if (!worldCircleHitsAnyPathRect(cx - HALL_W / 2 - 22, bushYw, 22, pathClearanceRects)) {
        drawBush(oc, cx - HALL_W / 2 - 22, projY(bushYw), 1);
      }
      if (!worldCircleHitsAnyPathRect(cx + HALL_W / 2 + 22, bushYw, 22, pathClearanceRects)) {
        drawBush(oc, cx + HALL_W / 2 + 22, projY(bushYw), 1);
      }
    }

    const offForkHub = document.createElement("canvas");
    offForkHub.width = worldW;
    offForkHub.height = projectedWorldH;
    const ocf = offForkHub.getContext("2d")!;
    const hubGrassTheme = FEED_VISUAL_THEME.public;
    ocf.save();
    ocf.scale(1, PROJ_Y);
    for (let ty = 0; ty < ROWS; ty++)
      for (let tx = 0; tx < COLS; tx++) drawGrass(ocf, tx, ty, hubGrassTheme.grass);
    const fkPaint = forkHubLayout(worldW, worldH, streetY);
    for (const lx of fkPaint.laneLeftXs) {
      drawForkRoadStrip(ocf, lx, fkPaint.y0, fkPaint.stubW, fkPaint.stubH, hubGrassTheme.path);
    }
    ocf.restore();
    const forkTreeClearanceRects = forkHubWalkClearanceRects(worldW, worldH, streetY);
    /** Naturalistic fork forest: jitter, scale, thinning, paint south-on-top. */
    const treePadR = 24;
    const pines: { wx: number; wyWorld: number; scale: number; rot: number; alpha: number }[] = [];
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (forkCellHash01(tx, ty, 11) < 0.1) continue;
        const jitterX = (forkCellHash01(tx, ty, 2) - 0.5) * TILE * 0.62;
        const jitterY = (forkCellHash01(tx, ty, 3) - 0.5) * TILE * 0.55;
        const wx = tx * TILE + TILE / 2 + jitterX;
        const wyWorld = ty * TILE + TILE / 2 + 8 + jitterY;
        if (worldCircleHitsAnyPathRect(wx, wyWorld, treePadR, forkTreeClearanceRects)) continue;
        const scale = 0.86 + forkCellHash01(tx, ty, 4) * 0.28;
        const rot = (forkCellHash01(tx, ty, 5) - 0.5) * 0.17;
        const depth = forkCellHash01(tx, ty, 6);
        const alpha = 0.88 + depth * 0.12;
        pines.push({ wx, wyWorld, scale, rot, alpha });
      }
    }
    pines.sort((a, b) => a.wyWorld - b.wyWorld);
    for (const p of pines) {
      const groundY = Math.max(36, projY(p.wyWorld));
      drawForkForestPine(ocf, p.wx, groundY, p.scale, p.rot, p.alpha);
    }

    const villageReturnWorld = zones.length > 0 ? villageReturnToSageWorldRect(worldW, worldH) : null;

    // Pre-build one multi-group interior bitmap per hall + NPC layouts per zone index
    const roomCanvases = new Map<string | number, HTMLCanvasElement>();
    const roomNpcPos = new Map<number, [number, number][]>();

    for (const h of interiorHallKeys) {
      const hallZi = hallHubZoneIndices(zones, h);
      const dims = hallHubDimensions.get(h);
      if (!dims || hallZi.length === 0) continue;
      const { rw, rh } = dims;
      const theme = TOWNHALLS[h] ?? TOWNHALLS.general;
      const facade = theme.facade ?? "general";
      const opaque = loadInteriorBackdropLayout(facade, rw, rh);
      const floorRect = interiorFloorRect(rw, rh, opaque, facade);
      const rc = document.createElement("canvas");
      rc.width = rw; rc.height = rh;
      const rctx = rc.getContext("2d")!;
      drawHallHubRoomBitmap(rctx, rw, rh, zones, hallZi, theme, opaque, floorRect);
      roomCanvases.set(hallHubRoomKey(h), rc);
      const hubLayouts = computeHallHubNpcLayouts(zones, hallZi, rw, rh, floorRect, facade);
      for (const zi of hallZi) roomNpcPos.set(zi, hubLayouts.get(zi)!);
    }

    let last = 0;
    /** After exiting a townhall, ignore entrance triggers for this many frames (also offset player). */
    let townhallEnterCooldown = 0;
    let pendingNpc: number | null = null;
    let npcProximityTime = 0;
    /** Story character (first session / repeat greeting) dwell timer parallel to Mastodon proximity. */
    let pendingStorySpot: StorySpot | null = null;
    let storyProximityTime = 0;
    /** Frames with Mastodon bar/sheet up but player no longer in post proximity (walk-away collapse). */
    let leavePostHudFrames = 0;
    /** First-visit plaza: dwell inside a labelled corridor commits that feed source. */
    let forkGateProximityTime = 0;
    let pendingForkGate: ForkPathGate | null = null;
    /** Village south strip: dwell to return to fork hub / Sage. */
    let returnToSageProximityTime = 0;
    let pendingReturnToSage = false;
    /** Briefly ignore Sage-return dwell after landing in the village (fork or first load). */
    let sageReturnGatedFrames = startInForkHub ? 0 : 95;
    let expandSuppressed: number | null = null;
    const trail: { x: number; y: number; age: number }[] = [];
    let trailTimer = 0;

    const loop = (now: number) => {
      const dt  = Math.min((now - last) / 16.67, 3); last = now;
      if (townhallEnterCooldown > 0) townhallEnterCooldown = Math.max(0, townhallEnterCooldown - dt);
      if (sageReturnGatedFrames > 0) sageReturnGatedFrames--;
      const zoom = getOverworldCanvasZoom();
      const cw  = canvas.width / (dpr * zoom), ch = canvas.height / (dpr * zoom);
      const s   = state;
      const dayPhase = getDayPhase();

      // Apply happy trigger from React handlers
      if (triggerHappyRef.current !== null) {
        const idx = triggerHappyRef.current;
        if (s.npcs[idx]) s.npcs[idx].happyTimer = 90;
        triggerHappyRef.current = null;
      }

      // Chain reaction trigger
      if (chainTriggerRef.current !== null) {
        const { idx } = chainTriggerRef.current;
        const src = s.npcs[idx];
        if (src) {
          const chainRadius = 150 * (src.scale / S);
          let delay = 0;
          s.npcs.forEach((npc, i) => {
            if (i === idx) return;
            const d = Math.hypot(npc.x - src.x, npc.y - src.y);
            if (d < chainRadius) {
              delay += 8;
              npc.chainDelay = delay;
            }
          });
        }
        chainTriggerRef.current = null;
      }

      // Process chain delays
      s.npcs.forEach((npc) => {
        if (npc.chainDelay !== undefined && npc.chainDelay > 0) {
          npc.chainDelay -= dt;
          if (npc.chainDelay <= 0) {
            npc.happyTimer = 50;
            npc.chainDelay = undefined;
          }
        }
      });

      let dx = 0, dy = 0;
      let manualInput = false;
      if (s.keys["ArrowLeft"]  || s.keys["a"] || s.keys["A"]) { dx -= 1; s.facing = "left"; manualInput = true; }
      if (s.keys["ArrowRight"] || s.keys["d"] || s.keys["D"]) { dx += 1; s.facing = "right"; manualInput = true; }
      if (s.keys["ArrowUp"]    || s.keys["w"] || s.keys["W"]) { dy -= 1; s.facing = "up"; manualInput = true; }
      if (s.keys["ArrowDown"]  || s.keys["s"] || s.keys["S"]) { dy += 1; s.facing = "down"; manualInput = true; }

      const joy = joystickRef.current;
      if (Math.abs(joy.dx) > 0.08 || Math.abs(joy.dy) > 0.08) {
        dx += joy.dx; dy += joy.dy;
        if (Math.abs(joy.dx) > Math.abs(joy.dy)) s.facing = joy.dx > 0 ? "right" : "left";
        else s.facing = joy.dy > 0 ? "down" : "up";
        manualInput = true;
      }

      if (storyOpenRef.current) {
        dx = 0;
        dy = 0;
        s.walkTarget = null;
      }

      // Cancel auto-walk on manual input
      if (manualInput) s.walkTarget = null;

      // Auto-walk toward tapped NPC / story NPC
      if (s.walkTarget) {
        const wt = s.walkTarget;
        const tdx = wt.x - s.px;
        const tdy = wt.y - s.py;
        const tDist = Math.sqrt(tdx * tdx + tdy * tdy);
        let arrived = false;
        if (wt.kind === "post") {
          const npc = s.npcs[wt.npcIdx];
          const talkR = npc ? NEARBY_DIST * (npc.scale / S) * 0.6 : NEARBY_DIST * 0.6;
          arrived = tDist < talkR;
          if (arrived) {
            const idx = wt.npcIdx;
            nearbyNpcIdxRef.current = idx;
            setNearbyNpc(s.npcs[idx]);
            activeNpcRef.current = idx;
            setActiveNpc(idx);
            setPanelNpc(s.npcs[idx]);
          }
        } else {
          const spot = storySpotsRef.current.find((sp) => sp.charId === wt.charId);
          const talkR = spot ? spot.radius * 0.55 : NEARBY_DIST * 0.55;
          arrived = tDist < talkR;
        }
        if (arrived) s.walkTarget = null;
        else {
          dx = tdx / tDist;
          dy = tdy / tDist;
          if (Math.abs(dx) > Math.abs(dy)) s.facing = dx > 0 ? "right" : "left";
          else s.facing = dy > 0 ? "down" : "up";
        }
      }

      // Moving while expanded → collapse to bar (keyboard, joystick, or tap-to-walk).
      // Must run after walkTarget so tap navigation counts even when manualInput is false.
      if (activeNpcRef.current !== null && (manualInput || s.walkTarget != null)) {
        expandSuppressed = activeNpcRef.current;
        activeNpcRef.current = null;
        setActiveNpc(null);
      }

      // Handle transition (fade out → swap scene → fade in)
      if (s.transition !== 0) {
        if (s.transition > 0) {
          s.transition = Math.min(s.transition + dt * 4, 100);
          if (s.transition >= 100 && s.pendingScene) {
            // Swap scene — enter consolidated hall hub
            if (s.pendingScene.type === "townhall_hall_hub") {
              s.scene = s.pendingScene;
              const hh = s.pendingScene.hall;
              const dims = hallHubDimensions.get(hh) ?? { rw: ROOM_W, rh: ROOM_H };
              const { dh: hdh } = interiorDoorExtents(dims.rw, dims.rh);
              s.px = dims.rw / 2;
              /** Spawn deeper into the room so the player is not on top of the EXIT / NPC door band. */
              s.py = dims.rh - hdh - (hh === "art" ? 120 : 78);
              s.camera = { x: 0, y: 0 };
              for (const zi of hallHubZoneIndices(s.zones, hh)) {
                const positions = roomNpcPos.get(zi);
                if (!positions) continue;
                let pi = 0;
                s.npcs.forEach((npc) => {
                  if (npc.zoneIndex === zi && pi < positions.length) {
                    npc.x = positions[pi][0];
                    npc.y = positions[pi][1];
                    pi++;
                  }
                });
              }
            } else if (s.pendingScene.type === "overworld") {
              if (s.scene.type === "townhall_hall_hub") {
                const hh = s.scene.hall;
                for (const zi of hallHubZoneIndices(s.zones, hh)) {
                  const zone = s.zones[zi];
                  if (!zone) continue;
                  const positions = npcPositions(zone.cx, zone.cy, zone.posts.length);
                  let pi = 0;
                  s.npcs.forEach((npc) => {
                    if (npc.zoneIndex === zi && pi < positions.length) {
                      npc.x = positions[pi][0];
                      npc.y = positions[pi][1];
                      pi++;
                    }
                  });
                }
                const campus = hallHubCentroidByHall.get(hh) ?? {
                  cx: s.scene.savedPx,
                  cy: s.scene.savedPy,
                  southOfStreet: false,
                };
                const gateCy = campusDoorWorldY(campus);
                s.px = campus.cx;
                const offDoor = campus.southOfStreet ? -52 : 56;
                /** Step back onto the avenue (north of south façades / south of north façades). */
                const nudgeTowardStreet = campus.southOfStreet ? -48 : 48;
                s.py = Math.min(s.worldH - TILE, Math.max(TILE, campus.cy + offDoor));
                if (Math.abs(s.py - gateCy) < 30) {
                  s.py = Math.min(s.worldH - TILE, Math.max(TILE, gateCy + nudgeTowardStreet));
                }
                townhallEnterCooldown = 110;
              } else if (s.scene.type === "fork_hub" && s.pendingScene.fromForkHub) {
                const sy = avenueCenterWorldY(s.worldH);
                const sp = overworldSpawnNearSageReturnPath(s.worldW, s.worldH, sy);
                s.px = sp.px;
                s.py = sp.py;
                s.facing = "up";
                storySpotsRef.current = storySpotsVillageOnly;
                sageReturnGatedFrames = 95;
                forkPathsRef.current = [];
              }
              s.scene = { type: "overworld" };
            } else if (s.pendingScene.type === "fork_hub") {
              if (s.scene.type === "townhall_hall_hub") {
                const hh = s.scene.hall;
                for (const zi of hallHubZoneIndices(s.zones, hh)) {
                  const zone = s.zones[zi];
                  if (!zone) continue;
                  const positions = npcPositions(zone.cx, zone.cy, zone.posts.length);
                  let pi = 0;
                  s.npcs.forEach((npc) => {
                    if (npc.zoneIndex === zi && pi < positions.length) {
                      npc.x = positions[pi][0];
                      npc.y = positions[pi][1];
                      pi++;
                    }
                  });
                }
                townhallEnterCooldown = 110;
              }
              const fkHub = forkHubLayout(s.worldW, s.worldH, avenueCenterWorldY(s.worldH));
              s.px = fkHub.mid;
              s.py = fkHub.y0 + fkHub.stubH * 0.48;
              s.facing = "up";
              s.scene = { type: "fork_hub" };
              storySpotsRef.current = storySpotsForkHub;
              dismissedStoryCharIdRef.current = null;
              storyDismissedMustExitRef.current = false;
              forkPathsRef.current = computeForkGateRects(
                s.worldW,
                s.worldH,
                avenueCenterWorldY(s.worldH),
              );
            }
            s.pendingScene = null;
            s.transition = -100; // start fade-in
          }
        } else {
          s.transition = Math.min(s.transition + dt * 4, 0);
        }
        dx = 0; dy = 0;
      }

      s.moving = dx !== 0 || dy !== 0;
      if (s.moving) {
        const preMoveX = s.px, preMoveY = s.py;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (isTownhallInteriorScene(s.scene)) {
          const hubDims =
            hallHubDimensions.get((s.scene as { hall: string }).hall) ?? { rw: ROOM_W, rh: ROOM_H };
          const iw = hubDims.rw;
          const ih = hubDims.rh;
          s.px = Math.max(WALL_THICKNESS + 10, Math.min(iw - WALL_THICKNESS - 10, s.px + (dx / len) * SPEED * dt));
          s.py = Math.max(WALL_THICKNESS + 40, Math.min(ih - 4, s.py + (dy / len) * SPEED * dt));
        } else if (isForkHubScene(s.scene)) {
          const streetYHub = avenueCenterWorldY(s.worldH);
          const walkRects = forkHubWalkClearanceRects(s.worldW, s.worldH, streetYHub);
          const pr = TILE * 0.4;
          const stepX = (dx / len) * SPEED * dt;
          const stepY = (dy / len) * SPEED * dt;
          const prevPx = s.px;
          const prevPy = s.py;
          const inWalk = (x: number, y: number) => worldCircleHitsAnyPathRect(x, y, pr, walkRects);
          let npx = Math.max(TILE, Math.min(worldW - TILE, prevPx + stepX));
          let npy = Math.max(TILE, Math.min(worldH - TILE, prevPy + stepY));
          if (!inWalk(npx, npy)) {
            npx = Math.max(TILE, Math.min(worldW - TILE, prevPx + stepX));
            npy = prevPy;
            if (!inWalk(npx, npy)) {
              npx = prevPx;
              npy = Math.max(TILE, Math.min(worldH - TILE, prevPy + stepY));
              if (!inWalk(npx, npy)) {
                npx = prevPx;
                npy = prevPy;
              }
            }
          }
          s.px = npx;
          s.py = npy;
        } else {
          s.px = Math.max(TILE, Math.min(worldW - TILE, s.px + (dx / len) * SPEED * dt));
          s.py = Math.max(TILE, Math.min(worldH - TILE, s.py + (dy / len) * SPEED * dt));
        }
        // Footstep / walk animation / dust trail only when the player actually
        // moved — pushing against a wall or a stale held key must not keep them ticking.
        if (s.px !== preMoveX || s.py !== preMoveY) {
          s.animTimer += dt;
          if (s.animTimer > 6) { s.animFrame = (s.animFrame + 1) % 4; s.animTimer = 0; }
          SoundFx.walk();
          trailTimer += dt;
          if (trailTimer > 4) {
            trail.push({ x: s.px, y: s.py, age: 0 });
            if (trail.length > 20) trail.shift();
            trailTimer = 0;
          }
        }
      }

      // Door detection — enter hall hub from overworld (one façade per distinct hall key)
      if (s.scene.type === "overworld" && s.transition === 0 && townhallEnterCooldown <= 0) {
        let triggered = false;
        for (const h of interiorHallKeys) {
          const campus = hallHubCentroidByHall.get(h);
          const zi0 = hallHubZoneIndices(s.zones, h)[0];
          if (!campus || zi0 === undefined) continue;
          const doorCx = campus.cx;
          const doorCy = campusDoorWorldY(campus);
          const doorHalfW = campus.southOfStreet ? 30 : 28;
          if (Math.abs(s.px - doorCx) < doorHalfW && Math.abs(s.py - doorCy) < 26) {
            s.transition = 1;
            s.pendingScene = {
              type: "townhall_hall_hub",
              hall: h,
              savedPx: s.px,
              savedPy: s.py,
              entryZoneIndex: zi0,
            };
            triggered = true;
            break;
          }
        }
        if (triggered) {
          s.walkTarget = null;
          nearbyNpcIdxRef.current = null;
          setNearbyNpc(null);
          activeNpcRef.current = null;
          setActiveNpc(null);
        }
      }

      // Door detection — exit hall hub to overworld
      if (s.scene.type === "townhall_hall_hub" && s.transition === 0) {
        const hubDims =
          hallHubDimensions.get(s.scene.hall) ?? { rw: ROOM_W, rh: ROOM_H };
        const iw = hubDims.rw;
        const ih = hubDims.rh;
        const { dw: edw, dh: edh } = interiorDoorExtents(iw, ih);
        const exitCx = iw / 2;
        const nearCenterX = Math.abs(s.px - exitCx) < edw / 2 + 8;
        if (nearCenterX && s.py < edh + 32) {
          s.transition = 1;
          s.pendingScene = { type: "fork_hub" };
          s.walkTarget = null;
          nearbyNpcIdxRef.current = null;
          setNearbyNpc(null);
          activeNpcRef.current = null;
          setActiveNpc(null);
        } else if (nearCenterX && s.py > ih - edh - 8) {
          s.transition = 1;
          s.pendingScene = { type: "overworld" };
          s.walkTarget = null;
          nearbyNpcIdxRef.current = null;
          setNearbyNpc(null);
          activeNpcRef.current = null;
          setActiveNpc(null);
        }
      }
      for (let ti = trail.length - 1; ti >= 0; ti--) {
        trail[ti].age += dt;
        if (trail[ti].age > 40) trail.splice(ti, 1);
      }

      // ── NPC update: idle frame, react to player ────────────────────────────
      const inTownhallInterior = isTownhallInteriorScene(s.scene);
      const currentHallHubDimensions =
        inTownhallInterior && s.scene.type === "townhall_hall_hub"
          ? hallHubDimensions.get(s.scene.hall) ?? { rw: ROOM_W, rh: ROOM_H }
          : null;
      s.npcs.forEach((npc, i) => {
        const npcVisible = inTownhallInterior
          ? npcBelongsToCurrentInterior(s, npc.zoneIndex)
          : npcShownOnOverworld(s.zones, npc.zoneIndex);
        if (!npcVisible) return;

        npc.idleFrame = Math.floor(now / 900 + i * 250) % 2;

        const distToPlayer = Math.hypot(npc.x - s.px, npc.y - s.py);
        const talkRadius   = NEARBY_DIST * 0.4 * (npc.scale / S);

        if (distToPlayer < talkRadius) {
          npc.waving = true;
          npc.waveTimer = (npc.waveTimer + dt) % 60;
          const pdx = s.px - npc.x, pdy = s.py - npc.y;
          if (Math.abs(pdx) > Math.abs(pdy)) npc.npcFacing = pdx > 0 ? "right" : "left";
          else npc.npcFacing = pdy > 0 ? "down" : "up";
        } else {
          npc.waving = false;
        }

        if (npc.happyTimer > 0) npc.happyTimer -= dt;

        // Emote bubbles
        if (npc.emoteTimer > 0) {
          npc.emoteTimer -= dt;
          if (npc.emoteTimer <= 0) npc.emote = undefined;
        } else {
          npc.emoteNext -= dt;
          if (npc.emoteNext <= 0) {
            const EMOTES = ["\uD83D\uDCAD", "...", "!", "?", "\uD83D\uDCAC", "\u2728", "\uD83D\uDE0A", "\uD83E\uDD14", "\uD83D\uDC4B", "\uD83D\uDCA1"];
            npc.emote = EMOTES[Math.floor(Math.random() * EMOTES.length)];
            npc.emoteTimer = 80 + Math.random() * 40;
            npc.emoteNext = 300 + Math.random() * 500;
          }
        }
      });

      // ── Nearby detection: Mastodon post NPCs vs story characters (same band; closer wins, tie → story) ──
      let nearest: number | null = null;
      let nearestDist = Infinity;
      s.npcs.forEach((npc, i) => {
        if (inTownhallInterior && !npcBelongsToCurrentInterior(s, npc.zoneIndex)) return;
        if (!inTownhallInterior && !npcShownOnOverworld(s.zones, npc.zoneIndex)) return;
        const d = Math.hypot(npc.x - s.px, npc.y - s.py);
        if (d < NEARBY_DIST * (npc.scale / S) && d < nearestDist) {
          nearest = i;
          nearestDist = d;
        }
      });
      if (nearest === dismissedNpcRef.current) {
        nearest = null;
      } else if (dismissedNpcRef.current !== null && nearest !== dismissedNpcRef.current) {
        dismissedNpcRef.current = null;
      }

      let nearestStory: StorySpot | null = null;
      let nearestStoryDist = Infinity;
      if (!inTownhallInterior) {
        for (const spot of storySpotsRef.current) {
          const d = Math.hypot(spot.worldX - s.px, spot.worldY - s.py);
          if (d < spot.radius && d < nearestStoryDist) {
            nearestStoryDist = d;
            nearestStory = spot;
          }
        }
      }
      if (dismissedStoryCharIdRef.current !== null) {
        if (storyDismissedMustExitRef.current) {
          // Player just closed the dialog — keep suppressed until they physically leave the radius.
          const dismissedSpot = storySpotsRef.current.find((sp) => sp.charId === dismissedStoryCharIdRef.current);
          const stillInside = dismissedSpot
            ? Math.hypot(dismissedSpot.worldX - s.px, dismissedSpot.worldY - s.py) < dismissedSpot.radius
            : false;
          if (stillInside) {
            nearestStory = null;
          } else {
            storyDismissedMustExitRef.current = false;
            dismissedStoryCharIdRef.current = null;
          }
        } else if (nearestStory?.charId === dismissedStoryCharIdRef.current) {
          nearestStory = null;
        } else if (nearestStory !== null) {
          dismissedStoryCharIdRef.current = null;
        }
      }

      const storyWins =
        nearestStory !== null &&
        (nearest === null || nearestStoryDist <= nearestDist);
      const postWins = nearest !== null && !storyWins;

      s.talkingTo = postWins && nearest !== null ? nearest : null;

      const DWELL_EXPAND = 120;

      if (!storyWins) {
        storyProximityTime = 0;
        pendingStorySpot = null;
      } else if (!storyOpenRef.current) {
        if (nearestStory !== pendingStorySpot) {
          pendingStorySpot = nearestStory;
          storyProximityTime = 0;
        } else {
          storyProximityTime++;
        }
        if (
          storyProximityTime >= DWELL_EXPAND &&
          pendingStorySpot !== null
        ) {
          setStoryOverlayCharId(pendingStorySpot.charId);
          setStoryOverlayOpen(true);
          SoundFx.talk();
          storyProximityTime = 0;
        }
      } else {
        storyProximityTime = 0;
      }

      if (storyWins) {
        npcProximityTime = 0;
        pendingNpc = null;
        if (nearbyNpcIdxRef.current !== null) {
          nearbyNpcIdxRef.current = null;
          setNearbyNpc(null);
        }
        if (activeNpcRef.current !== null) {
          activeNpcRef.current = null;
          setActiveNpc(null);
        }
      }

      if (postWins) {
        if (nearest !== pendingNpc) {
          pendingNpc = nearest;
          npcProximityTime = 0;
          if (nearest !== expandSuppressed) expandSuppressed = null;
        } else {
          npcProximityTime++;
        }

        if (npcProximityTime >= 6 && pendingNpc !== nearbyNpcIdxRef.current) {
          nearbyNpcIdxRef.current = pendingNpc;
          setNearbyNpc(pendingNpc !== null ? s.npcs[pendingNpc] : null);
        }

        if (
          npcProximityTime >= DWELL_EXPAND &&
          pendingNpc !== null &&
          activeNpcRef.current === null &&
          expandSuppressed !== pendingNpc
        ) {
          activeNpcRef.current = pendingNpc;
          setActiveNpc(pendingNpc);
          setPanelNpc(s.npcs[pendingNpc]);
        }
      } else if (!storyWins) {
        npcProximityTime = 0;
        pendingNpc = null;
      }

      // Walk away from a post while the bottom bar / expanded sheet is still up
      const mastodonHudUp =
        nearbyNpcIdxRef.current !== null || activeNpcRef.current !== null;
      if (!postWins && mastodonHudUp && !storyWins) {
        leavePostHudFrames++;
      } else {
        leavePostHudFrames = 0;
      }
      if (leavePostHudFrames >= 6) {
        expandSuppressed = null;
        if (nearbyNpcIdxRef.current !== null) {
          nearbyNpcIdxRef.current = null;
          setNearbyNpc(null);
        }
        if (activeNpcRef.current !== null) {
          activeNpcRef.current = null;
          setActiveNpc(null);
        }
        leavePostHudFrames = 0;
      }

      if (
        !inTownhallInterior &&
        s.transition === 0 &&
        isForkHubScene(s.scene) &&
        forkPathsRef.current.length > 0 &&
        !storyOpenRef.current
      ) {
        if (feedGatewayBusyRef.current) {
          forkGateProximityTime = 0;
          pendingForkGate = null;
        } else {
          const gates = forkPathsRef.current;
          let insideFork: ForkPathGate | null = null;
          for (const g of gates) {
            if (s.px >= g.left && s.px <= g.right && s.py >= g.top && s.py <= g.bottom) {
              insideFork = g;
              break;
            }
          }
          const FORK_DWELL = 16;
          if (!insideFork) {
            forkGateProximityTime = 0;
            pendingForkGate = null;
          } else if (s.zones.length > 0 && insideFork.feed === feedSource) {
            /** Already on this feed — re-enter village (same dwell as new feed, no refetch). */
            if (insideFork !== pendingForkGate) {
              pendingForkGate = insideFork;
              forkGateProximityTime = 0;
            } else {
              forkGateProximityTime++;
              if (forkGateProximityTime >= FORK_DWELL) {
                forkGateProximityTime = 0;
                pendingForkGate = null;
                s.transition = 1;
                s.pendingScene = { type: "overworld", fromForkHub: true };
                s.walkTarget = null;
                nearbyNpcIdxRef.current = null;
                setNearbyNpc(null);
                activeNpcRef.current = null;
                setActiveNpc(null);
              }
            }
          } else if (insideFork !== pendingForkGate) {
            pendingForkGate = insideFork;
            forkGateProximityTime = 0;
          } else {
            forkGateProximityTime++;
            if (forkGateProximityTime >= FORK_DWELL) {
              forkGateProximityTime = 0;
              if (insideFork.feed === "home" && !hasTokenGameRef.current) openLoginPromptRef.current();
              else forkCommitRef.current(insideFork.feed);
            }
          }
        }
      }

      if (
        !inTownhallInterior &&
        s.scene.type === "overworld" &&
        s.transition === 0 &&
        villageReturnWorld &&
        s.zones.length > 0 &&
        !storyOpenRef.current &&
        !feedGatewayBusyRef.current &&
        sageReturnGatedFrames <= 0
      ) {
        const r = villageReturnWorld;
        const insideReturn =
          s.px >= r.left && s.px <= r.right && s.py >= r.top && s.py <= r.bottom;
        const RET_DWELL = 88;
        if (!insideReturn) {
          returnToSageProximityTime = 0;
          pendingReturnToSage = false;
        } else if (!pendingReturnToSage) {
          pendingReturnToSage = true;
          returnToSageProximityTime = 0;
        } else {
          returnToSageProximityTime++;
          if (returnToSageProximityTime >= RET_DWELL) {
            returnToSageProximityTime = 0;
            pendingReturnToSage = false;
            s.transition = 1;
            s.pendingScene = { type: "fork_hub" };
            s.walkTarget = null;
            nearbyNpcIdxRef.current = null;
            setNearbyNpc(null);
            activeNpcRef.current = null;
            setActiveNpc(null);
            // Checkpoint scores to localStorage on Sage return (only count uncommitted posts)
            const uncommitted = new Set([...visitedRef.current].filter((id) => !countedPostIdsRef.current.has(id)));
            const total = mergeCounts(savedHallCountsRef.current, deriveHallCounts(s.zones, uncommitted));
            try { localStorage.setItem(SCORES_KEY, JSON.stringify(total)); } catch { /* ignore */ }
            setSavedHallCounts(total);
            const newCounted = new Set([...countedPostIdsRef.current, ...visitedRef.current]);
            try { localStorage.setItem(COUNTED_POSTS_KEY, JSON.stringify([...newCounted])); } catch { /* ignore */ }
            setCountedPostIds(newCounted);
            const { newLevels, shouldFetch } = checkMilestones(total);
            if (newLevels > 0) {
              setLevel(prev => prev + newLevels);
              setLevelGained(newLevels);
            }
            if (shouldFetch) {
              pendingTitleCountsRef.current = total;
              setPendingTitleAnalysis(true);
            }
            // Persist checkpoint to Firestore (fire-and-forget)
            const checkpointMilestones: Record<string, number[]> =
              (() => { try { return JSON.parse(localStorage.getItem(MILESTONES_KEY) ?? "{}"); } catch { return {}; } })();
            void fetch("/api/user/profile", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                hallCounts: total,
                earnedTitle: earnedTitleRef.current,
                milestones: checkpointMilestones,
              }),
            });
          }
        }
      }

      // ── Camera ──────────────────────────────────────────────────────────────
      // Overworld is rendered with a vertical squash (PROJ_Y), so the camera
      // target/clamp must use projected world height. Interiors stay flat.
      const interiorWNow = currentHallHubDimensions?.rw ?? ROOM_W;
      const interiorHNow = currentHallHubDimensions?.rh ?? ROOM_H;
      const curWorldW = inTownhallInterior ? interiorWNow : worldW;
      const curWorldH = inTownhallInterior ? interiorHNow : Math.ceil(worldH * PROJ_Y);
      const projPlayerY = inTownhallInterior ? s.py : s.py * PROJ_Y;
      const tcx = s.px - cw / 2, tcy = projPlayerY - ch / 2;
      s.camera.x += (tcx - s.camera.x) * 0.12 * dt;
      s.camera.y += (tcy - s.camera.y) * 0.12 * dt;
      s.camera.x = Math.max(0, Math.min(Math.max(0, curWorldW - cw), s.camera.x));
      s.camera.y = Math.max(0, Math.min(Math.max(0, curWorldH - ch), s.camera.y));
      // Camera shake
      let shakeX = 0, shakeY = 0;
      if (shakeRef.current > 0) {
        const intensity = shakeRef.current * 0.35;
        shakeX = (Math.random() - 0.5) * intensity;
        shakeY = (Math.random() - 0.5) * intensity;
        shakeRef.current -= dt;
      }
      // If viewport is larger than current world/room, center the whole scene.
      // This must affect ALL draws (background, NPCs, player, labels), so we
      // fold it into camX/camY instead of offsetting only one layer.
      const sceneOffsetX = Math.max(0, (cw - curWorldW) / 2);
      const sceneOffsetY = Math.max(0, (ch - curWorldH) / 2);
      const camX = Math.round(s.camera.x + shakeX - sceneOffsetX);
      const camY = Math.round(s.camera.y + shakeY - sceneOffsetY);
      // Y-projection factor for the current scene: overworld is dimetric, interiors are flat.
      const PY = inTownhallInterior ? 1 : PROJ_Y;

      ctx.clearRect(0, 0, cw, ch);

      // ── Render based on scene ──────────────────────────────────────────────
      if (!inTownhallInterior) {
        const forkLetterbox =
          isForkHubScene(s.scene) && forkPathsRef.current.length > 0;
        ctx.fillStyle = forkLetterbox ? "#58564f" : owTheme.grass.base;
        ctx.fillRect(0, 0, cw, ch);
      }
      if (inTownhallInterior && s.scene.type === "townhall_hall_hub") {
        const hh = s.scene.hall;
        const th = TOWNHALLS[hh] ?? TOWNHALLS.general;
        ctx.fillStyle = th.floorColor;
        ctx.fillRect(0, 0, cw, ch);
        const roomCanvas = roomCanvases.get(hallHubRoomKey(hh));
        if (roomCanvas) ctx.drawImage(roomCanvas, -camX, -camY);
      } else {
        ctx.drawImage(isForkHubScene(s.scene) ? offForkHub : offVillage, -camX, -camY);

        // Plaza façades only on the village map — post NPCs are drawn inside halls.
        if (s.scene.type === "overworld") {
          for (const h of interiorHallKeys) {
            const campus = hallHubCentroidByHall.get(h);
            if (!campus) continue;
            const zi0 = hallHubZoneIndices(s.zones, h)[0] ?? 0;
            const czx = campus.cx - camX;
            const czy = campus.cy * PROJ_Y - camY;
            const palette0 = ZONE_PALETTE[zi0 % ZONE_PALETTE.length];
            const theme = TOWNHALLS[h] ?? TOWNHALLS.general;
            const facadeLabel =
              h === "tech"
                ? "Tech Hub"
                : theme.name;
            drawTownhall(ctx, czx, czy, facadeLabel, theme, palette0, dayPhase.isNight, campus.southOfStreet);
          }
        }

        if (forkPathsRef.current.length > 0 && s.talkingTo === null && isForkHubScene(s.scene)) {
          const sy = avenueCenterWorldY(worldH);
          const fk = forkHubLayout(worldW, worldH, sy);
          const titles = ["Home", "Public", "Trending"] as const;
          const signZoneIdx = [1, 5, 2];
          ctx.save();
          ctx.font = "bold 13px monospace";
          const maxTextW = Math.max(72, fk.stubW * 0.92);
          fk.laneLeftXs.forEach((lx, i) => {
            const cx = lx + fk.stubW / 2;
            const raw = titles[i] ?? titles[1];
            const label = truncateBannerLabel(raw, ctx, maxTextW);
            const zi = signZoneIdx[i] ?? 1;
            const paletteSign = ZONE_PALETTE[zi % ZONE_PALETTE.length].sign;
            const screenX = cx - camX;
            const screenY = (fk.y0 + TILE * 0.58) * PY - camY;
            drawSignboard(ctx, screenX, screenY, label, paletteSign, false);
          });
          ctx.restore();
        }

        if (s.scene.type === "overworld" && villageReturnWorld && s.zones.length > 0 && s.talkingTo === null) {
          const r = villageReturnWorld;
          const lx = (r.left + r.right) / 2 - camX;
          const ly = r.top * PY - camY - 6;
          ctx.save();
          ctx.font = "bold 10px monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillText("TO SAGE / FEEDS", lx + 1, ly + 1);
          ctx.fillStyle = "rgba(255,228,150,0.95)";
          ctx.fillText("TO SAGE / FEEDS", lx, ly);
          ctx.textAlign = "left";
          ctx.restore();
        }

        // Topic zone overlays / ambient particles intentionally omitted here.
      }

      // Player trail
      ctx.save();
      for (const t of trail) {
        const tx = t.x - camX, ty = t.y * PY - camY;
        const alpha = Math.max(0, 0.25 * (1 - t.age / 40));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = inTownhallInterior ? "#666" : "#a0856a";
        ctx.fillRect(tx - 1.5, ty + 2, 3, 2);
        ctx.fillRect(tx + 2, ty + 4, 3, 2);
      }
      ctx.restore();

      // Heart particles
      const hearts = heartParticlesRef.current;
      ctx.save();
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      for (let hi = hearts.length - 1; hi >= 0; hi--) {
        const h = hearts[hi];
        h.y += h.vy * dt;
        h.x += Math.sin(h.age / 8) * 0.3;
        h.age += dt;
        if (h.age > h.maxAge) { hearts.splice(hi, 1); continue; }
        const hx = h.x - camX, hy = h.y * PY - camY;
        const fade = h.age < 8 ? h.age / 8 : Math.max(0, (h.maxAge - h.age) / 15);
        ctx.globalAlpha = fade * 0.85;
        ctx.fillStyle = "#ff6ec7";
        ctx.fillText("\u2665", hx, hy);
      }
      ctx.textAlign = "left";
      ctx.restore();

      // ── Entities (NPCs + player) ──────────────────────────────────────────
      const entities: { y: number; draw: () => void }[] = [];
      s.npcs.forEach((npc, i) => {
        if (inTownhallInterior && !npcBelongsToCurrentInterior(s, npc.zoneIndex)) return;
        if (!inTownhallInterior && !npcShownOnOverworld(s.zones, npc.zoneIndex)) return;

        const sx = npc.x - camX, sy = npc.y * PY - camY;
        if (sx < -80 || sx > cw + 80 || sy < -80 || sy > ch + 80) return;
        const talking = s.talkingTo === i;
        const palette = ZONE_PALETTE[npc.zoneIndex % ZONE_PALETTE.length];
        const iframe  = npc.idleFrame ?? 0;
        const sc      = npc.scale;
        entities.push({ y: npc.y, draw: () => {
          // Popularity glow ring
          if (sc >= S * 2) {
            const glowR = 14 * sc;
            const nightBoost = dayPhase.isNight ? 0.12 : 0;
            const pulse = 0.15 + nightBoost + 0.08 * Math.sin(now / 500 + i);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = palette.border;
            ctx.lineWidth   = 3 * (sc / S);
            ctx.beginPath();
            ctx.arc(sx, sy - 8 * sc, glowR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          if (talking) {
            ctx.save(); ctx.globalAlpha = 0.2 + 0.08 * Math.sin(now / 200);
            ctx.fillStyle = palette.bg; ctx.beginPath();
            ctx.arc(sx, sy - 16, 28 * (sc / S), 0, Math.PI * 2); ctx.fill(); ctx.restore();
          }

          // Unvisited "!" indicator
          if (!visitedRef.current.has(npc.post.id)) {
            const bounce = Math.sin(now / 400 + i * 0.7) * 3;
            ctx.save();
            ctx.fillStyle = "#ffd700";
            ctx.font = "bold 14px monospace";
            ctx.textAlign = "center";
            ctx.fillText("!", sx, sy - 44 * sc + bounce);
            ctx.restore();
          }

          // Username label
          const dxLabel = s.px - npc.x, dyLabel = s.py - npc.y;
          const distToPlayer = Math.sqrt(dxLabel * dxLabel + dyLabel * dyLabel);
          const LABEL_DIST = 300;
          if (distToPlayer < LABEL_DIST || talking) {
            const labelOff = 42 * sc;
            const nameLabel = npc.post.authorName || npc.post.authorHandle || "\uD83D\uDC18";
            ctx.font = "bold 11px monospace";
            const nameLabelW = ctx.measureText(nameLabel).width;
            const labelAlpha = talking ? 0.85 : Math.max(0.2, 1 - distToPlayer / LABEL_DIST);
            ctx.fillStyle = `rgba(0,0,0,${(0.6 * labelAlpha).toFixed(2)})`;
            ctx.beginPath();
            ctx.roundRect(sx - nameLabelW / 2 - 5, sy - labelOff - 3, nameLabelW + 10, 16, 3);
            ctx.fill();
            ctx.fillStyle = `rgba(255,255,255,${labelAlpha.toFixed(2)})`; ctx.textAlign = "center";
            ctx.fillText(nameLabel, sx, sy - labelOff + 10);
            ctx.textAlign = "left";
          }

          const bobOffset = npc.happyTimer > 0
            ? -Math.abs(Math.sin(((90 - npc.happyTimer) / 90) * Math.PI * 6)) * 9 * (npc.happyTimer / 90)
            : 0;

          drawCharacter(ctx, sx, sy + bobOffset, palette.bg, palette.sign, iframe, false, npc.npcFacing, sc, npc.waving, npc.look);

          // Happy celebration particles
          if (npc.happyTimer > 0) {
            const prog  = npc.happyTimer / 90;
            const r     = (1 - prog) * 28 + 6;
            ctx.save();
            ctx.globalAlpha = prog * 0.9;
            for (let k = 0; k < 5; k++) {
              const a = (k / 5) * Math.PI * 2 + now / 180;
              const px2 = sx + Math.cos(a) * r;
              const py2 = sy + bobOffset - 16 * sc + Math.sin(a) * r * 0.7;
              ctx.fillStyle = k % 2 === 0 ? "#ffd700" : "#ff6ec7";
              ctx.fillRect(px2 - 2, py2 - 2, 4, 4);
            }
            ctx.globalAlpha = prog;
            ctx.fillStyle = "#ff6ec7";
            ctx.font = `${Math.round(8 * prog + 8)}px monospace`;
            ctx.textAlign = "center";
            ctx.fillText("\u2665", sx, sy + bobOffset - 26 * sc - (1 - prog) * 10);
            ctx.textAlign = "left";
            ctx.restore();
          }

          // Emote bubble
          if (npc.emote && npc.emoteTimer > 0) {
            const fadeIn  = Math.min(1, (80 + 40 - npc.emoteTimer) / 10);
            const fadeOut = Math.min(1, npc.emoteTimer / 10);
            const alpha   = Math.min(fadeIn, fadeOut);
            const ey = sy - 30 * sc - 8 + Math.sin(now / 300 + i) * 2;
            ctx.save();
            ctx.globalAlpha = alpha * 0.85;
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            ctx.beginPath();
            ctx.roundRect(sx - 10, ey - 10, 20, 18, 6);
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            ctx.beginPath();
            ctx.arc(sx + 4, ey + 10, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(sx + 7, ey + 15, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = alpha;
            ctx.font = npc.emote.length > 1 ? "bold 8px monospace" : "11px sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "#333";
            ctx.fillText(npc.emote, sx, ey + 4);
            ctx.textAlign = "left";
            ctx.restore();
          }
        }});
      });
      if (!inTownhallInterior) {
        for (const spot of storySpotsRef.current) {
          const sx = spot.worldX - camX;
          const sy = spot.worldY * PY - camY;
          if (sx < -160 || sx > cw + 160 || sy < -200 || sy > ch + 160) continue;
          const neutralSpec = STORY_SPRITES[spot.def.spriteNeutral];
          const nameLabel = spot.def.displayName;
          entities.push({
            y: spot.worldY,
            draw: () => {

              if (!drawSprite(ctx, neutralSpec, sx, sy)) {
                ctx.save();
                ctx.fillStyle = "#8b7355";
                ctx.fillRect(sx - 8, sy - 28, 16, 28);
                ctx.restore();
              }
              const dxL = s.px - spot.worldX;
              const dyL = s.py - spot.worldY;
              const distToPlayer = Math.sqrt(dxL * dxL + dyL * dyL);
              const inBand = distToPlayer < spot.radius;
              if (inBand) {
                ctx.save();
                ctx.globalAlpha = 0.82;
                const spriteTopY = sy - neutralSpec.anchor.y;
                const bubbleH = 18;
                const bubbleGap = 12;
                const bubbleTop = spriteTopY - bubbleGap - bubbleH;
                ctx.fillStyle = "rgba(255,255,255,0.92)";
                ctx.beginPath();
                ctx.roundRect(sx - 10, bubbleTop, 20, bubbleH, 6);
                ctx.fill();
                ctx.fillStyle = "#333";
                ctx.font = "11px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("\u2026", sx, bubbleTop + bubbleH / 2);
                ctx.textBaseline = "alphabetic";
                ctx.textAlign = "left";
                ctx.restore();
              }
              const LABEL_DIST = 320;
              if (distToPlayer < LABEL_DIST || inBand) {
                const labelOff = 46;
                ctx.font = "bold 11px monospace";
                const nameLabelW = ctx.measureText(nameLabel).width;
                const labelAlpha = inBand ? 0.9 : Math.max(0.25, 1 - distToPlayer / LABEL_DIST);
                ctx.fillStyle = `rgba(0,0,0,${(0.58 * labelAlpha).toFixed(2)})`;
                ctx.beginPath();
                ctx.roundRect(sx - nameLabelW / 2 - 6, sy - labelOff - 3, nameLabelW + 12, 16, 3);
                ctx.fill();
                ctx.fillStyle = `rgba(255,250,220,${labelAlpha.toFixed(2)})`;
                ctx.textAlign = "center";
                ctx.fillText(nameLabel, sx, sy - labelOff + 10);
                ctx.textAlign = "left";
              }
            },
          });
        }
      }
      entities.push({ y: s.py, draw: () => {
        drawCharacter(ctx, s.px - camX, s.py * PY - camY, "#e74c3c", "#c0392b", s.moving ? s.animFrame : 0, true, s.facing);
      }});
      entities.sort((a, b) => a.y - b.y).forEach((e) => e.draw());

      

      

      // ── Day/night overlay ──────────────────────────────────────────────────
      if (dayPhase.alpha > 0) {
        ctx.save();
        ctx.fillStyle = dayPhase.tint;
        ctx.globalAlpha = dayPhase.alpha;
        ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
      }
      if (dayPhase.isNight) {
        drawNightStars(ctx, cw, ch, now);
      }

      // ── Transition fade overlay ────────────────────────────────────────────
      if (s.transition !== 0) {
        const fadeAlpha = Math.abs(s.transition) / 100;
        ctx.save();
        ctx.fillStyle = "#000";
        ctx.globalAlpha = fadeAlpha;
        ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
      }

      const gatewayOv = feedGatewayOverlayRef.current;
      if (gatewayOv && feedGatewayBusyRef.current) {
        ctx.save();
        ctx.fillStyle = "rgba(5,8,14,0.9)";
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = "#e4e6ff";
        ctx.font = "bold 15px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`Entering ${gatewayOv.label}…`, cw / 2, ch / 2 - 10);
        ctx.fillStyle = "#7a7a90";
        ctx.font = "12px monospace";
        ctx.fillText("Loading timeline & villages", cw / 2, ch / 2 + 16);
        ctx.textAlign = "left";
        ctx.restore();
      }

      // ── HUD ────────────────────────────────────────────────────────────────
      if (s.talkingTo === null) {
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(0, ch - 36, cw, 36);
        ctx.fillStyle = "#ffd700"; ctx.font = "bold 12px monospace";
        if (inTownhallInterior && s.scene.type === "townhall_hall_hub") {
          const zn = hallHubZoneIndices(s.zones, s.scene.hall).length;
          const tname = (TOWNHALLS[s.scene.hall] ?? TOWNHALLS.general).name;
          const tip = `${tname} — ${zn} group${zn === 1 ? "" : "s"} • Top: Back to Sage / feed gates — Bottom: Exit to village`;
          ctx.fillText(tip, 12, ch - 12);
        } else if (isForkHubScene(s.scene) && forkPathsRef.current.length > 0) {
          ctx.fillStyle = "#ffe8a8";
          ctx.fillText(
            "Stand at a path (Home / Public / Trending) to enter the village — Home needs Mastodon login",
            12,
            ch - 12,
          );
          ctx.fillStyle = "#ffd700";
        } else if (s.scene.type === "overworld" && s.zones.length > 0) {
          ctx.fillText(
            `${FEED_VISUAL_THEME[feedSource].chromeLabel}: WASD / joystick \u2022 South-centre path: return to Sage / switch feeds \u2022 Halls: top door`,
            12,
            ch - 12,
          );
        } else {
          ctx.fillText(
            `${FEED_VISUAL_THEME[feedSource].chromeLabel}: WASD / joystick \u2022 Walk to a hall for clustered posts`,
            12,
            ch - 12,
          );
        }

      }

      frameRef.current = requestAnimationFrame(loop);
    };

    frameRef.current = requestAnimationFrame(loop);

    const onVisChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(frameRef.current);
        SoundFx.mute();
      } else {
        last = performance.now();
        frameRef.current = requestAnimationFrame(loop);
        if (!muted) SoundFx.unmute();
      }
    };
    document.addEventListener("visibilitychange", onVisChange);

    return () => {
      cancelAnimationFrame(frameRef.current);
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerup", onCanvasTap);
    };
  }, [load, tilesReady, feedSource, feedForkPending, isLoggedIn]);

  // ── Loading / error states ──────────────────────────────────────────────────
  if (load.status === "loading") {
    return (
      <FeedLoadingScreen
        subtitle={mastodonInfo ? `${mastodonInfo.timeline} timeline · ${mastodonInfo.instance}` : undefined}
      />
    );
  }
  if (load.status === "error") {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#1a1a2e", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
        <div style={{ color: "#ff6060", fontFamily: "monospace", fontSize: 16 }}>⚠ Could not fetch Mastodon posts</div>
        <div style={{ color: "#888", fontFamily: "monospace", fontSize: 12, textAlign: "center", maxWidth: 400 }}>{load.msg}</div>
        <button
          onClick={() => fetchClusters(false)}
          style={{ marginTop: 12, padding: "8px 20px", background: "#6364ff", color: "#fff", border: "none", fontFamily: "monospace", fontSize: 13, cursor: "pointer", borderRadius: 4 }}
        >
          Try again
        </button>
      </div>
    );
  }

  const sheetNpc = nearbyNpc ?? panelNpc;
  const storyOverlayDef =
    storyOverlayCharId !== null ? STORY_CHARACTER_DEFS[storyOverlayCharId] ?? null : null;
  let storyIntroSeenThisSession = false;
  try {
    storyIntroSeenThisSession =
      Boolean(storyOverlayDef && sessionStorage.getItem(storyOverlayDef.sessionIntroKey));
  } catch {
    storyIntroSeenThisSession = false;
  }
  const storyOverlayLines: string[] =
    pendingTitleAnalysis && storyOverlayDef
      ? storyOverlayDef.analysisLines
      : storyIntroSeenThisSession && storyOverlayDef
        ? storyOverlayDef.repeatLines
        : storyOverlayDef?.firstSessionLines ?? [];
  const postId = sheetNpc?.post.id ?? "";
  const totalNpcs = load.npcs.length;
  const visitedCount = load.npcs.filter((n) => visited.has(n.post.id)).length;

  const mastodonLoginFormInner = (
    <>
      <span style={{ color: "#aaa", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
        Your Mastodon instance:
      </span>
      <input
        value={instanceInput}
        onChange={(e) => setInstanceInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const inst = instanceInput.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
            if (inst) window.location.href = `/api/auth/mastodon/begin?instance=${encodeURIComponent(inst)}`;
          }
        }}
        placeholder="fosstodon.org"
        style={{
          padding: "10px 12px", background: "#1a1a2e", border: "1px solid #6364ff",
          color: "#ddd", fontFamily: "ui-monospace, monospace", fontSize: 13, borderRadius: 4,
          outline: "none", width: "100%", boxSizing: "border-box" as const,
        }}
      />
      <button
        type="button"
        onClick={() => {
          const inst = instanceInput.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
          if (inst) window.location.href = `/api/auth/mastodon/begin?instance=${encodeURIComponent(inst)}`;
        }}
        style={{
          padding: "12px 0", background: "#6364ff", color: "#fff",
          border: "none", borderRadius: 4, fontFamily: "ui-monospace, monospace", fontSize: 13,
          cursor: "pointer", width: "100%",
        }}
      >
        Connect →
      </button>
      <span style={{ color: "#555", fontFamily: "ui-monospace, monospace", fontSize: 10, lineHeight: 1.4 }}>
        You&apos;ll be redirected to your instance to approve access.
      </span>
    </>
  );

  const mobileMenuTop = "calc(env(safe-area-inset-top, 0px) + 48px)";

  if (authUser === null || !authUser.loggedIn) {
    return (
      <div style={{
        width: "100vw", height: "100dvh", background: "#0d0d14",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          background: "rgba(10,14,22,0.97)", border: "1px solid #6364ff",
          borderRadius: 8, padding: "32px 28px", maxWidth: 360, width: "calc(100% - 48px)",
          display: "flex", flexDirection: "column", gap: 16,
        }}>
          <div style={{ textAlign: "center", color: "#c0c0d8", marginBottom: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>8bit World</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
              {authUser === null ? "Loading…" : "Connect Mastodon to enter the world"}
            </div>
          </div>
          {authUser !== null && mastodonLoginFormInner}
          <SupportLink variant="wall" />
        </div>
      </div>
    );
  }

  const forkHubBlockingUi =
    load.status === "ready" && load.zones.length === 0 && feedForkPending;
  const outerScreenFilter =
    load.status !== "ready"
      ? "none"
      : FEED_VISUAL_THEME[forkHubBlockingUi ? "public" : feedSource].cssFilter;

  return (
    <div style={{
      width: "100vw",
      height: "100dvh",
      background: "#000",
      overflow: "hidden",
      position: "relative",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      filter: outerScreenFilter,
      transition: "filter 0.35s ease",
    }}>
      {/* Header — slim row; wide ≥640px = full controls, narrow = brand + ☰ drawer */}
      <style>{`
        .bf-topbar {
          position: absolute; top: 0; left: 0; right: 0; z-index: 10;
          background: rgba(0,0,0,0.9);
          border-bottom: 1px solid rgba(99,100,255,0.5);
          padding-top: max(4px, env(safe-area-inset-top, 0px));
          padding-left: max(8px, env(safe-area-inset-left, 0px));
          padding-right: max(8px, env(safe-area-inset-right, 0px));
          padding-bottom: 5px;
        }
        .bf-topbar-inner {
          display: flex; align-items: center; gap: 6px; flex-wrap: nowrap;
          min-height: 36px; max-width: 100%;
        }
        .bf-topbar-inner.bf-topbar-inner--narrow {
          justify-content: space-between;
        }
        .bf-topbar-inner > * { flex-shrink: 0; }
        .bf-topbar-source {
          color: #7a7a8a; font-family: ui-monospace, monospace; font-size: 10px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          max-width: min(160px, 22vw); min-width: 0;
        }
        .bf-topbar-user { max-width: min(140px, 28vw); }
        @media (max-width: 520px) {
          .bf-topbar-source { display: none; }
          .bf-topbar-user { max-width: 88px; }
        }
        @media (max-width: 380px) {
          .bf-topbar-disc { font-size: 10px !important; padding-left: 6px !important; padding-right: 6px !important; }
        }
      `}</style>
      <div className="bf-topbar">
        <div className={`bf-topbar-inner${narrowTopbar ? " bf-topbar-inner--narrow" : ""}`} style={{ position: "relative" }}>
          <span style={{ color: "#a0a0ff", fontFamily: "ui-monospace, monospace", fontWeight: "bold", fontSize: 12, letterSpacing: "-0.02em" }}>Vikalp.Social</span>
          <span style={{
            color: visitedCount === totalNpcs ? "#4ecdc4" : "#8a8a9a",
            fontFamily: "ui-monospace, monospace", fontSize: 11,
          }} title={totalNpcs ? `${visitedCount} of ${totalNpcs} posts visited` : ""}>
            {visitedCount}/{totalNpcs}
          </span>
          {!narrowTopbar && <span className="bf-topbar-source" title={load.source}>{load.source}</span>}

          {!narrowTopbar && (
            <>
              <button
                type="button"
                onClick={() => { const m = SoundFx.toggleMute(); setMuted(m); }}
                title={muted ? "Unmute sounds" : "Mute sounds"}
                style={{
                  width: 36, height: 36, padding: 0, border: "1px solid #3a3a48",
                  background: muted ? "#2a2a30" : "#1e1e26",
                  color: muted ? "#666" : "#c0c0c8",
                  borderRadius: 6, fontSize: 15, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {muted ? "🔇" : "🔊"}
              </button>

              {!forkHubBlockingUi && (
              <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #3a3a48" }}>
                {(["home", "public", "trending"] as const).map((src) => (
                  <button
                    type="button"
                    key={src}
                    onClick={() => {
                      if (src === feedSource) return;
                      if (src === "home" && !hasToken) {
                        setLoginPromptOpen(true);
                        return;
                      }
                      setFeedSource(src);
                      persistFeedSource(src);
                      setFeedForkPending(false);
                      fetchClusters(true, src);
                    }}
                    title={src === "home" && !hasToken ? "Connect Mastodon for home" : FEED_VISUAL_THEME[src].chromeLabel}
                    style={{
                      padding: "6px 8px", border: "none", minHeight: 36,
                      background: feedSource === src ? FEED_VISUAL_THEME[src].chromeAccent : "#1a1a22",
                      color: feedSource === src ? "#0f0f14" : "#9a9aa8",
                      fontFamily: "ui-monospace, monospace", fontSize: 10, fontWeight: 600,
                      cursor: feedSource === src ? "default" : "pointer",
                    }}
                  >
                    {FEED_VISUAL_THEME[src].chromeLabel}
                  </button>
                ))}
              </div>
              )}

              <button
                type="button"
                onClick={() => {
                  if (refreshing) return;
                  setRefreshing(true);
                  fetchClusters(true)?.finally(() => setRefreshing(false));
                }}
                style={{
                  padding: "6px 12px", minHeight: 36,
                  background: refreshing ? "#2a2a30" : "#6364ff",
                  color: refreshing ? "#666" : "#fff",
                  border: "none", borderRadius: 6,
                  fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 600,
                  cursor: refreshing ? "default" : "pointer",
                }}
              >
                {refreshing ? "…" : "refresh"}
              </button>

              <span style={{ flex: 1, minWidth: 4 }} />

              <SupportLink variant="bar" />

              {isLoggedIn && authUser && authUser.loggedIn ? (
                <>
                  <img
                    src={authUser.avatar}
                    alt=""
                    style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid #6364ff" }}
                  />
                  <span
                    className="bf-topbar-user"
                    style={{ color: "#b0b0bc", fontFamily: "ui-monospace, monospace", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={`@${authUser.username}@${authUser.instance}`}
                  >
                    @{authUser.username}@{authUser.instance}
                  </span>
                  <button
                    type="button"
                    className="bf-topbar-disc"
                    onClick={() => {
                      fetch("/api/auth/logout", { method: "POST", credentials: "include" })
                        .then((r) => {
                          if (!r.ok) return;
                          setAuthUser({ loggedIn: false });
                          fetch("/api/mastodon/info", { credentials: "include" })
                            .then((ir) => ir.ok ? ir.json() : null)
                            .then((d) => { if (d) setMastodonInfo(d as MastodonInfo); })
                            .catch(() => {});
                          const nextFeed: ClusterFeedSource = feedSource === "home" ? "public" : feedSource;
                          if (feedSource === "home") {
                            persistFeedSource("public");
                            setFeedSource("public");
                          }
                          void fetchClusters(true, nextFeed);
                        })
                        .catch(() => {});
                    }}
                    style={{
                      padding: "6px 10px", minHeight: 36, background: "rgba(255,80,80,0.12)",
                      border: "1px solid rgba(255,80,80,0.35)", color: "#e8a0a0",
                      borderRadius: 6, fontFamily: "ui-monospace, monospace", fontSize: 11, cursor: "pointer",
                    }}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setLoginPromptOpen((v) => !v)}
                    style={{
                      padding: "6px 12px", minHeight: 36,
                      background: loginPromptOpen ? "#2a2a5a" : "rgba(99,100,255,0.12)",
                      border: "1px solid #6364ff", color: "#a0a0ff",
                      borderRadius: 6, fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Connect
                  </button>

                  {loginPromptOpen && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", right: 0,
                      background: "rgba(10,14,22,0.97)", border: "1px solid #6364ff",
                      borderRadius: 6, padding: "12px 14px", minWidth: 240,
                      boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
                      display: "flex", flexDirection: "column", gap: 8,
                      zIndex: 20,
                    }}>
                      {mastodonLoginFormInner}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {narrowTopbar && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              aria-controls="bf-mobile-drawer"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              style={{
                width: 40, height: 36, padding: 0, border: "1px solid #3a3a48",
                background: mobileMenuOpen ? "#2a2a48" : "#1e1e26",
                borderRadius: 6, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 5, width: 18 }}>
                <span style={{ height: 2, background: "#d0d0d8", borderRadius: 1 }} />
                <span style={{ height: 2, background: "#d0d0d8", borderRadius: 1 }} />
                <span style={{ height: 2, background: "#d0d0d8", borderRadius: 1 }} />
              </span>
            </button>
          )}
        </div>
      </div>

      {narrowTopbar && mobileMenuOpen && (
        <>
          {/* Outside .bf-topbar so stacking can sit above the game canvas */}
          <div
            role="presentation"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: "fixed", left: 0, right: 0, bottom: 0,
              top: mobileMenuTop,
              background: "rgba(0,0,0,0.55)", zIndex: 40,
            }}
          />
          <div
            id="bf-mobile-drawer"
            role="dialog"
            aria-label="Menu"
            style={{
              position: "fixed", left: 0, right: 0, top: mobileMenuTop,
              maxHeight: "min(88dvh, 520px)",
              overflowY: "auto",
              zIndex: 50,
              background: "rgba(10,12,20,0.98)",
              borderBottom: "1px solid rgba(99,100,255,0.45)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
              padding: "14px max(14px, env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left))",
              display: "flex", flexDirection: "column", gap: 12,
            }}
          >
            <div style={{ color: "#888", fontFamily: "ui-monospace, monospace", fontSize: 11, lineHeight: 1.4 }}>
              {load.source}
            </div>

            <button
              type="button"
              onClick={() => { const m = SoundFx.toggleMute(); setMuted(m); }}
              style={{
                minHeight: 44, padding: "0 14px", border: "1px solid #3a3a48",
                background: muted ? "#2a2a30" : "#1e1e26", color: "#e0e0e8",
                borderRadius: 8, fontFamily: "ui-monospace, monospace", fontSize: 13,
                cursor: "pointer", textAlign: "left" as const,
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              {muted ? "🔇 Unmute sound" : "🔊 Mute sound"}
            </button>

            {!forkHubBlockingUi && (
            <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #3a3a48" }}>
              {(["home", "public", "trending"] as const).map((src) => (
                <button
                  type="button"
                  key={src}
                  onClick={() => {
                    if (src === feedSource) return;
                    if (src === "home" && !hasToken) {
                      setLoginPromptOpen(true);
                      setMobileMenuOpen(false);
                      return;
                    }
                    setFeedSource(src);
                    persistFeedSource(src);
                    setFeedForkPending(false);
                    fetchClusters(true, src);
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    flex: 1, padding: "12px 6px", border: "none", minHeight: 44,
                    background: feedSource === src ? FEED_VISUAL_THEME[src].chromeAccent : "#1a1a22",
                    color: feedSource === src ? "#0f0f14" : "#9a9aa8",
                    fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 600,
                    cursor: feedSource === src ? "default" : "pointer",
                  }}
                >
                  {FEED_VISUAL_THEME[src].chromeLabel}
                </button>
              ))}
            </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (refreshing) return;
                setRefreshing(true);
                fetchClusters(true)?.finally(() => { setRefreshing(false); setMobileMenuOpen(false); });
              }}
              style={{
                minHeight: 44, padding: "0 14px",
                background: refreshing ? "#2a2a30" : "#6364ff",
                color: refreshing ? "#888" : "#fff",
                border: "none", borderRadius: 8,
                fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 600,
                cursor: refreshing ? "default" : "pointer",
              }}
            >
              {refreshing ? "Refreshing…" : "Refresh feed"}
            </button>

            <SupportLink variant="drawer" />

            {isLoggedIn && authUser && authUser.loggedIn ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4, borderTop: "1px solid #2a2a38" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <img src={authUser.avatar} alt="" style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #6364ff" }} />
                  <span style={{ color: "#c8c8d0", fontFamily: "ui-monospace, monospace", fontSize: 12, wordBreak: "break-all" as const }}>
                    @{authUser.username}@{authUser.instance}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    fetch("/api/auth/logout", { method: "POST", credentials: "include" })
                      .then((r) => {
                        if (!r.ok) return;
                        setAuthUser({ loggedIn: false });
                        fetch("/api/mastodon/info", { credentials: "include" })
                          .then((ir) => ir.ok ? ir.json() : null)
                          .then((d) => { if (d) setMastodonInfo(d as MastodonInfo); })
                          .catch(() => {});
                        const nextFeedLogout: ClusterFeedSource = feedSource === "home" ? "public" : feedSource;
                        if (feedSource === "home") {
                          persistFeedSource("public");
                          setFeedSource("public");
                        }
                        void fetchClusters(true, nextFeedLogout);
                        setMobileMenuOpen(false);
                      })
                      .catch(() => {});
                  }}
                  style={{
                    minHeight: 44, background: "rgba(255,80,80,0.12)",
                    border: "1px solid rgba(255,80,80,0.35)", color: "#f0a0a0",
                    borderRadius: 8, fontFamily: "ui-monospace, monospace", fontSize: 13, cursor: "pointer",
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4, borderTop: "1px solid #2a2a38" }}>
                <button
                  type="button"
                  onClick={() => setLoginPromptOpen((v) => !v)}
                  style={{
                    minHeight: 44, background: loginPromptOpen ? "#2a2a5a" : "rgba(99,100,255,0.12)",
                    border: "1px solid #6364ff", color: "#a0a0ff",
                    borderRadius: 8, fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {loginPromptOpen ? "Hide connect form" : "Connect Mastodon"}
                </button>
                {loginPromptOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {mastodonLoginFormInner}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated", touchAction: "manipulation" }} />

      {feedGatewayBusy && (
        <FeedLoadingScreen
          subtitle={`${feedGatewayBusy.label.toLowerCase()} timeline${mastodonInfo ? ` · ${mastodonInfo.instance}` : ""}`}
        />
      )}

      <RadarChart
        hallCounts={totalHallCounts}
        earnedTitle={earnedTitle}
        level={level}
        titleFetching={titleFetching}
        visible={load.status === "ready" && !feedForkPending && nearbyNpc === null && activeNpc === null && !storyOverlayOpen}
        expanded={radarExpanded}
        onExpand={() => setRadarExpanded(true)}
        onClose={() => setRadarExpanded(false)}
      />

      {/* {(storyOverlayCharId === "motherFlora" || floraComposeOpen) && (
        <FloraTreeBackground postsMade={postsMade} posts={floraPosts} />
      )} */}

      {showTitlePopup && earnedTitle && (
        <TitleAwardPopup
          title={earnedTitle.title}
          description={earnedTitle.description}
          level={level}
          levelUp={levelGained}
          onDismiss={() => { setShowTitlePopup(false); setLevelGained(0); }}
        />
      )}

      {/* {floraComposeOpen && hasToken && (
        <FloraComposeOverlay
          postsMade={postsMade}
          onPost={async (content) => {
            try {
              const res = await fetch("/api/mastodon/compose", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
              });
              if (res.ok) {
                const n = parseInt(localStorage.getItem(POSTS_MADE_KEY) ?? "0", 10) + 1;
                localStorage.setItem(POSTS_MADE_KEY, String(n));
                setPostsMade(n);
              }
              return res.ok;
            } catch {
              return false;
            }
          }}
          onSkip={() => setFloraComposeOpen(false)}
        />
      )} */}

      {storyOverlayDef && (
        <StoryDialogOverlay
          open={storyOverlayOpen}
          title={storyOverlayDef.displayName}
          lines={storyOverlayLines}
          portraitNeutralSrc={storySpritePublicUrl(storySpriteSpec(storyOverlayDef.spriteNeutral).file)}
          portraitHappySrc={storySpritePublicUrl(storySpriteSpec(storyOverlayDef.spriteHappy).file)}
          repeatSessionGreeting={storyIntroSeenThisSession}
          onCompleteIntro={handleStoryIntroComplete}
          onClose={handleCloseStoryOverlay}
          transparentBackdrop={false}
        />
      )}

      <BottomSheet
        npc={nearbyNpc ?? panelNpc}
        visible={!storyOverlayOpen && (nearbyNpc !== null || activeNpc !== null)}
        expanded={activeNpc !== null}
        hasToken={hasToken}
        comments={comments}
        commentsLoading={commentsLoading}
        onFavourite={handleFavourite}
        onBoost={handleBoost}
        favourited={Boolean(favourited[postId])}
        boosted={Boolean(boosted[postId])}
        localLikes={localLikes[postId] ?? sheetNpc?.post.likes ?? 0}
        localReposts={localReposts[postId] ?? sheetNpc?.post.reposts ?? 0}
        authUser={authUser}
        sheetAuthorFollowing={sheetAuthorFollowing}
        sheetFollowBusy={sheetFollowBusy}
        onToggleFollowAuthor={handleToggleFollowAuthor}
        onReply={handleReply}
        onExpand={handleExpandBar}
        onClose={handleCloseModal}
      />

      <VirtualJoystick joystickRef={joystickRef} />

      {showOnboarding && (
        <div
          onClick={() => { setShowOnboarding(false); localStorage.setItem("onboarding-seen", "1"); }}
          style={{
            position: "absolute", inset: 0, zIndex: 60,
            background: "rgba(0,0,0,0.75)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 24, padding: 32, color: "#fff", fontFamily: "monospace",
            animation: "fadeIn 0.3s ease-out",
          }}>
          <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
          <div style={{ fontSize: 28, textShadow: "0 0 20px #6364ff" }}>Welcome to Vikalp.Social</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 14, lineHeight: 1.6, maxWidth: 340, textAlign: "center" }}>
            <div>🕹️ Use the <b>joystick</b> or <b>WASD / arrow keys</b> to move</div>
            <div>👤 Walk near characters to read their posts</div>
            <div>♥ Tap <b>favourite</b> or <b>boost</b> to interact</div>
            <div>✕ Tap <b>X</b> or walk away to close encounters</div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowOnboarding(false); localStorage.setItem("onboarding-seen", "1"); }}
            style={{
              padding: "12px 32px", minHeight: 48,
              background: "#6364ff", border: "none", borderRadius: 8,
              color: "#fff", fontFamily: "monospace", fontSize: 16, fontWeight: "bold",
              cursor: "pointer",
            }}
          >Got it!</button>
        </div>
      )}
    </div>
  );
}
