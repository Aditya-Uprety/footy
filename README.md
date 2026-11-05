# Footy

Turn-based 3D football in the browser (Three.js + Vite + TypeScript). Two players draft 11 stationary players each, then take turns kicking with only Power / Curve / Loft and their own eye: no aim arrow, no trajectory preview, no landing marker. Play hot-seat on one device or online peer-to-peer with a room code.

**Play it: https://aditya-uprety.github.io/footy/** · version 1.1.0

## Features

- **Hot-seat** on one device, or **online** peer-to-peer with a 5-character room code or a shareable link (host-authoritative, both screens show identical results).
- **Snake draft** of 11 players per team, with spacing rules and an optional goalkeeper.
- Custom ball physics: drag, curve (Magnus effect), loft, bounces off players, posts, crossbar and nets; keepers catch.
- Real restarts: kickoffs, throw-ins, corners, goal kicks; half-time and full-time.
- Replays (any kick, three cameras, slow motion), an automatic goal replay, match log and full-time stats.
- Lobby settings: pitch size, player spacing, kicks per match, shot and placement timers, four kit pairs (three colorblind-safe).
- Procedural sound (no audio files), volume and mute.
- Touch controls and a phone-landscape layout; automatic performance mode on weaker devices.
- Remembers your names and last settings on each device.

## How to play

1. **Toss and draft.** A coin toss decides who picks the role: *Team A* (places first and takes the opening kickoff) or *Team B* (places the very last player). The teams then take turns placing 1–2 players each (A1, B2, A2, B2, …, B1) until both have 11. Spots must be ≥ 8 m from teammates, ≥ 4 m from opponents, outside the center circle and the opponent's penalty area, and 1 m inside the lines; a red marker shows why a spot is not allowed. Each team may place one keeper, inside its own penalty area. It is forced on the last slot unless an outfield teammate already stands in the box; then you may play without one.
2. **Kick.** Whoever has the ball turns on the spot, sets **Power**, **Curve** and **Loft** on the side bar and kicks. Nothing shows where the ball will go: use your eye, the zoom, the camera height, the minimap and the hold-Tab overhead map (positions only).
3. **Shot timer.** 30 s per kick; at 0 the ball is kicked with whatever you had set.
4. **Ball in play.** The ball bounces off players; a keeper it touches catches it. When the ball stops, the closest player (either team) gets it; a tie goes to the team that did not kick.
5. **Restarts.** After a goal the conceding team kicks off from the center spot (kickoffs are capped at 50 % power, so they can't score on their own). Over a touchline: the team that did not touch it last gets it at its player closest to where it went out. Over a goal line: a goal kick for the defending keeper, or a corner from the flag if a defender touched it last. No offside, no fouls.
6. **Match.** 40 kicks shared by both teams, half-time after 20. More goals wins; a draw is possible. Rematch starts a new toss and draft.

The full rules are in the game under *How to play*, and **H** shows the controls during a match.

### Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Turn | Drag left / right (one finger) | ← / → (Shift = fine) |
| Look up / down | Drag up / down | ↑ / ↓ |
| Zoom | Wheel (pinch) | + / − |
| Camera height | Height slider (Up / Down buttons) | PageUp / PageDown |
| Power · Curve · Loft | Sliders | W / S · A / D · Q / E |
| Kick | KICK button | Space |
| Overhead map | Hold the map button | Hold Tab |
| Fast-forward playback | Hold the fast button | Hold F |
| Playback camera | Cam button | C |
| Replay the last kick | Replay button | R (in a replay: C camera, 1 2 3 speed, Space again) |
| Match log and stats | L button | L |
| Mute | Speaker button | M |
| Help | ? button | H |

While placing players: click to place, drag to move, right-click or Undo to remove; left-drag or W A S D pans, right-drag rotates, wheel zooms, T gives a top-down view.

## Playing online

You need two browsers with WebGL (desktop Chrome, Edge, Firefox or Safari, or a recent phone or tablet). The game is peer-to-peer (WebRTC); the free PeerJS cloud server only introduces the two players.

- **Host:** open the site → *Host online*. A room code and a *Copy link* button appear. Send the link (`…/#/join/CODE`) or the code to your friend, choose the settings, wait for "Connected", then *Start match*. The host runs the rules.
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
| No sound | Sound starts after your first click or key press; check the speaker button (M) and the volume slider. |
| Choppy on an older device | Add `?perf=low` to the address (before the `#`). |
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

Requirements: Node.js 22.12 or newer. Design, rules, physics and protocol: [PLAN.md](PLAN.md). Build history: [PROGRESS.md](PROGRESS.md).

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

Routes: `#/` menu · `#/hotseat` · `#/host` · `#/join/CODE` · `#/practice` (solo sandbox) · `#/howto` · `#/lab` (Physics Lab: debug trajectory lines and live physics constants; linked from the menu in dev builds and with `?debug`).

Flags go in the query string before the hash, e.g. `http://localhost:5173/?debug#/lab`:

- `?debug`: hitboxes, FPS and draw calls, ruler, `window.__footy`
- `?seed=N`: deterministic random seed
- `?autoplace`: auto-fill a legal draft (hot-seat and the online host)
- `?touch`: show the touch button row on a mouse device (phones and tablets get it automatically)
- `?perf=low|high`: force performance mode on or off (default: phones, tablets and weak devices start in low; any device drops to low if the frame rate stays under ~30 fps)
- `?shot=N` / `?place=N`: initial shot / placement timer in seconds (0 = off; hot-seat and the online host)

### Layout

`src/shared`, `src/sim` (physics), `src/game` (rules, draft, authoritative `HostCore`) and `src/net/protocol.ts` are pure TypeScript with no DOM, Three.js or PeerJS, and run in Node tests; `src/architecture.test.ts` enforces it. `src/render` is Three.js, `src/ui` DOM overlays, `src/app` the glue per mode, `src/net` the PeerJS transport and sessions. A kick is simulated in full at 240 Hz the moment it is taken, then played back; online, the host sends the whole trajectory.

### Deploying

Every push to `main` runs `.github/workflows/deploy.yml` (install → `npm run check` → build → GitHub Pages). In the repository settings, Pages → Source must be **GitHub Actions**. Netlify or Cloudflare Pages also work: build command `npm run build`, publish directory `dist`.

### Headless WebGL check

If your browser pane has no WebGL, `node scripts/webgl-shot.mjs <url> <out.png> [steps]` drives headless Chrome with SwiftShader, saves a screenshot and exits non-zero on console errors. Steps include `wait:ms`, `eval:js`, `drag:x1,y1,x2,y2`, `wheel:x,y,dy`, `click:x,y`, `key:K`, `shot:file.png`, plus touch steps (`TOUCH=1`: `tap:`, `tdrag:`, `pinch:`, `thold:` / `trelease:`). The dev server (or preview) must be running.
