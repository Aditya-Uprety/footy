# Footy — Build Plan

> Single source of truth for rules, architecture and milestones. Planning finalized 2026-11-05.
> Workflow rules: `CLAUDE.md`. Progress checklist: `PROGRESS.md`.
> If anything here must change, edit it and add a line to §14 Changelog.

## 0. At a glance

- 2-player, turn-based, 3D football in the browser (Three.js). **Hot-seat** on one device or **online P2P** with a room code. Static site, free hosting.
- Each team drafts 11 **stationary** players in a snake draft. Then whoever has the ball looks around (first-person / behind-the-ball), sets **Power / Curve / Loft** on a side bar and kicks. **No aim arrow, no trajectory preview, no landing marker, no crosshair** — pure intuition.
- The ball bounces off players. When it stops, the **closest player** (either team) gets it. Goals, throw-ins, corners, goal kicks, kickoffs, half-time and full-time follow football rules, simplified where noted.

Model tags used below: **[Opus 5.5 High]** = core build · **[Sonnet 5.5 High]** = deploy & polish. Summary table in §12.

## 1. Glossary

| Term | Meaning |
|---|---|
| Team A / Team B | A places first and takes the opening kickoff; B places the very last player. A defends the goal at x = −L/2 and attacks +x. |
| Seat | One human. Seat 0 = Player 1 / online host, seat 1 = Player 2 / online guest. The coin toss maps seats to teams. |
| Pick | One draft turn: place 1 or 2 players, then confirm. |
| Kicker | Whoever is about to kick: a placed player, or a **ghost taker**: an invisible kicker used for kickoffs, throw-ins and corners. Ghost takers are not one of the 22 and have no hitbox. |
| Kick (turn) | One strike of the ball. The whole flight is simulated instantly, then played back. |
| Touch | The ball contacting a player's hitbox. With no contact, the last touch belongs to the kicking team. |

## 2. Rules spec (final)

### 2.1 Teams, seats, coin toss
1. Two seats. Hot-seat: both on one device. Online: host and guest.
2. Coin toss (host RNG). The **toss winner picks a role**:
   - **Team A**: places first (1 player) and takes the opening kickoff.
   - **Team B**: places the final player (the reactive edge).
3. Default kits: Team A red, Team B blue; keepers yellow (A) and green (B). Seat names are editable.
4. Ends never change (no re-placement), so Team A always defends x = −L/2.

### 2.2 Pitch
- Length L = 105 m, width W = 68 m (adjustable in the lobby, §2.9).
- FIFA markings: center circle r 9.15; goal area 5.5 × 18.32; penalty area 16.5 × 40.32; penalty mark 11 m from the goal line; penalty arc r 9.15 around the mark (outside the box only); corner arcs r 1; lines 0.12 m wide (visual only).
- Goals: 7.32 m between the inner edges of the posts, 2.44 m to the underside of the bar; posts and bar 0.12 m diameter; net 2.0 m deep.
- For rules, each line is its outer edge: touchlines at |z| = W/2, goal lines at |x| = L/2.

### 2.3 Placement phase (snake draft)
1. Schedule, 12 picks: **A1, B2, A2, B2, A2, B2, A2, B2, A2, B2, A2, B1**, giving 11 players each.
2. During a pick the active seat places its 1–2 players, may drag or undo them, then confirms. The opponent sees them only after Confirm. Confirmed players are final.
3. Each team places **exactly one goalkeeper** (GK toggle) at any pick. If a team's remaining slots would otherwise run out, its last slot is forced to be the GK.
4. A spot (player center (x, z)) is **legal** when all of these hold:
   - a. **In the field with a 1 m margin**: |x| ≤ L/2 − 1 and |z| ≤ W/2 − 1.
   - b. **Hitbox fully outside the center circle**: √(x² + z²) ≥ 9.15 + R (R = hitbox radius, §2.5).
   - c. **GK inside its own penalty area** (center within the box lines; rule a still applies). Outfield players may stand anywhere else, **including either penalty area**.
   - d. **≥ X = 8 m from every teammate** and **≥ Y = 4 m from every opponent**, measured center to center.
   - e. **GK feasibility guard**: a pick is illegal if, afterwards, a team that has not placed its GK yet would have no legal GK spot left in its own box (checked on a 0.25 m grid).
5. Optional placement timer (lobby, default off). On expiry the rest of the pick is filled with random legal spots (GK if forced).
6. After pick 12 the match starts with Team A's kickoff.

### 2.4 Turns and kicking
1. Exactly one team has possession at a time, held by a kicker (a player or a ghost taker).
2. **Aiming**: the possessing seat rotates 360° and sets **Power** (0–100 %), **Curve** (−100…+100 %, + bends right), **Loft** (0–55°), then kicks (§5.6).
3. **Allowed view aids**: scroll zoom (FOV), adjustable camera height along the kick line (1.7–8 m), hold-Tab overhead map, always-on minimap. Both maps show **positions only**: fixed orientation, no facing direction, no view cone, the kicker marked at its own center rather than the ball's offset position. **Never**: aim arrow, trajectory, landing marker, crosshair.
4. **Shot timer**: 20 s. It starts when the kicker's view is ready (after playback and the camera move). At 0 the ball is **auto-kicked with the current direction and sliders**.
5. **Every kick counts** toward the match total, including kickoffs and restarts.
6. After a kick, both seats watch the playback, then the next possession applies (§2.5–2.7).

### 2.5 Ball in play
1. Physics per §5: drag, curve (Magnus), bounces, rolling friction.
2. The ball **bounces off any player** it hits and continues. Outfield hitbox: radius 0.40 m, 1.85 m tall. It can be lofted over players.
3. **Goalkeepers**: hitbox radius 0.90 m, 2.30 m tall at the center (arms spread). A ball that **touches a keeper is caught**: play stops at once and the keeper's team kicks next, from where the keeper stands.
4. Posts, crossbar and nets are solid.
5. The ball **stops** when it rolls slower than 0.05 m/s (hard cap: 30 s of simulated time).
6. **Possession after a stop**: the player whose center is closest to the ball in 2D. Ties within 0.01 m go to the team that **did not take the kick**; if still tied, the lower player id.
7. The new kicker gets the ball at their feet: R + 0.11 + 0.02 m in front of them along their current facing.

### 2.6 Goals and out of play (set pieces)
1. **Goal**: the whole ball crosses the goal line between the posts and under the bar. Own goals count for the opponent. **Exception**: a goal straight from a throw-in, with no touch after the throw, doesn't count. Into the opponent's goal → goal kick to the defenders; into the thrower's own goal → corner to the opponent.
2. After a goal the **conceding team kicks off**.
3. **Over a touchline → throw-in** to the team that did not touch the ball last. A ghost taker stands at the exit point, with x clamped to ±(L/2 − 1). The ball is released from 1.8 m height just inside the line. **Power is capped at 45 %** (about 16 m/s), **curve is locked at 0**, loft is free. A throw that goes straight back out is not retaken: it's a throw-in to the other team.
4. **Over a goal line (not a goal)**, at the goal defended by team D:
   - last touch by the attackers → **goal kick**: D's **keeper gets the ball where they stand**;
   - last touch by D → **corner** to the attackers: a ghost taker in the corner arc on the side where the ball went out, with the ball 0.5 m from both lines.
5. "Last touch" means the team of the last player the ball hit; with no contact, the kicking team.

### 2.7 Kickoff, halves, end
1. **Kickoff**: a ghost taker on the center spot; any direction; full power allowed; may score directly.
2. Match = **40 kicks** (lobby-adjustable, even). **Half-time** comes after kick 20 resolves: the score is kept, the ball returns to the center, and the team that didn't take the opening kickoff kicks off. No change of ends, no re-placement.
3. **Full-time** comes after kick 40 resolves; a goal on that kick counts. Higher score wins; **level = draw**.
4. **Rematch**: a new coin toss and a fresh draft.

### 2.8 Not in the game
No offside, fouls, cards, handball, penalty kicks or substitutions. Players never move. Idle and kick animations are visual only: hitboxes are rotation-invariant.

### 2.9 Settings (lobby) and defaults
Before the settings UI exists (M13), code uses these defaults. All code reads from `Settings`; never hardcode 105/68/8/4/40/20.

| Setting | Default | Range |
|---|---|---|
| Pitch length L | 105 m | 90–120 |
| Pitch width W | 68 m | 60–90 |
| Teammate spacing X | 8 m | 5–15 |
| Opponent spacing Y | 4 m | 2 … X − 1 |
| Kicks per match | 40 | 10–100, even (half-time at half) |
| Shot timer | 20 s | off, or 10–60 s |
| Placement timer | off | off, or 20–120 s |
| Auto-speed slow rolls (per viewer) | on | on/off |

## 3. Architecture

### 3.1 Tech decisions (evaluated)

| Topic | Decision | Why / alternatives considered |
|---|---|---|
| Build | **Vite 8 + TypeScript (strict)** | Fast dev server, static `dist/`. Types catch cross-module mistakes across many separate build chats. |
| Rendering | **Three.js r187** | As requested; mature, no engine overhead. |
| UI | **Vanilla TS DOM + CSS overlays** | About 10 simple screens; no framework needed, tiny bundle. |
| Physics | **Custom (~600 LOC), not cannon-es/rapier** | One sphere vs static primitives. We need Magnus, quadratic drag, rolling resistance, keeper catch and goal/out line events, and the libraries model none of these, so they'd be hand-written anyway. Rapier also adds about 1–2 MB of WASM. Custom code is pure, testable in Node and deterministic. |
| Timestep | **Fixed 240 Hz, semi-implicit Euler** | At 32–35 m/s max the ball moves ≤ 0.15 m per step, less than the thinnest collision width (post plus ball = 0.34 m), so no tunneling and no continuous collision detection needed. A 30 s simulation takes < 10 ms. |
| Execution | **Simulate a whole kick instantly, record the trajectory, then play it back** | Decouples physics from frame rate. One `KickResult` drives local play, networking, replays and tests. |
| Networking | **WebRTC DataChannel via PeerJS 1.5.x**, free PeerJS cloud signaling, room codes | Free, no server to run. The alternative is a WebSocket relay (e.g. Cloudflare Worker + Durable Object): most robust through NAT, but needs an account and a deploy. It stays possible behind the `Transport` interface. |
| Authority | **Host-authoritative**: the host validates intents, simulates, and sends the full trajectory plus the next state | Identical results on both screens without relying on cross-browser float determinism. Lockstep was rejected because `Math.*` transcendentals may differ between JS engines. Bandwidth is trivial (~10–20 KB per kick). |
| State sync | **Full snapshots** (~2 KB JSON) after every change | Turn-based, so deltas aren't needed; reconnect becomes trivial. |
| Hosting | **GitHub Pages via GitHub Actions** | Free, HTTPS (required for WebRTC). Netlify or Cloudflare Pages work unchanged because the base path is relative. |
| Tests | **Vitest** (Node env) for sim, rules and protocol; browser-pane checks for visuals | |
| Dev tool | **lil-gui** (Physics Lab only, lazy-loaded) | Live tweaking of physics constants. |

Versions seen on npm at planning time (pin exact versions in M0): three 0.187.0, @types/three 0.187.0, peerjs 1.5.5, vite 8.3.5, vitest 5.1.0, typescript 7.0.2. If TypeScript 7 tooling causes friction, pin the latest 6.x and note it in the Changelog.

### 3.2 Layers

```
 ui/ (DOM overlays) ──┐                         ┌── render/ (Three.js)
                      ├── app/ (glue per mode) ─┤
                      │   matchView · placementView · aimController · practice · lab
                      │
                      └── Session (Local | Host | Guest)
                               │            │
                     net/ (protocol,        │
                      transports) ──────────┤
                                            ▼
                     game/ (rules, draft, HostCore) ──> sim/ (physics)
                                    └──── shared/ (pitch geometry, rng, math) ────┘
```

**Purity rule**: `shared/`, `sim/`, `game/` and `net/protocol.ts` are pure TypeScript: no DOM, no Three.js, no PeerJS, no real timers (HostCore gets an injected clock). They run in Node tests. An architecture test enforces this (M0).

### 3.3 Modes
- **Hot-seat** `#/hotseat`: `LocalSession` runs `HostCore` in the page; both seats are local.
- **Online host** `#/host`: `HostSession` = HostCore + PeerJS transport; local seat 0, remote seat 1.
- **Online guest** `#/join/CODE`: `GuestSession` renders snapshots and sends intents.
- **Practice** `#/practice`: solo sandbox with a random layout; possession switching only (no rules engine).
- **Physics Lab** `#/lab`: dev tool; the **only** place debug trajectory lines may appear.

Query flags: `?debug` (hitboxes, FPS/draw calls, ruler, `window.__footy`), `?seed=N` (deterministic RNG), `?autoplace` (auto-fills a legal draft), `?shot=N` / `?place=N` (shot / placement timer seconds, 0 = off; hot-seat and the online host, until the M13 settings panel).

### 3.4 Data flow of one kick
```
kicker UI ─intent{kick}─> HostCore.handle(seat) ─ validate ─> buildWorld(state)
                                                              └─> simulateKick() ─> KickResult
both seats <── kick{result, next} ──────────────────────────────────────────┘
both seats:  playback(result) ─> at end apply `next` ─> camera eases to the next kicker ─> shot timer
```

## 4. File and module layout

```
footy/
├─ CLAUDE.md  PLAN.md  PROGRESS.md  README.md
├─ index.html  package.json  tsconfig.json  vite.config.ts
├─ .claude/launch.json             # dev server "footy-dev" for the browser pane (M0)
├─ .github/workflows/deploy.yml    # GitHub Pages (M11)
├─ public/                         # static assets (sfx in M14)
├─ scripts/webgl-shot.mjs          # dev: headless Chrome (SwiftShader) screenshots + console check via CDP
├─ scripts/sim-table.mjs           # `npm run sim:table` launcher (Vite runnerImport) → scripts/simTable.ts tuning report (M2.6)
└─ src/
   ├─ main.ts                      # boot → router
   ├─ architecture.test.ts         # purity rule (§3.2)
   ├─ shared/                      # PURE
   │  ├─ pitch.ts                  # Law-1 constants + derivePitch(settings): lines, boxes, goals, spots
   │  ├─ rng.ts                    # seeded PRNG (mulberry32)
   │  └─ math.ts                   # clamp, lerp, angle helpers
   ├─ sim/                         # PURE physics
   │  ├─ constants.ts              # §5.3 (units in comments)
   │  ├─ vec3.ts  types.ts         # BallState, KickInput, SimEvent, Outcome, KickResult
   │  ├─ world.ts                  # buildWorld(pitch, players, kicker) → hitboxes, frame, nets
   │  ├─ kick.ts                   # KickInput (+ restart caps) → initial ball state
   │  ├─ collide.ts                # primitives + generic response
   │  ├─ step.ts                   # one fixed step
   │  ├─ simulate.ts               # run → KickResult (frames, events, outcome)
   │  ├─ analyze.ts                # flight stats (carry, apex, total, lateral@downrange) for tests and sim:table
   │  └─ *.test.ts
   ├─ game/                        # PURE rules
   │  ├─ types.ts  settings.ts     # GameState, Intent, Settings (+ defaults, ranges)
   │  ├─ draft.ts                  # schedule, validateSpots, forced GK, GK guard
   │  ├─ possession.ts             # closest player + tie rule
   │  ├─ restarts.ts               # out of play → restart + spots, throw-in exception
   │  ├─ rules.ts                  # newMatch, chooseRole, applyPick, kick, resolveOutcome, rematch
   │  ├─ host.ts                   # HostCore (authoritative, validates intents, guard timer)
   │  ├─ serialize.ts              # base64 <-> Float32Array, snapshot helpers
   │  └─ *.test.ts
   ├─ net/
   │  ├─ protocol.ts               # PURE: message types, PROTOCOL_VERSION, type guards
   │  ├─ transport.ts              # Transport interface + LoopbackTransport
   │  ├─ peer.ts                   # PeerJS transport, room codes, ICE config
   │  ├─ link.ts                   # HostLink / GuestLink: hello/welcome/reject, ping/pong RTT, silence → lost, seat reservation (M9.4)
   │  ├─ hostSession.ts  guestSession.ts
   │  └─ *.test.ts
   ├─ render/                      # Three.js only
   │  ├─ scene.ts                  # renderer, lights, resize, loop
   │  ├─ pitch.ts  goals.ts  players.ts  ball.ts  stadium.ts (M12)
   │  ├─ cameras.ts                # placement, aim, spectator, chase, broadcast, overhead rigs
   │  ├─ playback.ts               # KickResult player (interpolation, events, time-warp)
   │  ├─ overheadMap.ts            # hold-Tab orthographic view
   │  ├─ placementOverlay.ts       # draft ground overlay: no-go zones, own box, X/Y rings, hover marker (M7)
   │  └─ debug.ts                  # hitboxes, axes, ruler, lab trajectory line
   ├─ ui/                          # DOM overlays
   │  ├─ dom.ts  styles.css
   │  ├─ menu.ts  lobby.ts  toss.ts  placementPanel.ts  kickPanel.ts
   │  └─ hud.ts  minimap.ts  screens.ts  help.ts
   └─ app/                         # glue per mode
      ├─ router.ts  session.ts     # Session interface + LocalSession
      ├─ inspect.ts                # M1 inspect view: pitch + goals, orbit camera, keys 1–4, ?debug axes/ruler
      ├─ hotseat.ts                # #/hotseat mode: names → LocalSession → matchView (M7)
      ├─ matchView.ts              # phase → view (toss, placement, play, fulltime); holds the "shown" state until playback ends
      ├─ playView.ts               # play phase: aim rig, kick bar, HUD, maps, shot timer, half-time card (M8)
      ├─ matchText.ts  shotTimer.ts  # pure HUD texts/toasts and the shot-timer model (M8, tested)
      ├─ mapControls.ts            # hold-Tab overhead map + minimap, shared by practice and play (M8)
      ├─ placementView.ts  placementModel.ts  aimController.ts   # placementModel = pure per-pick state (M7)
      ├─ kickFlow.ts               # one turn: aim → wind-up → playback → eased move to the next kicker (M5.3; reused by M8/M10)
      ├─ online.ts                 # #/host and #/join lobby modes: PeerJS room + HostLink/GuestLink → lobby UI, connection overlay (M9)
      ├─ practice.ts  practiceRules.ts  lab.ts
      └─ audio.ts (M14)
```

## 5. Physics model

### 5.1 Units and axes
SI units (m, s, kg, rad). Sim world = Three.js world. Origin = center spot on the ground; **+y up**; **x along the length** (Team A's goal line at x = −L/2, Team B's at +L/2); **z across** (touchlines at z = ±W/2).
Yaw θ → kick direction **d̂ = (cos θ, 0, sin θ)**; the kicker's right is **r̂ = d̂ × ŷ = (−sin θ, 0, cos θ)**. (Facing +x, right is +z, which matches the screen's right for a camera looking along +x.)

### 5.2 Bodies
- **Ball**: r = 0.11 m, m = 0.43 kg.
- **Outfield hitbox**: vertical cylinder of radius R = 0.40 from y = 0 to Hc = 1.45, capped by a hemisphere of radius R centered at (x, Hc, z), so the top is at 1.85 m.
- **GK hitbox**: R = 0.90, Hc = 1.40, top at 2.30 m. Any contact means a catch.
- **Posts**: vertical capsules of radius 0.06 from y = 0 to y = 2.50 at x = ±(L/2 + 0.06), z = ±3.72. **Crossbar**: horizontal capsule of radius 0.06 at y = 2.50 between the post tops. So the inner post edges are at |z| = 3.66, the bar underside at y = 2.44, and the front faces sit flush with the goal line.
- **Nets**: thin two-sided rectangles: back at x = ±(L/2 + 2.06); sides at z = ±3.72 from the line to the back; roof at y = 2.50.
- **Ground**: the plane y = 0 everywhere, beyond the lines too.

### 5.3 Constants (initial; all in `src/sim/constants.ts`)

| Name | Value | Meaning |
|---|---|---|
| DT | 1/240 s | fixed step |
| G | 9.81 m/s² | gravity |
| RHO | 1.225 kg/m³ | air density |
| CD | 0.25 | drag coefficient (constant, past the drag crisis) |
| AREA | π r² = 0.03801 m² | ball cross-section |
| K_D | RHO·CD·AREA/(2m) = 0.01354 1/m | drag factor |
| K_M | RHO·AREA·r/(2m) = 0.00596 | Magnus factor (lift coefficient C_L ≈ rω/\|v\|) |
| W_MAX | 50 rad/s | sidespin at curve ±100 % |
| TAU_AIR | 6 s | spin decay time in the air |
| TAU_GROUND | 0.5 s | spin decay time while rolling |
| E_GROUND / MU_GROUND | 0.55 / 0.45 | ground restitution / impact friction |
| BOUNCE_KEEP_MIN | 0.6 | minimum fraction of horizontal speed kept per bounce (hollow sphere going to rolling) |
| SPIN_KEEP_GROUND | 0.8 | spin kept per bounce |
| V_SETTLE | 0.6 m/s | rebound speed below which the ball starts rolling |
| MU_ROLL | 0.12 | rolling resistance (decel = MU_ROLL·G = 1.18 m/s²) |
| V_STOP | 0.05 m/s | stopped |
| T_MAX | 30 s | simulation cap |
| E_PLAYER / MU_PLAYER / SPIN_KEEP_PLAYER | 0.45 / 0.25 / 0.3 | player contacts |
| E_FRAME / MU_FRAME / SPIN_KEEP_FRAME | 0.70 / 0.10 / 0.6 | posts and bar |
| E_NET / NET_TANGENT_KEEP | 0.10 / 0.5 | net contacts |
| V_MIN / V_MAX | 3 / 32 m/s | kick speed at power 0 / 100 % |
| LOFT_MAX | 55° | loft at 100 % |
| THROW_POWER_CAP / THROW_HEIGHT | 0.45 / 1.8 m | throw-in limits |
| KICK_GAP | 0.02 m | gap between the kicker's hitbox and the ball |
| GRACE_DIST | 0.25 m | kicker's hitbox ignored until the ball is this far beyond it |
| TAIL_GOAL / TAIL_OUT | 1.5 s / 1.0 s | visual-only simulation after a goal / out |
| FRAME_EVERY | 4 steps | trajectory recording rate (60 Hz) |

### 5.4 Forces
- **a = g + a_drag + a_magnus (+ a_roll when rolling)**
- g = (0, −G, 0)
- **a_drag = −K_D · |v| · v**
- **a_magnus = K_M · (ω × v)**. With ω = (0, ω_y, 0) the force is horizontal, along ∓r̂.
- **a_roll = −MU_ROLL · G · v̂_h** (horizontal only; clamp so it never reverses v_h).
- While rolling: the vertical component of a is zeroed (ground support), v.y = 0 and p.y = r.
- Spin decay per step: ω ← ω · (1 − DT/τ), with τ = TAU_GROUND when rolling, else TAU_AIR.

### 5.5 Step (reference algorithm; the planning check in §5.10 used exactly this)
```
step(b):                                     // b = { p, v, w, rolling }
  p0 = copy(b.p)
  a = (0, −G, 0) − K_D·|v|·v + K_M·(w × v)
  if rolling:
      a.y = 0
      if |v_h| ≤ MU_ROLL·G·DT: v_h = 0  else: a_h −= MU_ROLL·G · v_h/|v_h|
  v += a·DT ;  p += v·DT
  w *= 1 − DT / (rolling ? TAU_GROUND : TAU_AIR)
  if not rolling: collideGround()
  collidePlayers() ; collideFrame() ; collideNets()        // §5.7
  if rolling: p.y = r ; v.y = 0 ; if |v_h| < V_STOP → STOP
  detectLines(p0, p)                                        // §5.8

collideGround():   if p.y < r:
  p.y = r
  if v.y < 0:
     k   = max(BOUNCE_KEEP_MIN, 1 − MU_GROUND·(1+E_GROUND)·|v.y| / |v_h|)
     v_h *= k ;  v.y = E_GROUND·|v.y| ;  w *= SPIN_KEEP_GROUND ;  emit 'ground'
     if v.y < V_SETTLE: v.y = 0 ; rolling = true
```
A contact that leaves v.y > V_SETTLE (frame or net only) ends rolling.

### 5.6 Kick model
Input: yaw θ, power p ∈ [0,1], curve c ∈ [−1,1], loft l ∈ [0,1], after restart caps (throw-in: p ≤ 0.45, c = 0).
- speed **v0 = V_MIN + p·(V_MAX − V_MIN)**; loft angle **α = l · LOFT_MAX**
- **v = v0 · (cos α · d̂ + sin α · ŷ)**
- **ω = (0, −c·W_MAX, 0)**: clockwise seen from above when c > 0, which **curves the ball right** (toward r̂).
- **Start position**:
  - Player kicker with center (kx, kz) and radius R: **p = (kx, r, kz) + d̂·(R + r + KICK_GAP)**.
  - Ghost takers: kickoff (0, r, 0); corner (±(L/2 − 0.5), r, ±(W/2 − 0.5)); throw-in (x_exit clamped to ±(L/2 − 1), THROW_HEIGHT, ±(W/2 − r)).
- `rolling` starts true only when α = 0 and the start height is r.
- **Kicker grace**: the kicker's hitbox is ignored until the ball's horizontal distance from the kicker's axis exceeds R + r + GRACE_DIST. After that it's live: a rebound can hit the kicker, and a keeper who kicked catches it.

### 5.7 Collisions
Generic response, for a contact normal **n** (unit, obstacle → ball), penetration δ > 0, restitution e, friction μ and spin keep k_ω:
```
p += n·δ
vn = v·n
if vn < 0:
   vN = vn·n ;  vT = v − vN ;  jn = −(1+e)·vn
   if |vT| > 0: vT *= max(0, 1 − μ·jn/|vT|)
   v = −e·vN + vT ;  w *= k_ω ;  emit contact(speed = −vn)
```
- **Player hitbox** (center (px, pz), R, Hc): dx = bx − px, dz = bz − pz.
  - If by ≤ Hc: d = √(dx² + dz²), n = (dx, 0, dz)/d.
  - Else: dy = by − Hc, d = √(dx² + dy² + dz²), n = (dx, dy, dz)/d.
  - In both cases δ = R + r − d, and there's contact if δ > 0. A **GK contact means CATCH** (no bounce); otherwise apply the PLAYER constants. Update the last touch (team, playerId) and `touches += 1`.
- **Frame capsule** (segment a→b, radius 0.06): q = a + clamp(((p − a)·(b − a))/|b − a|², 0, 1)·(b − a); d = |p − q|; n = (p − q)/d; δ = r + 0.06 − d. Apply the FRAME constants; emit 'post' or 'bar'.
- **Net rectangle** (unit normal m, center o, half-extents U along u and V along w): s = (p − o)·m, s0 = (p0 − o)·m, side = (s0 ≥ 0 ? +1 : −1). If (|s| < r or sign(s) ≠ side) and |(p − o)·u| ≤ U and |(p − o)·w| ≤ V, then n = side·m and δ = r − side·s. Reflect the normal component with E_NET and multiply the tangential part by NET_TANGENT_KEEP. Emit 'net'.
- Degenerate d < 1e-9: use n = −v̂ (or +ŷ if v = 0).
- Order per step: ground → players → frame → nets. One pass per step is enough at 240 Hz.

### 5.8 Rule events and simulation end
Checked every step after collisions, using p0 (the start of the step) and p:
- **Goal-line plane** x = ±(L/2 + r) crossed from inside: f = crossing fraction; interpolate y_c and z_c. If |z_c| < 3.66 and y_c < 2.44 → **GOAL** (`goalOf` = the team defending that goal). Otherwise → **OUT** { line: 'goal', x: ±L/2, z: z_c }.
- **Touchline plane** |z| = W/2 + r crossed → **OUT** { line: 'touch', x: x_c, z: ±W/2 }.
- If both planes are crossed in one step, the smaller f wins.
- **GK contact → CATCH**: the simulation ends immediately (the renderer snaps the ball to the keeper's hands).
- **STOP** ends the simulation; T_MAX ends it as a STOP at the current (x, z).
- **Tails**: after a GOAL, simulate TAIL_GOAL more seconds (ground, frame and nets only; no players, no rule events); after an OUT, TAIL_OUT likewise. Tail frames are visual only.
- The outcome carries `lastTouch: { team, playerId | null }` (null = no contact since the kick) and `touches` (player contacts after the kick).

### 5.9 Output and playback
```ts
interface KickResult {
  turnId: number;
  input: KickInput;          // after caps
  start: Vec3; spin0: Vec3;
  frames: Float32Array;      // [t, x, y, z] × n: every FRAME_EVERY steps + every contact step + the last step
  events: SimEvent[];        // kick, ground, player, post, bar, net, goal, out, catch, stop (each with t)
  outcome: Outcome;          // goal | out | catch | stop (see §7)
  duration: number;          // seconds, incl. tail
}
```
Playback: binary-search the frames by t and lerp between them; fire each event when playback time passes its t. Ball rotation: rolling → rotate by distance/r about ŷ × v̂; airborne → spin0, decaying. Time-warp is local per viewer: hold F = 3×; "auto-speed slow rolls" = 2× while rolling below 2 m/s. On the wire, frames are base64 of the Float32Array bytes.

### 5.10 Tuning targets
"Planning check" values come from a throwaway implementation of §5.5–5.6 with the §5.3 constants, on an empty infinite plane. M2 tests assert the test ranges.

| Kick | Planning check | Test range |
|---|---|---|
| Power 25 %, loft 0° (10.3 m/s pass) | stops at 29 m after 6.6 s | 25–34 m |
| Power 50 %, loft 0° | 56 m | 48–63 m |
| Power 100 %, loft 0° | 94 m | 85–103 m |
| Power 100 %, loft 15° | carry 36 m, apex 3.0 m | carry 31–41, apex 2.5–3.6 |
| Power 100 %, loft 35° | carry 53 m, apex 12 m | carry 48–58, apex 10–14 |
| Power 30 %, loft 45° (chip) | carry 12 m, apex 3.3 m | carry 10.5–14, apex 2.9–3.8 |
| Power 75 %, curve +100, loft 10° | 4.1 m right at 25 m downrange | +3.3…+5.0 m |
| Power 40 %, curve +100, loft 0° (ground) | 2.8 m right at 25 m downrange | +2.0…+3.6 m |
| Any input, empty plane | — | ends < 12 s |

Consequence for balance: the maximum carry (~53 m) only just reaches a goal from the center spot, so direct kickoff goals are possible but marginal. Watch this in M17.

### 5.11 Determinism and performance
- The sim loop uses only + − × ÷ and `Math.sqrt` (correctly rounded): no `Math.hypot`, `pow`, `exp`, `sin` or `cos` inside the loop. Trig runs once per kick, on the host. The host is authoritative, so cross-machine determinism is not relied on, but tests and replays are exact.
- No randomness in the simulation.
- Budget: a 30 s simulation (7200 steps × ~40 checks) < 10 ms on desktop.

## 6. Cameras and controls

### 6.1 Cameras
- **Placement**: overhead perspective; pan (drag on the ground or WASD), zoom (wheel), rotate/tilt (right-drag), top-down preset (T).
- **Aim (kicker view)**: on the kick line behind the ball. Position = ball − d̂·(2.2 + 0.4·(h − 1.7)) + ŷ·h, with camera height h ∈ [1.7, 8] m (default 1.7). Yaw = θ. Free pitch −60°…+15° (view only; the default keeps the ball about 22° below the center). FOV 20°–75° (default 60°). The kicker mesh is hidden. No crosshair: the ball at the bottom center is the only reference.
- **Spectator** (opponent while the other seat aims, online): the same rig following the streamed yaw by default; C toggles to the broadcast camera.
- **Playback**: chase (starts from the aim pose, follows the ball with lag, rises with ball height, never below 1.5 m) or broadcast (elevated on the near touchline, tracking). C toggles. Behind-goal camera added in M15.
- **Transition**: a 0.8–1.2 s eased tween from where the ball stopped to the next kicker's aim pose.
- **Overhead map** (hold Tab): orthographic, whole pitch, fixed orientation; player discs and numbers; the kicker ringed at its own center; the ball hidden while aiming.
- **Minimap** (always on, bottom-left, 2D canvas): same content and rules as the overhead map.
- **Map orientation**: online, your own team attacks left→right; hot-seat, Team A attacks left→right. Fixed for the whole match.

### 6.2 Controls (desktop; touch in M16)

| Action | Mouse | Keys |
|---|---|---|
| Rotate (yaw) | drag horizontally on the view | ← / → (hold Shift = fine) |
| Look up/down (view only) | drag vertically | ↑ / ↓ |
| Zoom (FOV) | wheel | + / − |
| Camera height | side-bar slider | PageUp / PageDown |
| Power / Curve / Loft | side-bar sliders | W·S / A·D / Q·E |
| Kick | KICK button | Space |
| Overhead map | hold map button | hold Tab |
| Fast-forward playback | hold ⏩ | hold F |
| Playback camera | — | C |
| Help | ? button | H |

Sensitivity: drag 0.15°/px (Shift 0.03°/px); keys 40°/s (Shift 6°/s). Slider steps: power 1 %, curve 1 %, loft 0.5°. Tab and Space must `preventDefault`.

## 7. Game state and rules API (`src/game/types.ts`)

```ts
type Team = 0 | 1;                       // 0 = A (defends −x), 1 = B
type Seat = 0 | 1;                       // 0 = Player 1 / host
type RestartKind = 'kickoff' | 'throwin' | 'corner' | 'goalkick' | 'catch' | 'open';

interface Settings { pitchLength: number; pitchWidth: number; minTeammateDist: number; minOpponentDist: number;
                     kicksPerMatch: number; shotTimerSec: number; placementTimerSec: number }
interface PlayerSpot { id: number; team: Team; x: number; z: number; gk: boolean; shirt: number } // GK shirt 1, others 2–11
type Kicker = { kind: 'player'; playerId: number } | { kind: 'ghost'; x: number; y: number; z: number };
interface Possession { team: Team; kicker: Kicker; restart: RestartKind }
interface KickInput { yaw: number; power: number; curve: number; loft: number }
interface Touch { team: Team; playerId: number | null }
type Outcome =
  | { kind: 'goal'; goalOf: Team; z: number; lastTouch: Touch; touches: number }   // z = goal-line crossing
  | { kind: 'out'; line: 'touch' | 'goal'; x: number; z: number; lastTouch: Touch; touches: number }
  | { kind: 'catch'; keeperId: number }
  | { kind: 'stop'; x: number; z: number; lastTouch: Touch; touches: number };

interface GameState {
  rev: number;                           // +1 on every change
  phase: 'toss' | 'placement' | 'play' | 'fulltime';
  settings: Settings;
  seatNames: [string, string];
  toss: { winner: Seat; teamOfSeat: [Team, Team] | null };
  pick: number;                          // 0..12 (12 = draft complete)
  players: PlayerSpot[];                 // ids in placement order
  score: [number, number];
  kicksTaken: number;
  half: 1 | 2;                           // the client shows the half-time overlay when this flips
  possession: Possession | null;
  turnId: number;                        // +1 per new possession
  last: { turnId: number; outcome: Outcome; awarded: RestartKind } | null;
  rematchVotes: [boolean, boolean];
}

type Intent =
  | { type: 'tossChoice'; role: 'A' | 'B' }
  | { type: 'place'; pick: number; spots: { x: number; z: number; gk: boolean }[] }
  | { type: 'kick'; turnId: number; input: KickInput; auto: boolean }
  | { type: 'rematch' };
```

Pure functions in `game/rules.ts`: `newMatch(settings, names, rng)`, `chooseRole(s, seat, role)`, `validateSpots(s, team, spots) → Violation[]` (in draft.ts), `applyPick(s, team, spots)`, `kick(s, team, input) → { result, next }` (caps, buildWorld, simulateKick, then `resolveOutcome`), `resolveOutcome(s, possession, outcome)`, `voteRematch(s, seat)`.

`resolveOutcome` order: score/restart from §2.6 (goal, out, catch, or stop → closest player) → `kicksTaken += 1` → if kicksTaken = N/2 then half-time (kickoff by the other team than the opening one) → if kicksTaken = N then full-time.

`HostCore` (`game/host.ts`): `handle(seat, intent) → { ok } | { ok: false, reason }`; `onState(cb)`, `onKick(cb)`; `tick(nowMs)` for the guard auto-kick (§8.4); `noteAim(seat, yaw)`.

## 8. Network protocol

### 8.1 Transport and connection
- WebRTC DataChannel through **PeerJS 1.5.x**: reliable, ordered, `serialization: 'json'`.
- Signaling: the free PeerJS cloud server. The host's peer id is `footy-v1-<CODE>`; the guest uses a random id and connects to it.
- Room code: 5 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; regenerate on `unavailable-id`. Share link: `<site>/#/join/<CODE>`.
- ICE servers: `stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`. Optional TURN from env: `VITE_TURN_URLS` (comma-separated), `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`. Optional self-hosted PeerServer: `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`.
- `Transport` interface: `send(msg)`, `onMessage(cb)`, `onStatus(cb)`, `close()`. Implementations: `LoopbackTransport` (tests), `PeerTransport`. A WebSocket relay could be added later without touching game code.

### 8.2 Messages (every message is `{ v: 1, t: <type>, ... }`)

Guest → Host:

| t | Fields | When |
|---|---|---|
| `hello` | name, proto, resume? | on connect |
| `intent` | intent: Intent | toss choice, placement pick, kick, rematch |
| `aim` | turnId, yaw | ≤ 10 Hz while aiming (spectating only) |
| `ping` / `pong` | ts | every 2 s / reply to the host's ping |
| `bye` | reason | leaving on purpose (Leave, Menu, tab closed) |

Host → Guest:

| t | Fields | When |
|---|---|---|
| `welcome` | seat (1), resume, proto, name? (host's name) | accepted |
| `reject` | reason: 'full' \| 'version' \| 'ended' | refused, then close |
| `state` | state: GameState | after every change (full snapshot) |
| `kick` | result: WireKickResult, next: GameState | after each kick (frames as base64) |
| `aim` | turnId, yaw | host aiming, ≤ 10 Hz |
| `denied` | intentType, reason, violations? | an intent was refused (UI shows why) |
| `ping` / `pong` | ts | every 2 s / reply to the guest's ping |
| `bye` | reason | host leaving |

### 8.3 Sequences
- **Join**: connect → `hello` → host checks proto and seat → `welcome` + `state`.
- **Toss**: the host draws the winner → `state` (phase toss) → the winner's seat sends `intent{tossChoice}` → `state` (placement).
- **Pick**: the active seat sends `intent{place}` → host validates → `state`, or `denied` with violations.
- **Kick**: the active seat sends `intent{kick}` → host simulates → `kick{result, next}` to the guest (the host's own view gets the same objects locally) → both play back → each applies `next` when its playback ends.

### 8.4 Timers and authority
- The host is the only writer of `GameState`. Clients render the last snapshot and hold `next` until playback ends.
- The shot timer runs on the kicker's client, from the moment its aim view is ready; at 0 it sends the kick with `auto: true`.
- **Host guard**: the clock starts when the turn begins on the host (the previous kick's result was sent, or the kickoff possession was created). If no kick arrives within shotTimer + the previous playback duration (0 if none) + 15 s, HostCore auto-kicks with the last streamed yaw and neutral sliders (power 50 %, curve 0, loft 0). With the shot timer off there is no guard.
- The placement timer, if enabled, is enforced by the host in the same way.

### 8.5 Connection loss and resume
- Heartbeat: both sides ping every 2 s (each measures its own RTT); no traffic for 8 s → overlay "Connection lost — reconnecting…" (guest) / "Opponent disconnected" (host).
- The guest retries with backoff 1, 2, 4, 8 … s for up to 60 s, sending its `resume` token (from `welcome`, kept in sessionStorage per room). The host keeps seat 1 reserved for 120 s and re-sends `state` on resume.
- If the host's Peer loses signaling (`disconnected`), call `peer.reconnect()`.
- Optional (M10): host-refresh recovery (persist GameState in sessionStorage, re-register the same id).

### 8.6 Validation
- The host validates every intent: seat → team, phase, matching `turnId`/`pick`, finite numbers (power, curve and loft clamped), spot legality (§2.3). This catches bugs, not cheaters: it's a friends game.
- Clients validate every incoming message with type guards and drop malformed ones.
- `PROTOCOL_VERSION = 1`; on mismatch, `reject{version}` → "Both players need to refresh the page".

## 9. UI screens and HUD
- **Menu**: Play hot-seat · Host online · Join online · Practice · How to play (· Lab in dev builds).
- **Hot-seat setup**: two names (+ settings from M13) → Start.
- **Online lobby**: host (code, copy-link button, settings, waiting → ready); guest (code entry, or auto from the link); status pill with RTT.
- **Toss**: coin animation → the winner chooses a role card: "Team A — place first + kick off" or "Team B — place last".
- **Placement**: banner ("Blue — place 2 · pick 4/12"), GK toggle, Undo, Confirm, live violation text, ring legend (own X ring, opponent Y ring).
- **Match HUD**: scoreboard (names, colors, score) · "Kick 13/40 · 1st half" · shot-timer ring (red under 5 s) · possession banner ("Red #7 on the ball", "Corner — Blue") · event toasts (GOAL!, Saved!, Throw-in / Corner / Goal kick — Team, Half-time, Full-time) · minimap (bottom-left) · kick side bar on the right (Power, Curve, Loft, camera height, KICK).
- **Overlays**: half-time, full-time (result, Rematch, Menu), connection status, help.

## 10. Testing and verification
- `npm run check` = typecheck + all unit tests. **It must be green before ticking any code task.**
- **Unit tests** (Vitest, Node): sim, draft, possession, restarts, rules, HostCore, protocol, serialization.
- **Integration**: a scripted full match through HostCore (M6), then through LoopbackTransport with host and guest sessions (M10).
- **Architecture test**: the pure layers import no `three`/`peerjs` and use no `window`/`document`.
- **Browser checks**: start the dev server through `.claude/launch.json` ("footy-dev", port 5173) and verify in the browser pane (screenshots, zero console errors) before reporting acceptance. The user then re-checks the listed items. If the pane has no WebGL (true on the user's machine), verify DOM/routing in the pane and anything 3D with `node scripts/webgl-shot.mjs <url> <out.png> [steps]` (headless Chrome + SwiftShader; also "footy-preview" on port 4173 for the production build).
- Debug aids: `?debug` (hitbox wireframes, FPS and draw calls, ruler, `window.__footy` state), `?seed=N`, `?autoplace`.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| P2P fails behind strict NAT/CGNAT (some mobile networks) | Two STUN servers, a clear error message, optional TURN via env vars (documented in M11), and a `Transport` interface that allows a WebSocket relay later |
| PeerJS cloud signaling outage or rate limit | PeerServer host configurable by env; "retry" guidance in the UI |
| Kicking feels too easy or too hard without aids | Lab with live constants (M4), §5.10 targets, balance pass with the user (M17) |
| Long-range or kickoff goals dominate against a static keeper | Max carry ≈ 53 m keeps kickoff goals marginal; knobs: V_MAX, GK size, an optional kickoff power cap |
| Waiting while the ball rolls | MU_ROLL tuning, fast-forward, auto 2× on slow rolls |
| TS 7 / Vite 8 tooling friction | Pin versions in M0; fall back to the latest TS 6.x if needed |
| WebGL performance on weak machines | DPR cap 2, shadow-map size option, performance mode (M16) |
| A chat runs out of room mid-milestone | Small milestones; PROGRESS.md notes allow resuming mid-milestone |

## 12. Milestones

Each milestone fits in one chat. **Start a new chat at every milestone boundary.** The last item of each milestone is its acceptance check: Claude verifies in the browser pane, then the user re-checks.

| # | Milestone | Model + effort |
|---|---|---|
| M0 | Scaffold and tooling | **Opus 5.5 High** |
| M1 | Pitch and goals | **Opus 5.5 High** |
| M2 | Ball flight physics | **Opus 5.5 High** |
| M3 | Collisions, goals, outs, possession | **Opus 5.5 High** |
| M4 | Playback renderer and Physics Lab | **Opus 5.5 High** |
| M5 | Aiming and kicking (Practice mode) | **Opus 5.5 High** |
| M6 | Rules engine | **Opus 5.5 High** |
| M7 | Toss and placement UI (hot-seat) | **Opus 5.5 High** |
| M8 | Hot-seat match | **Opus 5.5 High** |
| M9 | Networking and lobby | **Opus 5.5 High** |
| M10 | Online match | **Opus 5.5 High** |
| M11 | Deploy to the web | **Sonnet 5.5 High** |
| M12 | Visual polish: players, ball, stadium | **Sonnet 5.5 High** |
| M13 | UI/UX polish and settings | **Sonnet 5.5 High** |
| M14 | Audio | **Sonnet 5.5 High** |
| M15 | Replays and quality of life | **Sonnet 5.5 High** |
| M16 | Touch and mobile | **Sonnet 5.5 High** |
| M17 | Balance, feel and release QA | **Opus 5.5 High** |

### M0 — Scaffold and tooling [Opus 5.5 High]
Goal: an empty but correctly structured app that builds, tests and renders.
- M0.1 npm project: Vite + TypeScript strict, three, @types/three, vitest (+ @types/node for test tooling), all pinned to exact versions. Scripts: `dev`, `build`, `preview`, `test`, `typecheck`, `check`. `.gitignore` (node_modules, dist, coverage, .env*).
- M0.2 Folder skeleton per §4 with stub modules. `src/shared/pitch.ts` holds the Law-1 constants plus `derivePitch(settings)` (line positions, box bounds, goal posts, spots).
- M0.3 `render/scene.ts`: renderer (antialias, DPR ≤ 2, sRGB output, ACES tone mapping), resize handling, render loop; a temporary green ground with OrbitControls; FPS counter under `?debug`.
- M0.4 `app/router.ts`: the §3.3 hash routes show placeholder screens; query flags parsed once.
- M0.5 Tests: `shared/pitch.test.ts` (penalty area 40.32 wide, goal area 18.32, etc.) and `architecture.test.ts` (§3.2 purity rule).
- M0.6 `.claude/launch.json` ("footy-dev": `npm run dev`, port 5173) and a README stub with the commands.

Acceptance:
1. `npm install`, then `npm run dev`; http://localhost:5173 shows green ground under a sky-blue background; drag orbits, wheel zooms.
2. http://localhost:5173/?debug shows an FPS counter.
3. http://localhost:5173/#/lab shows the placeholder "Physics Lab".
4. `npm run check` passes; `npm run build` then `npm run preview` serves the same page.

### M1 — Pitch and goals [Opus 5.5 High]
Goal: an accurate pitch that all later geometry derives from.
- M1.1 Grass with mowing stripes along x and a 6 m apron beyond the lines; receives shadows.
- M1.2 Markings from `derivePitch`: touchlines, goal lines, halfway line, center circle and spot, goal areas, penalty areas, penalty marks, penalty arcs (outside the box only), corner arcs. 0.12 m wide, no z-fighting, crisp at distance.
- M1.3 Goals: posts and crossbar (front faces on the goal line, §5.2), 2 m deep net (semi-transparent mesh plus grid lines), corner flags.
- M1.4 Lighting: hemisphere plus directional sun with soft shadows covering the pitch; sky gradient and light fog.
- M1.5 Inspect cameras: keys 1 (TV side), 2 (behind goal A), 3 (behind goal B), 4 (top-down). `?debug`: axes helper and a ruler (Shift+click two points → distance label).

Acceptance:
1. Top-down (key 4): all markings symmetric; the penalty arcs sit outside the boxes.
2. `?debug` ruler: center-circle radius ≈ 9.15 m, box depth 16.5 m, penalty mark 11 m from the goal line, 7.32 m between the posts' inner edges.
3. Goals have nets; posts cast shadows on the grass.
4. Keys 1–4 switch views; no flickering lines when orbiting low.
5. `npm run check` passes.

### M2 — Ball flight physics [Opus 5.5 High]
Goal: pure, tested ball physics on an empty plane (no players or goals yet).
- M2.1 `sim/vec3.ts`, `sim/constants.ts` (§5.3, units in comments), `sim/types.ts`.
- M2.2 `sim/kick.ts` per §5.6 (direction, speed, loft, spin, start position, throw-in caps).
- M2.3 `sim/step.ts` per §5.4–5.5 (gravity, drag, Magnus, spin decay, ground bounce, rolling, settle, stop).
- M2.4 `sim/simulate.ts`: fixed-step loop, T_MAX, frame recording (§5.9), events 'kick' / 'ground' / 'stop'.
- M2.5 Tests: determinism (two runs give identical frames); a no-curve kick stays on its line (lateral < 1e-9); curve sign (c > 0 goes right of d̂); higher loft gives a higher apex; spin decays; every slider extreme ends < T_MAX; every §5.10 range.
- M2.6 `npm run sim:table` prints carry / apex / total / time for power {25, 50, 75, 100} % × loft {0, 10, 15, 25, 35, 45, 55}°. Record any constant change in §5.3 and the Changelog.

Acceptance:
1. `npm run check` passes, including the §5.10 range tests.
2. `npm run sim:table` prints values close to the planning check (e.g. power 100 %, loft 35° carries ≈ 53 m).

### M3 — Collisions, goals, outs, possession [Opus 5.5 High]
Goal: complete pure simulation of a kick in a populated world.
- M3.1 `sim/world.ts`: `buildWorld(pitch, players, kicker)` → hitboxes (outfield/GK), goal frames, net rectangles.
- M3.2 `sim/collide.ts`: player hitbox, capsule segment, two-sided net rectangle, generic response (§5.7), kicker grace.
- M3.3 Rule events in `simulate.ts`: goal/out crossings with exit point, CATCH, last touch and touch count, tails (§5.8), T_MAX stop.
- M3.4 `game/possession.ts`: closest player in 2D, with the tie rule (§2.5.6).
- M3.5 Tests: head-on bounce (rebound speed ≈ E_PLAYER × impact); glancing deflection direction; a lob clears a 1.85 m player and a low drive hits; post rebound; crossbar; straight goal (correct `goalOf`; the ball stays in the net during the tail); wide shot → OUT 'goal' with the exit z; touchline OUT with the exit x; GK catch; own goal; last touch after a deflection; possession tie → non-kicking team; the kicker isn't hit by their own kick, but a later rebound can hit them.

Acceptance:
1. `npm run check` passes with all M3 tests.

### M4 — Playback renderer and Physics Lab [Opus 5.5 High]
Goal: see the simulation: ball, placeholder players, playback, lab tool.
- M4.1 `render/ball.ts`: procedural panel texture, rolling/airborne rotation, shadow (shadow map plus a soft blob for clarity).
- M4.2 `render/players.ts`: placeholder figures (team-colored body, head, shirt-number sprite; GK bigger with an arms-spread silhouette); hitbox wireframes under `?debug`.
- M4.3 `render/playback.ts`: frame interpolation, event callbacks, time-warp (hold F = 3×; auto 2× below 2 m/s while rolling).
- M4.4 `render/cameras.ts`: chase and broadcast playback cameras; C toggles.
- M4.5 `app/lab.ts` (`#/lab`): click to add/remove dummies (team and GK toggles), set the kick origin, numeric yaw/power/curve/loft, Kick, Replay, event log, lab-only trajectory line, lil-gui panel to live-edit §5.3 constants.

Acceptance (http://localhost:5173/#/lab):
1. Add 3 dummies and kick into one: visible bounce, log shows `player #id`.
2. Kick at a post: log shows `post` and the ball rebounds. Shoot into the goal: `GOAL`, and the ball settles in the net.
3. Kick over the touchline: `OUT touch x=…`. Kick at a GK dummy: `CATCH`.
4. Holding F speeds up playback; C switches the camera; editing a constant (e.g. W_MAX) changes the next kick.
5. `npm run check` passes.

### M5 — Aiming and kicking (Practice mode) [Opus 5.5 High]
Goal: the real kicking experience, playable solo.
- M5.1 Aim rig (§6.1): behind-ball camera on the kick line, yaw/pitch/zoom/height inputs (§6.2), kicker hidden, no crosshair.
- M5.2 `ui/kickPanel.ts`: vertical Power, Curve (center detent) and Loft sliders, a camera-height slider and KICK; keyboard shortcuts; restart caps visibly applied (throw-in power ≤ 45, curve locked).
- M5.3 Kick flow: short wind-up → local `simulateKick` → playback → ease to the next kicker.
- M5.4 Overhead map (hold Tab) and always-on minimap per §6.1: fixed orientation, no facing information.
- M5.5 `app/practice.ts` (`#/practice`): seeded random 22-player layout; after a stop the closest player gets the ball; goals and outs reset to a center kickoff (no rules engine yet).

Acceptance (http://localhost:5173/#/practice):
1. Rotate a full 360°; Shift gives fine control; zoom and camera height work.
2. Power 50, curve 0, loft 0: the ball rolls straight up the vertical center of the screen.
3. Curve +100 bends right and −100 bends left; loft 55° at low power chips over a nearby player.
4. Nothing reveals the aim: no arrow, line, crosshair or landing marker. Rotating while holding Tab doesn't change the map.
5. After the ball stops, the view moves to the closest player and the controls work again.

### M6 — Rules engine [Opus 5.5 High]
Goal: complete, tested game rules as pure code, no UI.
- M6.1 `game/types.ts` (§7), `game/settings.ts` (§2.9 defaults, ranges, validation), `shared/rng.ts` (seeded mulberry32).
- M6.2 `game/draft.ts`: schedule; `validateSpots` (§2.3.4 a–e) with readable violation messages; forced-GK logic; GK guard on a 0.25 m grid.
- M6.3 `game/restarts.ts`: throw-in, corner, goal kick, throw-in direct-goal exception (§2.6).
- M6.4 `game/rules.ts`: newMatch, toss/role, applyPick, kickoff, `kick()`, `resolveOutcome`, half-time, full-time, rematch.
- M6.5 `game/host.ts` HostCore: per-seat intent validation (§8.6), state and kick callbacks, injected clock, guard auto-kick (§8.4).
- M6.6 Tests: schedule totals; each violation type; forced GK on the last slot; the guard blocks a box-sealing pick; restart matrix (touch, goal line × last-touch team, both ends); throw-in into either goal; goal → conceding team kicks off; half-time kickoff swap; full-time and draw; wrong-seat and stale-turn intents rejected; a scripted 40-kick match reaches full-time.

Acceptance:
1. `npm run check` passes; the scripted-match test logs a final score after 40 kicks.

### M7 — Toss and placement UI, hot-seat [Opus 5.5 High]
Goal: from the menu to a finished draft on one device.
- M7.1 Minimal main menu (Hot-seat, Practice, Lab) and hot-seat name entry.
- M7.2 Coin-toss screen and role choice (§2.1).
- M7.3 `app/placementView.ts`: placement camera, ground raycast, hover marker green/red with the reason, exclusion rings (X around your teammates, Y around opponents), center circle and own box highlighted, GK toggle.
- M7.4 Tentative spots: click to place, drag to move, right-click or Undo to remove, Confirm when valid; banner "Blue — place 2 · pick 4/12"; forced-GK hint.
- M7.5 `app/session.ts` LocalSession wraps HostCore; after pick 12 hand off to the match (a stub screen until M8).

Acceptance:
1. Menu → Hot-seat → toss → role choice → 12 picks in the order A1 B2 A2 B2 A2 B2 A2 B2 A2 B2 A2 B1.
2. Spots inside the center circle, < 8 m from a teammate, < 4 m from an opponent, or < 1 m from a line show red with the reason and can't be confirmed.
3. A GK can only go inside its own box; a team's final slot is forced to GK if none was placed.
4. The `?debug` ruler confirms the spacing between confirmed players.

### M8 — Hot-seat match [Opus 5.5 High]
Goal: a complete hot-seat match, from kickoff to full-time.
- M8.1 `app/matchView.ts`: maps each phase to cameras, panels and playback through the Session interface.
- M8.2 Turn loop: aim → kick intent → result → playback → apply next state → camera ease → next turn. Ghost-taker restarts with the camera at the spot; goal kick to the keeper; catches.
- M8.3 Functional HUD (`ui/hud.ts`): scoreboard, kick counter and half, shot timer with auto-kick, possession banner, toasts (§9).
- M8.4 Half-time overlay; full-time screen with the result, Rematch (new toss and draft) and Menu.
- M8.5 `?autoplace` (random legal draft); smoke-test a whole match and fix what turns up.

Acceptance (fast route: http://localhost:5173/?autoplace#/hotseat; also once with a manual draft):
1. A full match plays through to the full-time screen.
2. A goal updates the score and the conceding team kicks off from the center spot.
3. Touchline out: throw-in to the other team from the exit point, power capped at 45, curve locked.
4. Over the goal line off an attacker: the defending keeper has the ball. Off a defender: corner from the correct corner.
5. A ball hitting a keeper shows "Saved!" and the keeper has the ball.
6. The shot timer reaching 0 auto-kicks.
7. After kick 20, half-time and the other team kicks off; after kick 40, full-time; Rematch starts a new toss.

### M9 — Networking and lobby [Opus 5.5 High]
Goal: two browsers connect with a room code.
- M9.1 `net/protocol.ts` (§8.2 types, PROTOCOL_VERSION, type guards) and `net/transport.ts` (interface plus LoopbackTransport).
- M9.2 `net/peer.ts`: PeerJS transport, room codes, ICE config (§8.1), error mapping (room not found, code taken, network).
- M9.3 Lobby UI: Host (code, copy link, waiting), Join (code field; `#/join/CODE` auto-joins), status with RTT.
- M9.4 Handshake (hello / welcome / reject), heartbeat, disconnect overlay.
- M9.5 Tests: guards accept valid and reject malformed messages; loopback handshake; version mismatch.

Acceptance (two windows on this computer):
1. Host shows a 5-character code; joining with it → both show "Connected · RTT n ms".
2. The copied link opens straight into the lobby as guest.
3. A bad code shows "Room not found"; a third window shows "Room full".
4. Closing the guest makes the host show "Opponent disconnected" within ~10 s.

### M10 — Online match [Opus 5.5 High]
Goal: a full host-authoritative match between two browsers.
- M10.1 `net/hostSession.ts`: HostCore plus transport; snapshot after every change; `kick` with base64 frames and the next state.
- M10.2 `net/guestSession.ts`: renders snapshots and sends intents only on its own turns; controls are disabled otherwise.
- M10.3 Spectating: aim-yaw stream (10 Hz) both ways; the spectator camera follows it.
- M10.4 Timers: client shot timer plus host guard (§8.4); placement timer setting.
- M10.5 Resilience: resume token, guest refresh/reconnect, host `peer.reconnect()`, seat reserved for 120 s, online rematch. Optional: host-refresh recovery.
- M10.6 Integration test: HostCore plus a scripted guest over LoopbackTransport play a full match; both sides end with identical state.

Acceptance (two windows, then two devices on the same Wi-Fi):
1. A full online match: both screens show the same ball paths, scores and restarts.
2. On the opponent's turn your controls are disabled and you watch their view turn.
3. Refreshing the guest mid-match rejoins with the same score and players.
4. `npm run check` passes.

### M11 — Deploy to the web [Sonnet 5.5 High]
- M11.1 `base: './'`; production smoke test (`npm run build && npm run preview`, play a hot-seat kick).
- M11.2 GitHub repo on the user's account (`gh` if logged in, otherwise step-by-step instructions; ask before pushing) and `.github/workflows/deploy.yml` (build → upload-pages-artifact → deploy-pages); Pages source set to "GitHub Actions".
- M11.3 README: how to play, host and join; troubleshooting (TURN env vars, PeerJS server).

Acceptance:
1. The public URL loads the menu over HTTPS.
2. Host on one network and join from another (e.g. a phone hotspot): they connect and play a few kicks.

### M12 — Visual polish: players, ball, stadium [Sonnet 5.5 High]
- M12.1 Low-poly humanoids built from primitives (kit, socks, boots, skin tones, hair), shirt numbers, GK kit with gloves and an arms-spread pose, idle sway.
- M12.2 Kick animation, keeper catch pose, possessor ring.
- M12.3 Stadium: stands, instanced crowd billboards, ad boards, floodlights.
- M12.4 Grass detail, ball texture, performance budget (≥ 60 fps on a mid laptop, ≤ 150 draw calls; `?debug` shows draw calls).

Acceptance: visual review; `?debug` shows ≥ 60 fps at 1080p on the user's machine.

### M13 — UI/UX polish and settings [Sonnet 5.5 High]
- M13.1 One consistent theme across menu, lobby, toss, placement, HUD and overlays.
- M13.2 How to play: rules from §2, controls from §6.2.
- M13.3 Lobby settings panel (§2.9), synced to the guest.
- M13.4 Team names and kit colors (colorblind-safe pairs); key-binding help (H).

Acceptance: every screen is styled; setting kicks per match to 10 gives half-time after 5 and full-time after 10.

### M14 — Audio [Sonnet 5.5 High]
- M14.1 WebAudio manager: kick (scaled by power), bounce, player thud, post clang, net swish, whistle (kickoff, half, full), crowd bed with goal roar and near-miss groan. Sounds are procedural or CC0, with licenses in `public/sfx/LICENSES.md`.
- M14.2 Volume and mute, persisted.

Acceptance: each event is audible at the right moment; mute persists across reloads; no audio errors in the console before the first click.

### M15 — Replays and quality of life [Sonnet 5.5 High]
- M15.1 Replay last kick (R) with a camera choice (chase, broadcast, behind goal) and slow motion.
- M15.2 Automatic goal replay (skippable).
- M15.3 Match log and full-time stats (shots, goals, saves, possession %).
- M15.4 Remember names and settings (localStorage).

Acceptance: a replay retraces the original path exactly; stats match a short test match.

### M16 — Touch and mobile [Sonnet 5.5 High]
- M16.1 Touch: drag for yaw, pinch to zoom, buttons for the map and camera height, large slider handles.
- M16.2 Responsive landscape layout; a "rotate your device" prompt in portrait.
- M16.3 Auto-detected performance mode (lower DPR and shadows).

Acceptance: a hot-seat match completes with touch only in Chrome device emulation (and on a real phone or tablet if available).

### M17 — Balance, feel and release QA [Opus 5.5 High]
- M17.1 Guided playtest with the user: collect feel issues (power range, curve, roll distance, GK size, X/Y, kickoff goals).
- M17.2 Tune constants; update §5.3, §5.10, the tests and the Changelog.
- M17.3 Bug bash: ball resting on a line, multiple contacts in one step, disconnect during playback, repeated rematch clicks, tab hidden during playback.
- M17.4 Final README, `v1.0.0` tag, redeploy (ask before pushing).

Acceptance: the user signs off on the feel; `npm run check` is green; the live site is updated.

## 13. Future ideas (out of scope for v1)
AI opponent · penalty shootout as a tie-break option · spectators · shareable replays · wind and weather · saved formations · WebSocket relay fallback · player-count variants (5-a-side).

## 14. Changelog
- 2026-11-05 — Plan created in the planning chat. Decided with the user: placement anywhere except the center circle (GK in own box, 1 m line margin); the toss winner picks a role (A = first pick + kickoff, B = last pick); real set pieces (ghost-taker throw-ins and corners, goal kick to the keeper); keepers with a wider reach that catch; a loft slider 0–55°; 40 shared kicks with half-time after 20, draws allowed; 20 s shot timer that auto-kicks; 105×68 m, X = 8 m, Y = 4 m; ties go to the non-kicking team; no offside or fouls; view aids: zoom, adjustable camera height, hold-Tab map, minimap; desktop first, touch later. Physics constants sanity-checked with a throwaway simulation (§5.10).
- 2026-11-05 — M0: the browser pane on the user's machine has no WebGL, so 3D checks use `scripts/webgl-shot.mjs` (headless Chrome + SwiftShader over CDP) alongside the pane (§4, §10). `Settings` + `DEFAULT_SETTINGS` were added early in `game/settings.ts` so no layer hardcodes 105/68 before M6.1; `base: './'` set already in M0 (M11.1 only needs to verify it). TypeScript 7.0.2 works; no fallback needed.
- 2026-11-05 — M1: added `app/inspect.ts` to §4 (the shared inspect view used until each mode has its own). Sun shadows use `PCFShadowMap` + `shadow.radius` because three r187 removed `PCFSoftShadowMap`.
- 2026-11-05 — M2: physics matches the §5.10 planning check with the §5.3 constants unchanged (P25 29.2 m, P50 55.7, P100 93.9; P100 L15 carry 36.2 / apex 3.0; L35 53.3 / 12.1; chip 12.2 / 3.3; curve 4.1 and 2.8 m). "Apex" in §5.10 means the ball-center height above the ground. Added `sim/analyze.ts` and `scripts/sim-table.mjs` + `scripts/simTable.ts` (§4). `step.ts` exposes the §5.5 phases (`integrate`, `collideGround`, `settleRolling`) so M3 inserts world collisions between them; `simulateKick({ input, origin, team, caps?, turnId?, consts? })` takes a `KickOrigin` (player with id/team/gk, or ghost ball spot) and optional constants for the Lab. Ghost ball spots: `kickoffSpot`, `cornerSpot`, `throwInSpot` in `kick.ts`.
- 2026-11-05 — M3: `simulateKick` takes an optional `world` (from `buildWorld(pitch, players, kicker)`); without it the ball flies over the empty plane with no lines (M2 tests, sim:table). Contacts count as touches/events only when the ball is approaching the obstacle (vn < 0); a net contact also damps spin by NET_TANGENT_KEEP. Possession tie rule implemented as: players within 0.01 m of the closest distance are tied → the non-kicking team's players win → then the lowest id. No constants changed.
- 2026-11-05 — M4: the Lab reuses the inspect view (pitch, goals, ball, orbit + keys 1–4), which gained `suspend()`/`resume()` so playback cameras can borrow the camera. Playback-camera switches (C) are a 0.9 s eased blend between continuously tracking rigs. `aimPose` (§6.1) landed in `render/cameras.ts` early for the chase start. lil-gui pinned at 0.21.0 and lazy-loaded (separate chunk). The Lab exposes `window.__lab` for scripted checks. No constants changed.
- 2026-11-05 — M5: added `app/kickFlow.ts` (turn cycle shared by practice and the match views; `requestKick` → `play(result)` is async-ready for online) and `app/practiceRules.ts` (pure practice layout + next kicker) to §4. `shared/rng.ts` (mulberry32) was written in M5.5 for the practice layout (M6.1 builds on it). Aim drag convention: drag right turns right, drag up looks up. While the hold-Tab map is open, the kick side bar, HUD and minimap are hidden. During playback the kicker's figure stays hidden while it stands between the camera and the ball (the chase camera starts right behind it). Practice outs and goals restart with a center kickoff by the conceding team / the team that didn't touch last. No constants changed.
- 2026-11-05 — M6: the goal `Outcome` also carries `z` (where the ball crossed the goal line), so a throw-in straight into the thrower's own goal gives the corner on the correct side (§2.6.1). `GameState.last` also records the kicking `team` and `disallowed` (throw-in goal that didn't count) for the HUD toasts.
- 2026-11-05 — M7: added `app/hotseat.ts`, `app/placementModel.ts` (pure, tested) and `render/placementOverlay.ts` (§4). `app/matchView.ts` was created in M7 (toss + placement + a hand-off stub); M8.1 extends it with the play phase. The `Session` interface is `{ kind, state, localSeats, send(seat, intent), randomPick(seat), onState, onKick, onDenied, dispose }` (refusals arrive via `onDenied`, so Local/Host/Guest look alike). Seat names are sanitized in `newMatch` (`sanitizeName`, max 16 characters, fallback "Player 1/2"). Placement camera: left-drag pans, right-drag rotates, wheel zooms, WASD pans, T = top view; the view is framed left of the side panel. Spots on red can't be placed (rather than placed and blocked at Confirm); Confirm still re-checks the whole pick (count, keeper, guard).
- 2026-11-05 — M8: added `app/playView.ts`, `app/matchText.ts`, `app/shotTimer.ts`, `app/mapControls.ts` (§4). `ui/hud.ts` and `ui/screens.ts` implemented. The match view keeps a "shown" state that lags `session.state` until a kick's playback ends, so the score, half-time and full-time appear after the ball is watched. The half-time card closes itself after 6 s (Continue / Space / Enter sooner) so it stays inside the host guard's 15 s grace (§8.4). `?autoplace` also skips name entry (default names) and the toss winner takes Team A: it is the fast test route. The M7 hand-off stub and its "New draft" button are gone (Rematch replaces it). No rules or constants changed.
- 2026-11-05 — M9: added `net/link.ts` (HostLink / GuestLink: handshake, heartbeat, seat reservation) and `app/online.ts` (lobby modes) to §4. Protocol (§8.2, still version 1): ping/pong go both ways so each side shows its own RTT; `welcome` carries the host's name for the guest's lobby; the guest may send `bye` when it leaves on purpose so the host notices at once (silence still catches closed tabs within ~8 s). A host lobby with no match yet frees seat 1 as soon as the guest drops (no 120 s reservation until a match is on). peerjs 1.5.5 pinned and lazy-loaded.
- 2026-11-05 — M10.1–M10.4: `game/serialize.ts` does base64 itself (little-endian float32, no Buffer/btoa) so it stays pure. The `Session` interface gained `aim(seat, turnId, yaw)` / `onAim(cb)` (hot-seat streams too: it feeds the host guard's yaw). `GuestSession.attach(link)` keeps the same session (and match view) across a reconnect. While spectating, the kick bar is hidden (the opponent's sliders are never shown) and C toggles the kicker view ↔ broadcast (kept between turns); during playback C still toggles chase ↔ broadcast. The placement timer runs on both devices (the opponent sees the countdown); at 0 the placing device keeps its legal tentative spots and fills the rest. New dev flags `?shot=N` / `?place=N` (§3.3) until the M13 settings panel. The wire `kick` message carries no `auto`/`seat`: the guest derives the seat from its previous state.
- 2026-11-05 — M10.5–M10.A: the guest's mid-match reconnect backoff is 1, 2, 4, 8, 16, 29 s (60 s in all, §8.5), then a manual "Try again"; the lobby (before a match) keeps the manual Reconnect. PeerJS runs with `debug: 0` (its own logs duplicated errors the UI already shows, e.g. room-not-found while retrying). Host-refresh recovery (optional) not implemented.
- 2026-11-05 — M12.2: added `render/figureAnim.ts` (pure poses for the kick, the keeper's catch and the possessor ring) to §4. `PlayersView` gained `setPossessor`, `playWindup`, `playKick`, `playCatch`, `relax`; players that animate swap their merged mesh for a body + legs + arms rig. The ring is hidden while the possessor's figure is hidden (the aim view), so it never marks anything about the aim. No rules or constants changed.
