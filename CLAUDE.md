# CLAUDE.md — Footy

Browser 3D turn-based football: Three.js + Vite + TypeScript, hot-seat and online P2P (PeerJS), static hosting.
- Rules, architecture, physics, protocol, milestones: **PLAN.md**
- Checklist and current status: **PROGRESS.md**

The user works hands-off: they set a model, type `continue`, and expect you to drive. Make reasonable calls that fit PLAN.md; ask only when a decision really belongs to the user.

## Start of every chat
1. Read **PLAN.md** and **PROGRESS.md** in full before doing anything else.
2. When the user types **`continue`**, resume at the **first unchecked item** in PROGRESS.md. Read its Status block and Notes first: a task may be half-done.
3. Check the milestone's model tag (PLAN.md §12). If you are not that model, say so in one line and ask the user to switch before starting.

## While working
- Do the current milestone's tasks in order. Never start the next milestone in the same chat.
- **After each completed task:**
  1. For code tasks, `npm run check` must be green. For visual tasks, verify in the browser pane (dev server "footy-dev" from `.claude/launch.json`, port 5173) with no console errors.
  2. **Update PROGRESS.md**: tick the box and refresh the Status block (current milestone, next task, model for the next task, date, notes).
  3. Commit locally, with a message like `M3.2: <what changed>`. Never push, add remotes or create repos unless the user says so (M11 and M17 ask first).
- A milestone's last item (`Mx.A`) means: run its acceptance checks from PLAN.md §12 yourself (tests and browser pane), then list them for the user to re-check.
- Keep `src/shared/`, `src/sim/`, `src/game/` and `src/net/protocol.ts` pure: no DOM, Three.js or PeerJS. Read tunables from `Settings` and `sim/constants.ts`; never hardcode 105/68/8/4/40/20.
- **No aim aids in game modes**: no aim arrow, trajectory, landing marker, crosshair, or facing direction on the maps. Debug lines belong only in `#/lab` and `?debug`.
- If the plan has to change (a rule, constant or architecture), edit PLAN.md, add a dated line to its §14 Changelog, and tell the user.
- Put deviations, known issues and "stopped mid-task at …" notes in PROGRESS.md → Notes.

## Stopping points (mandatory)
Stop and hand back to the user:
- **at the end of every milestone**, and
- **mid-milestone when the conversation is getting long** (many large files read or written, long debugging, or earlier details getting fuzzy). Finish or park the current task, write a Note in PROGRESS.md saying exactly where you stopped, commit, then stop.

Always end with exactly this block:

> **✅ Done:** <milestone or task id + name> — <one line on what works now>
> **Please check:** <numbered acceptance items for the user, with URLs or commands>
> **Next:** <next task id + name>
> **Switch to:** <Opus 5.5 · High effort | Sonnet 5.5 · High effort> (from PLAN.md §12)
> **New chat:** <YES — start a new chat | NO — stay in this chat>
> **Then type:** `continue`

"New chat" is **YES** at every milestone boundary and whenever you stop because the chat is long. It is **NO** only when you paused for something else (e.g. waiting for the user to try something or give information) and the chat is still short.

Model guide (PLAN.md §12): **Opus 5.5 · High** for core build work (M0–M10, M17); **Sonnet 5.5 · High** for deploy and polish (M11–M16).

## Commands
- `npm run dev`: dev server at http://localhost:5173 (routes: `#/`, `#/hotseat`, `#/host`, `#/join/CODE`, `#/practice`, `#/lab`; flags `?debug`, `?seed=N`, `?autoplace`, `?shot=N`, `?place=N`, `?touch`)
- `npm run check`: typecheck + unit tests (must pass before ticking a task)
- `npm run build` / `npm run preview`: production build
- `npm run sim:table`: physics tuning report (from M2)
