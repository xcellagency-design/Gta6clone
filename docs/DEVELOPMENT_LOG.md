# Development Log

Newest entries at the bottom. Every "tested" claim names the command that was run.

## 2026-11-26 — Milestone 0: research and setup

**Environment inspected.** Ubuntu 24.04 container, 4 vCPU, 15 GB RAM, no GPU, no display. No game
engine installed. Node 22, Rust 1.97, Python 3.13 and Chromium + Playwright present. npm, PyPI,
crates.io and apt reachable; GitHub release downloads return 403 and godotengine.org is
unreachable.

**Craft Anything.** Cloned `storytold/craft-anything` at `0a4e66b` (v0.6.1) outside this
repository and read the rebuild workflow, game kind, checks, agent adapters, MCP server and CLI.
Built the CLI (`cargo build -p craft-anything-cli --locked`, 5 m 09 s) and ran it:
`craft-anything-cli doctor` reports the binary, Chromium and its MCP server self-test (30 tools)
as OK, Claude Code as "installed but not connected", and no game engine. `rebuild` was **not**
run: it would start a second headless coding agent. Findings and the integration decision are in
`research/CRAFT_ANYTHING_ANALYSIS.md`.

**Engine.** Unreal, Unity and Godot cannot be installed here. A from-source build of Godot 4.6.3
was attempted and was denied by the session's permission system; it was not retried. Selected
TypeScript + three.js + Rapier (`docs/GAME_ARCHITECTURE.md` §1).

**Research.** `research/AAA_OPEN_WORLD_RESEARCH.md` written with evidence tags. Web pages could
not be fetched from this environment, so its citations rest on search-result extracts; the
document says so and lists what could not be verified.

**Technical spikes (all run).** Rapier raycast vehicle in Node: drives and steers. Chromium with
software WebGL2: renders the scene. Vite production build with a module worker: builds.

## 2026-11-26 — Milestone 1: playable prototype

**Built.** Fixed-step simulation (`GameSim`), Rapier physics wrapper, kinematic third-person
character (walk, run, sprint, crouch, jump, swim), orbit/chase camera with wall collision,
vehicle physics for six classes on Rapier's raycast controller plus buoyant boats, enter/exit,
procedural vehicle and character models, HUD, main menu, pause menu, settings, controls screen,
debug API, launcher with `--self-test` and `--screenshot`.

Built ahead of schedule because the prototype needed a world to stand in: the city plan, the
procedural cell generator, the city shader and the streaming manager (Milestones 2 and 3 are
tracked separately below and in the roadmap).

**Tested.**
- `npm test` — 38 tests pass: vehicle physics (every class settles, accelerates, shifts, brakes,
  reverses; steering direction; class differences; rain grip; wall damage; boat floats and
  turns), city plan (district map, road connectivity to every district including the island,
  signals, points of interest), generator (determinism, every cell at every LOD, LOD consistency,
  spawn clearance), streaming (LOD rings, priority, a 162 km/h cross-city drive with ground
  always loaded, hysteresis, cache, frame budget, cross-fade), headless gameplay (spawn, walk,
  sprint, crouch, jump, building collision, enter/drive/exit, parked cars streaming).
- `npm run selftest` — 13/13 steps pass in headless Chromium: launch, menu, spawn, move, camera,
  enter vehicle, act (drive), exit vehicle, hud, cells load, cells unload, no loading screen,
  render.
- Screenshots in `docs/screenshots/m1_*.png`.

**Failed / fixed along the way.**
- First tune of engine forces gave a sedan 0–100 km/h in about 14 s; retuned.
- Shader showed per-pixel noise on windows and awnings: hashes were seeded from interpolated
  per-vertex constants. Fixed by making style parameters `flat` varyings and taking
  screen-space derivatives outside branches.
- Different LODs of the same cell showed different buildings because LOD-specific code consumed
  random numbers. Fixed with per-parcel forked generators; a test now compares rooflines across
  LODs.

**Performance.** Not yet measured systematically (Milestone 9/10). Frame rate on this machine is
software-rendered and not representative.

**Known limitations at this point.** No traffic, pedestrians, police, missions, economy, saves or
audio yet. Characters are capsule mannequins. Motorcycles cannot fall over (their body only
yaws). The world is flat.
