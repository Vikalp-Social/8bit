# 8bit World

An 8-bit RPG Mastodon client. Your pixel character walks through 8bit World, enters topic halls (Tech Lab, Art Gallery, Nature Lodge…), and reads posts delivered by NPCs inside each building. Posts are clustered by an LLM — each cluster becomes a hall, each post becomes an NPC dialogue.

Live at **[8bit.vikalp.social](https://8bit.vikalp.social)** · part of the **[vikalp.social](https://vikalp.social)** suite alongside the [topic map](https://graph.vikalp.social).

---

## Getting started locally

The [clustering-backend](https://github.com/vikalp-social/clustering-backend) (api-server + ml-service) must be running.

```bash
pnpm install
pnpm run dev
```

**Default URL:** `http://localhost:22364/`

The Vite dev server proxies `/api/**` to `localhost:8080` (api-server) automatically. Set `API_PORT` if your api-server runs on a different port.

---

## Scripts

```bash
pnpm run dev        # start dev server with HMR
pnpm run build      # production build → dist/public/
pnpm run serve      # preview production build locally
pnpm run typecheck  # type-check without building
```

---

## Tech stack

- **React 19** + **TypeScript**
- **Vite 7** + **Tailwind CSS 4**
- **HTML5 Canvas** — all game rendering is hand-drawn (no game engine); sprites/tiles load via a small custom loader (`game/tileLoader.ts`)
- **Phaser 3** — only used by the experimental Flora tree scene (currently disabled)

---

## Project structure

```
src/
├── pages/
│   └── BitFeedGame.tsx      Main game file — all scenes, rendering, game loop
├── game/
│   ├── storyCharacters.ts   NPC character definitions and dialogue scripts
│   └── StoryDialogOverlay.tsx  Dialogue UI component
public/
└── tiles/                   Sprite sheets, tile maps, and pixel art assets
```

Almost all game logic is in `BitFeedGame.tsx`. Scene types:

- `fork_hub` — feed source selection (The Sage NPC)
- `overworld` — 8bit World plaza with hall façades; player walks to enter a hall
- Hall interior — shared hub + multi-room building; post NPCs appear here

The eight hall keys (assigned by the LLM): `tech`, `politics`, `art`, `nature`, `science`, `gaming`, `music`, `general`.

### Notable behaviors

- The game always opens at the **fork hub** (The Sage), where you pick a feed (Home / Public / Trending).
- Reading progress (per-hall counts → the radar chart and reading title) is saved to `localStorage` on **every post read**, and synced to Firestore when you return to The Sage.
- A **Ko-fi "Support Vikalp"** link sits in the top bar / mobile menu and on the sign-in screen.
- Hall interiors render their room backdrop + NPCs only (no scattered prop objects).
- Canvas zoom adapts to the device width so the framing stays consistent across phone sizes.

---

## Auth flow

Login is handled by the api-server (Mastodon OAuth 2.0). The app stores the session in a `__session` cookie scoped to `.vikalp.social`. Logging in at `vikalp.social` carries to this app automatically.

Local dev: enter your Mastodon instance in the login screen → you'll be redirected through OAuth and back.

---

## Deployment

Built and deployed by `deploy/deploy.sh --frontend` in the companion deploy repo. The production build output (`dist/public/`) is uploaded to Firebase Hosting (`8bit.vikalp.social`).

```bash
pnpm run build
# dist/public/ is the Firebase Hosting root
```
