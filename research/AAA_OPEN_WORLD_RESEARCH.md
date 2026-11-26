# Project Vice — AAA Open-World Research and Web-Stack Architecture

Research date: 2026-11-26. Status: research input for the engineering plan. "Project Vice" is an original IP. Nothing in this document authorises copying characters, story, map layout, names, art or code from any existing game; other games are studied only for publicly documented *techniques* and for *design ambition*.

---

## 1. Purpose, method and evidence legend

### 1.1 Purpose

1. Establish what is publicly known about Grand Theft Auto VI (the current benchmark for open-world ambition), separated strictly into official statements, press analysis and unknowns.
2. Survey the engine techniques that make large streamed worlds possible, with citable sources.
3. Translate those techniques into a concrete architecture for the stack we can actually build and verify in our environment (TypeScript + three.js + Rapier + Vite).

### 1.2 Method and its limits

- Sources were found with web search on 2026-11-26. **Direct page fetching was blocked by the session network policy for every host tried** (`www.rockstargames.com`, `www.purexbox.com`, `threejs.org`, `rapier.rs`, `en.wikipedia.org`, `developer.mozilla.org` all failed DNS resolution). Statements attributed to a web page therefore rest on the title and extract the search engine returned for that URL, not on a full read of the page. Where only secondary coverage of a primary source was visible, that is said explicitly.
- Every URL in this document appeared in a search result during this session. No URL was constructed from memory.
- three.js and Rapier API facts were **verified first-hand** by installing `three@0.187.0` and `@dimforge/rapier3d-compat@0.21.0` from the npm registry into a scratch directory and reading their shipped source and `.d.ts` files.
- The WebGL capability of the pre-installed browser was **measured first-hand** with a Playwright probe (results in §3.13).
- Equations that are textbook-standard (IDM, Pacejka) are written from the standard form; the cited paper/page is the reference, but the equation text itself was not visible in a search extract.

### 1.3 Evidence legend

Every important technical conclusion carries one of these tags.

| Tag | Meaning |
|---|---|
| **[CONFIRMED]** | Confirmed public information: stated by the owner of the technology/product (official docs, official announcements), or measured first-hand by us in this session. The source class is stated next to the tag when it is not an official statement. |
| **[INDUSTRY]** | Established industry technique described in a conference talk, paper, engine documentation or reputable technical journalism. Source given. |
| **[RECOMMENDATION]** | Our own engineering recommendation for Project Vice. A design choice, not a fact about anyone else's engine. |
| **[UNKNOWN]** | Unknown or proprietary implementation detail. Anything about Rockstar's RAGE internals for GTA VI falls here unless Rockstar has published it. |

Rule applied throughout: speculation about how GTA VI is implemented is never presented as fact. Third-party frame analysis (e.g. Digital Foundry, Adrian Courrèges) is observation of *output*, not knowledge of *implementation*.

### 1.4 Our constraints (given, determined by inspecting the dev environment)

- Dev machine: headless Linux cloud container, 4 vCPUs, 15 GB RAM, **no GPU**, no display.
- No Unreal, Unity or Godot installed, and their download hosts are blocked by the network policy. Package registries (npm, PyPI, crates.io, apt) are reachable.
- Chromium + Playwright are pre-installed; WebGL runs in software.
- **Selected runtime:** TypeScript + three.js (WebGL2 renderer) + Rapier WASM physics + Vite. Unit tests in Vitest (Node); gameplay self-test and screenshots in Playwright/Chromium.
- Unreal Engine 5 remains the documented "if we had an AAA budget and hardware" reference architecture. Godot 4 is the documented alternative if a native engine becomes available.

---

## 2. Grand Theft Auto VI — what is actually known

### 2.1 Release status as of 2026-11-26

**GTA VI has released.** It launched on **19 November 2026** on PlayStation 5 and Xbox Series X|S, after two delays (from "2025" to 26 May 2026, then to 19 November 2026). **[CONFIRMED]** — Rockstar Newswire post "Grand Theft Auto VI Now Available" and Rockstar Support's release-time article, corroborated by Wikipedia, CNN, Forbes and Deadline. Caveat: the Rockstar pages could not be fetched; this rests on their titles/extracts in search results plus consistent independent coverage.

### 2.2 Confirmed by Rockstar Games / Take-Two

| # | Fact | Detail | Source |
|---|---|---|---|
| 1 | Trailer 1 | Published 5 December 2023. YouTube stated it set the 24-hour record for a non-music video (over 93 million views); Guinness recorded 90,421,491 views in 24 h. | [YouTube blog](https://blog.youtube/culture-and-trends/grand-theft-auto-breaks-record/), [Guinness World Records](https://guinnessworldrecords.com/news/2023/12/grand-theft-auto-vi-first-look-becomes-most-viewed-videogame-trailer-in-24-hours-762030) |
| 2 | Setting | The fictional US state of **Leonida**, including **Vice City**. Rockstar's site has an "Only in Leonida" section. | [rockstargames.com/VI/only-in-leonida](https://www.rockstargames.com/VI/only-in-leonida), [Vice City page](https://www.rockstargames.com/VI/only-in-leonida/vice-city) |
| 3 | Named regions | Six regions were detailed alongside Trailer 2: Vice City, Leonida Keys, Grassrivers, Port Gellhorn, Ambrosia, Mount Kalaga. | [Leonida Keys](https://www.rockstargames.com/VI/leonida-keys), [Ambrosia](https://www.rockstargames.com/VI/only-in-leonida/ambrosia), [Port Gellhorn](https://www.rockstargames.com/VI/port-gellhorn); all six listed by [Gematsu](https://www.gematsu.com/2025/05/grand-theft-auto-vi-second-trailer-characters-and-places-detailed) and [Game Informer](https://gameinformer.com/2025/05/06/rockstar-shows-off-six-major-areas-of-vice-city-in-grand-theft-auto-vi) |
| 4 | Protagonists | Two leads, Jason Duval and Lucia Caminos, each with an official character page. | [Jason](https://www.rockstargames.com/VI/Jason), [Lucia](https://www.rockstargames.com/VI/lucia) |
| 5 | First delay | Announced 2 May 2025: release moved from "fall 2025" to 26 May 2026. | [CBC](https://amp.cbc.ca/lite/story/1.7525051), [Bloomberg](https://www.bloomberg.com/news/articles/2025-05-02/gta6-take-two-delays-release-of-grand-theft-auto-vi-to-may-2026-ttwo-share-price) |
| 6 | Trailer 2 | Published 6 May 2025 with a large update to the official site (characters, places). Rockstar stated it was captured on PS5. | [Gematsu](https://www.gematsu.com/2025/05/grand-theft-auto-vi-second-trailer-characters-and-places-detailed), [Notebookcheck](https://www.notebookcheck.net/PS5-was-behind-every-frame-of-GTA-6-Trailer-2-confirms-Rockstar.1012400.0.html) |
| 7 | Second delay | Announced 6 November 2025 (with Take-Two's quarterly results): release moved to 19 November 2026. | [Rockstar Newswire](https://www.rockstargames.com/newswire/article/ak3ak31a49a221/grand-theft-auto-vi-is-now-set-to-launch-november-19-2026), [Engadget](https://www.engadget.com/gaming/grand-theft-auto-vi-is-delayed-to-november-19-2026-211848530.html) |
| 8 | "An Extended Look" | A long gameplay video dated 27 August 2026 (the official site's page titles read "An Extended Look, Coming August 27" and later "An Extended Look: Now Playing"). Press recaps put it at roughly 26–27 minutes. | [rockstargames.com/VI/vice-city](https://www.rockstargames.com/VI/vice-city) (title string), [GamesRadar recap](https://www.gamesradar.com/news/live/gta-6-extended-look-showcase-live-coverage-2026-everything-announced/) |
| 9 | Release | 19 November 2026, midnight local time, PS5 and Xbox Series X/S. Digital pre-load from 10 November 2026. | [Rockstar Newswire](https://www.rockstargames.com/newswire/article/39akk424a9oo53/grand-theft-auto-vi-now-available), [Rockstar Support](https://support.rockstargames.com/articles/29jV3Cv2cCgvwM1XgtMO5o/grand-theft-auto-vi-regional-pre-load-and-release-times-on-playstation-5-and-xbox-series-x-or-s) |
| 10 | Platforms | PS5 and Xbox Series X/S only. **No PC version has been announced.** | Same as 9; [IBTimes](https://www.ibtimes.co.uk/gta-vi-pc-release-early-2027-report-1833680) |
| 11 | Launch sales | Take-Two/Rockstar announced about $3.79 billion in the first 24 hours (company estimate). | [Fox Business](https://www.foxbusiness.com/entertainment/grand-theft-auto-vi-shatters-entertainment-records-staggering-3-79b-debut), [Forbes](https://www.forbes.com/sites/antoniopequenoiv/2026/11/20/gta-6-raked-in-38-billion-sales-on-first-day-the-largest-entertainment-launch-ever/), [CNN](https://www.cnn.com/2026/11/20/media/gta-vi-launch-sales-numbers) |

All rows: **[CONFIRMED]** (official statement, seen via search extract and/or reputable reporting of the statement).

### 2.3 Press and technical analysis (third-party observation, not Rockstar statements)

Digital Foundry published a post-launch tech review and a four-console comparison. **The Digital Foundry article/video itself did not appear in search results; everything below is from secondary write-ups of it**, which agree on the main points and differ on some details.

| Finding (as reported) | Reported by |
|---|---|
| All four console versions target **30 fps**; no 40 or 60 fps mode on any console. | [gta-vi.io summary](https://gta-vi.io/news/gta6-digital-foundry-30fps-all-consoles), [Digg](https://digg.com/gaming/yf0qv57p) |
| Internal resolution about **1440p** on PS5 and Series X; PS5 Pro reconstructs to a near-4K image with PSSR; Series S about 720p upscaled to about 1080p. | [mobidevices](https://mobidevices.com/en/digital-foundry-gta-6), [guides-factory](https://guides-factory.com/guides/gta-6-performance), [Pure Xbox](https://www.purexbox.com/news/2026/11/three-big-takeaways-from-digital-foundrys-gta-6-analysis-for-xbox-series-xs) |
| **Ray-traced global illumination and ray-traced reflections on every console**; PS5 Pro adds ray-traced shadows. | [KitGuru](https://www.kitguru.net/gaming/matthew-wilson/gta-6-includes-advanced-ray-tracing-even-on-base-consoles/), [VGTimes](https://vgtimes.com/gaming-news/175004-ray-tracing-realistic-physics-and-30-fps-digital-foundry-takes-a-technical-deep-dive-into-gta-6.html) |
| Frame rate dips into the mid-to-upper 20s in heavy traffic, chases, explosions and dense crowds; base PS5 drops more often than Series X; PS5 Pro is the most stable. | [Kotaku](https://kotaku.com/grand-theft-auto-vi-gta-6-framerates-xbox-series-x-ps5-rockstar-2001000296), [Wccftech](https://wccftech.com/grand-theft-auto-vi-runs-better-xbox-series-x-ps5-digital-foundry/), [Neowin](https://www.neowin.net/news/analysis-reveals-gta-6-runs-better-on-xbox-series-x-than-on-playstation-5/) |
| DF's view that the game is **CPU-bound by simulation** (traffic, crowds, physics), which is why a higher frame-rate mode is hard. | [Techtroduce](https://www.techtroduce.com/gta-6-digital-foundry-ps5-pro-performance-review), [NeoGAF thread on the DF review](https://www.neogaf.com/threads/digital-foundry-grand-theft-auto-6-digital-foundry-tech-review-the-game-of-the-generation.1703495/) |
| Praise for distant LOD handling (traffic and lights drawn far into the distance), strand-based hair, atmospheric rendering; described as "the single most visually striking game of the generation" among realism-targeted games. | [TweakTown](https://www.tweaktown.com/news/114763/gta-6-deemed-the-single-most-visually-striking-game-of-the-generation-by-tech-experts/index.html) |

Tag: **[CONFIRMED — third-party measurement, secondary reporting]** for the fact that these were DF's published findings; the exact numbers should be re-checked against DF's own article before being quoted externally. Reported low points differ between outlets (e.g. PS5 Pro lows of 24 fps vs 20 fps), and patches may change them.

Other press material:

- Press recaps of "An Extended Look" describe a six-star wanted system with escalating response, switching between the two leads, and a broad range of side activities. Source: [GamesRadar](https://www.gamesradar.com/news/live/gta-6-extended-look-showcase-live-coverage-2026-everything-announced/), [Red Bull](https://www.redbull.com/int-en/gta-6-extended-look-everything-revealed). This is reporting on Rockstar's own video, so the *existence* of those features is on firm ground; their *implementation* is **[UNKNOWN]**.
- Before launch, Digital Foundry analysed Trailer 1 as roughly 1440p/30 fps. Source: [Notebookcheck](https://www.notebookcheck.net/GTA-VI-Trailer-recreated-using-GTA-V-analysis-by-Digital-Foundry-indicates-1440p-and-30-fps.782027.0.html). Superseded by the launch analysis.

### 2.4 Rumour and unverified reporting (do not rely on)

- A PC version in the first half of 2027: reported by outlets, **not confirmed** by Rockstar or Take-Two ([IBTimes](https://www.ibtimes.co.uk/gta-vi-pc-release-early-2027-report-1833680), [TweakTown](https://www.tweaktown.com/articles/11693/the-state-of-gta-6-on-pc-everything-you-need-to-know/index.html)).
- Launch price of $79.99: reported by secondary sites ([shattered.io](https://shattered.io/gta-6-launch-79-99-ps5-xbox-series-pc-date-unannounced/), [Make Tech Easier](https://maketecheasier.com/gta-6-release-date-price-preload/)); not checked against a store listing.
- Engine version names such as "RAGE 9": used by fan sites, never by Rockstar ([gta6hype](https://www.gta6hype.com/blog/rage9-vs-genie3-ai-future-gaming/) is an example of the unofficial usage).
- Timing of an online mode: speculation.
- Details we looked for and could **not** verify: the exact wording of Rockstar's statement about how Trailer 2 was captured beyond "on PS5" (e.g. the split between gameplay and cutscenes); an official map-size figure; a Metacritic score (Wikipedia's "universal acclaim" wording was the only reception claim seen); the install size.

### 2.5 Unknown / proprietary

All **[UNKNOWN]**: how GTA VI streams its world (cell size, formats, priorities, memory budgets); how its LOD, HLOD and impostors are built; its occlusion method; how many pedestrians and vehicles are simulated at each fidelity level; how its ray tracing is implemented; any official map-size figure; what changed in RAGE for this title. Rockstar has not published a technical talk on GTA VI as of this date in anything our searches surfaced.

What is public about RAGE in general: it is Rockstar's in-house engine, descended from Angel Studios' technology (Angel Studios became Rockstar San Diego), first shipped in Rockstar Games Presents Table Tennis (2006), and has integrated the Euphoria character-animation middleware and the open-source Bullet physics library. Source: [Wikipedia: Rockstar Advanced Game Engine](https://en.wikipedia.org/wiki/Rockstar_Advanced_Game_Engine). **[CONFIRMED — encyclopedic summary]**. The only detailed public views of Rockstar rendering are third-party frame studies of older games ([Courrèges' GTA V Graphics Study](https://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study/)) and Rockstar's own SIGGRAPH 2019 talk on Red Dead Redemption 2's atmosphere (§3.10).

### 2.6 Design ambitions we take inspiration from (not content)

1. **One continuous world with no loading screens** while walking, driving fast or flying.
2. **Density that holds at distance**: traffic, lights and silhouettes remain readable far away rather than ending at a visible bubble.
3. **Distinct districts** with their own architecture, palette, population mix and traffic character, so that location is recognisable from the street.
4. **Ambient life that does not need the player**: pedestrians and vehicles with plausible purpose.
5. **A legible, escalating law-enforcement response** driven by what the world has plausibly observed.
6. **Time of day and weather as mood**, changing lighting, wetness and population.
7. **Simulation before spectacle**: the benchmark title holds 30 fps on consoles because simulation load is prioritised; we should likewise budget CPU for simulation first.

We copy none of GTA VI's characters, story, map, region names, brands or radio content. Our city plan, district names and characters are original and procedurally generated from our own seed.

---

## 3. Technique survey

### 3.1 World partitioning and streaming

**How it works.** The world is cut into spatial units (grid cells, tiles or sub-levels). A streaming system keeps only the units near "streaming sources" (normally the player/camera) in memory, loads others asynchronously in the background, and shows a cheap stand-in for what is not loaded.

**Unreal Engine 5 — World Partition. [CONFIRMED — Epic docs]**
- The world is stored in a single persistent level and divided into streamable grid cells by a configurable runtime grid; cells load and unload according to streaming sources. Extra sources can be added with a streaming-source component (e.g. to pre-load a teleport destination). Epic notes that using more than one grid can hurt performance. Source: [World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine).
- **HLOD** layers merge many static-mesh actors into one proxy mesh and material, used to *visualise unloaded cells* and cut draw calls. Source: [World Partition – HLOD](https://dev.epicgames.com/documentation/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine).
- **Data Layers** group actors so sets of content can be toggled at runtime from gameplay code (quests, world states). Source: [Data Layers](https://dev.epicgames.com/documentation/unreal-engine/world-partition---data-layers-in-unreal-engine).
- **One File Per Actor** stores each actor in its own file so teams do not contend on one level file (an authoring feature, not a runtime one). Source: World Partition page above.
- A commonly quoted default of 256 m cells (25,600 cm) comes from a third-party knowledge base ([Prism-KB](https://jdot274.github.io/Prism-KB/tools/world-partition/)); we did not confirm it against Epic's page. Treat as unverified.

**Unity 6. [CONFIRMED — Unity docs]**
- Entities (DOTS) scene streaming: sub-scenes are split into *sections* that load asynchronously in the background; "all scene loading in Entities is asynchronous". Sources: [Entities streaming overview](https://docs.unity3d.com/Packages/com.unity.entities@1.3/manual/streaming-overview.html), [streaming scenes](https://docs.unity3d.com/Packages/com.unity.entities@1.3/manual/streaming-scenes.html).
- Addressables: assets load through asynchronous operation handles with reference counting; each load must be matched by a release. Source: [Addressables async operation handles](https://docs.unity3d.com/Packages/com.unity.addressables@2.3/manual/AddressableAssetsAsyncOperationHandle.html).
- A worked example of grid-based sub-scene streaming with quadtree LOD exists in Meta's Unity sample ([Meta asset streaming sample](https://developers.meta.com/vr/documentation/unity/unity-sample-asset-streaming)). **[INDUSTRY]**

**Godot 4.**
- There is no built-in equivalent of World Partition. The engine provides the pieces: background loading through `ResourceLoader.load_threaded_request` ([Background loading](https://docs.godotengine.org/en/4.4/tutorials/io/background_loading.html)), visibility ranges for HLOD ([Visibility ranges (HLOD)](https://docs.godotengine.org/en/4.6/tutorials/3d/visibility_ranges.html)) and automatic mesh LOD plus occluder-based occlusion culling ([Optimizing 3D performance](https://docs.godotengine.org/en/4.6/tutorials/performance/optimizing_3d_performance.html)). **[CONFIRMED — Godot docs]** for those features.
- In practice people write their own chunk manager on top of threaded loading, or use community add-ons. Forum threads report the recurring problem that `add_child()` runs on the main thread, so instantiation must be spread out to avoid hitches ([Godot forum thread](https://forum.godotengine.org/t/handling-data-streaming-chunk-loading-for-large-3d-maps-in-godot/138774?page=2)). **[INDUSTRY — community practice]**

**Shipped games.**
- *Marvel's Spider-Man* (Insomniac): the city is about 800 square tiles, each 128 m on a side; the game continuously unloads tiles behind the player and loads tiles ahead. Source: [PlayStation Blog interview](https://blog.playstation.com/2018/09/06/insomniac-interview-the-tech-behind-marvels-spider-man). The engineering detail is in Elan Ruskin's GDC 2019 talk "Marvel's Spider-Man: A Technical Postmortem" ([GDC Vault](https://gdcvault.com/play/1026496), [80.lv summary](https://80.lv/articles/marvels-spider-man-a-technical-postmortem)), and Insomniac's earlier "Streaming in Sunset Overdrive's Open World" ([GDC Vault](https://gdcvault.com/play/1022268/contactUs)). **[INDUSTRY]**
- *Horizon Zero Dawn* (Guerrilla, Decima): "Streaming the World of Horizon Zero Dawn" covers the asset pipeline, low-level and high-level streaming systems, memory management and scheduling. Source: [Guerrilla](https://guerrilla-games.com/read/Streaming-the-World-of-Horizon-Zero-Dawn). **[INDUSTRY]** (talk content beyond the abstract was not readable in this session.)
- *GTA V* (third-party frame study): Courrèges describes a deferred renderer writing several render targets per draw, and singles out Rockstar's LOD handling as best-in-class; low-detail geometry is what makes a per-frame environment cubemap affordable. Source: [GTA V – Graphics Study](https://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study/), [Part 2: LOD and Reflections](https://adriancourreges.com/blog/2015/11/02/gta-v-graphics-study-part-2). **[INDUSTRY — reverse-engineering analysis of rendered frames]**. How RAGE streams data is **[UNKNOWN]**.

### 3.2 Predictive streaming, priorities, budgets and time-slicing

**How it works.** A naive "load everything within radius R" system fails at speed: by the time a cell is requested, the player is already in it. Production systems therefore (a) prioritise by where the player *will* be, (b) cap memory with explicit pools and evict least-recently-used data, (c) do I/O and decompression off the main thread, and (d) cap the main-thread time spent per frame integrating loaded data into the live scene.

- **Velocity in priority. [CONFIRMED — Epic API docs]** Unreal's `FWorldPartitionStreamingSource` carries the source's velocity (computed by the engine), a flag controlling whether velocity contributes to cell priority sorting, an explicit priority, and a rotation that can affect prioritisation. Source: [FWorldPartitionStreamingSource](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/FWorldPartitionStreamingSource). Epic also documents scaling the loading range dynamically: [Dynamic loading range scaling](https://dev.epicgames.com/documentation/unreal-engine/dynamic-loading-range-scaling-in-unreal-engine).
- **Load ahead, unload behind. [INDUSTRY]** Insomniac describes exactly this for Spider-Man's tiles ([PlayStation Blog](https://blog.playstation.com/2018/09/06/insomniac-interview-the-tech-behind-marvels-spider-man)). Traversal speed is bounded by streaming throughput; Spider-Man 2 used the PS5 SSD to raise that bound ([80.lv](https://80.lv/articles/marvel-s-spider-man-2-fast-travel-hides-no-loading-screens/)).
- **Per-frame integration budget. [CONFIRMED — Epic docs]** Unreal exposes per-frame time limits for async loading and for adding/removing levels to the world, and a granularity setting for how many components are registered before the time limit is re-checked. Source: [Streaming settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/streaming-settings-of-the-unreal-engine-project-settings). Forum reports show that budgets alone do not prevent hitches when a single asset is indivisible (e.g. a large instanced mesh creating all its collision at once): [UE forum](https://forums.unrealengine.com/t/world-partition-streaming-performance/2577446). Lesson: make the *unit of work* small.
- **Fixed pools with LRU eviction. [CONFIRMED — Epic docs]** Unreal's virtual-texture physical pools have a fixed size and behave as a least-recently-used cache. Source: [Virtual texture memory pools](https://dev.epicgames.com/documentation/unreal-engine/virtual-texture-memory-pools-in-unreal-engine).
- **Reference-counted async assets. [CONFIRMED — Unity docs]** See Addressables in §3.1.
- **Asynchronous decompression and background I/O** are standard in the streaming talks cited in §3.1. **[INDUSTRY]** Specific formats and thread layouts of any given engine are **[UNKNOWN]** unless in those talks.

### 3.3 Level of detail

- **Discrete LOD with hysteresis. [CONFIRMED — three.js source, read first-hand]** `THREE.LOD.addLevel(object, distance, hysteresis)`; hysteresis is documented in the source as a "threshold used to avoid flickering at LOD boundaries, as a fraction of distance" (`src/objects/LOD.js`, r187).
- **Cross-fade / dithered transitions. [CONFIRMED — Unity docs]** Unity's LOD Group can cross-fade two LOD levels, rendering both during the transition and blending "by using either screen-space dithering or transparency"; the transition can be time-based or a fraction of the LOD's range. Source: [Unity LOD Group](https://docs.unity.com/en-us/engine/6000.0/manual/analysis/graphics-performance-profiling/simplifying-distant-meshes-with-level-of-detail-lod/class-lodgroup). Dithered fading is preferred over alpha blending because it keeps depth writes and avoids sorting. **[INDUSTRY]**
- **HLOD. [CONFIRMED — Epic and Godot docs]** One merged proxy replaces many objects at distance (§3.1). Godot states the benefit plainly: "a single larger mesh can replace several smaller meshes", cutting draw calls while keeping culling granularity up close.
- **Impostors. [INDUSTRY]** A mesh is pre-rendered from many directions into an atlas and drawn as a camera-facing quad, blending the nearest captured views. The octahedral layout was popularised by Ryan Brucks' "Octahedral Impostors" article (2018), which three.js community ports cite: [three.js forum](https://discourse.threejs.org/t/octahedral-impostors-for-three-js/80318), [Alan Zucconi overview](https://www.alanzucconi.com/2018/08/25/shader-showcase-saturday-7/).
- **Nanite (virtualised geometry). [CONFIRMED — Epic docs and SIGGRAPH slides]** Meshes are broken at import into hierarchical clusters of triangles; the renderer selects clusters per frame so detail scales with screen coverage, and a coarse *fallback mesh* serves collision, ray tracing and unsupported platforms. Sources: [Nanite docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine), [Karis, Stubbe, Wihlidal, SIGGRAPH 2021](https://advances.realtimerendering.com/s2021/Karis_Nanite_SIGGRAPH_Advances_2021_final.pdf). This removes authored LOD chains and most pop-in; it depends on GPU-driven rendering that the web stack cannot reproduce (§5.11).

### 3.4 Occlusion and visibility culling

- **Frustum culling**: skip objects whose bounds are outside the view volume. Universal. **[INDUSTRY]**
- **Unreal's defaults. [CONFIRMED — Epic docs]** View-frustum culling and hardware occlusion queries are on by default; distance culling and precomputed visibility volumes (baked offline, best for small/medium levels and mobile) are additional options; a hierarchical Z-buffer occlusion path exists. Source: [Visibility and Occlusion Culling](https://dev.epicgames.com/documentation/en-us/unreal-engine/visibility-and-occlusion-culling-in-unreal-engine), [reference](https://dev.epicgames.com/documentation/unreal-engine/visibility-and-occlusion-culling-reference-in-unreal-engine).
- **Hierarchical Z-buffer (HZB) and GPU-driven culling. [INDUSTRY]** Build a depth pyramid (from last frame's depth or a cheap occluder pass) and test each object's or mesh cluster's screen bounds against the matching mip; do instance and cluster culling on the GPU and emit draw arguments there. Source: [Haar and Aaltonen, "GPU-Driven Rendering Pipelines", SIGGRAPH 2015](https://advances.realtimerendering.com/s2015/aaltonenhaar_siggraph2015_combined_final_footer_220dpi.pdf).
- **Software occlusion. [INDUSTRY]** Rasterise simplified occluders on the CPU with SIMD and test bounds against that buffer: [Intel, Masked Software Occlusion Culling](https://intel.com/content/www/us/en/developer/articles/technical/masked-software-occlusion-culling.html). Guerrilla's visibility talk traces their path from software occlusion on PS3, to middleware for static visibility in Killzone Shadow Fall, to fast visibility queries for Horizon's open world: [Decima Engine: Visibility in Horizon Zero Dawn](https://www.guerrilla-games.com/read/decima-engine-visibility-in-horizon-zero-dawn).
- **PVS (potentially visible sets)**: precompute, per region, which other regions can be seen. Unreal's precomputed visibility is the documented example above. Good for static, authored worlds; poor fit for procedurally generated ones unless computed at generation time. **[INDUSTRY]**
- **Occluder nodes (Godot). [CONFIRMED — Godot docs]** Godot culls against artist-placed or baked occluders and notes that level design may need to add "occlusion opportunities" ([Optimizing 3D performance](https://docs.godotengine.org/en/4.6/tutorials/performance/optimizing_3d_performance.html)).

### 3.5 Procedural city and environment generation

- **Parish and Müller, "Procedural Modeling of Cities" (SIGGRAPH 2001). [INDUSTRY]** Roads grow from an extended L-system steered by global goals (population density, street patterns such as grid or radial) and local constraints (snap to existing roads, respect terrain); the enclosed areas are subdivided into lots; buildings are generated by a parametric, stochastic grammar. Source: [ACM SIGGRAPH archive entry](https://history.siggraph.org/?p=116923); interactive explainer: [phiresky](https://phiresky.github.io/procedural-cities/presentation.html).
- **Unreal PCG framework. [CONFIRMED — Epic docs]** A node graph produces and filters *points* (transform, bounds, density, seed, custom attributes) sampled from surfaces, volumes and meshes; spawner nodes turn points into meshes/actors. Source: [PCG overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-overview).
- **GPU run-time placement, Horizon Zero Dawn. [INDUSTRY]** Artists author rule graphs that evaluate to 2D *density maps*; the GPU discretises densities into a point cloud with a dither-style threshold pattern and places objects around the player on the fly. Guerrilla reports 500+ asset types and roughly 250 µs average GPU load. Sources: [slides (PDF)](https://www.guerrilla-games.com/media/News/Files/GDC2017_VanMuijden_GPUBasedProceduralPlacementInHorizonZeroDawn.pdf), [Guerrilla page](https://www.guerrilla-games.com/read/gpu-based-procedural-placement-in-horizon-zero-dawn). The idea that matters to us: placement is a **deterministic function of position and seed**, so it never needs to be stored.
- **Houdini pipelines. [INDUSTRY]** Insomniac built Manhattan with procedural systems that assist rather than replace authoring: David Santiago, "Procedurally Crafting Manhattan for Marvel's Spider-Man", GDC 2019 ([Game Developer video note](https://gamedeveloper.com/programming/video-procedurally-creating-manhattan-for-i-marvel-s-spider-man-i-), [GDC Vault](https://gdcvault.com/play/1025765)). Epic's City Sample city is likewise built with a Houdini-based procedural workflow; we saw this only through the sample's documentation extract and community threads about its Houdini project ([City Sample docs](https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration), [UE forum](https://forums.unrealengine.com/t/city-sample-in-houdini-cant-process-and-export/593207/118)), so the pipeline details are unverified here.

### 3.6 NPC crowds and simulation LOD

**How it works.** Rendering LOD is not enough; *behaviour* must also have levels. Near the player an NPC runs full AI, physics and animation. Further away it becomes a cheap agent following a path. Out of sight it is a statistic.

- **Unreal Mass Entity. [CONFIRMED — Epic docs]** An archetype ECS: data lives in *fragments*, logic in *processors*, entity templates are composed from *traits*. MassGameplay includes a LOD subsystem that computes the level of detail each entity needs, plus spawners and a force-based avoidance module. Sources: [Mass Entity overview](https://dev.epicgames.com/documentation/unreal-engine/overview-of-mass-entity-in-unreal-engine), [Mass Gameplay overview](https://dev.epicgames.com/documentation/unreal-engine/overview-of-mass-gameplay-in-unreal-engine?lang=en-US).
- **City Sample ("The Matrix Awakens"). [CONFIRMED — Epic docs]** Mass manages behaviour and visualisation of both traffic and crowds; density sliders exist for crowd, traffic and parked cars; the Big City map is about 4 km × 4 km. Source: [City Sample](https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration). Exact runtime entity counts were not in any extract we saw: **[UNKNOWN to us]**.
- **Assassin's Creed Unity. [INDUSTRY]** "AI recycling": up to about 10,000 crowd NPCs on screen within a budget of about 40 full AIs and 120 high-resolution models, by pooling and swapping low-detail "bulk" crowd members for full NPCs as they approach. Sources: [GDC Vault](https://www.gdcvault.com/play/1022141/Massive-Crowd-on-Assassin-s), [Game Developer preview](https://www.gamedeveloper.com/programming/get-coding-advice-from-insomniac-riot-and-ubisoft-at-gdc-2015).
- **Hitman: Absolution. [INDUSTRY]** About 1,200 crowd characters per zone with a cap of about 500 on screen, as summarised in a later Intel/IO Interactive deck, which also describes the crowd as CPU-heavy with AI simulated every frame and animation time-sliced over several frames. Sources: [GDC Vault, "Crowds in Hitman: Absolution"](https://gdcvault.com/play/1015315/Crowds-in-Hitman), [Intel/IO Interactive Hitman 2 deck](https://www.intel.com/content/dam/develop/external/us/en/documents/06-create-a-scalable-and-destructible-world-in-hitman2-807276.pdf).
- **Watch Dogs: Legion "Census". [INDUSTRY]** Characters are generated procedurally with appearance, schedule and relationships; a persistent profile is attached when the player takes interest in someone, so the many are cheap and only the selected few are fully instantiated. Sources: [GDC Vault](https://www.gdcvault.com/play/1027018/contactUs), [Ubisoft](https://news.ubisoft.com/en-us/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london).
- **S.T.A.L.K.E.R. "A-Life". [INDUSTRY]** Two planes of simulation: *online* (detailed, near the player) and *offline* (coarse, everywhere else, advancing as game time passes). Source: [Game Developer, "A-Life: an insight into ambitious AI"](https://gamedeveloper.com/design/a-life-an-insight-into-ambitious-ai).
- How GTA VI budgets its pedestrians is **[UNKNOWN]**.

### 3.7 Traffic systems

- **Lane graph. [CONFIRMED — Epic tooling; INDUSTRY as a pattern]** Roads are represented as directed lanes with connections at intersections; agents follow lanes instead of doing free navigation. Unreal's ZoneGraph is the lane-graph substrate used by Mass traffic and crowds in the City Sample ([ZoneGraph quick start, UE forums](https://forums.unrealengine.com/t/tutorial-zonegraph-quick-start-guide/573924); [City Sample docs](https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration)).
- **Car-following: Intelligent Driver Model. [INDUSTRY]** Each vehicle accelerates as a function of its own speed `v`, the gap `s` to the leader and the closing speed `Δv`:
  ```
  dv/dt = a · [ 1 − (v / v0)^δ − ( s*(v, Δv) / s )² ]
  s*(v, Δv) = s0 + v·T + v·Δv / ( 2·√(a·b) )
  ```
  `v0` desired speed, `T` desired time headway, `s0` minimum gap, `a` max acceleration, `b` comfortable deceleration, `δ` usually 4. It is collision-free in normal operation and costs a handful of arithmetic operations per vehicle. Source: [Treiber, Hennecke, Helbing (2000)](https://arxiv.org/abs/cond-mat/0002177).
- **Intersection control. [INDUSTRY pattern / RECOMMENDATION for specifics]** Signalised junctions cycle through *phases* (sets of non-conflicting lane connections with green); a red light or occupied junction is modelled as a virtual stopped leader at the stop line, which lets IDM handle stopping with no special case.
- **Fidelity LOD. [INDUSTRY]** Epic's City Sample docs state that Mass manages both traffic and crowds and that Chaos drives the vehicle physics; the Mass LOD subsystem (§3.6) is the mechanism for varying per-entity cost with distance. The exact distances and what each traffic LOD simulates were not in any extract we saw: **[UNKNOWN to us]**.

### 3.8 Vehicle physics

- **Raycast vehicle. [CONFIRMED — NVIDIA PhysX docs]** The chassis is one rigid body. Each wheel is a suspension ray cast from just above the wheel at maximum compression down the suspension direction to just below it at maximum droop. Spring/damper force comes from compression; tyre forces (longitudinal from engine/brake, lateral from slip) are applied at the contact point; the summed forces are applied to the body, which is then integrated. Source: [PhysX Vehicles guide](https://docs.nvidia.com/gameworks/content/gameworkslibrary/physx/guide/Manual/Vehicles.html).
- **Chaos Vehicles. [CONFIRMED — Epic API docs]** Wheels choose a sweep shape for the suspension query: raycast (cheapest), spherecast or shapecast (most expensive). Source: [UChaosVehicleWheel](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ChaosVehicles/UChaosVehicleWheel).
- **Pacejka "Magic Formula". [INDUSTRY]** A semi-empirical curve fit of tyre force against slip: `F(x) = D · sin( C · atan( B·x − E·(B·x − atan(B·x)) ) )`, where `x` is slip angle or slip ratio and B, C, D, E are stiffness, shape, peak and curvature factors. It reproduces the rise-peak-falloff of real tyres (grip drops after the peak, which is what makes slides controllable). It is ill-conditioned near zero speed and needs a low-speed blend. Sources: [Wikipedia: Hans B. Pacejka](https://en.wikipedia.org/wiki/Hans_B._Pacejka), [Tire model](https://wikipedia.com/wiki/Tire_model).
- **Rapier `DynamicRayCastVehicleController`. [CONFIRMED — package `.d.ts`, read first-hand, v0.21.0]** Created with `world.createVehicleController(chassis)`. `addWheel(chassisConnectionCs, directionCs, axleCs, suspensionRestLength, radius)`; per-wheel setters for suspension stiffness, compression, relaxation, max travel and max force; `setWheelEngineForce`, `setWheelBrake`, `setWheelSteering`; friction via `setWheelFrictionSlip` and `setWheelSideFrictionStiffness`; step with `updateVehicle(dt, filterFlags?, filterGroups?, filterPredicate?)`; read back `wheelIsInContact`, `wheelSuspensionLength`, `wheelContactPoint`, `wheelRotation`, `currentVehicleSpeed()`. Its tyre model is a simple friction-slip clamp, not Pacejka. Typings on a CDN: [ray_cast_vehicle_controller.d.ts](https://cdn.jsdelivr.net/npm/@dimforge/rapier3d@0.19.3/control/ray_cast_vehicle_controller.d.ts); class page: [rapier.rs](https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html). The controller is thinly documented ([issue](https://github-redirect.dependabot.com/dimforge/rapier.rs/issues/90)).

### 3.9 Animation (brief)

- **State machines and blend trees**: explicit states (idle, walk, run, jump) with authored transitions and parametric blends. Simple and predictable; grows combinatorially. **[INDUSTRY]**
- **Motion matching. [INDUSTRY]** Every few frames, search a database of motion-capture poses for the one whose current pose features and future trajectory best match the character's pose and desired trajectory, then blend to it. Introduced by Ubisoft for *For Honor*: Simon Clavet, "Motion Matching and The Road to Next-Gen Animation", GDC 2016 ([GDC Vault](https://www.gdcvault.com/play/1022985/Motion-Matching-and-The-Road)). Unreal ships it in the Pose Search plugin, where a Motion Matching node can replace state machines or blend spaces and cost scales with schema channels and sample rate ([Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-matching-in-unreal-engine)). **[CONFIRMED — Epic docs]**. It needs large, clean mocap sets: out of scope for us.
- **IK**: foot placement and hand targets solved after the base pose. three.js ships a CCD solver in its addons (`examples/jsm/animation/CCDIKSolver.js`). **[CONFIRMED — package contents]**

### 3.10 Time of day and weather (brief)

- **Sky and atmosphere. [INDUSTRY]** Hillaire's EGSR 2020 method renders physically based sky and aerial perspective cheaply with small look-up tables and a real-time multiple-scattering approximation; it is the basis of Unreal's sky atmosphere. Source: [Hillaire 2020](https://diglib.eg.org/handle/10.1111/cgf14050).
- **Volumetric clouds. [INDUSTRY]** Ray-march a cloud layer whose density comes from layered noise shaped by coverage/type maps; spread the cost over frames with temporal reprojection. Source: [Schneider and Vos, SIGGRAPH 2015](https://www.advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf).
- **Unified atmosphere, Red Dead Redemption 2. [CONFIRMED — Rockstar's own talk exists; content seen only via listing and secondary notes]** Fabian Bauer, "Creating the Atmospheric World of Red Dead Redemption 2: A Complete and Integrated Solution", SIGGRAPH 2019 Advances course: clouds, fog and scattering treated as one system. Sources: [course page](https://advances.realtimerendering.com/s2019/index.htm), [third-party RDR2 frame study](https://imgeself.github.io/posts/2020-06-19-graphics-study-rdr2).
- **Wet surfaces. [INDUSTRY]** Wetness darkens diffuse albedo and lowers roughness; puddles add a flat, highly reflective layer; ripples and streaks animate normals. Source: Sébastien Lagarde's rain series, covered by [fxguide](https://www.fxguide.com/?p=42356).
- **three.js**: an analytic daylight sky (`Sky`, `SkyMesh`) ships in the addons; volumetric clouds exist only as community packages (e.g. [@takram/three-clouds](https://www.npmjs.com/package/@takram/three-clouds)). **[CONFIRMED — package contents / npm listing]**

### 3.11 Rendering optimisation

- **Draw calls are the first budget. [INDUSTRY]** Each mesh costs CPU time in the renderer and driver regardless of triangle count; the three.js manual's guidance is to merge geometry ([Optimize Lots of Objects](https://threejs.org/manual/en/optimize-lots-of-objects.html)). `renderer.info.render.calls` reports the per-frame count ([three.js forum](https://discourse.threejs.org/t/webgl-drawcalls/24476/2)).
- **Instancing** (one geometry, many transforms, one call) and **batching** (many geometries, one material, one multi-draw call): see §3.13.
- **Shadows multiply draw calls. [INDUSTRY]** Each shadow-casting light re-renders its casters; a point light costs six passes. Cascaded shadow maps split the view frustum into depth ranges with a map each, to fight perspective aliasing: [Microsoft, Cascaded Shadow Maps](https://msdn.microsoft.com/fr-fr/library/ee416307.aspx), [Common Techniques to Improve Shadow Depth Maps](https://learn.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps). three.js ships a CSM addon (`examples/jsm/csm`). **[CONFIRMED — package contents]**
- **Texture atlases / arrays** let many objects share one material, which is the precondition for merging and batching. **Texture streaming** keeps only needed mips resident under a fixed pool ([Unreal virtual texture pools](https://dev.epicgames.com/documentation/unreal-engine/virtual-texture-memory-pools-in-unreal-engine)). **[INDUSTRY]**
- **WebGL-specific. [CONFIRMED — MDN]** Avoid synchronous GPU round-trips in the frame loop (`getError`, `readPixels`, `finish`), cache uniform locations, budget VRAM conservatively because WebGL cannot query it, and consider rendering below CSS resolution. Source: [MDN WebGL best practices](https://developer.mozilla.org/docs/Web/API/WebGL_API/WebGL_best_practices).

### 3.12 Wanted / police systems (design level)

- **Knowledge model. [INDUSTRY — observed behaviour documented by community wikis and press]** In GTA V the response is driven by *line of sight*: when officers lose sight, the HUD stars flash and police search around the last known position, with search time and intensity rising with the star level ([GTA Wiki](https://gta.wiki/wiki/Wanted_Level_in_GTA_V)). This is observed behaviour, not published design.
- **Witness model. [INDUSTRY — press coverage]** In Red Dead Redemption 2 a crime must be *seen and reported*: witnesses run to alert the law; stopping them before they report prevents the wanted state; then an investigation/search phase follows ([GameSpot](https://www.gamespot.com/articles/red-dead-redemption-2s-world-is-full-of-snitches/1100-6462203/), [Shacknews](https://www.shacknews.com/article/108138/how-the-wanted-and-bounty-systems-work-in-red-dead-redemption-2)).
- **Design conclusions. [RECOMMENDATION]** Separate four things: (1) *events* (a crime happened at position p, time t, severity k); (2) *knowledge* (who perceived it: witnesses with line of sight and hearing radius, officers, cameras); (3) *reporting* (a witness needs time to report; reports carry a description and a position); (4) *response* (heat level sets unit count and tactics; units go to the *reported* position, then search an area that grows with time since the last sighting and shrinks to nothing when the timer expires). The player always loses heat by breaking the chain of knowledge, never by an arbitrary timer alone.

### 3.13 Web / WebGL specifics

**three.js (r187, verified in the shipped source). [CONFIRMED]**
- `InstancedMesh`: one geometry + one material drawn N times with per-instance matrices/colours in one draw call; has `computeBoundingSphere()`, and culling is for the whole instance set, not per instance. Docs: [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).
- `BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, material)`: many *different* geometries sharing one material in one object, drawn through the `WEBGL_multi_draw` extension (slower fallback without it). Methods include `addGeometry`, `addInstance`, `setMatrixAt`, `setColorAt`, `setVisibleAt`, `deleteGeometry`, `deleteInstance`, `optimize`, `setInstanceCount`, `setGeometrySize`. Properties `perObjectFrustumCulled = true` and `sortObjects = true` by default, so each item is culled individually on the CPU. All geometries must share the first geometry's attribute layout. Docs: [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html). Community guidance: InstancedMesh for one geometry, BatchedMesh for many ([forum](https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221)).
- `LOD.addLevel(object, distance, hysteresis)`, `autoUpdate`. No built-in cross-fade.
- `BufferGeometryUtils.mergeGeometries(geometries, useGroups)` for static merging.
- `WebGLRenderer` requires WebGL2 ("WebGL 1 is not supported since r163").
- Addons present in the package: `csm/` (cascaded shadows), `objects/Sky.js`, `math/Octree.js`, `modifiers/SimplifyModifier.js`, `postprocessing/` (EffectComposer, bloom, GTAO/SSAO, SMAA/FXAA, etc.), `animation/CCDIKSolver.js`.

**Workers and scheduling. [CONFIRMED — MDN / Chrome docs]**
- Transferable objects move ownership of a resource between contexts without copying; an `ArrayBuffer` passed in the transfer list of `postMessage` becomes detached in the sender (`byteLength` 0). Typed arrays are transferred via their `.buffer`. Sources: [MDN Transferable objects](https://developer.mozilla.org/docs/Web/API/Web_Workers_API/Transferable_objects), [Chrome blog](https://developer.chrome.com/blog/transferable-objects-lightning-fast).
- `SharedArrayBuffer` requires cross-origin isolation (COOP `same-origin` + COEP `require-corp`). Sources: [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer), [web.dev](https://web.dev/articles/coop-coep.md.txt). We avoid depending on it.
- `requestIdleCallback` gives a deadline with `timeRemaining()` (capped at 50 ms), is not available in every major browser and not in workers. Source: [MDN IdleDeadline.timeRemaining](https://developer.mozilla.org/docs/Web/API/IdleDeadline/timeRemaining), [Background Tasks API](https://developer.mozilla.org/ko/docs/Web/API/Background_Tasks_API). Conclusion: use our own per-frame budget inside `requestAnimationFrame`; treat idle callbacks as an optional extra. **[RECOMMENDATION]**
- `OffscreenCanvas` lets rendering run in a worker ([web.dev](https://web.dev/articles/offscreen-canvas?authuser=115)). Not needed initially.

**WebGL2 versus WebGPU.**
- WebGPU is supported in current Chrome/Edge, Firefox (Windows from 141, Apple-silicon macOS from 145; Linux/Android in progress at the time of the article) and Safari 26. Source: [web.dev, November 2025](https://web.dev/blog/webgpu-supported-major-browsers). **[CONFIRMED]**
- three.js has a `WebGPURenderer` (import from `three/webgpu`) that uses WebGPU by default and falls back to a WebGL 2 backend; features such as compute shaders need the real WebGPU backend. Sources: [three.js manual](https://threejs.org/manual/en/webgpurenderer), [forum](https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974). **[CONFIRMED]**
- WebGL2 has no compute shaders and no GPU-driven indirect draw; culling and LOD selection must be done on the CPU. **[INDUSTRY]**

**Our browser, measured in this session. [CONFIRMED — first-hand]** Playwright 1.63.0 launching the pre-installed HeadlessChrome 158: `webgl2` context available; renderer string "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"; `MAX_TEXTURE_SIZE` 8192; `WEBGL_multi_draw` available; `navigator.gpu` undefined (**no WebGPU**); `hardwareConcurrency` 4; `requestIdleCallback` present. Chromium is phasing out *automatic* SwiftShader fallback for WebGL and documents `--enable-unsafe-swiftshader` as the opt-in for headless/no-GPU testing ([Chromium docs](https://chromium.googlesource.com/chromium/src/+/798e59c5275d4131797e8ea2e96e6c6000256b58/docs/gpu/swiftshader.md), [blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM)). Our build worked without the flag today; pass it explicitly so a browser update does not silently remove WebGL. **[RECOMMENDATION]**

**Rapier (`@dimforge/rapier3d-compat` 0.21.0, verified in `.d.ts`). [CONFIRMED]**
- `await RAPIER.init()` (the `-compat` build embeds the WASM, about 3 MB); `world.timestep`, `world.numSolverIterations`.
- `KinematicCharacterController` via `world.createCharacterController(offset)`: `computeColliderMovement(collider, desiredTranslationDelta, …)`, then `computedMovement()`, `computedGrounded()`, `numComputedCollisions()`; `enableAutostep(maxHeight, minWidth, includeDynamicBodies)`, `enableSnapToGround(distance)`, `setMaxSlopeClimbAngle`, `setMinSlopeSlideAngle`, `setSlideEnabled`, `setApplyImpulsesToDynamicBodies`, `setUp`. Guide: [Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller).
- Colliders: `ColliderDesc.cuboid`, `capsule`, `trimesh(Float32Array, Uint32Array)`, `heightfield`, `convexHull`. Typed-array inputs mean worker-generated collision data can be transferred and consumed without conversion.
- Vehicle controller: §3.8.

---

## 4. Engine comparison for this project

| Area | Unreal Engine 5 | Unity 6 | Godot 4 | Web: three.js + Rapier (WebGL2; WebGPU later) |
|---|---|---|---|---|
| World partition / streaming | Built in: World Partition grid, streaming sources with velocity/priority, Data Layers, per-frame integration budgets | Building blocks: Entities sub-scene sections (async), Addressables; grid logic is yours or a sample's | None built in; threaded resource loading; write a chunk manager or use add-ons | None; we write it. Workers + transferable buffers make background generation practical |
| LOD | Nanite removes authored LODs; HLOD proxies for unloaded cells | LOD Group with cross-fade; HLOD in Entities Graphics | Automatic mesh LOD on import; visibility ranges (HLOD) | `THREE.LOD` with hysteresis; everything else (HLOD, impostors, cross-fade) hand-built |
| Occlusion | Frustum + hardware queries by default; HZB; precomputed visibility; Nanite's own culling | Baked occlusion culling in the editor (not re-verified this session) | Occluder nodes, software rasterised | Frustum culling only out of the box; coarse CPU occlusion is ours to write |
| GI / lighting | Lumen dynamic GI and reflections, on by default in new projects ([docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine)); virtual shadow maps | Baked and probe-based GI, screen-space effects; HDRP has more | SDFGI / VoxelGI / lightmaps | Direct light + hemisphere/environment light + shadow maps (CSM addon); no dynamic GI |
| Physics / vehicles | Chaos, Chaos Vehicles (ray/sphere/shape wheel sweeps) | PhysX-based physics, wheel colliders; DOTS Physics | Jolt is the default 3D physics for new projects since 4.6 ([release page](https://godotengine.org/releases/4.6/)); `VehicleBody3D` raycast vehicle | Rapier WASM: rigid bodies, kinematic character controller, raycast vehicle controller |
| Crowd / AI frameworks | Mass Entity, ZoneGraph, Mass traffic/crowd samples (City Sample), behaviour trees, navmesh | DOTS/ECS for scale; NavMesh; no ready-made city traffic | Navigation server, avoidance; no ECS crowd framework | Nothing built in; typed-array ECS-style data and lane graph written by us |
| Tooling | Full editor, profilers, PCG graph, Houdini bridge | Full editor, profilers, large asset ecosystem | Full open-source editor | Code-first; browser devtools; Vite HMR; no world editor |
| Licensing | Free to use; 5% royalty on lifetime gross revenue above USD 1M per product ([license](https://www.unrealengine.com/en-US/license)) | Seat subscriptions; Runtime Fee cancelled Sept 2024; Personal free under USD 200k revenue/funding ([Unity](https://unity.com/blog/unity-is-canceling-the-runtime-fee)) | MIT, no royalties (not re-verified this session; well established) | three.js MIT; Rapier Apache-2.0 (both read from the `package.json` and LICENSE files of the installed packages) |
| Buildable and verifiable in our environment | **No**: not installed, download hosts blocked, no GPU | **No**: same | **No today**: download host blocked; plausible later because the engine can run headless | **Yes**: npm reachable; Vitest in Node; Playwright + software WebGL2 measured working |

Table cells without a link or a section reference (Unity baked occlusion, Unity/Godot GI options, Godot `VehicleBody3D`, Godot's MIT licence) are general knowledge that was **not re-verified in this session**; they do not affect the decision, which rests on the last row.

Conclusion **[RECOMMENDATION]**: build on the web stack now, but shape the code so the *world model* (city plan, cell records, residency state machine, priority function, simulation LOD) is engine-agnostic TypeScript with no three.js or Rapier imports. That core is what would map onto UE5 World Partition + Mass, or onto a Godot chunk manager, if hardware and access change.

---

## 5. Recommended architecture for Project Vice [RECOMMENDATION]

> **Decision record (added after implementation).** This section is the research
> recommendation as written before the code existed. The implementation in
> `docs/GAME_ARCHITECTURE.md` follows its structure — deterministic cells generated in workers,
> the residency state machine, the priority terms, LOD 0–4 with dithered cross-fade, an LRU
> cache and a per-frame budget — with these deliberate differences:
>
> | Recommendation here | As built | Why |
> |---|---|---|
> | 128 m cells | **200 m cells** (2 × 2 blocks of a 100 m road lattice) | A cell boundary that follows the road lattice keeps every block, road segment and intersection owned by exactly one cell. Measured generation is about 1–3 ms per LOD0 cell, so the larger cell is far inside the worker budget. |
> | 3 ms/frame instantiation budget | 4 ms | Measured main-thread streaming work is well under 1 ms on a typical frame. |
> | Coarse horizon-occlusion test | Not built | Frustum, distance and LOD culling only; listed in `docs/KNOWN_LIMITATIONS.md`. |
> | Finite 64 × 64-cell world | 24 × 20 authored cells (4.8 × 4.0 km) with open country and sea beyond | Scope. |

Everything in this section is our design. Numbers are starting values to be tuned by measurement; they are not claims about any other engine.

### 5.1 Design principles

1. **The world is a pure function of `(worldSeed, cellCoord)`.** No cell assets are stored on disk. This is the HZD placement idea (§3.5) applied to a whole city, and it fits a web stack with no asset pipeline.
2. **Workers generate, the main thread only uploads.** All geometry building, layout and collision-shape computation happens in Web Workers and arrives as transferable typed arrays (§3.13).
3. **Every main-thread step is small and budgeted** (§3.2: the hitch lesson from Unreal).
4. **Three independent LOD systems share one distance model**: render LOD, physics presence, simulation LOD.
5. **Core logic has no renderer dependency**, so Vitest can test it in Node and the determinism of generation can be asserted byte-for-byte.

### 5.2 City plan and cell grid

- **City plan (global, compact, generated once at boot, a few hundred kB):** district map (a low-resolution grid or Voronoi regions assigning each area a district type: downtown, commercial, residential, industrial, waterfront, park), arterial road graph (Parish-and-Müller-style growth simplified to a jittered grid with a few diagonal arterials and a coastline constraint), district parameters (height range, lot size, palette, pedestrian and traffic density, prop mix). The plan answers queries such as "which roads cross this cell" and "which district is this point in" without generating any cell.
- **Cell size: 128 m × 128 m.** Justification:
  - It matches a shipped precedent for a dense city traversed at speed (Insomniac's 128 m tiles, §3.1).
  - At a top driving speed of about 45 m/s a cell is crossed in about 2.8 s, comfortably longer than the worker generation time we should target (under 50 ms per cell at LOD0), so look-ahead of 2–4 s only ever needs one to two rings ahead.
  - A 128 m cell holds roughly one city block plus its bounding streets, so a cell is a natural unit for merging geometry into a few draw calls and for one LOD decision.
  - 256 m cells would quadruple the size of every unit of work (bigger worker jobs, bigger uploads, coarser LOD rings); 64 m cells would quadruple the cell count and draw calls at a given view distance.
- **Super-cells: 4 × 4 cells (512 m)** are the unit for LOD3 skyline proxies, in the spirit of HLOD.
- Coordinates: cell `(cx, cz)` covers `[cx·128, (cx+1)·128) × [cz·128, (cz+1)·128)` in metres, Y up. Cell key = `cx + "," + cz` or a packed 32-bit integer. The world is finite (e.g. 64 × 64 cells = 8.2 km square) with water outside.
- Determinism: a per-cell PRNG seeded by `hash(worldSeed, cx, cz, streamId)` with separate streams for layout, props, NPC spawns and traffic spawns, so changing prop rules does not reshuffle buildings. Generation must never read wall-clock time, iteration order of hash maps, or `Math.random`.

### 5.3 Cell record

```ts
type Residency = 'Unloaded' | 'Queued' | 'Generating' | 'Ready'
               | 'Instantiating' | 'Active' | 'Unloading';

interface CellRecord {
  // identity and placement
  key: number; cx: number; cz: number;           // grid coords
  origin: [number, number, number];              // world-space min corner (m)
  bounds: { min: Vec3; max: Vec3; maxHeight: number };
  districtId: number;

  // generated payload (typed arrays, produced in a worker, cached while Ready or better)
  geometry: {                                    // one entry per LOD tier that has geometry
    lod0?: MeshBundle; lod1?: MeshBundle; lod2?: MeshBundle;
  };                                             // MeshBundle = positions/normals/uvs/colors/indices + material groups
  materialIds: Uint16Array;                      // indices into the global material/atlas table
  buildings: BuildingData;                       // packed: footprint box, height, style, door points
  props: PropInstances;                          // packed: typeId, position, yaw, scale (instanced at LOD0/1)
  nav: NavData;                                  // sidewalk graph nodes/edges + lane segments crossing this cell
  npcSpawns: SpawnDefs;                          // deterministic spawn points, archetype weights, density
  trafficSpawns: SpawnDefs;                      // lane-anchored spawn points, parked-car slots
  collision: CollisionData;                      // ground + building cuboids (+ optional trimesh), LOD0 only
  lodAssets: { skylineContribution: SkylineBox[] }; // input to the super-cell LOD3 proxy

  // streaming bookkeeping
  priority: number;                              // last computed score (section 5.5)
  desiredLod: 0 | 1 | 2 | 3 | 4;
  activeLod: 0 | 1 | 2 | 3 | 4;
  residency: Residency;
  generation: number;                            // request id; stale worker results are discarded
  lastTouchedFrame: number;                      // for LRU
  bytesCpu: number; bytesGpu: number;            // accounted against budgets
  pinned: boolean;                               // mission-critical or contains the player
}
```

Worker results carry `{ key, generation, lodMask, buffers… }` and list every `ArrayBuffer` in the transfer list.

### 5.4 Residency state machine

```
Unloaded ──request──▶ Queued ──worker free──▶ Generating ──result──▶ Ready
   ▲                    │ cancel                │ cancel (generation++)   │ desiredLod ≤ 3 and budget available
   │                    ▼                       ▼                          ▼
   └──evicted (LRU)── Ready ◀──GPU released── Unloading ◀──demote── Active(LOD n) ◀──done── Instantiating
                                                                      │  ▲
                                                                      └──┘ LOD change (re-enter Instantiating for the new tier)
```

| State | Meaning | Leaves when |
|---|---|---|
| Unloaded | Nothing in memory. | Desired LOD ≤ 3 → Queued. |
| Queued | In the priority queue waiting for a worker. | A worker is free → Generating. No longer wanted → Unloaded. |
| Generating | A worker is producing typed arrays. | Result arrives with matching `generation` → Ready. Cancelled → result discarded on arrival. |
| Ready | CPU data cached; nothing on the GPU or in physics. | Wanted → Instantiating. Cache over budget and LRU-oldest → Unloaded. |
| Instantiating | Main thread is creating GPU buffers, meshes, colliders, spawners in time-sliced steps. | All steps done → Active. Demoted mid-way → Unloading (steps are individually reversible). |
| Active (LOD n) | Visible at tier n; LOD0 also has colliders and interaction. | Desired tier changes → Instantiating the delta. Not wanted → Unloading. |
| Unloading | Time-sliced removal of colliders, meshes, GPU buffers. | Done → Ready (CPU data kept for cheap re-entry). |

Hysteresis rules:
- **Distance bands**: a tier is *entered* at radius `R_k` and *left* at `R_k × 1.15 + 16 m`.
- **Asymmetric position**: promotion uses the *predicted* position (load early); demotion uses the *actual* position (unload late).
- **Dwell time**: a cell stays at least 0.75 s in a tier before a demotion (prevents thrash when circling a boundary).
- **Cancellation**: a Queued request may be dropped freely; a Generating one is never interrupted, its result is simply cached or discarded, because a 30 ms job is cheaper to finish than to coordinate cancelling.

### 5.5 Streaming priority function

Inputs per frame: player position `p`, velocity `v`, camera forward `f` (all projected to the ground plane), and for each candidate cell its centre `c`, AABB and importance `I ∈ [0,1]`.

```
speed   = |v|
T       = clamp(T_min + (T_max − T_min) · speed / v_ref, T_min, T_max)   // look-ahead seconds
p_pred  = p + v · T                                                       // predicted position

d_now   = distance(p,      cellAABB)        // 0 if inside
d_pred  = distance(p_pred, cellAABB)
d_eff   = min(d_now, d_pred)

dir     = normalize(c − p)
closing = max(0, dot(v, dir))                                 // m/s toward the cell
eta     = (closing > 0.5) ? d_now / closing : ETA_max         // seconds until arrival
heading = (speed > 1) ? max(0, dot(v / speed, dir)) : 0       // 0..1, movement direction
facing  = 0.5 + 0.5 · dot(f, dir)                             // 0..1, camera orientation
inView  = cellAABB intersects camera frustum ? 1 : 0.5

score =   w_d · (1 − sat(d_eff / R_load))
        + w_t · (1 − sat(eta / ETA_max))
        + w_h · heading · sat(speed / v_ref)
        + w_c · facing · inView
        + w_i · I
```

Starting constants: `T_min = 1.0 s`, `T_max = 4.0 s`, `v_ref = 45 m/s`, `ETA_max = 8 s`, `R_load` = the LOD3 radius, weights `w_d = 0.40, w_t = 0.25, w_h = 0.15, w_c = 0.10, w_i = 0.10`. `sat(x) = clamp(x, 0, 1)`.

Overrides:
- The cell containing the player and its eight neighbours are **required**: `score = +∞`, `pinned = true`.
- A pending *LOD0* request outranks any request for LOD1–3 at equal score (colliders before cosmetics).
- **Stall guard**: if a required cell is not Active(LOD0) when the player is within 24 m of its edge, cap vehicle speed smoothly and raise fog density until it is. This must be rare; the debug overlay counts it.

Desired LOD uses `d_eff` for promotion and `d_now` for demotion (§5.4). The queue is re-scored every frame for the few hundred candidate cells; this is trivially cheap.

### 5.6 LOD tiers and transitions

Two profiles: **desktop** (a real GPU) and **CI** (SwiftShader in our container, where fill rate is the limit, so radii and resolution are cut hard).

| Tier | Content | Enter radius desktop / CI |
|---|---|---|
| **LOD0** | Full-detail merged geometry (facade detail, windows, awnings, kerbs, road markings), instanced props, **Rapier colliders**, interaction points, NPC and traffic spawners, full simulation eligibility | 0–160 m / 0–96 m |
| **LOD1** | Reduced detail: flat facades with window texture, no small props, large props only, no colliders, no interaction | –400 m / –200 m |
| **LOD2** | Simplified boxes: one box (or extruded footprint) per building, vertex colour, one draw call per cell | –900 m / –400 m |
| **LOD3** | Merged impostor/skyline proxy per **super-cell**: one mesh of tallest-building boxes plus an emissive "window lights" texture at night; rendered with fog | –3000 m / –1200 m |
| **LOD4** | Nothing | beyond |

Draw-call targets per cell: LOD0 ≤ 12 (merged static by material group + a handful of `InstancedMesh`/`BatchedMesh` prop sets), LOD1 ≤ 4, LOD2 = 1, LOD3 = 1 per super-cell. Frame targets: desktop ≤ 600 draw calls; CI ≤ 150.

Transitions:
- **Dithered cross-fade.** Each cell tier has a `uFade` uniform; the fragment shader discards against a 4×4 Bayer (or interleaved-gradient) threshold. During a 0.4 s transition the old tier fades out with the inverted pattern while the new one fades in, so every pixel is covered by exactly one of them. This is the dithering approach Unity documents (§3.3) and needs no sorting or blending. Implement with `material.onBeforeCompile` or a small custom `ShaderMaterial` chunk.
- **Never show a hole.** A tier is removed only after its replacement reports "first frame rendered". Promotion order is always LOD3 → 2 → 1 → 0, so a coarser representation is on screen before the finer one arrives.
- **Hysteresis bands** per §5.4.
- **Distance fog matched to the LOD3 radius** hides the far edge; it is the cheapest anti-pop tool available to us.
- In the CI profile, transition time may be set to 0 for deterministic screenshots.

### 5.7 Memory budgets, cache and frame budget

| Budget | Desktop | CI | Enforced by |
|---|---|---|---|
| CPU cell cache (typed arrays in Ready or better) | 384 MB | 192 MB | LRU eviction of Ready cells by `lastTouchedFrame`, farthest-first tiebreak |
| GPU geometry (sum of uploaded buffers) | 512 MB | 128 MB | Demote farthest Active cells one tier |
| Textures / atlases | 256 MB (fixed set, loaded at boot) | 64 MB | Fixed atlas count; no per-cell textures |
| Rapier colliders | ≤ 9 cells at LOD0 normally (3×3), hard cap 25 | same | Colliders only at LOD0 |
| Workers | `min(hardwareConcurrency − 1, 4)` → 3 here | 2 (leave cores for SwiftShader) | Fixed pool |
| Main-thread instantiation | **3 ms/frame**, 6 ms when a required cell is pending | 4 ms/frame | Work queue with `performance.now()` checks |

- WebGL cannot report VRAM (§3.11), so `bytesGpu` is our own sum of buffer byte lengths.
- **Instantiation work items** are small and resumable: create one `BufferGeometry` and upload it; create one mesh; add up to N colliders (N ≈ 32) to Rapier; register one spawner. After each item the loop checks elapsed time against the budget. Ground and building colliders are **cuboids**, not trimeshes, so adding a cell's physics is a few dozen cheap calls rather than one long BVH build.
- **Distance-based unloading**: Active → Unloading when beyond the tier's leave radius; Ready → Unloaded only under cache pressure, so turning around is nearly free.
- **Test mode**: `streaming.flush()` drains all queues synchronously, so Vitest and Playwright tests are deterministic and independent of timing.
- GPU buffers are disposed explicitly (`geometry.dispose()`); three.js does not garbage-collect GPU resources.

### 5.8 Visibility and occlusion feasible in WebGL

1. **Cell-level frustum culling.** Each Active cell is one `Group` with a precomputed AABB; test it against the camera frustum on the CPU and set `group.visible`. This skips three.js's per-object tests for whole cells. `BatchedMesh` then culls per item inside visible cells.
2. **Distance + fog culling.** Anything past the fog's full-opacity distance is not drawn.
3. **Coarse horizon occlusion for street-level cameras.** Keep a 1-D angular buffer (e.g. 256 bins over 360° around the camera) storing the highest *elevation angle* reached by solid occluders. Process cells front to back. A cell is occluded if, across every bin its footprint spans, the stored elevation angle exceeds the elevation angle of the cell's top (`bounds.maxHeight`). Occluders are conservative "solid block" boxes emitted by the generator (the building mass of a block, shrunk inward, at the height of its *lowest* contiguous roofline). Cost is O(visible cells × bins spanned), microseconds. Enabled only while the camera is below a height threshold (about 30 m); disabled for aerial views, where little is occluded anyway.
4. **Shadow-pass culling.** Shadow casters limited to LOD0/LOD1 cells within the cascade range.

Honest limits: **no hierarchical-Z occlusion, no GPU-driven culling, no hardware occlusion queries in our pipeline.** WebGL2 has no compute shaders or indirect multi-draw driven from the GPU (§3.13), and a depth-pyramid read-back would stall the pipeline (MDN warns against synchronous read-backs, §3.11). Overdraw in dense streets will therefore be higher than in a native engine; we control it with LOD radii, fog and the horizon test rather than with exact visibility. If we later move to WebGPU, compute-based HZB culling becomes possible.

### 5.9 NPC and traffic simulation LOD

The split mirrors the published AAA pattern (§3.6): a small number of full agents, a larger number of cheap ones, statistics beyond.

**Pedestrians**

| Tier | Range | Cap desktop / CI | What runs |
|---|---|---|---|
| Full | ≤ 40 m | 24 / 8 | Rapier kinematic capsule (character controller), skinned animation with state machine, perception (sight/hearing), reactions, witness logic |
| Simplified | ≤ 140 m | 96 / 24 | Follows the sidewalk graph by interpolation; no physics body; instanced, low-rate or vertex-animated mesh; 10 Hz update; avoidance by lane offset only |
| Statistical | Cells Active at LOD1–3 | no entities | Per-cell headcount by archetype, updated at 1 Hz by flow between neighbouring cells and by time of day |
| Suspended | Unloaded cells | — | Nothing. Population is re-derived from `(seed, cell, timeBucket)` on load |

**Vehicles**

| Tier | Range | Cap desktop / CI | What runs |
|---|---|---|---|
| Full | ≤ 60 m, or involved in a collision | 8 / 4 (incl. player) | Rapier dynamic chassis + `DynamicRayCastVehicleController`; our tyre-force layer; damage |
| Simplified | ≤ 300 m | 48 / 12 | Kinematic movement along lane splines; IDM car-following (§3.7); signal phases as virtual leaders; instanced mesh; 20 Hz |
| Statistical | LOD1–3 cells | no entities (optionally headlight/taillight sprites at night for distant "life") | Per-lane-segment density and mean speed at 1 Hz |
| Suspended | Unloaded | — | Nothing |

Rules:
- **Promotion and demotion are invisible**: an agent is promoted to Full before it enters the Full radius on the predicted path, and demoted only when outside the camera frustum or beyond 1.25 × the radius (the "recycling" idea from AC Unity, §3.6).
- **Persistence by exception**: only agents the player has affected (hit, robbed, a witness mid-report, a pursuing officer) get a persistent record that survives cell unload. Everyone else is regenerated statistically. This is the Census/A-Life lesson at our scale.
- **Budgets are global**, so a crowded plaza steals Full slots from elsewhere instead of dropping frames.
- **Simulation budget**: Full agents every fixed step (60 Hz physics); Simplified round-robin (a fixed slice per frame); Statistical in an idle slice. Target total simulation cost ≤ 4 ms/frame on desktop.
- The lane graph and sidewalk graph are part of each cell's `nav` payload and are stitched across cell borders by deterministic shared edge nodes (both neighbours generate the same border nodes from the city plan).
- Wanted system (§3.12) consumes Full-tier perception only; Simplified agents within hearing radius of a loud crime are promoted, which is what makes "witnesses" plausible without simulating everyone.

### 5.10 Streaming debug overlay

Toggle with a key and via URL parameter (so Playwright can screenshot it).

- **Mini-grid** centred on the player: one square per cell, colour = residency state, digit = active LOD, outline = desired LOD, marker for pinned, arrow for velocity, dot for predicted position, wedge for the camera frustum.
- **Queues**: counts of Queued / Generating / Ready / Instantiating / Unloading; top five queued cells with score breakdown (distance, ETA, heading, facing, importance terms).
- **Workers**: busy/idle per worker, last and average generation time per LOD (ms), cancelled/discarded results.
- **Main-thread budget**: ms spent this frame on instantiation vs the budget; longest single work item; count of over-budget frames.
- **Memory**: CPU cache MB / budget, GPU geometry MB / budget, cells cached, evictions per minute.
- **Renderer**: `renderer.info` draw calls, triangles, geometries, textures; cells culled by frustum / horizon / distance.
- **Physics**: rigid bodies, colliders, cells with colliders, physics step ms.
- **Simulation**: pedestrians and vehicles per tier vs caps; promotions/demotions per second; persistent records.
- **Health counters**: stall-guard activations, "hole" detections (a required cell not Active when entered), LOD thrash count (tier changes per cell per 10 s), look-ahead `T` and speed.
- **In-world option**: wireframe cell bounds tinted by LOD, and the occluder boxes used by the horizon test.

### 5.11 What the web stack cannot match versus UE5 (honest list)

| UE5 capability | Our position |
|---|---|
| **Nanite** virtualised geometry | No equivalent. Discrete LODs, hand-built HLOD proxies, visible detail ceiling, some transitions noticeable despite dithering. |
| **Lumen** dynamic GI and reflections; hardware ray tracing | None. Direct sun + ambient/hemisphere light + cascaded shadow maps; optional screen-space AO. Night scenes rely on emissive textures and a few real lights. |
| **Virtual shadow maps**, many shadowed lights | One directional light with 2–3 cascades; streetlights unshadowed. |
| **GPU-driven rendering**, HZB occlusion, compute shaders | Not available in WebGL2. CPU culling only (§5.8). |
| **World Partition editor tooling**, Data Layers, OFPA, PCG graph, Houdini bridge | No editor. The world is code and seeds. Authored set-pieces would need our own tooling. |
| **Mass Entity** at tens of thousands of agents on many cores | JS is single-threaded per context; our agent counts are in the tens to low hundreds (§5.9). |
| **Chaos** destruction, cloth, high-fidelity vehicles | Rapier rigid bodies and a raycast vehicle with a simple tyre model. No destruction. |
| **MetaHuman-class characters, motion matching, mocap** | Low-poly characters, a small set of clips, state-machine animation. |
| **Virtual texturing / texture streaming, large asset pipelines** | Fixed atlases loaded at boot; procedural materials. Download size, not disk size, is our constraint. |
| **Volumetric clouds and fog, physically based atmosphere** | Analytic sky, distance fog, cheap cloud layer. |
| **Native threads, SIMD, memory control, 64-bit address space** | Workers with message passing; WASM memory limits; garbage-collector pauses must be managed by pooling typed arrays. |
| **Verified performance on consoles** | Performance varies with browser and GPU; in our own container we can only verify *correctness* and *relative* cost under software rendering, not real frame rates. |

Where the web stack is genuinely competitive: zero-install distribution, fast iteration, deterministic procedural worlds with no asset pipeline, and full automated testability of the world model in Node.

---

## 6. Risks and open questions

| # | Risk / question | Why it matters | Mitigation or next step |
|---|---|---|---|
| 1 | **No GPU in the dev environment.** SwiftShader frame times say little about real GPUs. | We could tune to the wrong bottleneck (fill rate in CI vs draw calls on real hardware). | Track renderer-independent metrics (draw calls, triangles, bytes, ms of JS). Keep desktop and CI profiles separate. Get one real-GPU measurement as early as possible. |
| 2 | **Chromium's SwiftShader fallback is being phased out.** | A browser update could remove WebGL from headless runs. | Pass `--enable-unsafe-swiftshader` explicitly; pin the Playwright browser version; fail tests loudly if `webgl2` is null. |
| 3 | **Worker generation time and transfer cost unmeasured.** | The 128 m cell size and look-ahead assume < 50 ms per LOD0 cell. | Benchmark the generator in Vitest (Node) first; adjust cell size or split LOD0 generation into two passes if needed. |
| 4 | **GC pauses** from allocating typed arrays per cell. | Hitches that budgets cannot see. | Pool buffers by size class; return them from the main thread to workers by transfer. |
| 5 | **Dithered cross-fade doubles overdraw** during transitions. | Costly under software rendering. | Limit concurrent fading cells; zero-length transitions in CI. |
| 6 | **Horizon occlusion correctness.** A non-conservative occluder causes visible popping. | Wrong culling is worse than no culling. | Unit-test with randomised scenes against a brute-force ray test; ship it off by default until it passes. |
| 7 | **Rapier vehicle feel.** The built-in tyre model is basic and the controller is thinly documented. | Driving is the core mechanic. | Prototype early; layer our own lateral/longitudinal force curve (simplified Pacejka) on top or replace wheel forces with a custom raycast vehicle if needed. |
| 8 | **Cross-cell seams** in road, sidewalk and lane graphs. | Agents stuck at borders; visible cracks. | Derive all border features from the global city plan, never from per-cell randomness; property-test neighbouring cells for matching edge nodes. |
| 9 | **Determinism across engines and threads.** Floating-point `Math.sin` etc. may differ between V8 versions or between Node and Chromium. | Golden-file tests and any future multiplayer depend on it. | Use integer hashing and avoid transcendental functions in layout decisions; quantise outputs before comparison. |
| 10 | **Memory limits in browsers** (tab and WASM heap). | Budgets in §5.7 are guesses. | Instrument `bytesCpu`/`bytesGpu`; test eviction under an artificially low budget. |
| 11 | **`BatchedMesh` behaviour under SwiftShader and at high instance counts.** A forum report says multi-draw can be slower past very large counts. | Could invalidate the prop-batching plan. | A/B against `InstancedMesh` per prop type and merged static geometry; keep the choice behind one interface. |
| 12 | **Scope.** The benchmark title took a very large team many years. | Ambition must be expressed as systems that scale, not as content volume. | Milestones defined by systems (streaming, LOD, sim LOD, driving, wanted) on a small city first. |
| 13 | **IP hygiene.** | Legal and ethical. | Original names, map and characters only; no real brands; this document's GTA VI section is reference, not a content source. |

Open questions for the next research pass:
- Read the primary Digital Foundry article and the GDC/SIGGRAPH slide decks directly once the hosts are reachable, and replace secondary citations.
- Is WebGPU (compute culling, better batching) worth a second renderer backend once a GPU machine is available? three.js's `WebGPURenderer` with WebGL2 fallback makes this plausible.
- Should far-distance traffic "life" be sprites driven by statistical lane densities, and what does that cost?
- Do we need any authored (non-procedural) landmark cells, and if so what is the minimal data format?

---

## 7. Sources

All links below appeared in search results during this session (2026-11-26). Pages could not be fetched directly; see §1.2.

### GTA VI — official

- [Rockstar Newswire: Grand Theft Auto VI Now Available](https://www.rockstargames.com/newswire/article/39akk424a9oo53/grand-theft-auto-vi-now-available)
- [Rockstar Newswire: Grand Theft Auto VI is Now Set to Launch November 19, 2026](https://www.rockstargames.com/newswire/article/ak3ak31a49a221/grand-theft-auto-vi-is-now-set-to-launch-november-19-2026)
- [Rockstar Support: regional pre-load and release times](https://support.rockstargames.com/articles/29jV3Cv2cCgvwM1XgtMO5o/grand-theft-auto-vi-regional-pre-load-and-release-times-on-playstation-5-and-xbox-series-x-or-s)
- [Rockstar: Only in Leonida](https://www.rockstargames.com/VI/only-in-leonida) · [Vice City](https://www.rockstargames.com/VI/only-in-leonida/vice-city) · [Leonida Keys](https://www.rockstargames.com/VI/leonida-keys) · [Ambrosia](https://www.rockstargames.com/VI/only-in-leonida/ambrosia) · [Port Gellhorn](https://www.rockstargames.com/VI/port-gellhorn) · [Jason](https://www.rockstargames.com/VI/Jason) · [Lucia](https://www.rockstargames.com/VI/lucia)

### GTA VI — reporting and analysis

- [YouTube blog: GTA VI trailer record](https://blog.youtube/culture-and-trends/grand-theft-auto-breaks-record/) · [Guinness World Records](https://guinnessworldrecords.com/news/2023/12/grand-theft-auto-vi-first-look-becomes-most-viewed-videogame-trailer-in-24-hours-762030)
- [Gematsu: second trailer; characters and places detailed](https://www.gematsu.com/2025/05/grand-theft-auto-vi-second-trailer-characters-and-places-detailed) · [Game Informer: six major areas](https://gameinformer.com/2025/05/06/rockstar-shows-off-six-major-areas-of-vice-city-in-grand-theft-auto-vi)
- [Notebookcheck: Trailer 2 captured on PS5](https://www.notebookcheck.net/PS5-was-behind-every-frame-of-GTA-6-Trailer-2-confirms-Rockstar.1012400.0.html) · [Notebookcheck: DF on Trailer 1](https://www.notebookcheck.net/GTA-VI-Trailer-recreated-using-GTA-V-analysis-by-Digital-Foundry-indicates-1440p-and-30-fps.782027.0.html)
- [CBC: delay to 2026](https://amp.cbc.ca/lite/story/1.7525051) · [Bloomberg: delay to May 2026](https://www.bloomberg.com/news/articles/2025-05-02/gta6-take-two-delays-release-of-grand-theft-auto-vi-to-may-2026-ttwo-share-price) · [Engadget: delay to November 19, 2026](https://www.engadget.com/gaming/grand-theft-auto-vi-is-delayed-to-november-19-2026-211848530.html)
- [GamesRadar: Extended Look recap](https://www.gamesradar.com/news/live/gta-6-extended-look-showcase-live-coverage-2026-everything-announced/) · [Red Bull: Extended Look](https://www.redbull.com/int-en/gta-6-extended-look-everything-revealed)
- [Wikipedia: Grand Theft Auto VI](https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI) · [Forbes: release time and download size](https://www.forbes.com/sites/erikkain/2026/11/16/gta-6-release-date-time-ps5-xbox-series-x-download-size-day-one-update/)
- [CNN: launch sales](https://www.cnn.com/2026/11/20/media/gta-vi-launch-sales-numbers) · [Forbes: first-day sales](https://www.forbes.com/sites/antoniopequenoiv/2026/11/20/gta-6-raked-in-38-billion-sales-on-first-day-the-largest-entertainment-launch-ever/) · [Fox Business](https://www.foxbusiness.com/entertainment/grand-theft-auto-vi-shatters-entertainment-records-staggering-3-79b-debut) · [Deadline](https://deadline.com/2026/11/gta6-first-day-sales-4-billion-1237230465/)
- Digital Foundry coverage (secondary): [Pure Xbox](https://www.purexbox.com/news/2026/11/three-big-takeaways-from-digital-foundrys-gta-6-analysis-for-xbox-series-xs) · [Kotaku](https://kotaku.com/grand-theft-auto-vi-gta-6-framerates-xbox-series-x-ps5-rockstar-2001000296) · [Wccftech](https://wccftech.com/grand-theft-auto-vi-runs-better-xbox-series-x-ps5-digital-foundry/) · [Neowin](https://www.neowin.net/news/analysis-reveals-gta-6-runs-better-on-xbox-series-x-than-on-playstation-5/) · [TweakTown](https://www.tweaktown.com/news/114763/gta-6-deemed-the-single-most-visually-striking-game-of-the-generation-by-tech-experts/index.html) · [KitGuru](https://www.kitguru.net/gaming/matthew-wilson/gta-6-includes-advanced-ray-tracing-even-on-base-consoles/) · [VGTimes](https://vgtimes.com/gaming-news/175004-ray-tracing-realistic-physics-and-30-fps-digital-foundry-takes-a-technical-deep-dive-into-gta-6.html) · [Techtroduce](https://www.techtroduce.com/gta-6-digital-foundry-ps5-pro-performance-review) · [mobidevices](https://mobidevices.com/en/digital-foundry-gta-6) · [guides-factory](https://guides-factory.com/guides/gta-6-performance) · [gta-vi.io](https://gta-vi.io/news/gta6-digital-foundry-30fps-all-consoles) · [Digg](https://digg.com/gaming/yf0qv57p) · [NeoGAF thread](https://www.neogaf.com/threads/digital-foundry-grand-theft-auto-6-digital-foundry-tech-review-the-game-of-the-generation.1703495/)
- Unconfirmed reporting: [IBTimes: PC status](https://www.ibtimes.co.uk/gta-vi-pc-release-early-2027-report-1833680) · [TweakTown: state of PC](https://www.tweaktown.com/articles/11693/the-state-of-gta-6-on-pc-everything-you-need-to-know/index.html) · [shattered.io: price](https://shattered.io/gta-6-launch-79-99-ps5-xbox-series-pc-date-unannounced/) · [Make Tech Easier: price and pre-load](https://maketecheasier.com/gta-6-release-date-price-preload/) · [gta6hype: "RAGE 9" (unofficial naming)](https://www.gta6hype.com/blog/rage9-vs-genie3-ai-future-gaming/)

### Rockstar technology (public)

- [Wikipedia: Rockstar Advanced Game Engine](https://en.wikipedia.org/wiki/Rockstar_Advanced_Game_Engine)
- [Adrian Courrèges: GTA V – Graphics Study](https://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study/) · [Part 2: LOD and Reflections](https://adriancourreges.com/blog/2015/11/02/gta-v-graphics-study-part-2) · [Part 3: Post-Effects](https://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study-part-3/)
- [SIGGRAPH 2019 Advances in Real-Time Rendering (lists the RDR2 atmosphere talk)](https://advances.realtimerendering.com/s2019/index.htm) · [RDR2 graphics study (third party)](https://imgeself.github.io/posts/2020-06-19-graphics-study-rdr2)

### Unreal Engine

- [World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine) · [World Partition – HLOD](https://dev.epicgames.com/documentation/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine) · [Data Layers](https://dev.epicgames.com/documentation/unreal-engine/world-partition---data-layers-in-unreal-engine)
- [FWorldPartitionStreamingSource](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/FWorldPartitionStreamingSource) · [Streaming settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/streaming-settings-of-the-unreal-engine-project-settings) · [Dynamic loading range scaling](https://dev.epicgames.com/documentation/unreal-engine/dynamic-loading-range-scaling-in-unreal-engine) · [Forum: World Partition streaming performance](https://forums.unrealengine.com/t/world-partition-streaming-performance/2577446)
- [Nanite](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine) · [Karis, Stubbe, Wihlidal: Nanite, SIGGRAPH 2021 (PDF)](https://advances.realtimerendering.com/s2021/Karis_Nanite_SIGGRAPH_Advances_2021_final.pdf)
- [Lumen](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine)
- [Visibility and Occlusion Culling](https://dev.epicgames.com/documentation/en-us/unreal-engine/visibility-and-occlusion-culling-in-unreal-engine) · [reference](https://dev.epicgames.com/documentation/unreal-engine/visibility-and-occlusion-culling-reference-in-unreal-engine)
- [PCG overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-overview) · [City Sample](https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration)
- [Mass Entity overview](https://dev.epicgames.com/documentation/unreal-engine/overview-of-mass-entity-in-unreal-engine) · [Mass Gameplay overview](https://dev.epicgames.com/documentation/unreal-engine/overview-of-mass-gameplay-in-unreal-engine?lang=en-US) · [ZoneGraph quick start (forum)](https://forums.unrealengine.com/t/tutorial-zonegraph-quick-start-guide/573924)
- [UChaosVehicleWheel](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ChaosVehicles/UChaosVehicleWheel) · [Motion Matching](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-matching-in-unreal-engine) · [Virtual texture memory pools](https://dev.epicgames.com/documentation/unreal-engine/virtual-texture-memory-pools-in-unreal-engine)
- [Unreal Engine licence](https://www.unrealengine.com/en-US/license) · [Prism-KB World Partition notes (third party, unverified figures)](https://jdot274.github.io/Prism-KB/tools/world-partition/)

### Unity and Godot

- [Unity Entities: streaming overview](https://docs.unity3d.com/Packages/com.unity.entities@1.3/manual/streaming-overview.html) · [streaming scenes](https://docs.unity3d.com/Packages/com.unity.entities@1.3/manual/streaming-scenes.html) · [Addressables async operation handles](https://docs.unity3d.com/Packages/com.unity.addressables@2.3/manual/AddressableAssetsAsyncOperationHandle.html) · [LOD Group](https://docs.unity.com/en-us/engine/6000.0/manual/analysis/graphics-performance-profiling/simplifying-distant-meshes-with-level-of-detail-lod/class-lodgroup) · [Unity: cancelling the Runtime Fee](https://unity.com/blog/unity-is-canceling-the-runtime-fee) · [Meta: Unity asset streaming sample](https://developers.meta.com/vr/documentation/unity/unity-sample-asset-streaming)
- [Godot: Background loading](https://docs.godotengine.org/en/4.4/tutorials/io/background_loading.html) · [Visibility ranges (HLOD)](https://docs.godotengine.org/en/4.6/tutorials/3d/visibility_ranges.html) · [Optimizing 3D performance](https://docs.godotengine.org/en/4.6/tutorials/performance/optimizing_3d_performance.html) · [Using Jolt Physics](https://docs.godotengine.org/en/4.6/tutorials/physics/using_jolt_physics.html) · [Godot 4.6 release](https://godotengine.org/releases/4.6/) · [Forum: streaming large 3D maps](https://forum.godotengine.org/t/handling-data-streaming-chunk-loading-for-large-3d-maps-in-godot/138774?page=2)

### Talks, papers and studio publications

- Insomniac: [Marvel's Spider-Man: A Technical Postmortem (GDC Vault)](https://gdcvault.com/play/1026496) · [80.lv summary](https://80.lv/articles/marvels-spider-man-a-technical-postmortem) · [PlayStation Blog tech interview](https://blog.playstation.com/2018/09/06/insomniac-interview-the-tech-behind-marvels-spider-man) · [Streaming in Sunset Overdrive's Open World](https://gdcvault.com/play/1022268/contactUs) · [Procedurally Crafting Manhattan (GDC Vault)](https://gdcvault.com/play/1025765) · [Game Developer video note](https://gamedeveloper.com/programming/video-procedurally-creating-manhattan-for-i-marvel-s-spider-man-i-) · [Spider-Man 2 fast travel (80.lv)](https://80.lv/articles/marvel-s-spider-man-2-fast-travel-hides-no-loading-screens/)
- Guerrilla: [Streaming the World of Horizon Zero Dawn](https://guerrilla-games.com/read/Streaming-the-World-of-Horizon-Zero-Dawn) · [Decima Engine: Visibility in Horizon Zero Dawn](https://www.guerrilla-games.com/read/decima-engine-visibility-in-horizon-zero-dawn) · [GPU-Based Procedural Placement (page)](https://www.guerrilla-games.com/read/gpu-based-procedural-placement-in-horizon-zero-dawn) · [slides (PDF)](https://www.guerrilla-games.com/media/News/Files/GDC2017_VanMuijden_GPUBasedProceduralPlacementInHorizonZeroDawn.pdf) · [Volumetric Cloudscapes of Horizon Zero Dawn (PDF)](https://www.advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf)
- Culling: [Haar and Aaltonen, GPU-Driven Rendering Pipelines (PDF)](https://advances.realtimerendering.com/s2015/aaltonenhaar_siggraph2015_combined_final_footer_220dpi.pdf) · [Intel: Masked Software Occlusion Culling](https://intel.com/content/www/us/en/developer/articles/technical/masked-software-occlusion-culling.html)
- Procedural cities: [Parish and Müller, Procedural Modeling of Cities (SIGGRAPH archive)](https://history.siggraph.org/?p=116923) · [phiresky explainer](https://phiresky.github.io/procedural-cities/presentation.html)
- Crowds: [Massive Crowd on Assassin's Creed Unity: AI Recycling](https://www.gdcvault.com/play/1022141/Massive-Crowd-on-Assassin-s) · [Game Developer preview](https://www.gamedeveloper.com/programming/get-coding-advice-from-insomniac-riot-and-ubisoft-at-gdc-2015) · [Crowds in Hitman: Absolution](https://gdcvault.com/play/1015315/Crowds-in-Hitman) · [Intel/IOI Hitman 2 deck (PDF)](https://www.intel.com/content/dam/develop/external/us/en/documents/06-create-a-scalable-and-destructible-world-in-hitman2-807276.pdf) · [Census, Watch Dogs: Legion (GDC Vault)](https://www.gdcvault.com/play/1027018/contactUs) · [Ubisoft: the tools that built London](https://news.ubisoft.com/en-us/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london) · [A-Life: an insight into ambitious AI](https://gamedeveloper.com/design/a-life-an-insight-into-ambitious-ai)
- Traffic and vehicles: [Treiber, Hennecke, Helbing: Intelligent Driver Model](https://arxiv.org/abs/cond-mat/0002177) · [PhysX Vehicles guide](https://docs.nvidia.com/gameworks/content/gameworkslibrary/physx/guide/Manual/Vehicles.html) · [Wikipedia: Hans B. Pacejka](https://en.wikipedia.org/wiki/Hans_B._Pacejka) · [Tire model](https://wikipedia.com/wiki/Tire_model)
- Animation, sky, weather, shadows: [Motion Matching and The Road to Next-Gen Animation](https://www.gdcvault.com/play/1022985/Motion-Matching-and-The-Road) · [Hillaire 2020, sky and atmosphere](https://diglib.eg.org/handle/10.1111/cgf14050) · [fxguide: game environments, rain](https://www.fxguide.com/?p=42356) · [Microsoft: Cascaded Shadow Maps](https://msdn.microsoft.com/fr-fr/library/ee416307.aspx) · [Common Techniques to Improve Shadow Depth Maps](https://learn.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps)
- Impostors: [three.js forum: octahedral impostors](https://discourse.threejs.org/t/octahedral-impostors-for-three-js/80318) · [Alan Zucconi: billboard impostors](https://www.alanzucconi.com/2018/08/25/shader-showcase-saturday-7/)
- Wanted systems: [GTA Wiki: Wanted Level in GTA V](https://gta.wiki/wiki/Wanted_Level_in_GTA_V) · [GameSpot: RDR2 witnesses](https://www.gamespot.com/articles/red-dead-redemption-2s-world-is-full-of-snitches/1100-6462203/) · [Shacknews: RDR2 wanted and bounty](https://www.shacknews.com/article/108138/how-the-wanted-and-bounty-systems-work-in-red-dead-redemption-2)

### Web platform, three.js, Rapier

- three.js: [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html) · [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) · [Optimize Lots of Objects](https://threejs.org/manual/en/optimize-lots-of-objects.html) · [WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer) · [forum: InstancedMesh vs BatchedMesh](https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221) · [forum: draw calls](https://discourse.threejs.org/t/webgl-drawcalls/24476/2) · [forum: TSL and WebGL2 vs WebGPU](https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974) · [@takram/three-clouds](https://www.npmjs.com/package/@takram/three-clouds)
- Rapier: [character controller guide](https://rapier.rs/docs/user_guides/javascript/character_controller) · [DynamicRayCastVehicleController class](https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html) · [vehicle controller typings](https://cdn.jsdelivr.net/npm/@dimforge/rapier3d@0.19.3/control/ray_cast_vehicle_controller.d.ts) · [character controller typings](https://cdn.jsdelivr.net/npm/@dimforge/rapier3d@0.19.3/control/character_controller.d.ts) · [issue: document vehicle controller](https://github-redirect.dependabot.com/dimforge/rapier.rs/issues/90)
- MDN / web.dev / Chrome: [Transferable objects](https://developer.mozilla.org/docs/Web/API/Web_Workers_API/Transferable_objects) · [Chrome: transferable objects](https://developer.chrome.com/blog/transferable-objects-lightning-fast) · [SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) · [COOP and COEP](https://web.dev/articles/coop-coep.md.txt) · [IdleDeadline.timeRemaining](https://developer.mozilla.org/docs/Web/API/IdleDeadline/timeRemaining) · [Background Tasks API](https://developer.mozilla.org/ko/docs/Web/API/Background_Tasks_API) · [OffscreenCanvas](https://web.dev/articles/offscreen-canvas?authuser=115) · [WebGL best practices](https://developer.mozilla.org/docs/Web/API/WebGL_API/WebGL_best_practices) · [WebGPU in major browsers](https://web.dev/blog/webgpu-supported-major-browsers)
- Chromium: [Using Chromium with SwiftShader](https://chromium.googlesource.com/chromium/src/+/798e59c5275d4131797e8ea2e96e6c6000256b58/docs/gpu/swiftshader.md) · [Intent to Remove: SwiftShader Fallback](https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM)

### First-hand verification performed in this session (no URL)

- npm registry: `three@0.187.0`, `@dimforge/rapier3d-compat@0.21.0` installed in a scratch directory; API facts in §3.3, §3.8, §3.9–3.11 and §3.13 read from shipped source and typings. Latest versions seen: Vite 8.3.8, Vitest 5.1.2, Playwright 1.65.1 (1.63.0 installed globally), Node 22.23.5.
- Playwright probe of the pre-installed HeadlessChrome 158: WebGL2 on SwiftShader, `WEBGL_multi_draw` present, `MAX_TEXTURE_SIZE` 8192, no WebGPU, 4 logical cores.
