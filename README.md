# Footy

Turn-based 3D football in the browser (Three.js + Vite + TypeScript). Two players draft 11 stationary players each, then take turns kicking with only Power / Curve / Loft and their own eye: no aim arrow, no trajectory preview. Play hot-seat on one device or online peer-to-peer with a room code.

**Play it: https://aditya-uprety.github.io/footy/**

> Work in progress. Rules, architecture and milestones: [PLAN.md](PLAN.md). Status: [PROGRESS.md](PROGRESS.md).

## How to play

1. **Draft.** A coin toss decides who picks the role: *Team A* (places first and takes the opening kickoff) or *Team B* (places the very last player). Each team places 11 players in a snake draft (A1, B2, A2, B2, …, B1). Spots must be ≥ 8 m from teammates, ≥ 4 m from opponents, outside the center circle and 1 m inside the lines. Exactly one keeper per team, inside its own penalty area. Red spots show the reason.
2. **Kick.** Whoever has the ball turns on the spot (drag, or ← / →), sets **Power**, **Curve** and **Loft** on the side bar and kicks (button or Space). There is nothing to show where the ball will go: use your eye, the zoom (wheel), the camera height, the minimap and the hold-Tab overhead map (positions only).
3. **Shot timer.** 20 s; at 0 the ball is auto-kicked as you left it.
4. **Ball in play.** The ball bounces off players; keepers catch it. When it stops, the closest player (either team) gets it. Goals, throw-ins, corners and goal kicks follow football rules, simplified. 40 kicks per match, half-time after 20; a draw is possible.

Keys: ← / → turn (Shift = fine) · ↑ / ↓ look · +/− zoom · PgUp / PgDn camera height · W·S power · A·D curve · Q·E loft · Space kick · hold Tab overhead map · hold F fast-forward · C camera · H help.

## Playing online

You need two browsers with WebGL (desktop Chrome, Edge, Firefox or Safari). The game is peer-to-peer (WebRTC); the free PeerJS cloud server only introduces the two players.

- **Host:** open the site → *Host online*. A 5-character room code and a *Copy link* button appear. Send the link (`…/#/join/CODE`) or the code to your friend, wait for "Connected", then *Start match*. The host runs the rules; both screens show identical results.
- **Join:** open the shared link (it joins automatically), or open the site → *Join online* and type the code.
- If a connection drops mid-match the guest reconnects by itself (up to 60 s) and the host keeps the seat for 120 s. A guest page refresh rejoins the same match. Refreshing the **host** page ends the match.

### Troubleshooting

| Symptom | What to try |
|---|---|
| "Room not found" | Check the code (letters and digits, no I/O/0/1); the host must still have the lobby open. |
| "Room full" | Someone else already joined that room. |
| Stuck on "Connecting…" or "Network error" | Some mobile networks, corporate networks and strict NATs block direct WebRTC. Try another network or a phone hotspot for one of you, or set up a TURN server (below). |
| "Both players need to refresh the page" | The two pages run different versions; reload both. |
| Black or empty 3D view | Your browser has WebGL disabled; enable hardware acceleration. |
| PeerJS cloud is down or rate-limited | Wait and retry, or self-host a PeerServer (below). |

### Optional: TURN relay and self-hosted PeerServer

Both are configured at build time with Vite env vars (see `src/net/peer.ts`). Nothing is required for the default setup (two public STUN servers + the PeerJS cloud server).

| Variable | Meaning |
|---|---|
| `VITE_TURN_URLS` | Comma-separated TURN URLs, e.g. `turn:turn.example.com:3478,turns:turn.example.com:5349` |
| `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | TURN login |
| `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE` | Self-hosted [PeerServer](https://github.com/peers/peerjs-server) (`VITE_PEER_SECURE=false` for plain `http`) |

Locally, put them in `.env.local` (git-ignored) and run `npm run dev` or `npm run build`. For the GitHub Pages deploy, add them as **repository variables** (Settings → Secrets and variables → Actions → Variables); the workflow passes them to the build. They end up in the public JavaScript bundle, so use only TURN credentials you are fine exposing (a free-tier or short-lived account).

## Development

Requirements: Node.js 22.12 or newer.

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (exact versions are pinned) |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run check` | Typecheck + unit tests (must pass before every commit) |
| `npm run build` | Typecheck, then production build into `dist/` (relative base: works under any path) |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm test` | Unit tests only (Vitest, Node) |
| `npm run typecheck` | TypeScript only |
| `npm run sim:table` | Physics tuning report: carry / apex / total / time for power × loft, and the PLAN §5.10 targets (exits non-zero if one is out of range) |

Routes: `#/` menu · `#/hotseat` · `#/host` · `#/join/CODE` · `#/practice` · `#/lab` (Physics Lab).

Flags go in the query string before the hash, e.g. `http://localhost:5173/?debug#/lab`:

- `?debug`: hitboxes, FPS and draw calls, ruler, `window.__footy`
- `?seed=N`: deterministic random seed
- `?autoplace`: auto-fill a legal draft (hot-seat and the online host)
- `?touch`: show the touch button row on a mouse device (phones and tablets get it automatically)
- `?perf=low|high`: force performance mode on or off (default: phones, tablets and weak devices start in low; any device drops to low if the frame rate stays under ~30 fps)
- `?shot=N` / `?place=N`: shot / placement timer in seconds (0 = off; hot-seat and the online host)

### Deploying

Every push to `main` runs `.github/workflows/deploy.yml` (install → `npm run check` → build → GitHub Pages). In the repository settings, Pages → Source must be **GitHub Actions**. Netlify or Cloudflare Pages also work: build command `npm run build`, publish directory `dist`.

### Headless WebGL check

If your browser pane has no WebGL, `node scripts/webgl-shot.mjs <url> <out.png> [steps]` drives headless Chrome with SwiftShader, saves a screenshot and exits non-zero on console errors. Steps include `wait:ms`, `eval:js`, `drag:x1,y1,x2,y2`, `wheel:x,y,dy`, `click:x,y`, `key:K`, `shot:file.png`. The dev server (or preview) must be running.
