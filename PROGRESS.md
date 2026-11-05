# Footy — Progress

> Tick a box as soon as its task is done and `npm run check` is green, then update the Status block.
> When the user types **continue**, resume at the first unchecked box.
> Task details and acceptance criteria live in PLAN.md §12.

## Status
- **Current milestone:** M1 — Pitch and goals (M0 done)
- **Next task:** M1.1 Striped grass + apron, receives shadows
- **Model for next task:** Opus 5.5 · High effort
- **Last updated:** 2026-11-05 (M0 complete)
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
- [ ] M1.1 Striped grass + apron, receives shadows
- [ ] M1.2 All pitch markings from `derivePitch`
- [ ] M1.3 Goals (posts, bar, net) + corner flags
- [ ] M1.4 Lighting, soft shadows, sky + fog
- [ ] M1.5 Inspect cameras (keys 1–4) + `?debug` axes and ruler
- [ ] M1.A Acceptance checks passed (browser pane) and reported to the user

## M2 — Ball flight physics · Opus 5.5 High
- [ ] M2.1 `vec3.ts`, `constants.ts`, `types.ts`
- [ ] M2.2 `kick.ts` (kick model, throw-in caps)
- [ ] M2.3 `step.ts` (forces, bounce, rolling, stop)
- [ ] M2.4 `simulate.ts` (loop, frames, events)
- [ ] M2.5 Physics tests incl. all PLAN §5.10 ranges
- [ ] M2.6 `npm run sim:table` tuning report
- [ ] M2.A Acceptance checks passed and reported to the user

## M3 — Collisions, goals, outs, possession · Opus 5.5 High
- [ ] M3.1 `world.ts` (hitboxes, goal frames, nets)
- [ ] M3.2 `collide.ts` (player, capsule, net rect, response, kicker grace)
- [ ] M3.3 Goal/out/catch events, last touch, tails
- [ ] M3.4 `game/possession.ts` (closest player + tie rule)
- [ ] M3.5 Collision + event tests
- [ ] M3.A Acceptance checks passed and reported to the user

## M4 — Playback renderer and Physics Lab · Opus 5.5 High
- [ ] M4.1 Ball mesh, rotation, shadow
- [ ] M4.2 Placeholder players + `?debug` hitboxes
- [ ] M4.3 Playback (interpolation, events, time-warp)
- [ ] M4.4 Chase + broadcast cameras (C toggles)
- [ ] M4.5 Physics Lab `#/lab` (dummies, kick inputs, event log, lil-gui constants)
- [ ] M4.A Acceptance checks passed (browser pane) and reported to the user

## M5 — Aiming and kicking (Practice mode) · Opus 5.5 High
- [ ] M5.1 Aim camera rig (yaw, pitch, zoom, height; kicker hidden; no crosshair)
- [ ] M5.2 Kick side bar (Power / Curve / Loft / height / KICK + keys + restart caps)
- [ ] M5.3 Kick flow: wind-up → simulate → playback → ease to next kicker
- [ ] M5.4 Hold-Tab overhead map + always-on minimap (no facing info)
- [ ] M5.5 Practice mode `#/practice`
- [ ] M5.A Acceptance checks passed (browser pane) and reported to the user

## M6 — Rules engine · Opus 5.5 High
- [ ] M6.1 `game/types.ts`, `game/settings.ts`, `shared/rng.ts`
- [ ] M6.2 `game/draft.ts` (schedule, validation, forced GK, GK guard)
- [ ] M6.3 `game/restarts.ts` (throw-in, corner, goal kick, throw-in goal exception)
- [ ] M6.4 `game/rules.ts` (match flow, half-time, full-time, rematch)
- [ ] M6.5 `game/host.ts` HostCore (intent validation, callbacks, guard)
- [ ] M6.6 Rules tests incl. scripted 40-kick match
- [ ] M6.A Acceptance checks passed and reported to the user

## M7 — Toss and placement UI (hot-seat) · Opus 5.5 High
- [ ] M7.1 Minimal main menu + hot-seat names
- [ ] M7.2 Coin toss + role choice
- [ ] M7.3 Placement camera, hover validity + reasons, exclusion rings, GK toggle
- [ ] M7.4 Tentative spots (place, drag, undo, confirm) + pick banner
- [ ] M7.5 LocalSession wiring; hand-off stub after pick 12
- [ ] M7.A Acceptance checks passed (browser pane) and reported to the user

## M8 — Hot-seat match · Opus 5.5 High
- [ ] M8.1 `app/matchView.ts` phase orchestration
- [ ] M8.2 Turn loop + ghost-taker restarts + catches
- [ ] M8.3 Functional HUD (score, kicks, shot timer + auto-kick, banners, toasts)
- [ ] M8.4 Half-time + full-time screens, Rematch
- [ ] M8.5 `?autoplace` + full-match smoke test and fixes
- [ ] M8.A Acceptance checks passed (browser pane) and reported to the user

## M9 — Networking and lobby · Opus 5.5 High
- [ ] M9.1 `net/protocol.ts` + `net/transport.ts` (Loopback)
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
