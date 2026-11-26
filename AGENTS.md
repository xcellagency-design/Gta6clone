# Working on UNDERTOW: Port Meridian

An original open-world crime game in TypeScript + three.js + Rapier. Read
`docs/GAME_ARCHITECTURE.md` before changing structure and `docs/DEVELOPMENT_ROADMAP.md` for what
is done and what is next.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Typecheck (`tsc --noEmit`) and build to `dist/` |
| `npm test` | Vitest unit and headless integration tests |
| `npm run validate:endings` | Narrative structure and ending reachability |
| `npm run selftest` | Gameplay self-test in headless Chromium (needs a build) |
| `node tools/launch.mjs --screenshot out/x.png --scene downtown` | Screenshot a named scene |

## Rules

1. **Simulation never imports rendering.** Code outside `src/render`, `src/ui`, `src/audio`,
   `*View.ts`, `*Renderer.ts` and `src/main.ts` must run in Node. That is how gameplay is tested.
2. **The static world is a pure function of coordinates.** `CityPlan` and `CellGenerator` use only
   the seeded RNG. Draw every random value that shapes a building *before* any LOD-specific
   branch (use `rng.fork()` per parcel) so all LODs show the same building.
3. **No expensive work on the main thread during play.** World generation belongs in the worker;
   instantiation is time-sliced by `StreamingManager`.
4. **Systems communicate through `EventBus`.** Do not reach across systems for state changes.
5. **No fake features.** A button, mission, vehicle or interaction must do what it says. If
   something is partial, say so in `docs/KNOWN_LIMITATIONS.md`.
6. **Progression lives in serialisable state** that `SaveSystem` writes, never only in runtime
   variables.
7. **Everything is original.** No names, characters, story, map, art or audio from existing
   games. Assets are procedural; label placeholders as placeholders.
8. **A feature is done when it is tested.** Add or extend a test in `tests/unit`, and a step in
   `tools/selftest.mjs` when it is player-facing. Never report a test as passed without running it.
9. Shader style ids are shared between `src/streaming/styles.ts` (generator) and
   `src/render/CityMaterial.ts` (shader). Change both together. Per-surface shader parameters are
   `flat` varyings; hashing an interpolated value produces per-pixel noise.
10. Keep docs in step with the code: architecture, roadmap, limitations and the development log.

## Conventions

- Axes: +x east, +z south, y up. Headings are radians, 0 faces +z, forward = (sin h, cos h).
- Units: metres, seconds, kilograms. Fixed simulation step 1/60 s.
- Lattice line `k` is at 100·k m; cell `(cx, cz)` covers 200 m and owns lines `2cx`, `2cx+1`.
- Vehicle input: positive steer is right, positive throttle is forward.
