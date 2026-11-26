# Development Roadmap

Status values: **done** (built and its acceptance test executed), **partial** (the acceptance
criterion is met but some listed deliverables are simplified or missing; the gaps are named).

The record of what was run is `docs/DEVELOPMENT_LOG.md`; the gaps are detailed in
`docs/KNOWN_LIMITATIONS.md`.

| # | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| 0 | Research and project setup | done | Research documents, architecture, validated toolchain |
| 1 | Playable prototype | done | Self-test steps 1–8; `gameplay.test.ts` |
| 2 | City environment | done | 12 districts generated; `cityplan.test.ts`, `generator.test.ts`; screenshots |
| 3 | World streaming | partial | `streaming.test.ts`; 201 km/h run with 0 held frames; overlay screenshot |
| 4 | Vehicles and traffic | partial | `vehicle.test.ts`, `traffic.test.ts` |
| 5 | NPC intelligence | partial | `npc_police.test.ts` |
| 6 | Crime and open-world gameplay | partial | `npc_police.test.ts`, `traffic.test.ts` |
| 7 | Missions and narrative | done | `story.test.ts` (full story played headless) |
| 8 | Twenty endings | partial | `validate:endings`; `story.test.ts`; self-test step |
| 9 | Polish and optimisation | partial | `docs/PERFORMANCE.md`; weather, audio, night lighting |
| 10 | Final verification | partial | 76 unit tests, 23-step self-test, screenshots, benchmarks |

## Milestone detail

### 0 — Research and project setup — done
Repository analysis, technical research, engine selection, architecture document, environment
validation, project structure.

### 1 — Playable prototype — done
3D environment, third-person player, camera with collision, movement, interaction, drivable
vehicle, collision, main menu. *Acceptance met:* launch, move, enter, drive, exit.

### 2 — City environment — done
Twelve districts with their own block patterns, building rules and palettes; road lattice with
streets, arterials and highways; sidewalks, kerbs, street lamps, trees, palms, hydrants, benches,
cranes, boats, piers; traffic; time-of-day lighting. *Acceptance met:* explorable and coherent.

### 3 — World streaming — partial
Built: spatial partition, worker generation with transferables, residency state machine,
predictive velocity look-ahead, priority function, LOD 0–4 with dithered cross-fade, LRU cache
and byte budget, distance unloading with hysteresis, frame-budgeted instantiation and disposal,
debug overlay. *Acceptance met:* continuous travel through cells with no loading screens.
**Missing:** occlusion culling; streamed interiors. **Not applicable:** asynchronous
decompression (no compressed assets).

### 4 — Vehicles and traffic — partial
Built: sedan, SUV, sports car, truck, motorcycle, boat (and a police cruiser) with distinct
handling; engine and gearbox; suspension and tyre grip from Rapier; handbrake; weather grip;
damage; fuel; entry and exit; garage storage; persistence across saves; lane-following traffic
with car-following, signals, lane discipline and junction reservation; traffic lights.
*Acceptance met:* traffic drives without colliding or sticking. **Simplified:** motorcycles
cannot fall; no deformation.

### 5 — NPC intelligence — partial
Built: pedestrians on sidewalk rings with crossings that obey signals; idle, talk, phone, enter
buildings; weather and time-of-day density and clothing; reactions to vehicles, the player and
crime; witnesses who report; three simulation tiers and budgets; twelve named characters with
schedules, relationships and saved memory. *Acceptance met.* **Missing:** schedules for ambient
pedestrians; pedestrians who drive; distinct service roles; police on foot.

### 6 — Crime and open-world gameplay — partial
Built: witness- and sight-based wanted system; reports; dispatch to last known position; search
areas; pursuit units that leave their lane; roadblocks at three stars; escalation to five stars;
escape by breaking sight, changing vehicle, respray, lying low or a false tip; arrest and fine;
lifetime notoriety; vehicle theft and carjacking. **Simplified:** world events are fixed offers,
not random.

### 7 — Missions and narrative — done
Mission framework with ten objective types, checkpoints, fail states, rewards and save
integration; event bus; 25 story missions and 12 side missions; decision graph of 33 nodes;
narrative state with 12 variables and 16 flags; relationships and character memory.

### 8 — Twenty endings — partial
Built: 20 designed endings with requirements, priorities, outcomes and staging; deterministic
selection; exhaustive reachability proof; witness paths; dev command and in-game replay;
cinematic presentation per ending. **Simplified:** endings are staged with camera and captions
rather than bespoke final missions.

### 9 — Polish and optimisation — partial
Built: day/night cycle, five weather states, rain, fog, wet roads, wind on water, clouds, night
windows, neon, lamp pools, headlights; procedural audio; profiling and four optimisations
(`docs/PERFORMANCE.md`). **Not achieved:** AAA-comparable visuals; authored animation; music.

### 10 — Final verification — partial
Playable build, automated tests, performance report, screenshots, gameplay self-test,
documentation. **Unverified:** frame rate on a GPU.

## Next steps, in order of value

1. Run on a machine with a GPU; measure, then tune quality presets and shadow settings.
2. Walkable interiors for safehouses and shops, streamed on approach.
3. Skinned character models and an animation state machine; pedestrians as physical bodies.
4. Stage the story's set pieces individually; play the final sequences instead of narrating them.
5. Route-planning for police pursuit; officers on foot.
6. Occlusion culling for downtown; hierarchical merging of the LOD3 ring.
7. Music and recorded sound.
8. A native port (Godot or Unreal): the data and the simulation design carry over.
