# Testing

A feature is not called done because its code exists. It is done when a test that exercises it
has been run and passed. This file lists the suites, what each proves, and the last results.

## How to run

```sh
npm test                    # 76 unit and headless integration tests (about 20 s)
npm run validate:endings    # narrative structure and ending reachability (about 3 s)
npm run build               # typecheck + production build
npm run selftest            # 23-step gameplay self-test in headless Chromium (about 15 s)
npm run verify              # all of the above
npx tsx tools/bench_sim.mts && node tools/bench.mjs   # benchmarks
node tools/shots.mjs        # documentation screenshots
```

## Last results (2026-11-26)

| Suite | Result |
|---|---|
| `npm test` | 76 passed, 0 failed, 9 files |
| `npm run validate:endings` | 20 of 20 endings reachable; 5 035 344 complete decision paths; 466 849 states |
| `npm run selftest` | 23 of 23 steps passed |
| `tsc --noEmit` | clean |

## Unit and integration tests (Vitest, Node)

These run the real simulation — Rapier physics, the streaming manager, the generator, traffic,
pedestrians, police, missions, economy, saves — without a renderer.

| File | Tests | What it proves |
|---|---|---|
| `vehicle.test.ts` | 13 | Each class settles on its suspension, accelerates within its top speed, shifts gear, brakes, reverses; steering direction; sports < sedan < truck to 72 km/h; rain reduces cornering; wall impacts damage; parked cars stay put; the boat floats, moves and turns |
| `cityplan.test.ts` | 6 | District map shape; every district present; spawn on land by a road; highways, arterials and streets exist; **every district is reachable by road from the spawn, including the island**; signals never green both ways; all nine kinds of location placed on land |
| `generator.test.ts` | 6 | Determinism; all 480 cells at 4 LODs produce valid buffers; coarser LODs never cost more; collision and gameplay data only at LOD0; far cells are one mesh; land has ground collision, water none; the spawn yard is clear; **the same buildings appear at every LOD** |
| `streaming.test.ts` | 7 | LOD rings; priority favours cells ahead; **a 162 km/h drive across the city never outruns full-detail ground**, with bounded residency and memory; no thrash on a LOD boundary; cache hits and eviction; frame budget respected; cross-fade and deferred disposal |
| `gameplay.test.ts` | 6 | Spawn; walk, run, sprint, crouch, strafe, jump; buildings block; enter, drive, cannot bail at speed, brake, exit, walk away; parked cars stream with cells; time and weather |
| `traffic.test.ts` | 7 | Cars stay on the road, never overlap, keep moving, turn, stop at reds; population follows the player; denser downtown and by day; slower in rain; stop behind a blocked lane; a hard hit makes a wreck and a crime; a stopped car can be taken (carjacking) |
| `npc_police.test.ts` | 11 | Pedestrians populate and walk sidewalks; talk, cross, enter buildings; fewer at night and in rain; flee and can be run over; **unwitnessed crime has no consequence; a witnessed one is phoned in after a delay and police go to the scene, not to the player**; walls block witnesses; units search then give up; escalation to five stars; an officer in line of sight pursues and arrests; pursuing units physically chase |
| `story.test.ts` | 11 | Exactly 20 endings, all reachable, none under 0.3 % or over 30 % of paths; each witness path replays deterministically to its ending; endings differ in fate, final sequence, staging and survivors; all references valid; **a full story is played from the first mission to an ending, every mission along the way**; dialogue; timed failure and checkpoint restart; evading really raises and clears a wanted level |
| `economy_save.test.ts` | 9 | Spend, earn, refuse, fine; **every kind of location performs its action**; items work and are consumed; stamina; **a save round-trips the whole playthrough into another game instance**; missions resume at their checkpoint; slots; truncated, tampered and wrong-version saves recover from backup; invalid data rejected |

## Gameplay self-test (Playwright, headless Chromium)

`tools/launch.mjs --self-test <file.json>` serves the production build, opens it in a browser and
drives it with scripted input through `window.__undertow`. The report follows Craft Anything's
self-test schema (`{"version": 1, "steps": [...]}`) and includes its three core steps, `move`,
`act` and `hud`.

| # | Requirement in the brief | Step(s) |
|---|---|---|
| 1 | Game launches | `launch` |
| 2 | Main menu works | `menu` |
| 3 | Player spawns | `spawn` |
| 4 | Player moves | `move` |
| 5 | Camera works | `camera` |
| 6 | Vehicle can be entered | `enter vehicle` |
| 7 | Vehicle can be driven | `act` |
| 8 | Vehicle can be exited | `exit vehicle` |
| 9 | World cells load | `cells load` |
| 10 | World cells unload | `cells unload`, `no loading screen` |
| 11 | NPCs spawn and move | `npcs spawn and move`, `traffic drives` |
| 12 | Mission objectives function | `mission objectives` |
| 13 | Save/load works | `save and load`, `corrupt save recovery` |
| 14 | Narrative decisions persist | `narrative decisions persist` |
| 15 | All 20 endings are reachable | `all 20 endings reachable` |
| — | Additional | `hud`, `economy`, `wanted level`, `audio`, `render` |

The last report is written to `out/self-test.json`.

## Developer commands for manual testing

Press `` ` `` in game. `help` lists everything. The ones that matter for verification:

| Command | Use |
|---|---|
| `ending <1-20>` | Replays the recorded decision path for that ending and plays it |
| `endings` | Lists all twenty |
| `story` | Current node, variables, flags, history |
| `decide <choiceId>` | Takes a decision |
| `skip` | Completes the current mission step |
| `tp <x> <z>` / `tp <district>` | Teleport (loads the destination first) |
| `time <h>`, `weather <w>` | Environment |
| `wanted <0-5>` | Police response |
| `spawn <profile>`, `cash <n>` | Vehicles and money |
| `stream` | Streaming overlay (also F3) |
| `save <slot>`, `load <slot>` | Save slots |

## What is not tested

- Real-GPU rendering and frame rate.
- Real keyboard, mouse and gamepad handling (the self-test uses the scripted input source).
- Audio output (only that the graph is built and events trigger sounds).
- Browsers other than Chromium.
- Long sessions (hours) for leaks.
