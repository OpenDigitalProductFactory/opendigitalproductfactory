# Agent Toolchain Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every non-technical DPF contributor's first Claude Code or Codex CLI session kernel-aware on first run — superpowers framework, dpf-platform skill pack, DPF MCP server, kernel-tier memory — without contributor-facing `config.toml` editing, plugin commands, or knowledge of the substrate names. Covers Windows + macOS/Linux, both clients, idempotent re-run, with an end-of-install smoke test.

**Architecture:** Wire existing substrate (skill pack at `packages/dpf-skill-pack/`, repo-root marketplaces, project Claude settings) into the existing install paths (`scripts/fresh-install.ps1`, `scripts/setup.ps1`, `install-dpf.sh`, `install-dpf.ps1`) through a pure planning library plus thin platform-shell adapters. Add Codex CLI plugin wiring (TOML upsert), kernel-memory seeding, and a smoke probe. State tracked in `~/.dpf/install-state.json` under a new `agentToolchain` object. No new substrate concept; gap-filling only.

**Tech Stack:** TypeScript (planning library, vitest), PowerShell (Windows adapter), Bash 3.2 (POSIX adapter), Python or Node (TOML round-trip per Open Question 4), `@iarna/toml` or equivalent, existing `scripts/installer/lib/*.sh` helpers, existing `.claude/settings.json` schema.

**Spec:** [docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md](../specs/2026-05-26-agent-toolchain-bootstrap-design.md)

**Backlog:** [BI-4B17051B](../../../) under EP-INSTALL-HARDENING-2026-05-23

---

## Phase 0: Branch And Substrate Guard

- [ ] Confirm work is on an isolated branch/worktree, not `main`.

  ```powershell
  git status --short --branch
  git branch --show-current
  ```

  Branch should be `feat/agent-toolchain-bootstrap-phase-1` (or higher phase) on a dedicated worktree.

- [ ] Re-read the governing docs before implementation:
  - `AGENTS.md`
  - `docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md`
  - `packages/dpf-skill-pack/README.md`
  - `scripts/ensure-dpf-skill-pack.ps1`
  - `scripts/seed-worktree-mcp.ps1`
  - `scripts/seed-worktree-mcp.sh`
  - `install-dpf.sh`
  - `scripts/installer/install-state.schema.json`
  - `docs/superpowers/specs/2026-05-26-contributor-client-mcp-readiness-design.md` (PR #1204 contract)

- [ ] Query the live substrate through DPF MCP when available:
  - `mcp__dpf__get_backlog_item({ itemId: "BI-4B17051B" })`
  - `mcp__dpf__list_epics({ status: "in-progress" })` — confirm EP-INSTALL-HARDENING-2026-05-23 still in-progress
  - `mcp__dpf__search_specs_and_plans({ query: "agent toolchain bootstrap", kind: "spec" })` — confirm spec is the only one
  - `mcp__dpf__search_code_graph({ query: "dpf-skill-pack" })` — confirm no parallel install path appeared since spec

- [ ] If MCP is unavailable, state DB fallback explicitly before using read-only DB queries.

- [ ] Verify current remote branch and PR state:

  ```bash
  git fetch origin
  gh pr list --state open --limit 100 --search "agent toolchain bootstrap OR dpf-bootstrap OR contributor plugin"
  ```

  Expected: zero overlapping PRs. If overlap appears (concurrent session shipped this), pause and reconcile per `feedback_pr_overlap_check_before_pushing`.

- [ ] Read the operator's `~/.codex/config.toml` and `~/.claude/plugins/installed_plugins.json` and copy redacted fixtures into `apps/web/lib/agent-toolchain-bootstrap/__tests__/fixtures/` so the Phase 1 tests cover the operator's real shape.

## Phase 1: Substrate guard tests (read-only fixtures)

Purpose: lock the contract into CI before any installer surgery so regressions land in vitest, not in install failures.

- [ ] Create `apps/web/lib/agent-toolchain-bootstrap/__tests__/fixtures/` with:
  - `codex-config-operator.toml` — redacted copy of the operator's `~/.codex/config.toml` representing the *current* state (no `[plugins."dpf-platform"]`).
  - `codex-config-after-bootstrap.toml` — same file with `[plugins."dpf-platform"]\nenabled = true` upserted; every other block byte-equivalent.
  - `installed-plugins-fresh.json` — `installed_plugins.json` with no DPF entries.
  - `installed-plugins-already-installed.json` — DPF entry present for current repo root.
  - `installed-plugins-stale-entries.json` — DPF entries present for two deleted worktree paths plus one live path.
  - `kernel-principles-subset/` — a small fixture mirror of the kernel principles dir.

- [ ] Create `apps/web/lib/agent-toolchain-bootstrap/codex-config.ts` (skeleton only — no logic yet, just types) exporting:

  ```ts
  export type CodexConfigPlan = {
    writes: Array<{ path: string; content: string }>;
    deletes: Array<{ path: string }>;
    rationale: string;
  };
  export function planCodexConfig(
    existingTomlText: string,
    repoRoot: string,
    marketplacePath: string,
  ): CodexConfigPlan;
  ```

- [ ] Create `apps/web/lib/agent-toolchain-bootstrap/__tests__/codex-config.test.ts`:
  - Given operator fixture + repo root + marketplace path → upserts `[plugins."dpf-platform"]\nenabled = true`.
  - Re-running on `codex-config-after-bootstrap.toml` produces zero writes (idempotent).
  - Preserves byte-equivalence of `[mcp_servers.dpf]`, `[features]`, `[projects.*]`, `[marketplaces.*]`, `[desktop]`, `[plugins."github@openai-curated"]`, `[plugins."superpowers@openai-curated"]`, every other declared block.
  - Refuses to write if the TOML is unparseable; returns a plan with `rationale` describing the parse error and zero writes.

- [ ] Create `apps/web/lib/agent-toolchain-bootstrap/claude-plugins.ts` exporting:

  ```ts
  export type ClaudePluginConfigPlan = {
    writes: Array<{ path: string; content: string }>;
    staleEntriesToReconcile: Array<{ plugin: string; projectPath: string }>;
    rationale: string;
  };
  export function planClaudePluginConfig(
    repoRoot: string,
    existingPluginsJson: unknown,
    options?: { reconcileStaleEntries?: boolean },
  ): ClaudePluginConfigPlan;
  ```

- [ ] Create `apps/web/lib/agent-toolchain-bootstrap/__tests__/claude-plugins.test.ts`:
  - Given fresh fixture → adds `dpf-platform@dpf-platform-local` scope `local`, `projectPath` = repo root.
  - Given already-installed fixture → zero writes.
  - Given stale-entries fixture with `reconcileStaleEntries: true` → planned removals match the deleted paths; live path preserved.
  - Given stale-entries fixture without flag → warn-only (no removals, but `staleEntriesToReconcile` populated for the installer to surface).

- [ ] Create `apps/web/lib/agent-toolchain-bootstrap/memory-seed.ts` exporting:

  ```ts
  export type MemorySeedPlan = {
    writes: Array<{ path: string; content: string; mode: "create" | "update" | "preserve-user-edit" }>;
    rationale: string;
  };
  export function planKernelMemorySeed(
    kernelPrinciplesDir: string,
    contributorMemoryDir: string,
    projectSlug: string,
    options?: { commandmentTierOnly?: boolean },
  ): MemorySeedPlan;
  ```

- [ ] Create `apps/web/lib/agent-toolchain-bootstrap/__tests__/memory-seed.test.ts`:
  - Fresh contributor memory dir → all selected kernel principles projected with frontmatter (`type: feedback` / `kernel-tier: commandment`) and a `MEMORY.md` index entry per file.
  - User-edited file (`mtime` newer than expected install-time) → marked `preserve-user-edit`, not overwritten.
  - `commandmentTierOnly: true` → only commandment-tier files projected.

- [ ] Create `apps/web/lib/agent-toolchain-bootstrap/install-state.ts` extending the schema and exporting:

  ```ts
  export type AgentToolchainState = {
    appliedAt: string; // ISO
    dpfPlatformVersion: string;
    superpowersVersion: string | null;
    claudeCodeWired: boolean;
    codexWired: boolean;
    memorySeededAt: string | null;
    smokeTest: {
      result: "passed" | "failed" | "skipped";
      kernelPrincipleObserved: string | null;
      transcript: string | null;
    };
  };
  ```

- [ ] Update `scripts/installer/install-state.schema.json` to include `agentToolchain` as a top-level optional object matching the type above, plus tests in `apps/web/lib/agent-toolchain-bootstrap/__tests__/install-state.test.ts` asserting:
  - Schema round-trips the object.
  - Existing state files without the block read cleanly (defaulted).
  - Migration from prior schema versions preserves unrelated fields.

- [ ] Run the Phase 1 test slice: `pnpm --filter web exec vitest run lib/agent-toolchain-bootstrap` — every test passes.

- [ ] Run the typecheck: `pnpm --filter web typecheck` — zero errors.

## Phase 2: Pure planning library implementation

- [ ] Implement `planCodexConfig` against the Phase 1 tests. Use a TOML library (`@iarna/toml` or `smol-toml`) to round-trip; never regex. Add the dependency to `apps/web/package.json`.

- [ ] Implement `planClaudePluginConfig` against the Phase 1 tests. JSON-only — no external dep.

- [ ] Implement `planKernelMemorySeed` against the Phase 1 tests. Pure FS read; planning step does not write.

- [ ] Implement `renderSmokeTestScenario` in `apps/web/lib/agent-toolchain-bootstrap/smoke-test.ts`:

  ```ts
  export type SmokeTestScenario = {
    prompt: string;
    expectedRefusalSignatures: string[]; // kernel principle slugs
    kernelPrincipleId: string;
  };
  export function renderSmokeTestScenario(): SmokeTestScenario;
  ```

  Initial scenario: prompt asks the agent to run a destructive git command without explicit operator approval; expected refusal signature includes `destructive-actions-require-explicit-go` (commandment tier).

- [ ] Implement `materializeAgentToolchainState` consolidating the planning outputs into the state object.

- [ ] Re-run the Phase 1 vitest slice. All tests pass without skips.

## Phase 3: Windows installer wiring

- [ ] Rename `scripts/ensure-dpf-skill-pack.ps1` to `scripts/dpf-bootstrap-agent-toolchain.ps1`. Keep a thin shim at the old name that exec-replaces with the new name (so `scripts/seed-worktree-mcp.ps1`'s call site keeps working until the next phase).

- [ ] Extend `scripts/dpf-bootstrap-agent-toolchain.ps1` to:
  - Invoke the planning library through a small Node bridge: `node -e "require('@dpf/db').dpfBootstrap.runWindows({ repoRoot })"` (or a similarly named entry point) and apply the resulting writes / deletes.
  - Write the Codex `config.toml` upsert per the planning output.
  - Seed the kernel memory directory per the planning output.
  - Run the smoke test (see Phase 5 for the probe contract).
  - Persist the resulting `agentToolchain` state into `~/.dpf/install-state.json` (creating the file if absent, via the existing PowerShell state helpers added in this phase).

- [ ] Add a PowerShell wrapper around `dpf-state-read` / `dpf-state-write` in a new `scripts/installer/lib/state.ps1`, mirroring the Bash version. (The current installer is split — Windows uses inline PS, POSIX uses `scripts/installer/lib/state.sh`. This phase consolidates the contract.)

- [ ] Wire the new script into:
  - `scripts/fresh-install.ps1` — call after the Edge Node bootstrap, before the final success message. Inherit `-Headless` / `-SkipDocker` flag semantics where applicable.
  - `scripts/setup.ps1` — call at the end, after the agent rulebook verification step.

- [ ] Update the success banner in both scripts to surface:
  - Whether Claude Code plugin install succeeded.
  - Whether Codex CLI plugin entry was wired.
  - Smoke test result + the kernel principle that fired.
  - The contributor MCP readiness card URL (PR #1204) for the operator to check token scope.

- [ ] Manual verification on a clean Windows worktree:
  - Delete the operator's `~/.codex/config.toml` `[plugins."dpf-platform"]` block (if it's present from prior testing) so the smoke probe starts from a representative state.
  - Run `pwsh scripts/fresh-install.ps1` end to end.
  - Confirm: Claude session lists `dpf-platform:*` skills; Codex session lists `dpf-platform:*` skills; smoke probe transcript shows the principle name; `~/.dpf/install-state.json` contains the `agentToolchain` block.
  - Second run is a no-op (zero writes; exit 0; banner says "already converged").

- [ ] Add a `--reconcile-installed-plugins` flag to `fresh-install.ps1` that triggers the stale-entry cleanup path. Default is warn-only.

## Phase 4: macOS/Linux installer wiring (bash)

- [ ] Author `scripts/dpf-bootstrap-agent-toolchain.sh` as the bash sibling. Calls the same planning library through Node if available; falls back to inline Python for the TOML upsert when Node is not on PATH (Python 3 is universal on macOS and supported Linux distros per `scripts/installer/lib/preflight.sh`).

- [ ] Add `scripts/ensure-dpf-skill-pack.sh` as a backward-compat shim that execs the new script.

- [ ] Wire the new script into `install-dpf.sh`:
  - Source order: after `autostart.sh` is called and before the final success message.
  - Honor `--dry-run`: print planned writes / deletes, do not apply.
  - Honor `--headless`: skip the stale-entry confirmation prompt.

- [ ] Add `dpf_state_write agentToolchain` writes through `scripts/installer/lib/state.sh` mirroring the PowerShell `state.ps1` contract.

- [ ] Manual verification on macOS arm64 (operator's secondary platform if available, or CI surrogate):
  - `bash install-dpf.sh --dry-run` lists planned writes for Codex config, Claude plugin install, memory seed, smoke probe.
  - `bash install-dpf.sh` end to end on a clean home directory.
  - Confirm the same three observations as Windows (Claude skills, Codex skills, smoke probe transcript).
  - `bash install-dpf.sh` re-run is a no-op.

- [ ] Manual verification on Ubuntu 22 LXD: same set of observations.

## Phase 5: Smoke test surface

- [ ] Implement the smoke probe in `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}`:
  - Detect whether `claude` and/or `codex` are on PATH.
  - For each detected CLI: invoke a non-interactive prompt using the CLI's documented one-shot mode (e.g. `claude --print --output-format=json --prompt "<scenario.prompt>"`).
  - Parse the response for the kernel principle slug listed in `scenario.expectedRefusalSignatures`.
  - Result is `passed` if signature found; `failed` if a response came back but no signature; `skipped` if the CLI isn't on PATH.
  - Write transcript + result into `install-state.json.agentToolchain.smokeTest`.

- [ ] Soft-fail behavior in `dev` mode (warn, continue). Hard-fail in `release` mode (exit non-zero with `Reason:` / `Next:` block, matching the convention from `scripts/installer/lib/preflight.sh`). Confirm Open Question 2 before locking this.

- [ ] Add a `scripts/installer/lib/__tests__/smoke-test.bats` (or vitest equivalent) test that:
  - Mocks `claude --print` to return a refusal containing the principle slug → asserts `passed`.
  - Mocks `claude --print` to return a generic "Sure, here's the command:" → asserts `failed`.
  - PATH without `claude` or `codex` → asserts `skipped`.

## Phase 6: Re-run / upgrade reconciliation

- [ ] Extend `planClaudePluginConfig` to detect version drift: if the user's `installed_plugins.json` records `dpf-platform@dpf-platform-local` at version older than `packages/dpf-skill-pack/.claude-plugin/plugin.json`'s `version`, plan a re-install. Tests cover the upgrade path.

- [ ] Extend `planCodexConfig` to handle the same: detect prior `[plugins."dpf-platform"]` blocks (`disabled = true` set manually by the user, or marked stale by a prior installer) and reconcile without clobbering user intent. Tests cover preserve-user-disable.

- [ ] Add upstream-`superpowers` version pinning: read the documented current pin from a constant in `apps/web/lib/agent-toolchain-bootstrap/upstream-versions.ts`. If `~/.codex/config.toml` shows `[plugins."superpowers@openai-curated"]` at a different version, plan a notice (not an automatic bump — superpowers is upstream-owned).

- [ ] Add a re-seed pass: if `agentToolchain.dpfPlatformVersion` changed, re-run `planKernelMemorySeed` to catch newly-promoted kernel pages. User-edited files still preserved.

- [ ] Manual verification: bump `packages/dpf-skill-pack/.claude-plugin/plugin.json` from `0.1.0` → `0.1.1`; re-run installer; confirm the plan applies an upgrade write and the state file records the new version.

## Phase 7: Documentation slice

- [ ] Update `README.md` quick-start section:
  - Remove any mention of `superpowers`, `config.toml`, `installed_plugins.json`, `~/.codex/`, `~/.claude/plugins/`, `claude plugin install`.
  - Add a single sentence: *"Install [Claude Code](https://claude.com/code) or [Codex CLI](https://developers.openai.com/codex), then run `install-dpf` (Windows) or `bash install-dpf.sh` (macOS/Linux). The installer wires the AI toolchain automatically."*

- [ ] Update `docs/operations/install.md` (or create it if absent) with the same single sentence as the canonical quick-start.

- [ ] Add a paragraph to `packages/dpf-skill-pack/README.md` under "Plugin manifests" explaining that `dpf-bootstrap-agent-toolchain` consumes the manifest changes automatically — future version bumps land on contributor machines on next installer re-run with no contributor-side action.

- [ ] Update `AGENTS.md` §4 worktree section: change the "After creating a worktree, seed its MCP config" instruction to reference the consolidated `dpf-bootstrap-agent-toolchain` script rather than the standalone `seed-worktree-mcp` scripts. (The seed scripts remain as the WorktreeCreate hook target; their internals just call the new bootstrap.)

- [ ] Update `CLAUDE.md` if there's a customer-facing reference that needs the new phrasing.

## Phase 8: Verification

- [ ] CI gates (must all be green on the implementation branch):
  - `pnpm --filter web exec vitest run` — all Phase 1-2 tests pass plus any newly added.
  - `pnpm --filter web typecheck` — zero errors.
  - `pnpm --filter web build` — production build green.
  - Gitleaks + DCO + secrets scans — green.
  - No new CodeQL findings introduced by the agent-toolchain code (TOML parsing is the new attack surface — verify it doesn't allow path traversal in marketplace paths or injection through TOML keys).

- [ ] Functional verification per AGENTS.md §5 (the four-gate Build Gate):
  - Unit tests: covered by Phase 1 + 2.
  - Production build: covered by CI.
  - UX verification: run the bootstrap script end-to-end on a Windows worktree; confirm Claude Code and Codex CLI sessions opened in the worktree list the expected skills and pass the smoke probe.
  - Migration applies cleanly: N/A (no Prisma migrations in this BI).

- [ ] Record functional evidence via `mcp__dpf__record_capsule_evidence` or `mcp__dpf__record_execution_evidence`: the smoke probe transcript, the Claude session screenshot showing skills + tools, the Codex session screenshot showing skills + tools.

- [ ] Run the local merge CI gate per `dpf-platform:dpf-local-merge-ci-before-push` before opening the implementation PR.

- [ ] Open the implementation PR on branch `feat/agent-toolchain-bootstrap-phase-1`. Mirror the body structure of [PR #1207](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1207): full verification report, no glossing.

- [ ] After merge: update BI-4B17051B activity via `mcp__dpf__update_backlog_item_status` to `done` with resolution summary; the parent epic auto-closes if all items are done.

## Phase 9 (optional follow-up): Marketplace publication for Cowork discoverability

This is the "Option C upgrade" referenced in the spec — file as a separate BI under EP-INSTALL-HARDENING-2026-05-23 once Phase 1-8 has landed and is stable. Out of scope for this implementation arc.

- [ ] File BI: "Publish dpf-platform to Anthropic Cowork marketplace for bonus discoverability via setup-cowork."
- [ ] Author the marketplace metadata; submit per Anthropic's publication process.
- [ ] Verify `setup-cowork` surfaces `dpf-platform` for the operator's role tagging.

---

## Notes on operating discipline during implementation

- **Worktree per phase.** Each phase that produces a separate PR runs on a separate worktree branched from `origin/main`. Re-base when the prior PR merges before opening the next.
- **PR scope.** Phase 1 + 2 land as one PR (test + library, no installer surgery). Phase 3 lands separately (Windows wiring + smoke probe stub). Phase 4 separately (POSIX wiring). Phase 5 + 6 separately (smoke + upgrade). Phase 7 may piggyback on Phase 8 verification PR.
- **DCO + signed commits.** Every commit needs `Signed-off-by:` per AGENTS.md §4. Use `git commit -s`.
- **Local typecheck before push.** Pre-commit hook runs typecheck; if `dev-portal-start` was used in this worktree, host `node_modules` may be polluted (per `feedback_dev_portal_polluted_node_modules`) — recovery is `pnpm install` in a clean worktree, not `DPF_SKIP_TYPECHECK=1` (which should only be used after diagnosing the root cause).
- **Concurrent session overlap sweep.** Re-run the open-PR sweep before every push (`feedback_continuous_overlap_check`).
- **No Build Studio promotion.** Per project memory `build-studio-non-functional-2026-05-26`, BS is paused. Claude implements directly.
