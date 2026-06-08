import Phaser from "phaser";
import { useEffect, useRef } from "react";
import { FloraTreeScene } from "./FloraTreeScene";

// ─── Types ───────────────────────────────────────────────────────────────────
export interface FloraPost {
  id:        string;
  content:   string;
  createdAt: string;
}

interface FloraTreeBackgroundProps {
  postsMade: number;
  posts:     FloraPost[];
}

// ─── Component ────────────────────────────────────────────────────────────────
export function FloraTreeBackground({ posts, postsMade }: FloraTreeBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef      = useRef<Phaser.Game | null>(null);

  // Mount once — spin up a Phaser game inside the container div
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const game = new Phaser.Game({
      type:            Phaser.AUTO,
      parent:          container,
      width:           window.innerWidth,
      height:          window.innerHeight,
      backgroundColor: "#87ceeb",
      scene:           FloraTreeScene,
      // Disable default Phaser banner to keep console tidy
      banner:          false,
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When posts change (or arrive after async fetch) → tell the scene to add leaves
  useEffect(() => {
    if (!gameRef.current) return;

    const tryEmit = () => {
      const scene = gameRef.current
        ?.scene.getScene("FloraTreeScene") as FloraTreeScene | undefined;
      if (scene?.scene.isActive()) {
        scene.events.emit("renderLeaves", posts, Math.max(postsMade, posts.length));
      } else {
        // Scene not ready yet — retry on next frame
        requestAnimationFrame(tryEmit);
      }
    };
    tryEmit();
  }, [posts, postsMade]);

  return (
    <div
      ref={containerRef}
      style={{ position: "fixed", inset: 0, zIndex: 52, pointerEvents: "auto" }}
    />
  );
}
