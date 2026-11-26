# UNDERTOW: Port Meridian — Game Architecture

Working title in the brief: *Project Vice*. The shipped identity is an original IP,
**UNDERTOW: Port Meridian** (see `docs/STORY_BIBLE.md`). Nothing — characters, story, map, names,
missions, art or audio — is taken from any existing game.

This document records what was decided, why, and how the systems fit together. It is kept in step
with the code; where something is designed but not built yet it is marked **(planned)** and
tracked in `docs/DEVELOPMENT_ROADMAP.md`.

---

## 1. Engine selection

### 1.1 What the development environment actually is (inspected 2026-11-26)

| Item | Finding |
|---|---|
| OS | Ubuntu 24.04, headless cloud container, no display |
| CPU / RAM / disk | 4 vCPU, 15 GB RAM, ~60 GB free |
| GPU | **None.** No `nvidia-smi`, no GPU device. Mesa software rasterisers only |
| Installed engines | **None** — no Unreal, Unity or Godot binary |
| Toolchains | Node 22, Rust 1.97, Python 3.13, GCC/Clang, CMake |
| Browser | Chromium + Playwright pre-installed (software WebGL) |
| Network | Package registries (npm, PyPI, crates.io, apt) reachable. `github.com` release downloads → HTTP 403; `godotengine.org` unreachable |
| Permissions | A from-source build of Godot 4.6.3 was attempted as a workaround and **was denied by the session's permission system**. It was not retried |

### 1.2 Comparison

| | Unreal Engine 5 | Unity 6 | Godot 4 | Web: three.js + Rapier |
|---|---|---|---|---|
| Open-world streaming | World Partition, HLOD, Level Streaming (built in) | Addressables / SubScenes (assembly required) | None built in; hand-built | None built in; hand-built (this project) |
| Geometry / lighting | Nanite, Lumen | HDRP, APV | SDFGI, VoxelGI | Forward WebGL2, shadow maps, PMREM |
| Vehicles / physics | Chaos Vehicles | Wheel colliders / PhysX | VehicleBody3D / Jolt | Rapier raycast vehicle controller (WASM) |
| Crowds / AI | Mass Entity, StateTree, navmesh | DOTS, NavMesh | NavigationServer | Hand-built agent simulation |
| Text-authorable without an editor GUI | Poor (binary assets) | Poor (scenes) | Good | Complete |
| Obtainable here | No (≈100 GB, launcher, GPU) | No (licence login, GPU) | No (downloads blocked; source build denied) | **Yes** (npm) |
| Runnable and testable here | No | No | No | **Yes** (Node + headless Chromium) |
| How the player gets it | Packaged build | Packaged build | Editor or export | A URL / static files |

### 1.3 Decision

**TypeScript + three.js (WebGL2) + Rapier (WASM), built with Vite, tested with Vitest and
Playwright.**

Unreal Engine 5 is the right engine for a AAA open-world game and is the reference the streaming
design is modelled on (World Partition, HLOD, Mass). It cannot be installed, run or verified in
this environment. Godot 4 would be the preferred native fallback and is equally unavailable here.
Choosing either would mean writing a large project that has never been executed — the opposite of
"a working game is more important than an impressive collection of unfinished systems".

The web stack is the only one where every milestone can be built, run, measured and screenshotted
on this machine, and its output is something a player can open immediately.

What this choice costs, stated plainly:

- No Nanite/Lumen-class rendering. Visual ceiling is "good WebGL", not AAA.
- No built-in world partition, navmesh, animation graph or vehicle editor. The equivalents are
  written in this repository (they are small and fully tested, not a general-purpose engine).
- Single main thread for rendering and simulation; Web Workers for generation.
- All art is procedural (see §11). There are no authored models, textures or recorded audio.

**Migration path.** Simulation code is separated from rendering (§2). The data — city plan,
vehicle profiles, narrative graph, ending registry, missions — is engine-neutral JSON. A port to
Godot or Unreal would replace `src/render`, `src/streaming` views and the physics binding; the
design and the data carry over.

### 1.4 Unreal features evaluated, and what stands in for them here

| UE5 feature | Purpose | Equivalent in this project |
|---|---|---|
| World Partition | Grid cells streamed by distance | `StreamingManager` + 200 m cells |
| HLOD | Merged distant proxies | LOD2 simplified cell meshes; LOD3 merged skyline proxies |
| Level Streaming | Explicit sub-level load | Interiors streamed on approach **(planned)** |
| Nanite | Virtualised geometry | Not available; discrete LODs with dithered cross-fade |
| Lumen | Dynamic GI | Not available; sun + hemisphere + PMREM sky environment |
| Chaos Vehicles | Vehicle physics | Rapier `DynamicRayCastVehicleController` |
| Mass Entity | Crowd/traffic at scale | Agent arrays with simulation LOD tiers |
| Navigation / Behavior Trees | AI movement and decisions | Lane graph + sidewalk rings; small state machines |
| PCG Framework | Procedural content | Seeded generator in Web Workers |
| Animation Blueprints | Character animation | Procedural pose functions |

---

## 2. Top-level structure

```
┌────────────────────────── main thread ──────────────────────────┐
│  Game (fixed 60 Hz step)                                         │
│   ├─ sim: Player, Vehicles, Traffic, NPCs, Police, Missions,     │
│   │        Narrative, Economy, TimeOfDay/Weather   (no DOM/WebGL)│
│   ├─ StreamingManager ──► priority queue ──► WorkerPool ─────────┼──► cell.worker × N
│   │        ▲   time-sliced instantiation (ms budget per frame)   │     (procedural
│   ├─ render: Renderer, CellViews, CharacterRenderer,             │      generation,
│   │        VehicleRenderer, Sky, Water, Weather FX               │      typed arrays
│   ├─ ui: HUD, menus, map, debug overlay (DOM)                    │      transferred)
│   └─ save: SaveSystem (slots, checksum, backup)                  │
└──────────────────────────────────────────────────────────────────┘
```

Rules that keep it maintainable:

1. **Simulation never imports rendering.** Everything under `src/*` that is not `render/`, `ui/`,
   `audio/` or a `*View.ts` file runs in Node, which is how the unit tests exercise real physics,
   streaming, traffic and narrative without a browser.
2. **Systems talk through the `EventBus`** (`crime.committed`, `vehicle.entered`,
   `mission.completed`, `cell.activated`…), not by reaching into each other.
3. **Fixed timestep.** Simulation advances in 1/60 s steps; rendering interpolates. A scripted
   input source can drive the same step function, which makes the self-test deterministic even
   when the renderer is slow.
4. **Data over code.** Vehicles, narrative, endings, missions and characters are JSON under
   `data/`.

### Directory map

| Path | Contents |
|---|---|
| `src/core` | Game loop, event bus, input, RNG, config, quality settings |
| `src/world` | City plan: districts, road lattice, points of interest |
| `src/streaming` | Streaming manager, priority, cell generator, worker pool, cell views |
| `src/player` | Character controller, camera rig |
| `src/vehicles` | Vehicle physics, profiles, vehicle rendering |
| `src/traffic` | Lane graph, signals, traffic agents |
| `src/npc` | Pedestrian simulation, schedules, named characters |
| `src/police` | Crimes, witnesses, wanted level, police units |
| `src/missions` | Mission runner and objective types |
| `src/narrative` | Narrative state, conditions, ending selection, reachability |
| `src/economy` | Cash, purchases, property, business income |
| `src/environment` | Time of day, weather, sky, water |
| `src/render` | Renderer, materials, shaders |
| `src/ui` | HUD, menus, map, streaming overlay |
| `src/audio` | Procedural WebAudio |
| `src/save` | Save slots, validation, recovery |
| `src/dev` | Debug API, developer console, self-test hooks |
| `data/` | JSON: narrative, missions, vehicles, world |
| `tests/unit`, `tests/e2e` | Vitest (Node) and Playwright (browser) tests |
| `tools/` | Launcher (`--self-test`, `--screenshot`), validators, benchmark |

---

## 3. World

Port Meridian is a 4.8 km × 4.0 km coastal city on a flat Gulf shoreline (the terrain is flat by
design; there is no heightfield).

- **Lattice.** Road centre lines lie on a 100 m lattice. A lattice *edge* (100 m of road between
  two intersections) has a class: none, street, arterial or highway. A *block* is the 100 m square
  between lattice lines.
- **Cells.** A streaming cell is 200 m × 200 m = 2 × 2 blocks, 24 × 20 cells in the world. Each
  cell belongs to one district, read from an authored district map (`src/world/CityPlan.ts`).
- **Districts** (12): Meridian Center (downtown), The Flats, Crown Shore, Ironhook Port, Sol
  Strand (beach island), Paseo District, Cypress Heights, Saltgrass County, Pelican Marina, Neon
  Mile, Eastbank Rebuild Zone, plus the highway network (I-9 Loop and the Odile Causeway).
  Each has its own block pattern, building rules, palette, lighting and population density.
- **Determinism.** Every cell is a pure function of `(world seed, cx, cz, lod)`. Nothing about the
  static world is stored on disk or in saves.

Why 200 m: at 60 m/s (216 km/h) a vehicle crosses a cell in 3.3 s, which leaves the streaming
system several frames per cell even at top speed, while keeping a cell's worst-case geometry
(downtown) inside one worker job of a few tens of milliseconds.

---

## 4. Streaming architecture

This is the highest-priority system. The world is never loaded whole.

### 4.1 Cell record

Each cell record carries: world coordinates; per-LOD generated data (geometry, material ids,
building data, props, collision boxes, navigation data, pedestrian and traffic spawn definitions,
points of interest); its streaming priority; its residency state; byte size; and timing data.

### 4.2 Residency state machine

```
Unloaded ─► Queued ─► Generating (worker) ─► Ready (data cached)
                                               │
                                               ▼
                         Active(LOD n) ◄─ Instantiating (time-sliced, main thread)
                               │
                               ▼
                           Unloading ─► Unloaded   (generated data stays in an LRU cache)
```

### 4.3 LOD tiers

| LOD | Content | Simulation |
|---|---|---|
| 0 | Full building massing, roof detail, props, street furniture, colliders, shadows, interaction | Full |
| 1 | Building massing, trees and lights only; no small props | Simplified |
| 2 | One simplified volume per building, flat roads | Statistical |
| 3 | Merged skyline proxy per block | None |
| 4 | Not resident | None |

LOD is chosen from an *effective distance* (below) with hysteresis bands so a cell on a boundary
does not flip back and forth. Changes cross-fade with a screen-door dither (both LODs drawn for a
fraction of a second), so there is no hard pop.

### 4.4 Priority

For a cell centre `c`, player position `p`, velocity `v`, camera forward `f`:

```
lookahead      = clamp(|v| · T_look, 0, D_max)          T_look ≈ 3 s
p_pred         = p + v̂ · lookahead
d_eff          = min(|c − p|, |c − p_pred|, dist(c, segment p→p_pred))
eta            = |c − p| / max(|v|, v_min)               (time until the player could arrive)
facing         = max(0, dot(normalize(c − p), f))        (camera orientation)
moving         = max(0, dot(normalize(c − p), v̂))        (movement direction)
priority       = w_d / (1 + d_eff / cell)
               + w_f · facing + w_m · moving · speedFactor
               + w_e / (1 + eta)
               + w_i · importance                         (mission target, player's vehicle…)
               + w_l · (4 − targetLod)                    (nearer LODs first)
```

Requests are served highest priority first. A player driving fast therefore pulls cells ahead of
the vehicle to the front of the queue and raises their target LOD before arrival.

### 4.5 Background work and frame budget

- **Workers.** Procedural generation runs in a pool of Web Workers. Results come back as typed
  arrays using transferables (no copy).
- **Time-sliced instantiation.** Turning data into GPU buffers and physics colliders happens on
  the main thread in small steps under a per-frame millisecond budget.
- **No synchronous generation during play.** The only synchronous load is the spawn area behind
  the menu.
- **Asynchronous decompression** from the brief does not apply: there are no stored, compressed
  assets. The worker generation stage occupies that slot in the pipeline.

### 4.6 Memory

Generated data is kept in an LRU cache with a byte budget; GPU objects are disposed when a cell
unloads. Unload distance is larger than load distance (hysteresis).

### 4.7 Visibility

Per-mesh frustum culling (bounding volumes per cell layer), distance culling of small props, and
LOD selection. Full hierarchical-Z occlusion culling is out of scope for WebGL2 here; this is
listed in `docs/KNOWN_LIMITATIONS.md`.

### 4.8 Diagnostics

The developer overlay (F3) shows: current cell, loaded / loading / unloading cells, queue length,
memory, load latency, NPC and traffic simulation counts by tier, LOD distribution and frame rate.

---

## 5. Rendering

- three.js `WebGLRenderer`, ACES tone mapping, sRGB output, PCF soft shadows from one sun shadow
  map that follows the camera.
- **Procedural materials** (no texture files): a façade shader draws windows, frames and
  night-time lit rooms from wall coordinates in metres; a road shader draws asphalt, lane
  markings and wetness; ground uses vertex colour with procedural variation.
- **Batching.** A cell layer is one merged mesh per material. Props, vehicles and characters are
  instanced. The draw-call target is under ~400 at default quality.
- **Atmosphere.** Analytic sky, sun/moon light, exponential height-aware fog for aerial
  perspective, a procedural cloud layer, water with fresnel sky reflection and sun glint.
- **Quality settings** scale resolution, shadow size, draw distance, population and effects.

## 6. Physics

Rapier 3D (WASM), fixed 60 Hz. Static cuboid colliders arrive with LOD0 cells and leave with them.
The player is a kinematic character controller. Vehicles are dynamic bodies driven by Rapier's
raycast vehicle controller. Boats use buoyancy forces on a dynamic body.

## 7. Vehicles

Profiles in `data/vehicles/vehicles.json`: mass, dimensions, wheel layout, drivetrain, torque
curve, gears, steering, grip, suspension, brakes. Classes: sedan, SUV, sports, motorcycle, truck,
boat. On top of Rapier's wheel model the game adds an engine/gearbox model, speed-sensitive
steering, handbrake, weather grip, damage, and procedural engine audio.

## 8. AI

- **Traffic:** agents on the lane graph with a car-following model and signalised intersections.
  Three tiers: physical (near the player, collidable), kinematic (lane following only),
  statistical (density only, spawned and removed out of sight).
- **Pedestrians:** agents on sidewalk rings with crossings; activities (walk, idle, talk, enter a
  building, shop); reactions (weather, danger, the player); crime witnessing and reporting.
- **Named characters:** persistent, with a schedule, relationships and memory of the player.
- **Police:** knowledge is information-based — witnesses, reports, line of sight, last known
  position, search areas. Never omniscient.

All populations are bounded by configurable budgets.

## 9. Narrative

`data/narrative/decision_graph.json` is a graph of mission and decision nodes whose choices apply
effects to tracked variables and flags and branch conditionally.
`data/narrative/ending_registry.json` holds 20 endings, each with requirements, priority,
character outcomes, consequences, a final sequence and cinematic staging. Selection is
deterministic: highest-priority ending whose requirements hold. `src/narrative/reachability.ts`
exhaustively explores the graph and proves every ending reachable; `npm run validate:endings` and
a unit test enforce it. Dev commands replay any ending's witness path.

## 10. Save system

Versioned JSON in browser storage: manual slots, an autosave slot, a checksum per save and a
backup of the previous write for recovery. Everything that matters to progression lives in
serialisable state objects, never only in runtime variables.

## 11. Asset pipeline

There is none in the traditional sense. Every mesh, material, sound and character is generated
by code in this repository and is therefore original. These are **procedural placeholder
assets** by the standard of a commercial game and are labelled as such. Craft Anything's paid
asset generation was not used (no key).

## 12. Performance budgets

Development hardware has no GPU, so frame-rate numbers measured here are software-rendered and
are reported as such in `docs/PERFORMANCE.md`. Budgets that can be measured anywhere:

| Budget | Target |
|---|---|
| Simulation step (60 Hz) | ≤ 4 ms on the dev container |
| Main-thread streaming work | ≤ 4 ms per frame |
| Cell generation (worker) | ≤ 60 ms per LOD0 cell |
| Draw calls at default quality | ≤ 400 |
| Generated-data cache | ≤ 192 MB |
| Frame rate on a mid-range discrete GPU | 60 fps (not verifiable here) |

## 13. Testing strategy

- **Unit tests (Vitest, Node):** narrative and endings, streaming logic, city plan, vehicle
  physics, traffic, NPCs, police, missions, economy, saves.
- **Gameplay self-test (Playwright):** boots the real build in Chromium and drives it through
  the debug API; writes a report in Craft Anything's self-test schema.
- **Screenshots:** captured at milestones into `docs/screenshots/`.
- **Benchmarks:** `npm run bench`.

See `docs/TESTING.md`.
