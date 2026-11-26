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

## 2026-11-26 — Milestones 2 and 3: city and streaming

**Built.** Twelve districts from an authored cell map; road lattice with three road classes;
per-district block fillers (towers, walk-ups, malls, villas, houses, farms, container yards,
warehouses, tank farms, piers, hotels, construction frames, the salvage yard); street furniture;
one shader for every static surface; streaming manager with workers, look-ahead, priority,
LOD 0–4, cross-fade, cache, budgets and the F3 overlay.

**Tested.** `cityplan.test.ts`, `generator.test.ts`, `streaming.test.ts` (20 tests). Self-test
steps `cells load`, `cells unload`, `no loading screen`.

**Failed / fixed.** Awnings and windows still showed noise after the first shader fix; cause was
hashing a per-vertex constant that picks up interpolation error — fixed with `flat` varyings.
Night was nearly black with blown-out windows; ambient, window brightness and neon placement
were retuned.

**Not built.** Occlusion culling. Interiors.

## 2026-11-26 — Milestones 4, 5 and 6: traffic, pedestrians, police

**Built.** Traffic agents with an intelligent-driver car-following model, signals, yield rules,
turn curves, lane changes and three tiers; conversion of a traffic car to a physical vehicle on
impact or theft; pedestrians on sidewalk rings with activities, weather, reactions and witness
reports; the wanted system (reports, last known position, sight checks, dispatch, search,
pursuit drivers, roadblocks, arrest, escape, notoriety).

**Tested.** `traffic.test.ts` (7), `npc_police.test.ts` (11).

**Failed / fixed.**
- Two cars in adjacent lanes both turned left into the same lane and overlapped → lane
  discipline (left turns from the inside lane) and following through junctions.
- Cars from different approaches met inside junctions → a junction reservation taken when a car
  passes its stop line, with opposing straight-through flows allowed together.
- Witnesses disappeared with their cell before their call connected → pending reports are kept
  when the caller's cell unloads.
- The player on foot was not an obstacle to traffic → added.
- The event log was flooded by streaming events, hiding others → streaming events are counted
  but not logged.

## 2026-11-26 — Milestones 7 and 8: missions, story, endings

**Built.** Narrative engine (conditions, effects, deterministic ending selection), exhaustive
reachability analysis, mission runner with ten objective types and checkpoints, decision and
ending flow, named characters, dev replay of any ending. Story content — story bible, 33-node
decision graph, 20-ending registry, 12 characters, 12 side missions — was authored against the
engine by a delegated writing agent and validated by `npm run validate:endings`; the validator
was then re-run independently.

**Tested.** `story.test.ts` (11), including a complete story played headless from the first
mission to ENDING_08 through every mission on the path, and all 20 endings selected in the
running game. Validator: 20/20 reachable, 5 035 344 complete paths, rarest ending 0.79 % of
paths, most common 15.65 %.

**Failed / fixed.** Two faults were in the tests themselves, not the game: a helper that waited
on the wrong step after a `collect` objective, and an infinite loop checking schedules that end
at hour 24.

**Simplified.** Ending final sequences are narrated over a staged camera, not played.

## 2026-11-26 — Milestone 9 and 10: systems, polish, verification

**Built.** Economy and nine kinds of interactive location; inventory items; save slots with
checksum, backup and recovery; map and minimap; world markers; decision, character, save and
ending screens; procedural audio; developer console; day/night, five weather states, wet roads.

**Tested.** `economy_save.test.ts` (9). Full suite: **76 passed, 0 failed**. Browser self-test:
**23 of 23 steps**. Benchmarks in `docs/PERFORMANCE.md`. Screenshots in `docs/screenshots/`.

**Performance.** Simulation step 0.34–0.46 ms mean. LOD0 cell generation 0.29 ms mean. A
201 km/h run with zero frames held for streaming. Browser frame rate 13 fps (low) and 4 fps
(medium) **under software rendering**; GPU frame rate not measurable here.

**Failed / fixed.** Worker dispatch happened once per frame, starving far cells at low frame
rates → dispatch also runs when a worker finishes. The map panel overflowed a 720p window →
constrained.

**Remaining.** See `docs/KNOWN_LIMITATIONS.md` and the "Next steps" list in
`docs/DEVELOPMENT_ROADMAP.md`. The largest gaps against the brief: visuals are procedural
placeholders, there are no interiors, no on-foot police or combat, ending sequences are staged
rather than played, and GPU performance is unverified.
