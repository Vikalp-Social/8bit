// Tile loader — loads sprite PNGs from /tiles/<file> at game start and exposes
// a synchronous getter for the renderer. Missing files are ok: the game falls
// back to its procedural drawings, so you can drop tiles in incrementally.

import { ALL_TILES, type TileSpec } from "./tileManifest";

export interface LoadedTile {
  img: HTMLImageElement;
  spec: TileSpec;
}

const cache = new Map<string, LoadedTile>();

/** Vite `base` (e.g. `/8bit-feed/`); must match static URLs under `public/`. */
function tilesBase(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return b.endsWith("/") ? b : `${b}/`;
}

function loadOne(spec: TileSpec): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = `${tilesBase()}tiles/${spec.file}`;
    img.onload  = () => { cache.set(spec.file, { img, spec }); resolve(); };
    img.onerror = () => {
      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.warn(`[tiles] missing or failed: ${url}`);
      resolve();
    };
    img.src = url;
  });
}

/** In-flight / completed load so concurrent callers (e.g. React Strict Mode) share one run. */
let loadPromise: Promise<void> | null = null;

/** Load every tile in the manifest. Resolves once all attempts are settled. */
export async function loadAllTiles(): Promise<void> {
  if (!loadPromise) {
    loadPromise = Promise.all(ALL_TILES.map(loadOne)).then(() => {
      // eslint-disable-next-line no-console
      console.log(`[tiles] loaded ${cache.size}/${ALL_TILES.length} sprites`);
    });
  }
  return loadPromise;
}

/** Synchronous accessor used in the render loop. Returns null if the tile is not loaded. */
export function getTile(spec: TileSpec): LoadedTile | null {
  return cache.get(spec.file) ?? null;
}

/**
 * Draw a sprite at a world ground point (wx, wy). Aligns the sprite's anchor
 * to that point, so the sprite "stands on" the ground. Returns true if the
 * sprite was drawn, false if it was missing (caller should fall back).
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  spec: TileSpec,
  wx: number,
  wy: number,
): boolean {
  const tile = getTile(spec);
  if (!tile) return false;
  const dx = Math.round(wx - spec.anchor.x);
  const dy = Math.round(wy - spec.anchor.y);
  // Always render at manifest size so oversized source PNGs don't blow up in-game.
  ctx.drawImage(tile.img, dx, dy, spec.size.w, spec.size.h);
  return true;
}

/** Repeatedly draw a tileable ground sprite to fill a rectangle. */
export function tileSprite(
  ctx: CanvasRenderingContext2D,
  spec: TileSpec,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const tile = getTile(spec);
  if (!tile) return false;
  const tw = spec.size.w, th = spec.size.h;
  for (let py = 0; py < h; py += th) {
    for (let px = 0; px < w; px += tw) {
      ctx.drawImage(tile.img, x + px, y + py, tw, th);
    }
  }
  return true;
}
