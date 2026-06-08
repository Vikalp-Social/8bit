import type { TileSpec } from "./tileManifest";
import { STORY_SPRITES } from "./tileManifest";

export type StoryPlacement =
  | {
      mode: "avenue_lane";
      lane: "west" | "east";
      offsetX?: number;
      offsetY?: number;
    }
  | {
      mode: "fork_plaza";
      offsetX?: number;
      /** Extra world Y south (+) / north (−) from resolved fork baseline. */
      offsetY?: number;
    }
  | {
      mode: "village_south";
      /** X offset from world horizontal centre (negative = west). */
      offsetX?: number;
      /** Y offset from world bottom edge (negative = above bottom). */
      offsetY?: number;
    };

/** Data-only definition; runtime resolves x,y using world geometry. */
export interface StoryCharacterDefinition {
  id: string;
  displayName: string;
  /** Manifest sprite keys — must exist on `STORY_SPRITES`. */
  spriteNeutral: keyof typeof STORY_SPRITES;
  spriteHappy: keyof typeof STORY_SPRITES;
  placement: StoryPlacement;
  /** Which game scenes this character appears in. */
  scenes: ("fork_hub" | "overworld")[];
  /** sessionStorage key: after first dialogue completion in this session, use repeatLines. */
  sessionIntroKey: string;
  /** Pokémon-style multi-page introduction (shown once per browser session tab). */
  firstSessionLines: string[];
  /** Short lines after intro was seen this session. */
  repeatLines: string[];
  /** Lines shown during a special analysis moment (Sage: reading title; Flora: post count). */
  analysisLines: string[];
  /** Proximity radius (world px) matching feel of NEARBY_DIST for NPCs. */
  interactRadius: number;
}

export const STORY_CHARACTER_DEFS: Record<string, StoryCharacterDefinition> = {
  sage: {
    id: "sage",
    displayName: "The Sage",
    spriteNeutral: "sage",
    spriteHappy: "sageHappy",
    placement: { mode: "fork_plaza", offsetX: 0, offsetY: 0 },
    scenes: ["fork_hub"],
    sessionIntroKey: "story-intro-sage-v1",
    firstSessionLines: [
      "Welcome, traveler — before you lies 8bit World, but first you must choose a road.",
      "The left gate leads Home: voices you already follow… but only if your soul is linked to the federation.",
      "The centre path is the Public square — everyone's voice. The right path gathers what's Trending.",
      "Step through the mud that calls to you — then roam the halls and read what speaks to you!",
    ],
    repeatLines: [
      "Three roads diverged—and you walked yours. Wander the halls; wisdom hides in ordinary posts.",
      "Farewell—for now!",
    ],
    analysisLines: [
      "Ah, traveler! You carry the scent of many halls upon you — I sense you have gathered new knowledge.",
      "Let me divine the shape of your reading soul… the topics you have touched, the ideas you have absorbed.",
      "The oracle speaks. A title has been bestowed upon you — look to the stars above for your name.",
    ],
    interactRadius: 56,
  },
  // motherFlora: {
  //   id: "motherFlora",
  //   displayName: "Mother Flora",
  //   spriteNeutral: "motherFlora",
  //   spriteHappy: "motherFloraHappy",
  //   placement: { mode: "fork_plaza", offsetX: 48 * 3.5, offsetY: 0 },
  //   scenes: ["fork_hub"],
  //   sessionIntroKey: "story-intro-flora-v1",
  //   firstSessionLines: [
  //     "Ah — a traveler with a voice! Words are seeds, dear one.",
  //     "Each thought you share with the world becomes a leaf upon my tree.",
  //     "Shall we plant one together? Speak your heart into the Fediverse.",
  //   ],
  //   repeatLines: [
  //     "The tree remembers every word you've offered. Another leaf today?",
  //   ],
  //   analysisLines: [
  //     "Your words have nourished this tree well.",
  //     "Every post is a leaf — and every leaf finds its place in the canopy.",
  //   ],
  //   interactRadius: 56,
  // },
};

export type StorySpot = {
  charId: string;
  worldX: number;
  worldY: number;
  radius: number;
  def: StoryCharacterDefinition;
};

/** Place story characters once world + fork geometry are known. */
export function buildStoryWorldSpots(opts: {
  worldW: number;
  worldH: number;
  streetY: number;
  aveLeft: number;
  aveRight: number;
  tile: number;
  /** Centre X of plaza / fork hub (typically worldW / 2). */
  forkPlazaMidX: number;
  /** Ground Y where the Sage stands (feet anchor) on the fork plaza. */
  forkPlazaWorldY: number;
  /** Which scene is active — characters not in this scene are omitted. */
  activeScene: "fork_hub" | "overworld";
}): StorySpot[] {
  const TILE_SZ = opts.tile;
  const out: StorySpot[] = [];
  for (const def of Object.values(STORY_CHARACTER_DEFS)) {
    if (!def.scenes.includes(opts.activeScene)) continue;
    let x: number;
    let y: number;
    const p = def.placement;
    if (p.mode === "fork_plaza") {
      x = opts.forkPlazaMidX + (p.offsetX ?? 0);
      y = opts.forkPlazaWorldY + (p.offsetY ?? 0);
    } else if (p.mode === "village_south") {
      x = opts.worldW / 2 + (p.offsetX ?? 0);
      y = opts.worldH + (p.offsetY ?? -TILE_SZ * 3);
    } else {
      const offX = p.offsetX ?? TILE_SZ * 0.5;
      const offY = p.offsetY ?? 0;
      x = p.lane === "west" ? opts.aveLeft + offX : opts.aveRight - offX;
      y = opts.streetY + offY;
    }
    out.push({
      charId: def.id,
      worldX: Math.round(Math.min(opts.worldW - TILE_SZ, Math.max(TILE_SZ, x))),
      worldY: Math.round(Math.min(opts.worldH - TILE_SZ, Math.max(TILE_SZ, y))),
      radius: def.interactRadius,
      def,
    });
  }
  return out;
}

/** @returns TileSpec from manifest for overlay portrait URL resolution. */
export function storySpriteSpec(key: keyof typeof STORY_SPRITES): TileSpec {
  return STORY_SPRITES[key];
}
