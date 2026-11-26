# Known Limitations

This is a playable, tested vertical slice of an open-world crime game. It is **not** a AAA game
and not visually comparable to one. This file lists where it falls short of the brief, so nothing
partial is mistaken for finished.

## Engine and visuals

- **Not Unreal Engine 5.** No native engine could be installed or run in the development
  environment (see `docs/GAME_ARCHITECTURE.md` §1). The game is TypeScript + three.js + Rapier in
  a browser. There is no Nanite, Lumen, virtual texturing or GPU-driven rendering.
- **All art is procedural placeholder art.** Buildings are boxes with shader-drawn façades.
  Vehicles are extruded profiles. Characters are jointed capsule mannequins with procedural
  animation — no skinned meshes, faces or motion capture. There are no texture files at all.
- **Lighting is simple:** one sun shadow map, a hemisphere light, sky-based image lighting. No
  global illumination, no volumetric light shafts, one real headlight (the player's).
- **Water** reflects the sky analytically; it does not reflect the city. **Clouds** are a 2D layer.
- **Frame rate on a GPU is unverified.** Only software rendering was available
  (`docs/PERFORMANCE.md`).

## World

- **Flat.** There is no terrain height. Highways are at grade with signalled junctions; there
  are no overpasses or interchanges.
- **4.8 × 4.0 km**, on a 100 m road lattice. Streets are a grid; coastlines follow cell edges.
- **No interiors.** Shops, garages, safehouses and venues are entered through a panel, not a
  walkable room. The brief's "interiors load when entering" is not implemented.
- Buildings cannot be climbed or destroyed. Trees and lamp posts are rigid.

## Streaming

- **No occlusion culling.** Visibility is frustum, distance and LOD only.
- **No asynchronous decompression** stage, because nothing is stored compressed: cells are
  generated procedurally in workers.
- Instantiation is budgeted per frame, so at very low frame rates far cells arrive slowly.
- Cross-fades use a dither pattern, which is visible as stipple for the half-second it lasts.

## Player

- Walk, run, sprint, crouch, jump, swim, interact, drive. **No combat, weapons, cover, climbing
  or melee.** The crime in this game is theft, reckless driving and the story's choices.
- No health system: the player cannot die. Being arrested is the fail state.
- Swimming is a simple float; the player cannot dive or board a boat from the water.

## Vehicles

- **Motorcycles cannot fall over.** Their body is locked to yaw only and the lean is visual.
- Boats use four buoyancy samples; there are no waves in the physics.
- Damage affects power, steering and colour. There is no deformation, no detachable parts.
- No aircraft, trains or bicycles.

## NPCs

- **Only the twelve named characters have daily schedules, relationships and memory.** Ambient
  pedestrians have a temperament and a current activity, not a life.
- Pedestrians and drivers are separate populations: a pedestrian never gets into a car, and a
  driver whose car is taken does not appear on the street.
- No distinct shop workers, security guards or business owners among the ambient population.
- Pedestrians are not physical bodies: the player can walk through them (they react and step
  aside); vehicles knock them down by a distance test.
- **Police exist only in cars.** There are no officers on foot.

## Police

- Pursuit drivers steer straight at their target with a simple stuck-recovery. They do not plan
  routes around buildings and can be lost by breaking line of sight around a block.
- Roadblocks are a single car across the road.
- There is no use of force; an arrest requires the player to be stopped near a unit.

## Missions and story

- Missions are assembled from ten generic objective types. **Set pieces described in the mission
  text are not individually staged** — "haul the bay boat back" plays as a drive to a marker.
- Characters in `talk` objectives appear near where the previous objective ended, not at an
  authored location.
- Timed drives use the authored time as a minimum and add time for long routes, so they stay
  completable from wherever the previous objective ended.
- Side-mission narrative effects in the data are **not applied** to story variables. This is
  deliberate: it keeps the ending-reachability proof exact.
- The two "random event" side missions are offered at fixed places; they are not triggered
  randomly.
- **Endings are a staged camera move with captions and an outcome summary**, each at its own
  district, hour and weather. The four Act 3 endgames are distinct playable mission chains, but
  the individual final sequences described in `docs/ENDING_DESIGN.md` are told, not played.
- Decisions are text panels. There are no cutscenes or voice acting.
- Cash earned in play does not feed the story's `wealth` variable; that changes only through
  decisions.

## Economy

- Prices and incomes are untuned. Property income is generous relative to mission rewards.
- Clothing changes two colours.

## Saves

- Stored in the browser's `localStorage`: per browser, per site, not portable between machines.
- The ambient world is not saved (parked cars, pedestrians, traffic). A wanted level does not
  survive a load, though the lifetime police record does.

## Audio

- Entirely synthesised: engine, road, rain, city hum, sirens, impacts, footsteps, UI tones.
  **No music, no voices, no recorded sound.**

## Platform

- Desktop browsers with WebGL2. No touch controls; phones are not supported.
- Tested only in Chromium.
- Key bindings are fixed.

## Craft Anything

- It was studied and its contracts adopted (`--self-test`, `--screenshot`, own build and test
  scripts), but it was **not used to orchestrate the build**, and its paid asset generation was
  not used. Its own checks cannot launch a plain Node/web project
  (`research/CRAFT_ANYTHING_ANALYSIS.md` §3.7).

## Leftovers outside this repository

- `/home/user/toolchain/godot-src` holds a Godot 4.6.3 source checkout from the abandoned engine
  attempt. It is unused and can be deleted.
