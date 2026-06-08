// Tile manifest — single source of truth for every PNG sprite the game can use.
//
// Drop PNGs into `public/tiles/<filename>.png` matching the filenames below and
// refresh the page. Anything missing falls back to the procedural canvas
// drawing, so the game keeps working at every step.
//
// Coordinate convention:
//   - `size`: pixel dimensions of the source PNG.
//   - `anchor`: where in the sprite the "ground point" is, in pixels measured
//     from the top-left of the sprite. For a tree this is the base of the
//     trunk; for a building it is the bottom-center of the front door; for an
//     NPC it is the feet. The renderer aligns this point to the world (x, y).

export interface TileSpec {
  /** Filename inside `public/tiles/`. */
  file: string;
  /** Sprite size in pixels. */
  size: { w: number; h: number };
  /** Ground anchor point, in pixels from the sprite's top-left. */
  anchor: { x: number; y: number };
  /** Notes for the artist. Not used at runtime. */
  notes?: string;
}

// ─── Ground tiles ──
// Overworld grass and dirt paths are drawn procedurally in `BitFeedGame` (older look).
// Optional PNGs under `public/tiles/ground/` are not wired in the loader today.

export const GROUND_TILES = {} as const satisfies Record<string, TileSpec>;

// ─── Object sprites (drawn on top of the ground at a specific world point) ──
// Anchor = ground point on the sprite. Trees stand on their trunk, buildings
// on the bottom-center of the front door, NPCs on their feet.

export const OBJECT_SPRITES = {
  tree:        { file: "objects/tree_alt_pine.png", size: { w: 48,  h: 64 },  anchor: { x: 24, y: 60 }, notes: "Trunk base centered, foliage above" },
  bush:        { file: "objects/bush.png",      size: { w: 32,  h: 24 },  anchor: { x: 16, y: 22 } },
  flowerBed:   { file: "objects/flower_bed.png",size: { w: 220, h: 110 }, anchor: { x: 110, y: 108 }, notes: "Wide bed; upscaled draw for prominent plaza décor" },
  fence:       { file: "objects/fence.png",     size: { w: 48,  h: 16 },  anchor: { x: 24, y: 14 }, notes: "Tiles seamlessly side-to-side; one segment" },
  lantern:     { file: "objects/lantern.png",   size: { w: 16,  h: 32 },  anchor: { x: 8,  y: 30 } },
} as const satisfies Record<string, TileSpec>;

// ─── Story / quest NPCs (overworld portraits; source art often large — scaled at draw) ──
export const STORY_SPRITES = {
  sage: {
    file: "characters/sage.png",
    size: { w: 96, h: 96 },
    anchor: { x: 48, y: 91 },
    notes: "Source 2048²; scaled draw; feet near bottom-center",
  },
  sageHappy: {
    file: "characters/sage_happy.png",
    size: { w: 96, h: 96 },
    anchor: { x: 48, y: 91 },
    notes: "Same layout as sage neutral",
  },
  // motherFlora: {
  //   file: "characters/mother_flora.png",
  //   size: { w: 96, h: 96 },
  //   anchor: { x: 48, y: 91 },
  //   notes: "Source 1024²; scaled draw; feet near bottom-center",
  // },
  // motherFloraHappy: {
  //   file: "characters/mother_flora.png",
  //   size: { w: 96, h: 96 },
  //   anchor: { x: 48, y: 91 },
  //   notes: "No separate happy variant — reuses neutral sprite",
  // },
} as const satisfies Record<string, TileSpec>;

// ─── Interior backdrops (full-room images) ───────────────────────────────────
export const INTERIOR_BACKDROPS = {
  general:  { file: "interiors/general/backdrops/general_room.png", size: { w: 2560, h: 1080 }, anchor: { x: 0, y: 0 } },
  tech:     { file: "interiors/tech/backdrops/tech_room_multi.png", size: { w: 2560, h: 1080 }, anchor: { x: 0, y: 0 } },
  politics: { file: "interiors/politics/backdrops/politics_room.png", size: { w: 2560, h: 1080 }, anchor: { x: 0, y: 0 } },
  art:      { file: "interiors/art/backdrops/art_room.png", size: { w: 5504, h: 3072 }, anchor: { x: 0, y: 0 }, notes: "Full-room gallery; hub canvas scales to rw×rh" },
  science:  { file: "interiors/science/backdrop/science_room.png", size: { w: 2560, h: 1080 }, anchor: { x: 0, y: 0 } },
  music:    { file: "interiors/music/backdrops/music_room.png", size: { w: 2560, h: 1080 }, anchor: { x: 0, y: 0 } },
  gaming:   { file: "interiors/gaming/backdrops/gaming_room.png", size: { w: 5504, h: 3072 }, anchor: { x: 0, y: 0 }, notes: "Full-room arcade; actual asset 5504×3072 — hub canvas scales to rw×rh" },
  nature:   { file: "interiors/nature/backdrops/nature_room.png", size: { w: 4232, h: 2362 }, anchor: { x: 0, y: 0 }, notes: "Lodge interior; hub canvas scales to rw×rh" },
} as const satisfies Record<string, TileSpec>;

// ─── Building sprites — one per townhall theme ──
// The whole building is one PNG with the door at the bottom-center as the
// anchor. Recommended canvas: 192×160 px (the world size we currently render).
// Draw at GBA dimetric perspective: roof viewed from above-and-front, slim
// right-side strip, front face with door+windows, ground shadow at bottom.

export const BUILDING_SPRITES = {
  general:  { file: "buildings/general.png",  size: { w: 192, h: 160 }, anchor: { x: 96, y: 156 }, notes: "Cozy red-roof cottage" },
  tech:     { file: "buildings/tech.png",     size: { w: 192, h: 160 }, anchor: { x: 96, y: 156 }, notes: "Silver Tech Center, glowing blue glass entrance" },
  politics: { file: "buildings/politics.png", size: { w: 192, h: 160 }, anchor: { x: 96, y: 156 }, notes: "Stone town hall with columns and clock" },
  art:      { file: "buildings/art.png",      size: { w: 192, h: 160 }, anchor: { x: 96, y: 156 }, notes: "Pink-roof gallery with big display window" },
  nature:   { file: "buildings/nature.png",   size: { w: 192, h: 160 }, anchor: { x: 96, y: 156 }, notes: "Log lodge with green roof and chimney smoke" },
  science:  { file: "buildings/science.png",  size: { w: 192, h: 160 }, anchor: { x: 96, y: 156 }, notes: "Lab with rooftop dome and telescope" },
  gaming:   { file: "buildings/gaming.png",   size: { w: 192, h: 160 }, anchor: { x: 96, y: 156 }, notes: "Dark arcade with neon zigzag canopy" },
  music:    { file: "buildings/music.png",    size: { w: 192, h: 160 }, anchor: { x: 96, y: 156 }, notes: "Purple music hall with arched window and gold marquee" },
} as const satisfies Record<string, TileSpec>;

// ─── All assets flattened, for the loader ──
export const ALL_TILES: TileSpec[] = [
  ...(Object.values(GROUND_TILES) as TileSpec[]),
  ...Object.values(OBJECT_SPRITES),
  ...Object.values(STORY_SPRITES),
  ...Object.values(BUILDING_SPRITES),
  ...Object.values(INTERIOR_BACKDROPS),
];
