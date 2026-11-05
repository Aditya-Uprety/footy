# Footy — Progress

> Tick a box as soon as its task is done and `npm run check` is green, then update the Status block.
> When the user types **continue**, resume at the first unchecked box.
> Task details and acceptance criteria live in PLAN.md §12.

## Status
- **Current milestone:** M9 — Networking and lobby (M0–M8 done)
- **Next task:** M9.2 `net/peer.ts` (PeerJS, room codes, ICE, errors)
- **Model for next task:** Opus 5.5 · High effort
- **Last updated:** 2026-11-05 (M9.1 done)
- **Notes / blockers:** browser pane has no WebGL here; use `scripts/webgl-shot.mjs` for 3D checks (see Notes)

## M0 — Scaffold and tooling · Opus 5.5 High
- [x] M0.1 npm project: Vite + TS strict + three + vitest, pinned versions, scripts, .gitignore
- [x] M0.2 Folder skeleton + `shared/pitch.ts` (`derivePitch`)
- [x] M0.3 Renderer bootstrap, temporary ground + OrbitControls, `?debug` FPS
- [x] M0.4 Hash router with placeholder screens + query flags
- [x] M0.5 Tests: pitch dimensions + architecture purity
- [x] M0.6 `.claude/launch.json` + README stub
- [x] M0.A Acceptance checks passed (browser pane) and reported to the user

## M1 — Pitch and goals · Opus 5.5 High
- [x] M1.1 Striped grass + apron, receives shadows
- [x] M1.2 All pitch markings from `derivePitch`
- [x] M1.3 Goals (posts, bar, net) + corner flags
- [x] M1.4 Lighting, soft shadows, sky + fog
- [x] M1.5 Inspect cameras (keys 1–4) + `?debug` axes and ruler
- [x] M1.A Acceptance checks passed (browser pane) and reported to the user

## M2 — Ball flight physics · Opus 5.5 High
- [x] M2.1 `vec3.ts`, `constants.ts`, `types.ts`
- [x] M2.2 `kick.ts` (kick model, throw-in caps)
- [x] M2.3 `step.ts` (forces, bounce, rolling, stop)
- [x] M2.4 `simulate.ts` (loop, frames, events)
- [x] M2.5 Physics tests incl. all PLAN §5.10 ranges
- [x] M2.6 `npm run sim:table` tuning report
- [x] M2.A Acceptance checks passed and reported to the user

## M3 — Collisions, goals, outs, possession · Opus 5.5 High
- [x] M3.1 `world.ts` (hitboxes, goal frames, nets)
- [x] M3.2 `collide.ts` (player, capsule, net rect, response, kicker grace)
- [x] M3.3 Goal/out/catch events, last touch, tails
- [x] M3.4 `game/possession.ts` (closest player + tie rule)
- [x] M3.5 Collision + event tests
- [x] M3.A Acceptance checks passed and reported to the user

## M4 — Playback renderer and Physics Lab · Opus 5.5 High
- [x] M4.1 Ball mesh, rotation, shadow
- [x] M4.2 Placeholder players + `?debug` hitboxes
- [x] M4.3 Playback (interpolation, events, time-warp)
- [x] M4.4 Chase + broadcast cameras (C toggles)
- [x] M4.5 Physics Lab `#/lab` (dummies, kick inputs, event log, lil-gui constants)
- [x] M4.A Acceptance checks passed (browser pane) and reported to the user

## M5 — Aiming and kicking (Practice mode) · Opus 5.5 High
- [x] M5.1 Aim camera rig (yaw, pitch, zoom, height; kicker hidden; no crosshair)
- [x] M5.2 Kick side bar (Power / Curve / Loft / height / KICK + keys + restart caps)
- [x] M5.3 Kick flow: wind-up → simulate → playback → ease to next kicker
- [x] M5.4 Hold-Tab overhead map + always-on minimap (no facing info)
- [x] M5.5 Practice mode `#/practice`
- [x] M5.A Acceptance checks passed (browser pane) and reported to the user

## M6 — Rules engine · Opus 5.5 High
- [x] M6.1 `game/types.ts`, `game/settings.ts`, `shared/rng.ts`
- [x] M6.2 `game/draft.ts` (schedule, validation, forced GK, GK guard)
- [x] M6.3 `game/restarts.ts` (throw-in, corner, goal kick, throw-in goal exception)
- [x] M6.4 `game/rules.ts` (match flow, half-time, full-time, rematch)
- [x] M6.5 `game/host.ts` HostCore (intent validation, callbacks, guard)
- [x] M6.6 Rules tests incl. scripted 40-kick match
- [x] M6.A Acceptance checks passed and reported to the user

## M7 — Toss and placement UI (hot-seat) · Opus 5.5 High
- [x] M7.1 Minimal main menu + hot-seat names
- [x] M7.2 Coin toss + role choice
- [x] M7.3 Placement camera, hover validity + reasons, exclusion rings, GK toggle
- [x] M7.4 Tentative spots (place, drag, undo, confirm) + pick banner
- [x] M7.5 LocalSession wiring; hand-off stub after pick 12
- [x] M7.A Acceptance checks passed (browser pane) and reported to the user

## M8 — Hot-seat match · Opus 5.5 High
- [x] M8.1 `app/matchView.ts` phase orchestration
- [x] M8.2 Turn loop + ghost-taker restarts + catches
- [x] M8.3 Functional HUD (score, kicks, shot timer + auto-kick, banners, toasts)
- [x] M8.4 Half-time + full-time screens, Rematch
- [x] M8.5 `?autoplace` + full-match smoke test and fixes
- [x] M8.A Acceptance checks passed (browser pane) and reported to the user

## M9 — Networking and lobby · Opus 5.5 High
- [x] M9.1 `net/protocol.ts` + `net/transport.ts` (Loopback)
- [ ] M9.2 `net/peer.ts` (PeerJS, room codes, ICE, errors)
- [ ] M9.3 Lobby UI (host / join / link / status + RTT)
- [ ] M9.4 Handshake, heartbeat, disconnect overlay
- [ ] M9.5 Protocol + handshake tests
- [ ] M9.A Acceptance checks passed (two windows) and reported to the user

## M10 — Online match · Opus 5.5 High
- [ ] M10.1 `net/hostSession.ts` (snapshots, kick results)
- [ ] M10.2 `net/guestSession.ts` (intents on own turn only)
- [ ] M10.3 Aim-yaw streaming + spectator camera
- [ ] M10.4 Shot timer + host guard + placement timer
- [ ] M10.5 Resume/reconnect, seat reservation, online rematch
- [ ] M10.6 Networked full-match integration test
- [ ] M10.A Acceptance checks passed (two windows + two devices) and reported to the user

## M11 — Deploy to the web · Sonnet 5.5 High
- [ ] M11.1 Relative base + production smoke test
- [ ] M11.2 GitHub repo + Pages workflow (ask before pushing)
- [ ] M11.3 README: play / host / join + troubleshooting
- [ ] M11.A Acceptance checks passed (public URL, cross-network) and reported to the user

## M12 — Visual polish: players, ball, stadium · Sonnet 5.5 High
- [ ] M12.1 Low-poly humanoid players, kits, numbers, GK pose
- [ ] M12.2 Kick animation, catch pose, possessor ring
- [ ] M12.3 Stadium, crowd, ad boards, floodlights
- [ ] M12.4 Grass/ball detail + performance budget
- [ ] M12.A Acceptance checks passed and reported to the user

## M13 — UI/UX polish and settings · Sonnet 5.5 High
- [ ] M13.1 Consistent theme across all screens
- [ ] M13.2 How-to-play screen
- [ ] M13.3 Lobby settings panel synced to guest
- [ ] M13.4 Team names, kit colors, key-binding help
- [ ] M13.A Acceptance checks passed and reported to the user

## M14 — Audio · Sonnet 5.5 High
- [ ] M14.1 Audio manager + all event sounds (licenses recorded)
- [ ] M14.2 Volume / mute, persisted
- [ ] M14.A Acceptance checks passed and reported to the user

## M15 — Replays and quality of life · Sonnet 5.5 High
- [ ] M15.1 Replay last kick (cameras, slow-mo)
- [ ] M15.2 Auto goal replay (skippable)
- [ ] M15.3 Match log + full-time stats
- [ ] M15.4 Remember names and settings
- [ ] M15.A Acceptance checks passed and reported to the user

## M16 — Touch and mobile · Sonnet 5.5 High
- [ ] M16.1 Touch controls
- [ ] M16.2 Responsive landscape layout + rotate prompt
- [ ] M16.3 Performance mode
- [ ] M16.A Acceptance checks passed and reported to the user

## M17 — Balance, feel and release QA · Opus 5.5 High
- [ ] M17.1 Guided playtest with the user
- [ ] M17.2 Constant tuning + docs/tests updated
- [ ] M17.3 Bug bash on edge cases
- [ ] M17.4 Final README, v1.0.0 tag, redeploy (ask before pushing)
- [ ] M17.A User sign-off

## Notes
<!-- Short dated notes: deviations from PLAN.md, known issues, where a half-finished task stopped. -->
- 2026-11-05 — **The browser pane has no WebGL on this machine** (GPU disabled in its sandbox; `getContext('webgl2')` returns null). DOM-only checks (routes, overlays, console) still use the pane; 3D views are verified with `node scripts/webgl-shot.mjs <url> <out.png> [steps]` (headless Chrome + SwiftShader over CDP: screenshots, console errors, `eval:`, `drag:`, `wheel:`, `key:`, `click:`). The dev server must be running (footy-dev).
- 2026-11-05 — M0 notes: `src/main.ts` holds a temporary "inspect view" (temp ground + OrbitControls + lights) shared by all routes; M1 replaces the ground and adds the inspect cameras. Placeholder screens live in `ui/placeholders.ts`. `game/settings.ts` already exports `Settings`/`DEFAULT_SETTINGS` (M6.1 adds ranges/validation). Pitch tests were written in M0.2; M0.5 added `architecture.test.ts` and `app/router.test.ts`. `.claude/launch.json` also has "footy-preview" (port 4173).
- 2026-11-05 — M1 notes: the inspect view (pitch, goals, environment, orbit camera, keys 1–4, debug aids) lives in `app/inspect.ts` and is still shared by every route; later modes bring their own views. `?debug` sets `window.__footy = { stage, controls, pitch, goTo, ruler }`. Markings are one merged mesh lifted 4 mm with polygon offset; the outer ground has a hole under the pitch (it z-fought at distance before). three r187 removed `PCFSoftShadowMap`, so the sun uses `PCFShadowMap` with `shadow.radius` 3 (4096 map). Draw calls ≈ 50–70 with shadows (goal tubes are separate meshes; merge in M12.4 if needed). M1 acceptance measured with real Shift+clicks: circle radius 9.16, box depth 16.47, penalty mark 11.01, between posts 7.42 (clicks on the post faces; inner edges are 7.32 by construction).
- 2026-11-05 — Watch item (M12.4): in headless SwiftShader, lines farther than ~40 m break into dashes at grazing angles (sub-pixel width). Ask the user whether it shows on a real GPU with MSAA; if so, fade/widen distant lines or move markings to a mipmapped texture.
- 2026-11-05 — M2 notes: §5.10 matched with the §5.3 constants unchanged (see `npm run sim:table`). `step.ts` is split into `integrate` → `collideGround` (airborne only) → `settleRolling`; M3 should insert players → frame → nets between `collideGround` and `settleRolling` in `simulate.ts`, record a frame on each contact step, and handle "a contact that leaves v.y > V_SETTLE ends rolling". `simulateKick` takes `{ input, origin: KickOrigin, team, caps?, turnId?, consts? }`; M3 adds the world/pitch argument. `kickStats().apex` = ball-center height above the ground (what §5.10 means). Hitbox sizes are `HITBOX` in `sim/constants.ts`; ghost ball spots are `kickoffSpot` / `cornerSpot` / `throwInSpot` in `sim/kick.ts`. `SimEvent` contact events carry t, x, y, z, speed (+ `tail?`).
- 2026-11-05 — M3 notes: `simulateKick({ ..., world })` takes `buildWorld(pitch, players, kicker)`; without `world` it is the M2 empty infinite plane (no obstacles, no lines), which `sim:table` and the M2 tests still use. `World` = `hitboxes`, `frame` (6 capsules), `nets` (8 rects: back/sideL/sideR/roof per goal), `lines`, `kickerId`; any object with `{ id, team, x, z, gk }` works as a player (game `PlayerSpot` fits). Step order: integrate → ground → players (keeper ⇒ CATCH, stops at once) → frame → nets → settle → `detectLines` (exported). A contact counts as a touch/event only when the ball was approaching (vn < 0). Net contacts also damp spin by NET_TANGENT_KEEP (plan left spin open). Tail contact events carry `tail: true`; no `stop` event is emitted for goal/out results. Goal/out event `t` is the step time (not interpolated). `game/possession.ts` `closestPlayer(players, x, z, kickingTeam)`: tied set = within 0.01 m of the minimum → prefer the non-kicking team → lowest id. The kicker's ball-at-feet spot (§2.5.7) is already `kickStart` in `sim/kick.ts`.
- 2026-11-05 — M4 notes: `app/inspect.ts` now exposes `ball`, `controls`, `pickRoots`, `suspend()` / `resume(target, fov)` so a mode can borrow the camera (the Lab does this during playback); `main.ts` swaps views per route (Lab vs the shared inspect view). `render/cameras.ts` already has `aimPose(ball, yaw, h, pitch?)`, `aimBackDistance`, `aimDefaultPitch` (ball 22° below center) and `AIM_HEIGHT_MIN/MAX` for M5.1, plus `createPlaybackCamera(camera, pitch)` (chase/broadcast; `start(ball, yaw, h)`, `toggle()`, `update(dt, ball, vel)`; C blends over 0.9 s; FOV 60 chase / 34 broadcast). `render/playback.ts` `KickPlayback(result, { onEvent, onEnd, autoSlowRolls, keeperAt, consts })`: `update(realDt, { fastForward })` returns sim dt, then `applyTo(ball, simDt)`; catch snaps the ball to `keeperHands`. `render/players.ts` `createPlayersView({ hitboxes })` with `setPlayers`, `setHidden(id)` (for the aim view), `setHitboxesVisible`, `pickTargets`/`idOf`; default facing = toward the opponent's goal. The Lab exposes `window.__lab` (addDummy, setOrigin, setInput, preset, kick, replay, toggleCamera, setFastForward, setConst, log, playback, camera) for scripted webgl-shot checks. Airborne ball rotation uses only spin0 (sidespin), so an uncurved lofted ball doesn't visibly rotate in flight: revisit in M12.
- 2026-11-05 — M5 notes: `app/aimController.ts` = aim rig (pure helpers `applyDrag`, `stepAimKeys`, `zoomFov`, `withHeight`, `aimStatePose`; the controller drives the stage camera and the ball while `active`). `ui/kickPanel.ts` = side bar (custom vertical sliders; `setCaps({ throwIn })`, `input(yaw)`, `onKick`, `update(dt)` for held keys). `app/kickFlow.ts` = turn cycle: `startTurn({ origin, yaw, caps }, { instant })`, `kick()`, `play(result)` (may arrive late), `onPlaybackEnd` → mode calls `startTurn` again; F/C keys live here. `render/overheadMap.ts` + `ui/minimap.ts` share `mapContent(players, kickerOrigin, ballOrNull)` (no yaw parameter by design) and support orientation ±1 for online Team B. `app/practice.ts` exposes `window.__practice` (aim, panel, flow, players, turn, giveBall, newLayout, showMap, content, ballNdc) for webgl-shot checks. Practice reuses the inspect view with its orbit camera suspended. A shared `[hidden] { display: none !important }` rule was added to styles.css. Known nit: the chase camera can pass through other (non-kicker) players' figures after a deflection; fade near-camera figures in M12.
- 2026-11-05 — M5.A: verified with webgl-shot on ?seed=7: 2×1200 px drag = 360° (yaw back to 0), wheel FOV 37°→75° (clamped), height 4 m keeps the ball at the same screen spot; power 50/curve 0/loft 0 ball stays at NDC x = 0 through playback; curve ±100 at power 75/loft 10 bends ±11.2 m (right/left); power 30 (also 25), loft 55° chips over an opponent 6 m away (first bounce ~12 m) while a low drive hits him; overhead map screenshots before/after rotating are byte-identical; after a stop the camera eases to the closest player and drag/keys work again. No console errors. The browser pane itself still has no WebGL (and can't reach this folder's dev server, which another chat started), so all 3D checks used `scripts/webgl-shot.mjs`.
- 2026-11-05 — M6 notes: `game/rules.ts` functions return a NEW state (rev + 1) and throw `RuleError { reason, violations? }` on illegal calls; `HostCore.handle` turns those into `{ ok: false, reason, violations? }`. `activeSeat(s)` says who must act; `teamOfSeat` / `seatOfTeam` map seats. Player ids are 1-based in placement order; shirts GK 1, outfield 2–11 in placement order. `game/draft.ts`: `pickInfo(pick)`, `gkForced(state, team)`, `spotViolations(pitch, settings, placed, team, spot)` (rules a–d, for the M7 hover marker; pass confirmed players + the pick's other tentative spots), `validateSpots` (whole pick incl. GK count/forced/guard), `findGkSpot`/`gkSpotExists` (guard grid), `randomPick(state, team, rng, keep?)` (placement timer / ?autoplace; `HostCore.randomPickFor(seat)` wraps it). `game/restarts.ts` `decideRestart` + `kickoffPossession` etc. Ghost kickers store the ball spot; `rules.kickOrigin(s, possession)` gives the physics origin, `kickCaps(possession)` the throw-in caps, `host.defaultYaw(s)` the initial aim (toward the attacked goal). HostCore: `onKick` fires `{ result, next, seat, auto, guard }` (no `onState` for kicks: clients apply `next` after playback); `onState` for everything else; `noteAim(seat, yaw)`; `tick(nowMs)` + `deadline()` for the guards (shot timer + previous playback + 15 s; placement timer + 15 s); `new HostCore({ settings, names, seed, now?, state? })`. Practice still uses its own `app/practiceRules.ts` (unchanged). `game/testUtil.ts` `draftedMatch(seed, settings?)` = toss + random draft, for tests (and handy for ?autoplace).
- 2026-11-05 — M6.A: `npm run check` green (29 files, 258 tests); the scripted HostCore match (seed 2026, random aimed kicks) reaches full-time after 40 kicks: Team A 0 : 1 Team B (goal 1, out 2, stop 37; restarts open, kickoff, throw-in, goal kick). Run `npx vitest run src/game/host.test.ts -t scripted --reporter=verbose` to see the log line. No browser check (pure code, nothing rendered).
- 2026-11-05 — M7 notes: `app/hotseat.ts` = the #/hotseat mode (name entry over a turning pitch → `LocalSession` → `createMatchView`; "New draft" restarts with the same names; ?seed=N gives seed N, N+1, … per restart). `app/session.ts` `Session` = `{ kind, state, localSeats, send(seat, intent), randomPick(seat), onState, onKick, onDenied, dispose }`; `LocalSession` wraps HostCore (guards ticked every 500 ms on performance.now; tests pass `tickMs: 0`). **`app/matchView.ts` already exists** (created in M7.2, not M8.1): it owns the match backdrop (inspect view from the match settings) and the confirmed `PlayersView`, and maps phases → views (toss → `ui/toss.ts`; placement → `app/placementView.ts`; play/fulltime → hand-off stub card). M8.1 extends it with the play phase instead of creating it. Phase views get `sync(state)` on every state. `app/placementModel.ts` (pure, tested) holds one pick's tentative spots + keeper toggle/forced lock; `render/placementOverlay.ts` draws no-go zones, own box, X/Y rings, player discs, hover marker. The placement camera re-maps the shared OrbitControls (left = pan, right = rotate) and restores them on dispose; `render/cameras.ts` `placementPose(pitch, aspect, fov, { polarDeg, inset })` frames the pitch left of the side panel. `game/rules.ts` gained `sanitizeName`/`defaultName`/`NAME_MAX` (newMatch sanitizes names). Scripting hooks: `window.__hotseat` (session, match) and `window.__placement` (model, `screenOf(x, z)`, `top()`). `scripts/webgl-shot.mjs` gained `move:`, `rclick:` and `js<step>:<expr>` (coordinates from JS, e.g. `jsclick:__placement.screenOf(-20,5)`). M7.3 and M7.4 were committed together (same files). Known nits: under ?debug the FPS counter overlaps the placement panel's top-right corner; the debug ruler's line is hard to see over the placement overlay (the label is fine). `?autoplace` is still M8.5 (`session.randomPick(seat)` already does the work).
- 2026-11-05 — M7.A: verified with webgl-shot (seeds 3, 5, 11): menu → setup → toss (coin lands on the drawn winner) → role → picks; banner order Red1 Blue2 Red2 Blue2 Red2 Blue2 Red2 Blue2 Red2 Blue2 Red2 Blue1 → play; hover reasons "Too close to a line", "Inside the center circle", "Too close to a teammate (4.9 m, needs 8 m)", "Too close to an opponent (3 m, needs 4 m)", "The keeper must stand in your own penalty area"; clicks on red spots place nothing; illegal drags snap back with the reason; forced keeper locks the last slot ("Your last player must be the keeper"); ?debug ruler between two confirmed Blue players placed 9 m apart = 8.98 m; Shift+clicks don't place. The browser pane (no WebGL) shows menu, setup and toss and then a "needs WebGL" card; no console errors apart from the expected WebGL warnings.
- 2026-11-05 — M8 notes: `app/playView.ts` runs the turn loop (aim → `intent{kick}` → `onKick` → playback → apply `next` → toast → half-time card? → next turn); `app/matchView.ts` routes `onKick` to it and switches to the full-time view only when the play view reports `next` applied (`onApplied`). States that arrive mid-playback wait (`busy`); kicks that arrive mid-playback queue (e.g. a host-guard kick while the tab slept). `kickFlow.play()` now also accepts a result while aiming (guard kick / the other seat online): it locks the controls first. Shot timer = `app/shotTimer.ts`, started on the flow's `aim` phase, auto-kick with `auto: true` at 0; ring red under 5 s. HUD texts in `app/matchText.ts` (tested). Hold-Tab map + minimap moved to `app/mapControls.ts` (practice uses it too). Scripting hook `window.__match` (flow, aim, panel, timer, maps, shown, `kickNow({yaw, power, curve, loft})`, `setFastForward`). For crafted situations in checks: `__hotseat.session.core.commit({...state, rev+1, turnId+1, possession})` (private in TS, reachable in JS). M8.1–M8.5 were written together and committed as one. Balance watch (M17): a straight 70 % rolling kickoff scored past an off-centre keeper on seed 3.
- 2026-11-05 — M8.5 smoke test (seed 11, headless, random kicks + fast-forward): 40 kicks → full-time "Draw"; turn 1 left idle → shot timer auto-kicked (`auto: true`); throw-ins came up with power 45 / curve 0 caps; goal kicks to the keeper; half-time after kick 20 with Blue kicking off ("Kick 21/40 · 2nd half"); toasts "Out — touchline" → "Throw-in — Blue", "Out — goal line" → "Goal kick — Red"; no console errors. Crafted: a shot 14 m in front of Blue's keeper → "Saved! / Blue #1 (GK)" and "Blue #1 (GK) has the ball"; a corner ghost puts the ball at (52, −33.5) with the camera behind it; kick 40 → full-time card → Rematch → new match. No fixes were needed beyond the work itself.
- 2026-11-05 — M8.A: verified with webgl-shot (`?autoplace` seeds 3 and 11, plus `?seed=3` through the Start button and the Team A role card): full 40-kick match → full-time; crafted goal → "GOAL!" then "Goal — Red / Red 1 – 0 Blue", Blue kicks off from the center; throw-ins capped (45 / 0, locked); goal line off the attacker → "Goal kick — …", keeper has the ball; corner ghost in the correct corner (natural corners are covered by the restarts unit tests; none came up in the random match); keeper hit → "Saved!"; idle turn → auto-kick at 0; half-time after kick 20 with the other team kicking off; full-time after 40; Rematch starts a new match. No console errors. The browser pane could not start its own server (port 5173 held by another chat's server), so the pane check was skipped; everything ran headless.
