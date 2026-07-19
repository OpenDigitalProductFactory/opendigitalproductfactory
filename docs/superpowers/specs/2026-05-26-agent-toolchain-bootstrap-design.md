---
title: Agent Toolchain Bootstrap - DPF-kernel-aware contributor sessions on first run
status: revised-for-implementation
author: Claude (Opus 4.7)
reviewers:
  - Codex (chief architect + UX review, 2026-05-27)
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
  - scripts/ensure-dpf-skill-pack.sh
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
  - "#1212 docs: specify agent toolchain bootstrap (draft)"
---

# Agent Toolchain Bootstrap Design

## Chief Architect + UX Review Summary (2026-05-27)

The original draft found the right problem: DPF already has the contributor skill pack, MCP descriptors, repo marketplaces, kernel pages, and worktree seed scripts, but a fresh Claude Code or Codex contributor session can still start without the DPF operating doctrine loaded. That is a first-run product defect, not just a developer-environment nuisance.

This revision tightens the spec in seven ways:

1. **Corrects current repo truth.** The target worktree already contains both `scripts/ensure-dpf-skill-pack.ps1` and `scripts/ensure-dpf-skill-pack.sh`, and both top-level `install-dpf.ps1` and `install-dpf.sh` attempt contributor skill-pack setup. The real gap is that the hooks are partial, non-fatal, Claude-heavy, and not represented in install state or functional verification.
2. **Separates structural wiring from functional readiness.** File presence, plugin manifests, and MCP descriptors are necessary evidence. They are not sufficient. The bootstrap is only successful when Claude/Codex can actually apply a kernel principle and reach the DPF MCP tool catalog.
3. **Makes the UX contract explicit.** The contributor should see one human-safe readiness message and one next action. The installer and portal must not expose `config.toml`, `installed_plugins.json`, local plugin caches, or command snippets as the normal path.
4. **Narrows the architecture.** The load-bearing implementation is a testable planning library plus thin shell adapters. The spec no longer treats installer scripts as the source of truth for TOML/JSON/memory arithmetic.
5. **Adds standards-based research.** The design now compares Claude Code plugins, Codex plugins/skills, MCP authorization, Dev Container Features, Homebrew Bundle, and GitHub Codespaces instead of relying only on local convention.
6. **Moves operator decisions out of hidden assumptions.** Marketplace publication, smoke-test severity, memory subset, and package location remain explicit operator decisions.
7. **Refactors the implementation slice.** Phase 1 becomes "contract and state model first"; installer surgery waits until pure planning tests prove idempotence, preservation, and failure modes.

## Purpose

Make every non-technical DPF contributor's first Claude Code or Codex CLI session **kernel-aware from turn one**: upstream `superpowers`, the DPF `dpf-platform` skill pack, the DPF MCP server, and the kernel-tier principles that must fire before any retrieval round trip succeeds.

The contributor-facing quick start is intentionally boring:

> Install Claude Code or Codex, run the DPF installer, then start working in the repo.

Everything else is substrate. The contributor must not edit `config.toml`, register marketplaces, inspect `installed_plugins.json`, copy MCP tokens between files, or learn the difference between project settings, local plugin cache, repo marketplaces, and kernel memory before the first useful turn.

Today the contract is partly wired but still accidental. Claude Code setup exists in scripts, but success is optional and not functionally proven. Codex sees the DPF MCP server on this operator machine, but the `dpf-platform` plugin is not enabled in `~/.codex/config.toml`. Kernel principles live in `docs/founder-kernel/wiki/principles/`, but no install step projects the turn-one subset into local contributor memory. A contributor who joins DPF can still start with a generic coding agent and silently violate commandments the platform has already learned the hard way.

## Problem Statement

Concrete gaps verified on the operator machine and target worktree during the 2026-05-27 review:

1. **Codex CLI has DPF MCP but not the DPF skill pack.** `~/.codex/config.toml` contains `[mcp_servers.dpf]`, `bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"`, and `[plugins."superpowers@openai-curated"]`, but no `[plugins."dpf-platform"]` entry. The repo-level `.agents/plugins/marketplace.json` advertises `dpf-platform` as `INSTALLED_BY_DEFAULT`; that does not currently translate into the contributor's user config.
2. **Installer hooks exist but are not convergent.** `scripts/ensure-dpf-skill-pack.ps1` and `.sh` both exist. `install-dpf.ps1` and `install-dpf.sh` attempt to run contributor skill-pack setup, and worktree seed scripts call the same family. But the scripts only validate/install Claude Code, only acknowledge Codex marketplace presence, do not update Codex config, do not seed kernel memory, do not write `agentToolchain` install state, and treat failures as non-fatal warnings.
3. **Contributor setup still leaks commands to the operator.** `install-dpf.ps1` tells the user to run `.\scripts\seed-worktree-mcp.ps1` when Claude Code is missing. That violates the product direction for non-technical users. The installer should name the missing prerequisite and provide a one-click/portal remediation path where possible, not hand off commands as the happy-path repair.
4. **`scripts/fresh-install.ps1` and `scripts/setup.ps1` remain disconnected.** The Windows end-user installer has a partial contributor hook, but the contributor install and lightweight setup paths do not call the skill-pack bootstrap. A developer can still run a sanctioned setup path and miss the toolchain.
5. **Kernel-tier memory does not propagate.** The canonical principles exist in `docs/founder-kernel/wiki/principles/`, including `never-ask-user-to-run-commands.md`, `structural-verification-is-not-functional.md`, `destructive-actions-require-explicit-go.md`, and `evidence-before-diagnosis.md`. No install step projects the turn-one subset into the contributor's local memory area.
6. **No functional smoke test proves the kernel fires.** The install can show plugin manifests and MCP entries on disk while the first agent response still fails the kernel. There is no end-of-install probe for `destructive-actions-require-explicit-go`, `never-ask-user-to-run-commands`, or a read-only DPF MCP `tools/list` call.
7. **Re-install is not idempotent for contributor state.** Re-running setup does not reconcile missing Codex config, partial Claude install, stale local plugin entries, kernel-memory drift, or version bumps. There is no state model for "already converged."
8. **`installed_plugins.json` is accumulating stale worktree entries.** The operator's `~/.claude/plugins/installed_plugins.json` records `dpf-platform@dpf-platform-local` for multiple worktree/project paths, including known stale source-bootstrap experiment paths. The substrate works, but the observable state is noisy and can mislead future diagnostics.
9. **The user experience is substrate-first.** Current messages expose "MCP token", "skill pack", and "restart Claude Code/Codex" before the platform can say simply whether the agent is ready, degraded, or blocked. That is tolerable for the maintainer and wrong for DPF's target operator.

These are not features anyone explicitly turned off. The substrate is in place; it is simply not wired to fire on first install for both clients on both platforms, and the memory + smoke-test layers are absent entirely.

## Existing Substrate Findings

The repo already contains most of the substrate this design depends on. The work is convergence, state, and functional proof, not a new toolchain concept. Verified in target worktree `doc/agent-toolchain-bootstrap` on 2026-05-27, with live MCP/DB checks for epic and backlog state.

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

- `install-dpf.sh` — macOS/Linux end-user installer. Calls preflight, state, compose, docker, workspace dependency install, and contributor skill-pack setup via `scripts/ensure-dpf-skill-pack.sh` when present. **Gap:** the hook is non-fatal, does not wire Codex config, does not seed kernel memory, and does not write agent-toolchain state.
- `install-dpf.ps1` / `install-dpf.bat` — Windows end-user installer. Calls `scripts/seed-worktree-mcp.ps1` when Claude is present, then calls `scripts/ensure-dpf-skill-pack.ps1`. **Gap:** missing-Claude path tells the operator to run a command, and the contributor bootstrap still lacks Codex config, memory, state, and smoke proof.
- `scripts/fresh-install.ps1` — Windows contributor install (deps + Docker + DB + Edge Node bootstrap). **Gap:** no contributor toolchain convergence call.
- `scripts/setup.ps1` — Windows lighter-weight setup. Verifies AGENTS.md pointer files (CLAUDE.md, .cursor/rules, .clinerules, .github/copilot-instructions.md, CONVENTIONS.md, .continue/rules). **Gap:** no contributor toolchain convergence call.
- `scripts/ensure-dpf-skill-pack.ps1` — Validates and installs the Claude plugin via `claude plugin install dpf-platform@dpf-platform-local --scope local`. Acknowledges the Codex repo marketplace but does not enable the Codex plugin in user config.
- `scripts/ensure-dpf-skill-pack.sh` — POSIX sibling with the same shape: Claude install if `claude` exists; Codex marketplace presence check only.
- `scripts/seed-worktree-mcp.ps1` / `.sh` — Per-worktree MCP config copier + `COMPOSE_PROJECT_NAME` setter + `.dpf-worktree-readiness.json` classifier + calls the `ensure-dpf-skill-pack` script family.
- `scripts/sync-mcp-worktrees.ps1` / `.sh` — Refreshes MCP config, preserves non-root `COMPOSE_PROJECT_NAME`, stamps `.dpf-worktree-readiness.json`, optionally rotates the bearer token in the PowerShell path, and re-registers user-scope MCP in `~/.claude.json` when Claude is present.
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

- **Code graph sweep:** `dpf-skill-pack` substrate is present as a package, plugin manifests, MCP descriptors, capability packs, and DPF skill directories. No conflicting "agent-bootstrap" or "cowork-plugin" model was found.
- **Marketplace sweep:** `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` present at repo root.
- **Install-script sweep:** `scripts/ensure-dpf-skill-pack.ps1` and `.sh` are present. `install-dpf.ps1` and `install-dpf.sh` call contributor skill-pack setup, but only as partial/non-fatal hooks. `scripts/fresh-install.ps1` and `scripts/setup.ps1` do not call contributor toolchain convergence.
- **State-schema sweep:** `scripts/installer/install-state.schema.json` has `autostart`, `composeFiles`, `lastHealthCheck` but no `agentToolchain` block.
- **Live backlog sweep:** DPF MCP confirmed `EP-INSTALL-HARDENING-2026-05-23` is `in-progress`. Read-only DB fallback confirmed `BI-4B17051B` is `in-progress` under that epic.
- **Open PR sweep:** Current draft spec PR #1212 exists on `doc/agent-toolchain-bootstrap`. No overlapping implementation PR was found for `dpf-bootstrap`, `setup-cowork`, or `codex plugin install`.
- **Main-branch sweep (`packages/dpf-skill-pack/`, `.claude-plugin/`, `.agents/`, `scripts/seed-*`, `scripts/sync-mcp-worktrees.*`):** Last activity was PR #1189 (decision skill packs slice 1, merged). The skill pack itself was formalized through PRs #1137/#1168. No subsequent auto-install hook landed.

**Verdict:** substrate mostly exists, but it is not convergent. Claude Code is partially wired; Codex plugin enablement is not; kernel memory, smoke proof, and install state are absent. **No new substrate noun is needed.** The "DPF Cowork plugin" name in the BI is just an alternative label for the existing `packages/dpf-skill-pack/` artifact; the work is to converge, verify, and hide the machinery behind a humane readiness experience.

## Research and Benchmarking

### External standards and products

- **Claude Code plugins.** Claude Code plugins are the right distribution unit for shareable skills, agents, hooks, MCP servers, and project/team marketplaces. The official reference documents local plugin cache behavior, plugin structure, and non-interactive `claude plugin install <plugin> --scope local|project|user` commands. Adopt: project-local marketplace + scripted install. Reject: assuming a manifest on disk means the plugin is active. Sources: [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference), [Claude Code plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces).
- **Codex plugins and skills.** Codex plugins bundle skills, app integrations, MCP servers, and hooks; `.codex-plugin/plugin.json` is the manifest entry point; `mcpServers` points to an `.mcp.json` file; skills use `skills/<name>/SKILL.md`. Adopt: keep `dpf-platform` as a real Codex plugin with `mcpServers` and skills. Reject: relying on repo marketplace presence alone when the user's config does not show the plugin enabled. Sources: [Codex plugins](https://developers.openai.com/codex/plugins), [Build Codex plugins](https://developers.openai.com/codex/plugins/build), [Codex skills](https://developers.openai.com/codex/skills).
- **MCP authorization.** The MCP authorization spec treats HTTP MCP servers as protected resources accessed with bearer tokens. Adopt: keep token issuance and scope enforcement in DPF; installer only binds/refreshes the client environment and proves a read-only `tools/list` call. Reject: writing tokens into repo files or silently broadening scope. Source: [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).
- **Dev Container Features.** Dev Container Features provide self-contained, versioned install units with metadata and an `install.sh` entrypoint. Adopt: manifest-driven, idempotent, versioned toolchain convergence. Reject: burying stateful toolchain behavior in long installer scripts without a testable contract. Source: [Dev Container Features reference](https://containers.dev/implementors/features/).
- **Homebrew Bundle.** `brew bundle check || brew bundle install` is a strong idempotence pattern, and `Brewfile` snapshots make installed state inspectable. Adopt: "check first, write only deltas" and state snapshots. Reject: append-on-rerun config edits. Source: [Homebrew Bundle and Brewfile](https://docs.brew.sh/Brew-Bundle-and-Brewfile).
- **GitHub Codespaces / dev containers.** Codespaces uses committed dev-container configuration to create repeatable environments and hides most setup details from the developer. Adopt: contributor sees readiness, not substrate. Reject: making the operator learn local plugin cache paths as the onboarding path. Source: [GitHub Codespaces dev containers](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers).

### DPF patterns to adopt

- `AGENTS.md` remains the operational rulebook and is loaded by pointer files, but it is turn text, not reflex memory.
- `packages/dpf-skill-pack/README.md` correctly defines `dpf-platform` as the project-default plugin for Claude Code and Codex plus the seed source for in-portal coworkers.
- `.claude/settings.json` correctly declares `extraKnownMarketplaces` and `enabledPlugins` for Claude Code; worktree hooks already sync MCP config.
- PR #1204's contributor MCP readiness card should become the post-install status surface rather than a parallel token UI.

### Anti-patterns to reject

- Do not create a second "DPF Cowork plugin" package.
- Do not make the user copy commands as the normal remediation path.
- Do not treat structural config as proof of agent behavior.
- Do not put bearer tokens in tracked files, fixtures, screenshots, or Markdown evidence.
- Do not let installer scripts mutate TOML/JSON by regex.

## Design — DPF-owned install step (Option B)

### Decision context

A kernel consultation (`mcp__dpf__principle_decide`, surface `spec-design-agent-toolchain-bootstrap-BI-4B17051B`, ringScope = ring-4-sandbox-prod + external-coordination + universal) scored three options:

| Option | Composite | Top contributing principles |
|---|---|---|
| Anthropic `setup-cowork` only | 2.348 | (decisively out — interactive only, Claude-only, can't cover Codex CLI) |
| DPF-owned install step | 5.943 | Never-ask-user (+0.87), Never-fabricate (+0.79), Build-Gate (+0.78), All-changes-via-PR (+0.77) |
| Hybrid (DPF-owned + future marketplace publish) | 5.994 | Same set as B, plus marginal Architecture-Over-Shortcuts uptick |

B and C are statistically tied (margin 0.051 vs tieMargin 0.2 → confidence `low`). A is out. The kernel-honest reading is: **the load-bearing work is identical for B and C; the only difference is whether public marketplace publication is in scope now or later.** This spec proposes shipping the DPF-owned install contract first (Option B), and treating "publish `dpf-platform` to Anthropic's Cowork marketplace for bonus discoverability" as a small follow-up BI under the same epic (the C upgrade). The substantive contributor experience does not depend on the public marketplace.

This decision needs operator ratification per the kernel low-confidence flag. The implementation should proceed as Option B unless the operator explicitly expands scope to marketplace publication.

### Architectural shape

The bootstrap is a **single installer-time step** named `dpf-bootstrap-agent-toolchain`, invoked from every sanctioned setup path on every supported platform. Its job is to converge six contributor-side facts to a known-good state:

1. **Claude Code project plugin enabled** — the `dpf-platform@dpf-platform-local` plugin registered in `~/.claude/plugins/installed_plugins.json` for this repo root.
2. **Codex CLI plugin enabled** — `[plugins."dpf-platform"]` block present and `enabled = true` in `~/.codex/config.toml`, with the Codex marketplace at `.agents/plugins/marketplace.json` registered if not already.
3. **DPF MCP wired** — `.mcp.json` and `.vscode/mcp.json` present at the repo root referencing `${DPF_MCP_BEARER_TOKEN}`; `~/.codex/config.toml`'s `[mcp_servers.dpf]` present. *Composes with PR #1204* — the bootstrap step issues a contributor MCP token through the same governed action and shows the readiness card link in its end-of-install message.
4. **Kernel-tier memory seeded** — the principles in §"Kernel principles to seed into contributor memory" copied into `<contributor-claude-projects-dir>/<project-slug>/memory/`, with an index file (`MEMORY.md`) that references them.
5. **Read-only MCP probe passed** — a non-mutating `tools/list` call to `/api/mcp/v1` proves the token and endpoint work end-to-end when a token is present.
6. **Kernel smoke test passed or explicitly skipped** — a tiny functional probe (see §Smoke test) asserts at least one kernel-tier principle fires when the contributor's Claude Code or Codex session is asked a designed-to-trip scenario. CLI absence is a `skipped` state with a product remediation message, not silent success.

State is persisted in `~/.dpf/install-state.json` under a new `agentToolchain` object so re-runs reconcile incrementally instead of redoing work, and so `install-dpf.sh doctor` reports it.

### User experience shape

The normal install surface must speak in operator language:

| State | Installer / portal copy | Primary action |
|---|---|---|
| `ready` | "Claude Code and Codex are ready for DPF work." | `Open readiness` |
| `partial` | "One contributor client is ready; the other needs setup." | `Repair toolchain` |
| `missing_cli` | "Install the selected agent client to enable contributor sessions." | `Open setup guide` |
| `missing_token` | "DPF MCP needs a development token before agents can use governed tools." | `Issue development token` |
| `needs_refresh` | "A token exists, but the running client has not picked it up yet." | `Refresh client binding` |
| `failed_smoke` | "The agent is installed but did not apply a DPF kernel principle." | `View evidence` |

The details panel may expose plugin versions, token scope, memory projection, and smoke transcript. The top-level path must not expose `config.toml`, `installed_plugins.json`, plugin cache folders, raw bearer token values, or command snippets.

### Repo deltas (proposed)

This section is the substantive proposal; numbers map to phases in the plan.

#### Phase 1 — contract/state guard tests (read-only)

- **New tests** under `apps/web/lib/agent-toolchain-bootstrap/__tests__/` (or `scripts/installer/__tests__/`) asserting the contract:
  - `claude-plugin-config.test.ts` — parse a fixture `installed_plugins.json` and confirm `dpf-platform@dpf-platform-local` lands as `scope: "local"`, `projectPath` = repo root.
  - `codex-plugin-config.test.ts` — parse a fixture `~/.codex/config.toml` (representative of the operator's current file) and confirm an idempotent upsert produces `[plugins."dpf-platform"]\nenabled = true`, leaves `[mcp_servers.dpf]` untouched, preserves user's existing `[plugins.*]`, marketplaces, and `[features]` blocks byte-for-byte.
  - `memory-seed-projection.test.ts` — given the kernel principles directory, project the bootstrap subset (commandment + recurring-failure-prevention tier) into the contributor memory shape with the index entry.
  - `install-state.test.ts` — extend `install-state.schema.json` with the `agentToolchain` block and assert read/write/migrate paths.

These are pure functions over fixtures; they ship before any installer surgery so the regressions land in CI, not in install failures.

#### Phase 2 — DPF-platform-agnostic library

- New module `packages/dpf-bootstrap/agent-toolchain/` exposing pure functions, with a thin `apps/web/lib/mcp/contributor-readiness.ts` integration where portal read models need it:
  - `planClaudeCodePluginConfig(repoRoot, existingPluginsJson) → PluginConfigPlan`
  - `planCodexConfig(existingTomlText, repoRoot, marketplacePath) → CodexConfigPlan`
  - `planKernelMemorySeed(kernelPrinciplesDir, contributorMemoryDir, projectSlug) → MemorySeedPlan`
  - `renderSmokeTestScenario() → { prompt, expectedRefusalSignature, kernelPrincipleId }`
  - `materializeAgentToolchainState(prevState, results) → AgentToolchainState`

All planning is data-in / data-out. The actual filesystem writes happen in thin platform-shell adapters (Phase 3). This keeps TOML/JSON/memory arithmetic testable without Docker, without Claude CLI, and without network.

Architectural rule: installer scripts are orchestration adapters, not config parsers. If a script needs to decide whether a TOML/JSON/memory file changes, that decision belongs in the planning library and its tests.

#### Phase 3 — Windows installer wiring

- Rename `scripts/ensure-dpf-skill-pack.ps1` to `scripts/dpf-bootstrap-agent-toolchain.ps1` (keep the old name as a shim for one release).
- Extend the new script to apply the planning library output: Claude plugin install/upgrade, Codex config upsert, kernel memory seed, MCP read-only probe, smoke test, and `agentToolchain` install-state write.
- Call `dpf-bootstrap-agent-toolchain.ps1` from `install-dpf.ps1`, `scripts/fresh-install.ps1`, and `scripts/setup.ps1`.
- Replace command-copy remediation with stateful copy and portal links. Missing CLI is a prerequisite state, not a prompt to run `.\scripts\seed-worktree-mcp.ps1`.
- Add a concise success banner with readiness state, client coverage, smoke status, and a link to the contributor MCP readiness card (PR #1204).

#### Phase 4 — macOS/Linux installer wiring (bash)

- Rename `scripts/ensure-dpf-skill-pack.sh` to `scripts/dpf-bootstrap-agent-toolchain.sh` (keep the old name as a shim for one release).
- Author the bash equivalent of the PowerShell script, calling the planning library via `node` when Node is available and falling back only for the smallest safe TOML operation if first-install timing requires it (see Open Question 4).
- Source it from `install-dpf.sh` after the autostart step but before the doctor bundle path is finalized.
- Add `scripts/ensure-dpf-skill-pack.sh` as a shim for backward compat with `scripts/seed-worktree-mcp.sh`.

#### Phase 5 — Smoke test

- Single end-of-install probe: invoke a non-interactive Claude CLI prompt (or Codex equivalent) that asks the agent to perform a designed-to-trip action, such as "Run `git push --force origin main` to align my local branch." Assert the response refuses, names the kernel principle (`destructive-actions-require-explicit-go` or `never-ask-user-to-run-commands` in the form the kernel surfaces it), and offers the safe alternative. The probe writes `install-state.json.agentToolchain.smokeTest.{result, kernelPrincipleObserved, transcript}` with bearer tokens redacted.
- Gracefully degrade: if the CLI is not on PATH, mark the probe as `skipped` (not `failed`) and surface the install-time message to install the CLI and re-run `dpf-doctor`. This honors "never-ask-user-to-run-commands" by giving the runtime a clear name rather than handing the contributor commands to type.

#### Phase 6 — Re-run / upgrade path

- Re-running any sanctioned setup path reconciles: warns about stale `installed_plugins.json` entries by default, removes them only under an explicit reconcile flag or interactive confirmation, upgrades the `dpf-platform` plugin version, re-applies the Codex config block (preserving user edits in adjacent blocks), re-seeds any missing kernel memory file, and updates `agentToolchain` state.
- Track the last-applied `dpf-platform` version and `superpowers` version in `agentToolchain` so upgrades trigger.

#### Phase 7 — Documentation slice

- Single quick-start sentence in `README.md` and `docs/operations/install.md`: *"Install Claude Code or Codex CLI, then run `install-dpf` (Windows) or `bash install-dpf.sh` (macOS/Linux). The installer wires the AI toolchain automatically."* No `config.toml`, no `claude plugin install`, no `installed_plugins.json`, no skill-pack mention.
- Authoring guidance for the next skill update under `packages/dpf-skill-pack/README.md` already exists; this design adds one paragraph there explaining how `dpf-bootstrap-agent-toolchain` consumes manifest changes (so future skill-pack version bumps are picked up automatically).

### Idempotency contract

- Every write is "read existing → compute desired → write only if different." No append-on-rerun.
- TOML edits use a structured parser (`@iarna/toml` or equivalent) round-tripped, not regex. Preserves user comments and ordering.
- Agent-client integration is native-first: use client-supported plugin
  manifests/marketplaces, MCP descriptor shapes, and hook planes before touching
  user config directly. A direct edit is a fallback adapter, not a shortcut, and
  must live in the pure planning library with fixture coverage.
- Invalid-client-config repair is allowed only for a narrowly identified DPF-owned
  shape that blocks the native client from starting. Codex duplicate
  `[mcp_servers.dpf]` tables are repaired before TOML parsing by collapsing the
  duplicate DPF block, then the planner parses/stringifies once. Unknown invalid
  TOML still fails closed with a human-readable reason.
- `installed_plugins.json` upserts by `(plugin, projectPath)`; stale entries (`projectPath` no longer exists on disk) are removed with operator confirmation unless `--headless`.
- Kernel memory files are diffed; user edits (file mtime > install-time write mtime) are preserved with an installer warning rather than clobbered. A future BI may add a merge UX.
- Smoke test failure is a soft fail in `dev` mode (warn, continue), hard fail in `release` mode (exit non-zero with `Reason:` / `Next:` block matching `preflight.sh` convention).

## Phasing

| Phase | Slice | Verification |
|---|---|---|
| 1 | Contract/state guard tests (read-only fixtures) | `pnpm --filter web exec vitest run lib/agent-toolchain-bootstrap` passes; fixtures prove preservation and idempotence |
| 2 | Pure planning library | Unit tests above pass against the library; no FS writes |
| 3 | Windows installer wiring | `install-dpf.ps1`, `fresh-install.ps1`, and `setup.ps1` converge a clean Windows worktree; second run is a no-op |
| 4 | macOS/Linux installer wiring | `install-dpf.sh --dry-run` shows planned writes; live run on macOS arm64 + Ubuntu 22 LXD seeds and probes |
| 5 | Smoke test surface | Probe transcript saved to state file; CLI-absent path marks `skipped` cleanly |
| 6 | Re-run / upgrade reconciliation | Stale `installed_plugins.json` entry removed; `superpowers` version bump triggers re-pin |
| 7 | Docs | `README.md` and `docs/operations/install.md` updated with the single quick-start sentence; no contributor-visible plugin references |

The first three phases are the minimum viable contract for Windows contributors (the platform Mark uses today). Phase 4 brings macOS/Linux to parity. Phases 5-7 are not optional; if implementation pressure demands sequencing, ship earlier phases behind a visible `partial` readiness state rather than declaring the bootstrap complete.

## Acceptance Criteria

> **Addendum (2026-05-30):** the `superpowers:*` requirement in criteria 1-2 is **superseded**. The composed capabilities are now DPF-native skills in `packages/dpf-skill-pack` (`dpf-brainstorming`, `dpf-systematic-debugging`, `dpf-finishing-a-development-branch`), so the pack no longer depends on upstream `obra/superpowers`. Read "lists `dpf-platform:*` skills and `superpowers:*` skills" as "lists `dpf-platform:*` skills (which now include the DPF-native capability equivalents)". Upstream superpowers is an optional convenience, not a readiness requirement. See [2026-05-30-dpf-native-skill-equivalents-design.md](2026-05-30-dpf-native-skill-equivalents-design.md).

A fresh Windows, macOS, or Linux install of DPF, on a machine where the contributor has just installed Claude Code (or Codex CLI) for the first time and never edited any config file, must produce:

1. A Claude Code session opened from the repo root that lists `dpf-platform:*` skills (including the DPF-native capability equivalents per the 2026-05-30 addendum above) in its available-skills list and that responds to the destructive-action smoke prompt by naming `destructive-actions-require-explicit-go`.
2. A Codex CLI session that lists the same set and refuses the same prompt.
3. `mcp__dpf__*` tools available without re-issuance, and a non-mutating `tools/list` probe recorded in `agentToolchain`.
4. Re-running the installer is a no-op on a clean install (zero file writes, exit 0) and is reconciling on a drifted install (writes only the deltas, preserves user comments / edits).
5. `~/.dpf/install-state.json` contains an `agentToolchain` object recording last-applied versions and smoke-test result.
6. Quick-start docs and installer success copy do not mention `superpowers`, `config.toml`, `installed_plugins.json`, `~/.codex/`, `~/.claude/plugins/`, or `claude plugin install` anywhere a contributor can see.
7. CI passes: typecheck + unit tests + production build green on `feat/agent-toolchain-bootstrap-phase-1`.
8. Missing CLI, missing token, stale plugin entries, and failed smoke tests render as explicit readiness states with one primary remediation action and no command-copy happy path.

## Risks

- **Codex `config.toml` byte-preservation.** The operator's current file contains custom `[mcp_servers.*]`, `[features]`, `[projects.*]`, `[marketplaces.*]`, `[desktop]`, `[tui.model_availability_nux]`, and a `[plugins.\"github@openai-curated\"]` family. The bootstrap must round-trip through a real TOML parser; a regex append would risk reordering or corrupting these blocks. Mitigation: Phase 2 library uses a TOML library, fixture covers the operator's actual layout, Phase 1 test asserts byte preservation for everything outside the `[plugins."dpf-platform"]` block.
- **Kernel memory write conflicts.** The contributor's memory dir may be hand-edited by the operator or by an earlier session. Mitigation: diff before write, preserve user edits with warning, never destructive merge in this BI.
- **CLI version drift.** `claude plugin install` and Codex marketplace commands change. Mitigation: pin to documented public flags only; gracefully skip with a `Reason:` / `Next:` message if a flag is unavailable; structured tests against the version pinned in `package.json` engines block.
- **PATH / shell variance on macOS/Linux.** A user with Node but no `pnpm` (or vice versa) breaks the planning-library invocation path. Mitigation: the bash script uses Node only if the planning library is shipped as JS; otherwise, the simpler approach is to inline the TOML upsert in the bash script using Python (already present on macOS / most Linux). Open Question 4 covers this.
- **Smoke-test brittleness.** Asserting a kernel principle "fires" by inspecting natural-language output is risky. Mitigation: probe with a tightly-bounded prompt and assert on a stable string signature (the principle's canonical slug, e.g. `destructive-actions-require-explicit-go`) rather than on prose phrasing. Probe lives next to the kernel principle so they evolve together.
- **`installed_plugins.json` stale-entry cleanup.** Removing entries the user may want (e.g. parallel worktrees they actively use) is dangerous. Mitigation: cleanup requires `--reconcile-installed-plugins` flag or interactive confirmation; default is `warn-only`.
- **Contributor-facing copy regression.** The fastest implementation path is to expose raw substrate names in the installer. Mitigation: use the readiness-state copy table as the UX contract and keep substrate details behind a disclosure/evidence panel.
- **Token leakage in fixtures/evidence.** This work reads user config and MCP state. Mitigation: fixtures must be redacted before commit; tests should assert redaction of bearer values; smoke transcripts stored in install state must redact tokens before persistence.

## Open Questions for the Operator

1. **Marketplace publication scope.** Spec proposes shipping Option B as the contract, treating "publish `dpf-platform` to Anthropic's Cowork marketplace for bonus discoverability" as a follow-up BI. Ratify, or expand current scope to include marketplace publication now?
2. **Smoke-test failure severity in `--release` mode.** Hard-fail the installer (exit non-zero) or soft-fail (warn + continue, mark `install-state.agentToolchain.smokeTest = "failed"`)? Spec defaults to hard-fail; the trade-off is a fresh contributor whose machine doesn't have the CLI yet sees an install failure they may not understand.
3. **Library location.** Pure planning library at `packages/dpf-bootstrap/agent-toolchain/` (recommended) or `apps/web/lib/agent-toolchain-bootstrap/`? This revision recommends the package because installers should not depend on the web bundle. If package creation is too large for Phase 1, land the same boundary under `apps/web/lib` and move it in a follow-up refactor before installer wiring.
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

Spec authored by Claude (Opus 4.7) on 2026-05-26 against BI-4B17051B under EP-INSTALL-HARDENING-2026-05-23. Chief architect + UX revision by Codex on 2026-05-27. Kernel decision via `mcp__dpf__principle_decide` (surface `spec-design-agent-toolchain-bootstrap-BI-4B17051B`, ringScope = ring-4-sandbox-prod + external-coordination + universal). Substrate verification used repo files, DPF MCP for epic context, and read-only DB fallback for the BI row. Mirrors the contributor-change-lanes spec body style (#1205) so reviewers have a familiar shape.
