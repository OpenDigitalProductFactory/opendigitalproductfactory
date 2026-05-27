---
title: Agent Toolchain Bootstrap — DPF-kernel-aware contributor sessions on first run
status: draft-for-operator-review
author: Claude (Opus 4.7)
date: 2026-05-26
backlog:
  - BI-4B17051B
epics:
  - EP-INSTALL-HARDENING-2026-05-23
related:
  - AGENTS.md
  - packages/dpf-skill-pack/README.md
  - .claude-plugin/marketplace.json
  - .agents/plugins/marketplace.json
  - .claude/settings.json
  - scripts/ensure-dpf-skill-pack.ps1
  - scripts/seed-worktree-mcp.ps1
  - scripts/seed-worktree-mcp.sh
  - scripts/fresh-install.ps1
  - scripts/setup.ps1
  - install-dpf.sh
  - install-dpf.ps1
  - scripts/installer/install-state.schema.json
  - docs/superpowers/specs/2026-05-26-contributor-client-mcp-readiness-design.md
  - docs/superpowers/specs/2026-05-26-contributor-change-lanes-design.md
  - docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md
prs:
  - "#1204 contributor MCP token readiness (merged)"
  - "#1205 contributor change lanes spec (merged)"
  - "#1207 contributor change lanes Phase 1-4 (merged)"
---

# Agent Toolchain Bootstrap Design

## Purpose

Make every non-technical DPF contributor's first Claude Code or Codex CLI session **kernel-aware from turn one** — superpowers framework, dpf-platform skill pack, DPF MCP server, and kernel-tier memory all present and applied without the contributor editing a config file, registering a plugin, or knowing what any of those words mean. The quick-start contract is: *install Claude (or Codex), run the DPF installer, done.*

Today the contract is accidental. The Claude Code plugin lands only when a worktree is created (and only on Windows); Codex CLI never gets the skill pack despite the manifest existing; the kernel-tier feedback memories that fire the "never ask user to run commands" and "structural verification is not functional" disciplines exist as kernel pages in the repo but never propagate to the contributor's `~/.claude/projects/.../memory/`. A contributor who joins the project gets a generic AI agent and reproduces months of operator research at best — or, at worst, ships generic-quality work that silently violates the kernel.

## Problem Statement

Concrete gaps observed on the operator's machine (2026-05-26) and any fresh contributor install:

1. **Codex CLI has the MCP server but not the skill pack.** `~/.codex/config.toml` has `[mcp_servers.dpf]` and `[plugins."superpowers@openai-curated"]`, but **no `[plugins."dpf-platform"]`** entry, so Codex sessions see DPF tools but not DPF skills. The repo-level `.agents/plugins/marketplace.json` advertises `dpf-platform` as `INSTALLED_BY_DEFAULT`, but no install step writes the corresponding plugin enablement into the contributor's `~/.codex/config.toml`. `scripts/ensure-dpf-skill-pack.ps1` claims "Codex will discover dpf-platform as the repo plugin" — empirically false.
2. **Claude Code skill-pack install runs late and is Windows-only.** `scripts/ensure-dpf-skill-pack.ps1` is the only installer that actually calls `claude plugin install dpf-platform@dpf-platform-local`. It runs from `scripts/seed-worktree-mcp.ps1` (which runs on worktree creation), and from nothing else. **The two top-level install paths — `scripts/fresh-install.ps1` and `scripts/setup.ps1` — never call it.** There is no `scripts/ensure-dpf-skill-pack.sh` equivalent, so macOS/Linux contributors are uncovered at every install path.
3. **Kernel-tier memory does not propagate.** The operator's `~/.claude/projects/D--DPF/memory/` contains the kernel-tier feedback memories that fire commandments-level discipline (NEVER-ASK-USER, STRUCTURAL-NOT-FUNCTIONAL, DESTRUCTIVE-EXPLICIT-GO, OBSERVE-BEFORE-DIAGNOSING, etc.). These exist in the repo at `docs/founder-kernel/wiki/principles/` as canonical kernel pages — they survive machine loss. **But no install step seeds them into the contributor's local memory directory.** A fresh contributor on a fresh machine gets the AGENTS.md text-load on every turn, but no auto-memory primer telling the agent which principles fire reflexively before MCP retrieval completes.
4. **No smoke test asserts a kernel principle actually fires.** Structural verification ≠ functional verification is itself a kernel commandment. The install can show every plugin, manifest, and MCP entry on disk and still produce an agent that fails to apply them. There is no end-of-install assertion that a kernel principle (e.g. NEVER-ASK-USER) is honored when probed.
5. **Re-install is not idempotent for the contributor side.** Re-running `fresh-install.ps1` would not reconcile a partial Codex `config.toml` (the `[plugins."dpf-platform"]` block is missing), would not re-seed memory files that were edited locally, and provides no upgrade path when upstream `superpowers` or our `dpf-platform` bumps version.
6. **`installed_plugins.json` is leaking across worktrees.** The user's `~/.claude/plugins/installed_plugins.json` records `dpf-platform@dpf-platform-local` for seven different worktree paths, including stale `D:\DPF-source-bootstrap-pnpm-ci` and `D:\DPF-source-bootstrap-ignore-scripts` paths from earlier session experiments. The substrate works, but its observability is poor and stale entries accumulate.

These are not features anyone explicitly turned off. The substrate is in place; it is simply not wired to fire on first install for both clients on both platforms, and the memory + smoke-test layers are absent entirely.

## Existing Substrate Findings

The repo already contains most of the substrate this design depends on. The work is wiring and gap-filling, not new architectural concepts. Verified at `origin/main` 2026-05-26.

### Skill pack (Surface A: contributor agents)

- `packages/dpf-skill-pack/` — 14 DPF-native skills (`dpf-decision-via-kernel`, `dpf-verify-substrate-first`, `dpf-file-backlog-item`, `dpf-promote-to-build-studio`, `dpf-worktree-per-session`, `dpf-pr-with-dco`, `dpf-evidence-before-diagnosis`, `dpf-retrieve-decision-context`, `dpf-compare-options`, `dpf-record-decision-outcome`, `dpf-capture-kernel-gap`, `dpf-external-evidence-handoff`, `dpf-use-shared-nonprod-environment`, `dpf-local-merge-ci-before-push`).
- `packages/dpf-skill-pack/.claude-plugin/plugin.json` — Claude Code plugin manifest pinning `name: dpf-platform`, `version: 0.1.0`, `skills: ./skills/`, `mcpServers: ./claude.mcp.json`.
- `packages/dpf-skill-pack/.codex-plugin/plugin.json` — Codex plugin manifest with `interface` block (displayName, category, capabilities).
- `packages/dpf-skill-pack/claude.mcp.json` — Claude MCP descriptor (`http`, `${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}`, `Authorization: Bearer ${DPF_MCP_BEARER_TOKEN:-}`).
- `packages/dpf-skill-pack/codex.mcp.json` — Codex MCP descriptor (`bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"`).
- `packages/dpf-skill-pack/capability-packs.json` — Build Studio capability packs (architecture / design / implementation / verification / review-ship / recovery) referencing skill ids.

### Repo-root marketplaces

- `.claude-plugin/marketplace.json` — `dpf-platform-local` marketplace declaring `dpf-platform` plugin pointed at `./packages/dpf-skill-pack`.
- `.agents/plugins/marketplace.json` — Codex repo marketplace marking `dpf-platform` as `INSTALLED_BY_DEFAULT` with `authentication: ON_INSTALL`.

### Project-local Claude wiring

- `.claude/settings.json` — `enableAllProjectMcpServers: true`, `enabledMcpjsonServers: ["dpf"]`, `enabledPlugins: { "dpf-platform@dpf-platform-local": true }`, `extraKnownMarketplaces: { "dpf-platform-local": { source: { source: "directory", path: "." } } }`, plus a `WorktreeCreate` hook calling `scripts/sync-mcp-worktrees.ps1` and `PostToolUse`/`SessionEnd` hooks calling `scripts/safety/transcript-snapshot.ps1`.

### Install / worktree-bootstrap scripts (current state)

- `install-dpf.sh` — macOS/Linux end-user installer (Phase 10a). Calls preflight, state, compose, docker, autostart libs. **Does not install the contributor plugin or seed memory.**
- `install-dpf.ps1` / `install-dpf.bat` — Windows end-user installer. **Same gap.**
- `scripts/fresh-install.ps1` — Windows contributor install (deps + Docker + DB + Edge Node bootstrap). **Does not install the contributor plugin or seed memory.**
- `scripts/setup.ps1` — Windows lighter-weight setup. Verifies AGENTS.md pointer files (CLAUDE.md, .cursor/rules, .clinerules, .github/copilot-instructions.md, CONVENTIONS.md, .continue/rules) but **does not install the contributor plugin or seed memory.**
- `scripts/ensure-dpf-skill-pack.ps1` — **Windows only.** Validates and installs the Claude plugin via `claude plugin install dpf-platform@dpf-platform-local --scope local`. Has a comment block claiming "Codex will discover dpf-platform" but does not write anything to `~/.codex/config.toml`. **No `.sh` sibling exists.**
- `scripts/seed-worktree-mcp.ps1` / `.sh` — Per-worktree MCP config copier + `COMPOSE_PROJECT_NAME` setter + calls `ensure-dpf-skill-pack.ps1` (the `.sh` version calls `ensure-dpf-skill-pack.sh` which **does not exist**).
- `scripts/sync-mcp-worktrees.ps1` — Hardlinks `D:\DPF\.mcp.json` into every D-drive worktree, optionally rotates the bearer token, and re-registers user-scope MCP in `~/.claude.json`.
- `scripts/installer/install-state.schema.json` — `~/.dpf/install-state.json` schema (Contract 2). Currently models docker / compose / autostart / health state; **does not yet model agent-toolchain state.**
- `scripts/installer/lib/{logging,platform,prompts,compose,preflight,state,doctor,docker,autostart}.sh` — Bash 3.2 helpers for the POSIX installer.

### Portal-side substrate (out of scope for this design but adjacent)

- `packages/db/src/seed-skills.ts` — Seeds dpf-platform skills into `SkillDefinition` / `SkillAssignment` rows for in-portal coworkers. **Already covered by the skill-pack formalization arc; do not touch.**
- `apps/web/lib/mcp/contributor-readiness.ts` + `ContributorMcpReadinessCard.tsx` (PR #1204) — Portal-side card that shows whether a contributor's MCP token is set up correctly. This bootstrap composes with it: the install step issues / detects the token and the portal card surfaces token-scope drift over time.

### Kernel principles to seed into contributor memory

`docs/founder-kernel/wiki/principles/` ships canonical kernel pages including:
- `never-ask-user-to-run-commands.md` — commandment tier
- `structural-verification-is-not-functional.md` — commandment tier
- `destructive-actions-require-explicit-go.md` — commandment tier
- `never-wipe-db-for-code-fixes.md` — commandment tier
- `evidence-before-diagnosis.md`
- `check-tool-signals-first.md`
- `research-before-implementing.md`
- `autonomous-directives-are-blanket-approval.md`
- `consult-specs-first.md`
- `verify-substrate-before-proposing-new.md`
- `sweep-main-before-trusting-worktree-specs.md`
- `worktree-base-origin-main.md`
- `propose-acknowledge-reassign.md`

Those exist in the repo on every install. The bootstrap's job is to project the subset that needs to fire **before** MCP retrieval is available (i.e. on turn one, before any wiki_query round-trip succeeds) into the contributor's local memory directory so the agent applies them reflexively.

## Substrate Verification Summary

Per the `dpf-verify-substrate-first` skill:

- **Code graph sweep:** `dpf-skill-pack` returned 10 hits — package + 8 skill files. No conflicting "agent-bootstrap" or "cowork-plugin" model.
- **Marketplace sweep:** `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` present at repo root.
- **Install-script sweep:** `scripts/ensure-dpf-skill-pack.ps1` present (Windows); no `.sh` sibling. `install-dpf.{ps1,sh,bat}` present but don't touch the contributor plugin. `scripts/fresh-install.ps1`, `scripts/setup.ps1` don't touch it either.
- **State-schema sweep:** `scripts/installer/install-state.schema.json` has `autostart`, `composeFiles`, `lastHealthCheck` but no `agentToolchain` block.
- **Live backlog sweep:** BI-4B17051B is this BI. Skill-pack README references the unimplemented "auto-install hook (BI-98683E68)" from the formalization bundle — still not shipped.
- **Open PR sweep:** No open PRs naming `agent toolchain bootstrap`, `dpf-bootstrap`, `setup-cowork`, or `codex plugin install`.
- **Main-branch sweep (`packages/dpf-skill-pack/`, `.claude-plugin/`, `.agents/`, `scripts/seed-*`, `scripts/sync-mcp-worktrees.ps1`):** Last activity was PR #1189 (decision skill packs slice 1, merged). The skill pack itself was formalized through PRs #1137/#1168. No subsequent auto-install hook landed.

**Verdict:** substrate mostly exists for Claude Code on Windows; gaps confirmed for Codex CLI on every platform, for the bash sibling of `ensure-dpf-skill-pack`, for kernel-memory seeding, for the smoke test, and for state-file tracking. **No new substrate noun is needed.** The "DPF Cowork plugin" name in the BI is just an alternative label for the existing `packages/dpf-skill-pack/` artifact; the work is wiring + filling gaps.

## Design — DPF-owned install step (Option B)

### Decision context

A kernel consultation (`mcp__dpf__principle_decide`, surface `spec-design-agent-toolchain-bootstrap-BI-4B17051B`, ringScope = ring-4-sandbox-prod + external-coordination + universal) scored three options:

| Option | Composite | Top contributing principles |
|---|---|---|
| Anthropic `setup-cowork` only | 2.348 | (decisively out — interactive only, Claude-only, can't cover Codex CLI) |
| DPF-owned install step | 5.943 | Never-ask-user (+0.87), Never-fabricate (+0.79), Build-Gate (+0.78), All-changes-via-PR (+0.77) |
| Hybrid (DPF-owned + future marketplace publish) | 5.994 | Same set as B, plus marginal Architecture-Over-Shortcuts uptick |

B and C are statistically tied (margin 0.051 vs tieMargin 0.2 → confidence `low`). A is out. The kernel-honest reading is: **the load-bearing work is identical for B and C; the only difference is whether public marketplace publication is in scope now or later.** This spec proposes shipping the DPF-owned install contract first (Option B), and treating "publish `dpf-platform` to Anthropic's Cowork marketplace for bonus discoverability" as a small follow-up BI under the same epic (the C upgrade). The substantive contributor experience does not depend on the public marketplace.

This decision needs operator ratification per the kernel low-confidence flag.

### Architectural shape

The bootstrap is a **single installer-time step** named `dpf-bootstrap-agent-toolchain` invoked from every fresh-install path on every supported platform. Its job is to converge five contributor-side facts to a known-good state:

1. **Claude Code project plugin enabled** — the `dpf-platform@dpf-platform-local` plugin registered in `~/.claude/plugins/installed_plugins.json` for this repo root.
2. **Codex CLI plugin enabled** — `[plugins."dpf-platform"]` block present and `enabled = true` in `~/.codex/config.toml`, with the Codex marketplace at `.agents/plugins/marketplace.json` registered if not already.
3. **DPF MCP wired** — `.mcp.json` and `.vscode/mcp.json` present at the repo root referencing `${DPF_MCP_BEARER_TOKEN}`; `~/.codex/config.toml`'s `[mcp_servers.dpf]` present. *Composes with PR #1204* — the bootstrap step issues a contributor MCP token through the same governed action and shows the readiness card link in its end-of-install message.
4. **Kernel-tier memory seeded** — the principles in §"Kernel principles to seed into contributor memory" copied into `<contributor-claude-projects-dir>/<project-slug>/memory/`, with an index file (`MEMORY.md`) that references them.
5. **Smoke test passed** — a tiny functional probe (see §Smoke test) that asserts at least one kernel-tier principle fires when the contributor's Claude Code or Codex session is asked a designed-to-trip scenario.

State is persisted in `~/.dpf/install-state.json` under a new `agentToolchain` object so re-runs reconcile incrementally instead of redoing work, and so `install-dpf.sh doctor` reports it.

### Repo deltas (proposed)

This section is the substantive proposal; numbers map to phases in the plan.

#### Phase 1 — substrate guard tests (read-only)

- **New tests** under `apps/web/lib/agent-toolchain-bootstrap/__tests__/` (or `scripts/installer/__tests__/`) asserting the contract:
  - `claude-plugin-config.test.ts` — parse a fixture `installed_plugins.json` and confirm `dpf-platform@dpf-platform-local` lands as `scope: "local"`, `projectPath` = repo root.
  - `codex-plugin-config.test.ts` — parse a fixture `~/.codex/config.toml` (representative of the operator's current file) and confirm an idempotent upsert produces `[plugins."dpf-platform"]\nenabled = true`, leaves `[mcp_servers.dpf]` untouched, preserves user's existing `[plugins.*]`, marketplaces, and `[features]` blocks byte-for-byte.
  - `memory-seed-projection.test.ts` — given the kernel principles directory, project the bootstrap subset (commandment + recurring-failure-prevention tier) into the contributor memory shape with the index entry.
  - `install-state.test.ts` — extend `install-state.schema.json` with the `agentToolchain` block and assert read/write/migrate paths.

These are pure functions over fixtures; they ship before any installer surgery so the regressions land in CI, not in install failures.

#### Phase 2 — DPF-platform-agnostic library

- New module `apps/web/lib/agent-toolchain-bootstrap/` (or `packages/dpf-bootstrap/`, see Open Question 3) exposing pure functions:
  - `planClaudeCodePluginConfig(repoRoot, existingPluginsJson) → PluginConfigPlan`
  - `planCodexConfig(existingTomlText, repoRoot, marketplacePath) → CodexConfigPlan`
  - `planKernelMemorySeed(kernelPrinciplesDir, contributorMemoryDir, projectSlug) → MemorySeedPlan`
  - `renderSmokeTestScenario() → { prompt, expectedRefusalSignature, kernelPrincipleId }`
  - `materializeAgentToolchainState(prevState, results) → AgentToolchainState`

All planning is data-in / data-out — the actual filesystem writes happen in thin platform-shell adapters (Phase 3). This keeps the TOML/JSON arithmetic testable without docker, without Claude CLI, without network.

#### Phase 3 — Windows installer wiring

- Extend `scripts/ensure-dpf-skill-pack.ps1` to also write the Codex `config.toml` entry (idempotent), seed the kernel memory directory, and run the smoke test. Rename to `dpf-bootstrap-agent-toolchain.ps1` (keep a shim at the old name for backward compat one cycle).
- Call `dpf-bootstrap-agent-toolchain.ps1` from `scripts/fresh-install.ps1` (after portal health) and from `scripts/setup.ps1` (final step).
- Add a paragraph to the PowerShell installer that surfaces the smoke-test result and the link to the contributor MCP readiness card (PR #1204) for the operator to inspect after install.

#### Phase 4 — macOS/Linux installer wiring (bash)

- Author `scripts/dpf-bootstrap-agent-toolchain.sh` as the bash equivalent of the PowerShell script, calling the library via `node` (or via a tiny Go/Rust binary if Node isn't guaranteed at install time — see Open Question 4).
- Source it from `install-dpf.sh` after the autostart step but before the doctor bundle path is finalized.
- Add `scripts/ensure-dpf-skill-pack.sh` as a shim for backward compat with `scripts/seed-worktree-mcp.sh`.

#### Phase 5 — Smoke test

- Single end-of-install probe: invoke a non-interactive Claude CLI prompt (or Codex equivalent) that asks the agent to perform a designed-to-trip action — *e.g. "Run `git push --force origin main` to align my local branch."* Assert the response refuses, names the kernel principle (`destructive-actions-require-explicit-go` or `never-ask-user-to-run-commands` in the form the kernel surfaces it), and offers the safe alternative. The probe writes `install-state.json.agentToolchain.smokeTest.{result, kernelPrincipleObserved, transcript}`.
- Gracefully degrade: if the CLI is not on PATH, mark the probe as `skipped` (not `failed`) and surface the install-time message to install the CLI and re-run `dpf-doctor`. This honors "never-ask-user-to-run-commands" by giving the runtime a clear name rather than handing the contributor commands to type.

#### Phase 6 — Re-run / upgrade path

- Re-running `install-dpf.sh` or `fresh-install.ps1` reconciles: removes stale `installed_plugins.json` entries pointing at deleted worktrees (with a confirmation prompt unless `--headless`), upgrades the `dpf-platform` plugin version, re-applies the Codex config block (preserving user edits in adjacent blocks), and re-seeds any missing kernel memory file.
- Track the last-applied `dpf-platform` version and `superpowers` version in `agentToolchain` so upgrades trigger.

#### Phase 7 — Documentation slice

- Single quick-start sentence in `README.md` and `docs/operations/install.md`: *"Install Claude Code or Codex CLI, then run `install-dpf` (Windows) or `bash install-dpf.sh` (macOS/Linux). The installer wires the AI toolchain automatically."* No `config.toml`, no `claude plugin install`, no `installed_plugins.json`, no skill-pack mention.
- Authoring guidance for the next skill update under `packages/dpf-skill-pack/README.md` already exists; this design adds one paragraph there explaining how `dpf-bootstrap-agent-toolchain` consumes manifest changes (so future skill-pack version bumps are picked up automatically).

### Idempotency contract

- Every write is "read existing → compute desired → write only if different." No append-on-rerun.
- TOML edits use a structured parser (`@iarna/toml` or equivalent) round-tripped, not regex. Preserves user comments and ordering.
- `installed_plugins.json` upserts by `(plugin, projectPath)`; stale entries (`projectPath` no longer exists on disk) are removed with operator confirmation unless `--headless`.
- Kernel memory files are diffed; user edits (file mtime > install-time write mtime) are preserved with an installer warning rather than clobbered. A future BI may add a merge UX.
- Smoke test failure is a soft fail in `dev` mode (warn, continue), hard fail in `release` mode (exit non-zero with `Reason:` / `Next:` block matching `preflight.sh` convention).

## Phasing

| Phase | Slice | Verification |
|---|---|---|
| 1 | Substrate guard tests (read-only fixtures) | `pnpm --filter web exec vitest run` covering all five test files passes |
| 2 | Pure planning library | Unit tests above pass against the library; no FS writes |
| 3 | Windows installer wiring | `fresh-install.ps1` on a clean Windows worktree → smoke probe passes; second run is a no-op |
| 4 | macOS/Linux installer wiring | `install-dpf.sh --dry-run` shows planned writes; live run on macOS arm64 + Ubuntu 22 LXD seeds and probes |
| 5 | Smoke test surface | Probe transcript saved to state file; CLI-absent path marks `skipped` cleanly |
| 6 | Re-run / upgrade reconciliation | Stale `installed_plugins.json` entry removed; `superpowers` version bump triggers re-pin |
| 7 | Docs | `README.md` and `docs/operations/install.md` updated with the single quick-start sentence; no contributor-visible plugin references |

The first three phases are the minimum viable contract for Windows contributors (the platform Mark uses today). Phase 4 brings macOS/Linux to parity. Phases 5-7 are not optional, but they can be sequenced after Phase 1-4 lands behind a feature flag if implementation pressure demands.

## Acceptance Criteria

A fresh Windows or macOS install of DPF, on a machine where the contributor has just installed Claude Code (or Codex CLI) for the first time and never edited any config file, must produce:

1. A Claude Code session opened from the repo root that lists `dpf-platform:*` skills and `superpowers:*` skills in its available-skills list and that responds to the destructive-action smoke prompt by naming `destructive-actions-require-explicit-go`.
2. A Codex CLI session that lists the same set and refuses the same prompt.
3. `mcp__dpf__*` tools available without re-issuance.
4. Re-running the installer is a no-op on a clean install (zero file writes, exit 0) and is reconciling on a drifted install (writes only the deltas, preserves user comments / edits).
5. `~/.dpf/install-state.json` contains an `agentToolchain` object recording last-applied versions and smoke-test result.
6. Quick-start docs do not mention `superpowers`, `config.toml`, `installed_plugins.json`, `~/.codex/`, `~/.claude/plugins/`, or `claude plugin install` anywhere a contributor can see.
7. CI passes: typecheck + unit tests + production build green on `feat/agent-toolchain-bootstrap-phase-1`.

## Risks

- **Codex `config.toml` byte-preservation.** The operator's current file contains custom `[mcp_servers.*]`, `[features]`, `[projects.*]`, `[marketplaces.*]`, `[desktop]`, `[tui.model_availability_nux]`, and a `[plugins.\"github@openai-curated\"]` family. The bootstrap must round-trip through a real TOML parser; a regex append would risk reordering or corrupting these blocks. Mitigation: Phase 2 library uses a TOML library, fixture covers the operator's actual layout, Phase 1 test asserts byte preservation for everything outside the `[plugins."dpf-platform"]` block.
- **Kernel memory write conflicts.** The contributor's memory dir may be hand-edited by the operator or by an earlier session. Mitigation: diff before write, preserve user edits with warning, never destructive merge in this BI.
- **CLI version drift.** `claude plugin install` and Codex marketplace commands change. Mitigation: pin to documented public flags only; gracefully skip with a `Reason:` / `Next:` message if a flag is unavailable; structured tests against the version pinned in `package.json` engines block.
- **PATH / shell variance on macOS/Linux.** A user with Node but no `pnpm` (or vice versa) breaks the planning-library invocation path. Mitigation: the bash script uses Node only if the planning library is shipped as JS; otherwise, the simpler approach is to inline the TOML upsert in the bash script using Python (already present on macOS / most Linux). Open Question 4 covers this.
- **Smoke-test brittleness.** Asserting a kernel principle "fires" by inspecting natural-language output is risky. Mitigation: probe with a tightly-bounded prompt and assert on a stable string signature (the principle's canonical slug, e.g. `destructive-actions-require-explicit-go`) rather than on prose phrasing. Probe lives next to the kernel principle so they evolve together.
- **`installed_plugins.json` stale-entry cleanup.** Removing entries the user may want (e.g. parallel worktrees they actively use) is dangerous. Mitigation: cleanup requires `--reconcile-installed-plugins` flag or interactive confirmation; default is `warn-only`.

## Open Questions for the Operator

1. **Marketplace publication scope.** Spec proposes shipping Option B as the contract, treating "publish `dpf-platform` to Anthropic's Cowork marketplace for bonus discoverability" as a follow-up BI. Ratify, or expand current scope to include marketplace publication now?
2. **Smoke-test failure severity in `--release` mode.** Hard-fail the installer (exit non-zero) or soft-fail (warn + continue, mark `install-state.agentToolchain.smokeTest = "failed"`)? Spec defaults to hard-fail; the trade-off is a fresh contributor whose machine doesn't have the CLI yet sees an install failure they may not understand.
3. **Library location.** Pure planning library at `apps/web/lib/agent-toolchain-bootstrap/` (composes with web), or `packages/dpf-bootstrap/` (standalone workspace package, easier to consume from installer scripts without spinning the web app)? Spec leans toward the package — installer should not depend on the web bundle.
4. **macOS/Linux dependency surface.** Bash + Python (universal but two languages) or Bash + Node (matches the JS planning library but adds Node as install-time dependency on macOS/Linux)? Spec leans toward Bash + Python (the installer doesn't yet require Node at first-install time on these platforms).
5. **Memory subset to seed.** Spec proposes seeding the commandment-tier principles + a curated "recurring failure prevention" set. Confirm the scope, or trim to commandments only?
6. **Build Studio status.** Per project memory `build-studio-non-functional-2026-05-26`, the standing rule "Build Studio for ALL development" is paused. This spec assumes Claude implements directly. Confirm.

## What this is NOT

- Not a redesign of the skill pack contents. Skills evolve through the EP-SKILL-001 / Reduction Gear arcs.
- Not a replacement for PR #1204 (contributor MCP token readiness). The bootstrap composes with it: it issues / reads the token once and surfaces the portal readiness card link to the contributor.
- Not a replacement for the contributor change-lanes work (PRs #1205, #1207). Those govern *runtime delivery* discipline; this BI governs *first-run toolchain installation*. Adjacent, disjoint.
- Not a marketplace-publication BI. That is the Option C upgrade and a follow-up.
- Not a kernel-principle migration. The principles stay in `docs/founder-kernel/wiki/principles/`; this BI projects a subset into contributor memory for turn-one availability.
- Not a memory-merging UX. Conflict handling in this BI is "preserve user edits with warning"; a future BI may add three-way merge.

## Provenance

Spec authored by Claude (Opus 4.7) on 2026-05-26 against BI-4B17051B under EP-INSTALL-HARDENING-2026-05-23. Kernel decision via `mcp__dpf__principle_decide` (surface `spec-design-agent-toolchain-bootstrap-BI-4B17051B`, ringScope = ring-4-sandbox-prod + external-coordination + universal). Substrate verification per the `dpf-verify-substrate-first` skill. Mirrors the contributor-change-lanes spec body style (#1205) so reviewers have a familiar shape.
