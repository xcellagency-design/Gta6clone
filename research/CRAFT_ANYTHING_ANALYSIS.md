# Craft Anything — Repository Analysis

**Repository:** https://github.com/storytold/craft-anything
**Inspected:** shallow clone of `main` at commit `0a4e66b` (workspace version `0.6.1`), on 2026-11-26.
**Method:** read the README, `AGENTS.md`/`CLAUDE.md`, `Cargo.toml`, `docs/` and the source of the
rebuild workflow, the game kind, the checks, the agent adapters, the MCP server and the CLI.
Statements below cite the file they come from. Where something was *not* run here, it says so.

---

## 1. What Craft Anything actually is

The project name suggests a game-making tool. It is broader and differently shaped than that:

> "See how any website, app or game works, then have AI build your own version; an open-source,
> clean-room engine in pure Rust." — `README.md`

It is three things in one Rust workspace:

1. **A reverse-engineering / inspection engine** — about 320 tools (decoders, a disassembler, a
   decompiler, website capture, Android/Apple/.NET/Java readers, game-file readers). Every tool
   returns an *evidence record* with confidence, coverage and limitations (`crates/evidence`).
2. **A rebuild orchestrator** — *Study → Build → Check → Refine*. It does not write the new
   project itself. It starts a **coding agent** (Claude Code first) as a child process, hands it
   a brief, and then judges the result with deterministic checks (`crates/ai/src/rebuild`).
3. **Three front ends over one engine** — a desktop app (egui), a CLI (`craft-anything-cli`)
   and an MCP server (`craft-anything-cli mcp`). Each tool is at once a CLI subcommand and an
   MCP tool.

It is **not** a game engine, has no renderer, physics or runtime of its own, and ships no game
templates. For games it is a *director and referee* around an engine you already have.

Status per the repository itself: **early alpha** (`README.md`, badge and Status section;
`docs/STATUS.md` last updated 2026-11-21).

## 2. Repository architecture

Layered crates, lowest first; `cargo xtask layers` enforces the layering (`AGENTS.md`):

| Layer | Crate(s) | Role |
|---|---|---|
| L0 | `crates/evidence`, `crates/formats` | Evidence record type; ~380 files of format decoders |
| L1 | `crates/disasm`, `crates/js` | Disassembly; JavaScript analysis (oxc) |
| L2 | `crates/analysis`, `crates/platform` | Program analysis; process, locks, OS integration |
| L3 | `crates/engines` | External engines: Ghidra, jadx, Frida, gdb, adb, CDP, **game engines** (`game.rs`), **generated assets** (`assets/`) |
| L4 | `crates/engine` | The tool registry (`ToolSpec`s in `src/tools/<area>.rs`), sessions, workspaces, clean-room rules, toolchains, self-test and mechanics schemas |
| L5 | `crates/ai`, `crates/mcp`, `crates/setup` | Agent adapters and the rebuild workflow; MCP server; `setup`/`doctor` |
| L6 | `crates/ui-egui` | Desktop UI (the only crate allowed to use egui/winit) |
| apps | `apps/craft-anything`, `apps/craft-anything-cli`, `apps/craft-anything-web` | Desktop, CLI + MCP, browser file viewer (WASM) |

Other notable facts: `unsafe_code = "forbid"` workspace-wide; Rust **1.97+** required; several
dependencies are git dependencies on `storytold/craft-libs`; `vendor/` carries patched `winit`
and `wgpu-hal`.

Toolsets (`docs/tools.md`): `core` 36, `native` 55, `apple` 14, `formats` 37, `managed` 8,
`android` 14, `java` 6, `adb` 24, `browser` 24, `javascript` 11, `runtime` 14, `frida` 9,
`application` 17, `database` 1, `projects` 21, `setup` 11, `build` 7.

## 3. Answers to the architecture questions

### 3.1 How it studies an existing game
`crates/ai/src/rebuild/study.rs` and `crates/engines/src/game.rs`:

- A **local game folder** is triaged from its files only — "nothing is run". `game::detect`
  recognises Unreal (`.pak` under `Content/Paks`, `*-Shipping.exe`), Unity (`UnityPlayer.dll`,
  `globalgamemanagers`, IL2CPP vs. `Assembly-CSharp.dll`) and Godot (`.pck`), including the
  engine version.
- **Clean room** (the default): nothing inside the original is read. The builder works from the
  person's description and reference pictures and must mark estimated numbers.
- **Deep mode** (opt-in, "for your private use"): the code and files are read with the built-in
  decompiler and Ghidra when installed, and the builder is told the person "wants a 1:1 copy made
  with the original game's own files" (`brief.rs`, `game_steps`).
- The brief itself states a hard limit: *"We can't watch the original running on this computer
  yet."* There is no gameplay recording or behavioural capture for games.

### 3.2 How it collects evidence about gameplay and visuals
- Websites: real capture (screenshots at three widths, layout, colours, fonts) — the mature path.
- Games: static evidence only (file triage, decompilation in Deep mode), plus the person's
  pictures in `reference/`. Values that shape play go in `app/MECHANICS.md` and
  `app/mechanics.json`, each with a source or `"estimated": true`. The `MechanicsCheck` only
  confirms the sheet is readable; its own note says: *"its behavior is unverified. No runtime
  measurement was compared with these values."* (`kinds/mechanics.rs`)

### 3.3 How it talks to Claude Code
`docs/claude-code.md`, `crates/ai/src/cli_agents/adapters.rs`:

- Finds the person's own, unmodified `claude` binary and runs it headless:
  `claude -p <task> --output-format stream-json --verbose --append-system-prompt <preamble>`,
  with `--resume <session>` to continue.
- Offers its own tools through `--mcp-config` + `--strict-mcp-config` (the server is
  `craft-anything-cli mcp --project … --inbox …`).
- Routes every write/command/web action through
  `--permission-prompt-tool mcp__craft-anything__core_action_approve`; disables Claude Code's own
  question tool (`--disallowedTools AskUserQuestion`) in favour of `core_person_ask`.
- Checks `claude auth status` before a build. It never handles credentials.
- Other agents (Codex, Copilot, Grok, Kimi, ACP agents) have adapters; most are marked "built,
  not yet run live".

### 3.4 How it creates new game projects
`craft-anything-cli rebuild <target|-> "<request>"` creates a project folder containing
`craft.json` (request, target, status, history), `capture/`, `app/` (the generated project),
`checks/` (one folder per round), `investigation.cany/` and `inbox/`. Target `-` means "nothing
to recreate" — a new game from a description. `--project-folder <dir> --existing edit` adopts an
existing folder as the app itself, edited in place.

### 3.5 How it handles different engines
`crates/ai/src/rebuild/stacks.toml` is a table of *instructions to the builder*, one per stack:

| Stack | What the builder is told (abridged) |
|---|---|
| Unity | Build scenes from an editor script `CraftBuild.Build()`; batch-mode build to `app/Build/` |
| Unreal Engine | C++ only (Blueprint/level files are binary); levels spawned from code; packaged with BuildCookRun |
| Godot | GDScript, text `.tscn`; check with `--headless --import` then `--quit-after 120` |
| Rust + macroquad / Bevy | Cargo project in `app/`, procedural assets |
| Phaser | Browser project with a build script producing a static site |
| Builder's choice / React+Vite / plain HTML | Web stacks; output must be static files in `app/dist` |

`game::Builder::ALL` is `[Unity, Unreal, Godot, Rust]`. The engine editors themselves are *not*
bundled: Godot is "a portable download checked against the official checksums"; Unity Hub and the
Epic launcher are the vendors' installers (`game.rs` module docs).

### 3.6 Build and refinement cycles
`crates/ai/src/rebuild/mod.rs`: one worker thread runs Study, then the builder's turn, then the
kind's checks. Failed checks become a refinement brief for the next round, up to `max_rounds`
(default 6 in the app, 2 in the CLI via `--rounds`). During its turn the builder can ask for the
same checks early (`rebuild_check`, recorded as round 0).

### 3.7 Testing and validation
The game kind registers these checks (`kinds/game.rs`):

| Check | What it verifies | Source |
|---|---|---|
| `BuildCheck` | The project builds with its own toolchain | `rebuild/check.rs`, `engine/src/toolchains.toml` |
| `ScreenshotCheck` | The game, started with `--screenshot <file.png>`, saves a non-blank PNG (luma std-dev ≥ 2 over a 64×36 downsample); optional likeness to reference pictures | `kinds/screenshot.rs` |
| `SelfTestCheck` | The game, started with `--self-test <file.json>`, plays its core loop with scripted input and reports `move`, `act`, `hud` all passed | `kinds/self_test.rs`, `docs/schemas/self-test.schema.json` |
| `MechanicsCheck` | `app/mechanics.json` is readable (behaviour unverified) | `kinds/mechanics.rs` |
| `CreditsCheck` (Deep only) | `app/CREDITS.md` + private-use note when original files were used | `kinds/game.rs` |

A person's **own project** (no original to compare with) is judged by exactly two checks: its
own build and its own tests (`kinds/own.rs`). For a Node.js project those are
`npm run build --if-present` and `npm test` (`toolchains.toml`).

Self-test report format (version 1):

```json
{"version": 1, "steps": [
  {"step": "move", "passed": true, "detail": "walked 3.1 m forward"},
  {"step": "act",  "passed": true, "detail": "…"},
  {"step": "hud",  "passed": true, "detail": "…"}]}
```

Extra steps beyond the three are accepted and reported (up to 20).

**Launch limitation found in the source:** checks start the built game through
`outputs::launch_now`, which knows Godot projects, Electron apps, Rust binaries, packaged
Unity/Unreal builds in `app/Build/`, and toolchain `launch` recipes (Python, Go, .NET, Java).
The **Node.js toolchain has no launch recipe**, so a plain browser game cannot be started with
`--screenshot`/`--self-test` by Craft Anything itself unless it is wrapped (for example in
Electron).

### 3.8 Production-ready vs. experimental
From `README.md` Status and `docs/STATUS.md`:

- **Works today:** desktop app, CLI, MCP server; Study → Build → Check → Ready for websites,
  apps and games *with Claude Code as the builder*; website checks at three widths; game rebuilds
  in Unity, Unreal or Godot; Deep mode with Ghidra; generated pictures and 3D models (opt-in,
  paid, the person's own fal.ai key).
- **Partly there:** building with API keys and other agents; **behaviour checks for apps and
  games**; some tools tested only against stand-ins.
- **Explicitly not done:** watching an original game run; measuring a build's behaviour against
  its mechanics sheet.

## 4. Generated assets
`crates/engines/src/assets/`: pictures and "game-ready" GLB models through fal.ai, priced from
`assets.toml` (for example $0.15 per picture, $0.40–0.50 per 3D model). Off unless the person
enables it per project and supplies a key (`--generate-assets`). No audio generation.

## 5. Fit for this project, and the limits that matter

| Need | Craft Anything | Verdict |
|---|---|---|
| Study GTA VI | Would need the game's files (Deep) or reference pictures. We are building an original IP and must not copy the game; the tool also refuses DRM bypass | **Not used.** Target is `-` (nothing to recreate) |
| Engine/runtime | None of its own | Our game supplies the stack |
| Orchestrating a builder | Starts a *second* headless `claude -p` session with its own approvals | Redundant inside a session that is already Claude Code; would duplicate cost and hide work behind a nested agent |
| Build / test gating | Own-project mode runs `npm run build` and `npm test` | **Adopted as a contract** |
| Screenshot + self-test contracts | Clear, small, well specified | **Adopted** (same options and JSON schema) |
| Asset generation | Paid, needs a fal.ai key | Not available here; assets are procedural and labelled as such |
| Open-world scale | Rounds are bounded (2–6) and judged on a 90-second run | Far too small a loop for a multi-milestone open-world game; milestones are driven directly |

## 6. Recommended implementation strategy

**Create a separate game project, keep Craft Anything unmodified, and conform to its contracts
so it can orchestrate or verify the project later.** Concretely:

1. The game lives in this repository; the Craft Anything clone stays outside it, untouched.
2. `package.json` sits at the project root with real `build` and `test` scripts, so
   own-project mode (`--project-folder . --existing edit`) can judge it.
3. The game implements Craft Anything's two runtime contracts through a launcher:
   `--screenshot <file.png>` and `--self-test <file.json>` (report schema version 1 with the
   `move`, `act`, `hud` steps plus this project's extra steps).
4. `MECHANICS.md` / `mechanics.json` follow its mechanics-sheet format, every value marked
   `estimated` (there is no original to source them from).
5. Milestones are implemented and tested directly in this session rather than through nested
   `rebuild` rounds.

No change to Craft Anything's source is required or justified.

## 7. Exact commands

Build and inspect the tool (Rust ≥ 1.97):

```sh
git clone https://github.com/storytold/craft-anything && cd craft-anything
cargo build -p craft-anything-cli            # or: cargo install --path apps/craft-anything-cli
craft-anything-cli doctor                    # install, agents, engines, MCP server
craft-anything-cli commands                  # every tool, by toolset
craft-anything-cli capabilities
```

Let it drive this game project as the person's own project (needs a signed-in `claude`):

```sh
craft-anything-cli rebuild - "Fix the failing tests" \
  --project-folder /path/to/Gta6clone --existing edit --rounds 2
```

Start a fresh game from a description instead (not what this project does):

```sh
craft-anything-cli rebuild - "An open-world driving game" --build-with godot --rounds 2
```

Serve its tools to any MCP client:

```sh
craft-anything-cli mcp --all-tools
```

This project's side of the contracts:

```sh
npm run build                                   # BuildCheck / own-build
npm test                                        # own-tests
npm run selftest -- --self-test out/self-test.json
npm run screenshot -- --screenshot out/shot.png
```

## 8. Risks and dependencies

- **Alpha software.** Behaviour checks for games are "partly there"; several agent adapters are
  unverified. Do not depend on it for correctness — our own test suite is the gate.
- **Needs a local coding agent** signed in, and Rust 1.97+ to build from source.
- **Nested-agent cost and oversight.** `rebuild` runs a headless builder; `--unattended` answers
  questions with the first choice and refuses approvals.
- **Deep mode is a legal hazard for this project.** It exists to copy an original's files for
  private use. It must stay off; this project takes nothing from any existing game.
- **Browser-game launch gap** (section 3.7): Craft Anything cannot itself launch a plain web
  build for its screenshot/self-test checks.
- **Paid assets** require a fal.ai key and budget.

## 9. What was and was not executed here

- Read: all files cited above.
- `cargo build -p craft-anything-cli`: see `docs/DEVELOPMENT_LOG.md` for the result on this machine.
- **Not run:** `craft-anything-cli rebuild` (it would start a second builder agent), asset
  generation (no key), anything in Deep mode.
