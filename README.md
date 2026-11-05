# Footy

Turn-based 3D football in the browser (Three.js + Vite + TypeScript). Two players draft 11 stationary players each, then take turns kicking with only Power / Curve / Loft and their own eye: no aim arrow, no trajectory preview. Play hot-seat on one device or online peer-to-peer with a room code.

> Work in progress. Rules, architecture and milestones: [PLAN.md](PLAN.md). Status: [PROGRESS.md](PROGRESS.md).

## Requirements

- Node.js 22.12 or newer
- A browser with WebGL

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (exact versions are pinned) |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run check` | Typecheck + unit tests (must pass before every commit) |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm test` | Unit tests only (Vitest, Node) |
| `npm run typecheck` | TypeScript only |

## Routes and flags

Routes: `#/` menu · `#/hotseat` · `#/host` · `#/join/CODE` · `#/practice` · `#/lab` (Physics Lab).

Flags go in the query string before the hash, e.g. `http://localhost:5173/?debug#/lab`:

- `?debug`: FPS and draw calls (more debug aids arrive with later milestones)
- `?seed=N`: deterministic random seed
- `?autoplace`: auto-fill a legal draft

## Headless WebGL check (dev)

If your browser pane has no WebGL, `node scripts/webgl-shot.mjs <url> <out.png> [steps]` drives headless Chrome with SwiftShader, saves a screenshot and exits non-zero on console errors. Steps include `wait:ms`, `eval:js`, `drag:x1,y1,x2,y2`, `wheel:x,y,dy`, `click:x,y`, `key:K`, `shot:file.png`. The dev server must be running.
