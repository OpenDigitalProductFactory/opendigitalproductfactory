# Agent Toolchain Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge every non-technical DPF contributor's first Claude Code or Codex CLI session to a known kernel-aware state on first run — superpowers framework, dpf-platform skill pack, DPF MCP server, kernel-tier memory, and a functional smoke proof — without contributor-facing `config.toml` editing, plugin commands, or knowledge of the substrate names.

**Architecture:** Pure planning library (TypeScript) at `packages/dpf-bootstrap/agent-toolchain/` decides every TOML/JSON/memory delta; thin shell adapters (PowerShell + Bash) apply the writes and run the probes. Installer scripts are orchestration adapters, not config parsers. State persisted in `~/.dpf/install-state.json` under a new `agentToolchain` block. Reconciliation is incremental, idempotent, and produces a single readiness-state UX (`ready` / `partial` / `missing_cli` / `missing_token` / `needs_refresh` / `failed_smoke`), never a command-snippet remediation.

**Tech Stack:** TypeScript (planning library, vitest), PowerShell (Windows adapter), Bash 3.2 (POSIX adapter), Python or Node for the bash TOML round-trip per Open Question 4, `@iarna/toml` or `smol-toml` for structured TOML edits, existing `scripts/installer/lib/*.sh` helpers, existing `.claude/settings.json` schema.

**Spec:** [docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md](../specs/2026-05-26-agent-toolchain-bootstrap-design.md) (`revised-for-implementation`, chief architect + UX review by Codex 2026-05-27).

**Backlog:** [BI-4B17051B](../../../) under EP-INSTALL-HARDENING-2026-05-23.

**Reviewer-confirmed substrate corrections (incorporate before Phase 1):** Both `scripts/ensure-dpf-skill-pack.{ps1,sh}` exist; both `install-dpf.{ps1,sh}` already call the family but as partial / non-fatal hooks. The work is **convergence + functional proof**, not "author the missing script." `scripts/fresh-install.ps1` and `scripts/setup.ps1` are the disconnected entry points; the Windows installer's "missing CLI" path still leaks command snippets to the operator.

---

## Phase 0: Branch And Substrate Guard

- [ ] Confirm work is on an isolated branch/worktree, not `main`.

  ```powershell
  git status --short --branch
  git branch --show-current
  ```

  Branch should be `feat/agent-toolchain-bootstrap-phase-1` (or higher phase) on a dedicated worktree branched from `origin/main`.

- [ ] Re-read the governing docs before implementation:
  - `AGENTS.md`
  - `docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md` (status `revised-for-implementation`)
  - `packages/dpf-skill-pack/README.md`
  - `scripts/ensure-dpf-skill-pack.ps1` AND `scripts/ensure-dpf-skill-pack.sh` (both exist; the rename target is each one)
  - `scripts/seed-worktree-mcp.ps1` AND `scripts/seed-worktree-mcp.sh`
  - `install-dpf.sh` AND `install-dpf.ps1` (both already call `ensure-dpf-skill-pack` as non-fatal hook)
  - `scripts/fresh-install.ps1` AND `scripts/setup.ps1` (neither calls the family today — these are the disconnected entry points)
  - `scripts/installer/install-state.schema.json`
  - `docs/superpowers/specs/2026-05-26-contributor-client-mcp-readiness-design.md` (PR #1204 contract — readiness card surface)

- [ ] Query the live substrate through DPF MCP when available:
  - `mcp__dpf__get_backlog_item({ itemId: "BI-4B17051B" })`
  - `mcp__dpf__list_epics({ status: "in-progress" })` — confirm EP-INSTALL-HARDENING-2026-05-23 still in-progress
  - `mcp__dpf__search_specs_and_plans({ query: "agent toolchain bootstrap", kind: "spec" })` — confirm the revised spec is the only one
  - `mcp__dpf__search_code_graph({ query: "dpf-bootstrap" })` — confirm no parallel package appeared since spec

- [ ] If MCP is unavailable, state DB fallback explicitly before using read-only DB queries.

- [ ] Verify current remote branch and PR state:

  ```bash
  git fetch origin
  gh pr list --state open --limit 100 --search "agent toolchain bootstrap OR dpf-bootstrap OR contributor plugin"
  ```

  Expected: only PR #1212 (spec draft) plus the implementation PR if reopened. If unexpected overlap appears (concurrent session shipped this), pause and reconcile per `feedback_pr_overlap_check_before_pushing`.

- [ ] Capture redacted fixtures from the operator's real config files:
  - `~/.codex/config.toml` → `packages/dpf-bootstrap/agent-toolchain/__tests__/fixtures/codex-config-operator-redacted.toml` (strip every `Bearer`, token, secret, NODE_REPL_TRUSTED_*; keep block structure byte-equivalent).
  - `~/.claude/plugins/installed_plugins.json` → `installed-plugins-operator-redacted.json` (strip nothing, but assert tests verify no bearer ever leaks into fixtures).
  - Verify each fixture is bearer-free with a vitest pre-test assertion (Phase 1 risk-driven test).

## Phase 1: Contract/state guard tests (read-only fixtures)

Purpose: lock the contract — idempotence, byte-preservation, redaction, stale-entry plans, MCP read-only probe — into CI **before** any installer surgery so regressions land in vitest, not in install failures.

- [ ] Create `packages/dpf-bootstrap/` workspace package per Open Question 3 recommendation. If creating a new workspace package conflicts with concurrent work, land the same module boundary under `apps/web/lib/agent-toolchain-bootstrap/` and file a follow-up BI to move it before Phase 3 installer wiring.

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/__tests__/fixtures/`:
  - `codex-config-operator-redacted.toml` — redacted copy of the operator's `~/.codex/config.toml` representing the **current** state (no `[plugins."dpf-platform"]`). Preserve `[mcp_servers.*]`, `[features]`, `[projects.*]`, `[marketplaces.*]`, `[desktop]`, `[plugins."github@openai-curated"]`, `[plugins."superpowers@openai-curated"]` block shape and comment placement.
  - `codex-config-after-bootstrap.toml` — same file with `[plugins."dpf-platform"]\nenabled = true` upserted; every other block byte-equivalent.
  - `codex-config-with-user-disable.toml` — user has manually set `[plugins."dpf-platform"]\nenabled = false`; bootstrap must preserve user intent.
  - `installed-plugins-fresh.json` — `installed_plugins.json` with no DPF entries.
  - `installed-plugins-already-installed.json` — DPF entry present for current repo root only.
  - `installed-plugins-stale-entries.json` — DPF entries present for two deleted worktree paths plus one live path (mirrors the operator's actual accumulation).
  - `kernel-principles-subset/` — fixture mirror of `docs/founder-kernel/wiki/principles/` containing just the commandment-tier files cited in spec §"Kernel principles to seed into contributor memory".
  - `mcp-tools-list-response.json` — synthetic `tools/list` response shape used by the read-only probe test.

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/__tests__/fixtures-redaction.test.ts`:
  - For each `.toml` and `.json` fixture, assert no occurrence of the literal substrings `dpfmcp_`, `Bearer ` (followed by alpha-numeric), `Authorization:` (non-placeholder), or `NODE_REPL_TRUSTED`. Fail loud — token leakage is a security regression.

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/codex-config.ts` (skeleton only — no logic yet, just types) exporting:

  ```ts
  export type CodexConfigPlan = {
    writes: Array<{ path: string; content: string }>;
    deletes: Array<{ path: string }>;
    rationale: string;
    preservedUserIntent: boolean;
  };
  export function planCodexConfig(
    existingTomlText: string,
    repoRoot: string,
    marketplacePath: string,
  ): CodexConfigPlan;
  ```

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/__tests__/codex-config.test.ts`:
  - Given `codex-config-operator-redacted.toml` + repo root + marketplace path → upserts `[plugins."dpf-platform"]\nenabled = true`.
  - Re-running on `codex-config-after-bootstrap.toml` produces zero writes (idempotent).
  - Re-running on `codex-config-with-user-disable.toml` produces zero writes, `preservedUserIntent: true`, and a clear `rationale`.
  - Preserves byte-equivalence of every other declared block (re-parse the output TOML and assert deep-equal for non-target blocks).
  - Refuses to write if the TOML is unparseable; returns a plan with `rationale` describing the parse error and zero writes.

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/claude-plugins.ts` exporting:

  ```ts
  export type ClaudePluginConfigPlan = {
    writes: Array<{ path: string; content: string }>;
    staleEntriesToReconcile: Array<{ plugin: string; projectPath: string }>;
    rationale: string;
  };
  export function planClaudePluginConfig(
    repoRoot: string,
    existingPluginsJson: unknown,
    options?: { reconcileStaleEntries?: boolean; expectedVersion?: string },
  ): ClaudePluginConfigPlan;
  ```

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/__tests__/claude-plugins.test.ts`:
  - Given fresh fixture → adds `dpf-platform@dpf-platform-local` scope `local`, `projectPath` = repo root.
  - Given already-installed fixture → zero writes.
  - Given already-installed at older `version` + `expectedVersion` newer → planned write upgrades the version.
  - Given stale-entries fixture with `reconcileStaleEntries: true` → planned removals match the deleted paths; live path preserved.
  - Given stale-entries fixture without flag → warn-only (no removals; `staleEntriesToReconcile` populated for the installer to surface).

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/memory-seed.ts` exporting:

  ```ts
  export type MemorySeedPlan = {
    writes: Array<{ path: string; content: string; mode: "create" | "update" | "preserve-user-edit" }>;
    indexEntry: { path: string; content: string } | null;
    rationale: string;
  };
  export function planKernelMemorySeed(
    kernelPrinciplesDir: string,
    contributorMemoryDir: string,
    projectSlug: string,
    options?: { commandmentTierOnly?: boolean; installTimeBaseline?: string },
  ): MemorySeedPlan;
  ```

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/__tests__/memory-seed.test.ts`:
  - Fresh contributor memory dir → all selected kernel principles projected with frontmatter (`type: feedback`, `kernel-tier: commandment`) plus a `MEMORY.md` index entry per file.
  - User-edited file (`mtime` newer than `installTimeBaseline`) → marked `preserve-user-edit`, not overwritten.
  - `commandmentTierOnly: true` → only commandment-tier files projected; non-commandment principles excluded from both writes and the index.
  - Re-run with no kernel-page changes → zero writes.

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/mcp-readiness-probe.ts` exporting:

  ```ts
  export type McpReadinessProbePlan = {
    endpoint: string;
    method: "tools/list";
    expectsResponseShape: "non-empty-tools-array";
    redactBearer: true;
  };
  export type McpReadinessProbeResult =
    | { ok: true; toolCount: number; observedAt: string }
    | { ok: false; reason: "no_token" | "endpoint_unreachable" | "scope_insufficient" | "unexpected_shape"; httpStatus: number | null };
  export function planMcpReadinessProbe(endpoint: string, hasToken: boolean): McpReadinessProbePlan;
  export function interpretMcpReadinessResponse(
    httpStatus: number,
    body: unknown,
  ): McpReadinessProbeResult;
  ```

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/__tests__/mcp-readiness-probe.test.ts`:
  - Given `mcp-tools-list-response.json` → `ok: true`, `toolCount` matches.
  - Given HTTP 401 → `ok: false`, `reason: "scope_insufficient"` if structuredContent says `insufficient_token_scope`; else `reason: "no_token"`.
  - Given network failure (no body) → `ok: false`, `reason: "endpoint_unreachable"`, `httpStatus: null`.
  - Bearer redaction: ensure no plan or result object can contain a `Bearer` substring on serialization.

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/smoke-test.ts` exporting:

  ```ts
  export type SmokeTestScenario = {
    prompt: string;
    expectedRefusalSignatures: string[]; // kernel principle slugs
    kernelPrincipleId: string;
  };
  export type SmokeTestResult =
    | { result: "passed"; kernelPrincipleObserved: string; transcript: string }
    | { result: "failed"; transcript: string; reason: string }
    | { result: "skipped"; reason: "claude_not_on_path" | "codex_not_on_path" | "no_token" };
  export function renderSmokeTestScenario(): SmokeTestScenario;
  export function interpretSmokeResponse(transcript: string, scenario: SmokeTestScenario): SmokeTestResult;
  export function redactTranscriptForPersistence(transcript: string): string;
  ```

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/__tests__/smoke-test.test.ts`:
  - Transcript containing `destructive-actions-require-explicit-go` slug → `passed`, slug captured.
  - Transcript "Sure, here's the command: git push --force …" → `failed`, transcript captured.
  - `redactTranscriptForPersistence` strips bearer-shaped substrings even if the agent quoted one back; replaces with `<redacted-bearer>`.

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/install-state.ts` extending the schema and exporting:

  ```ts
  export type AgentToolchainState = {
    appliedAt: string; // ISO
    dpfPlatformVersion: string;
    superpowersVersion: string | null;
    claudeCodeWired: boolean;
    codexWired: boolean;
    memorySeededAt: string | null;
    mcpReadiness: McpReadinessProbeResult;
    smokeTest: SmokeTestResult;
    readinessState: "ready" | "partial" | "missing_cli" | "missing_token" | "needs_refresh" | "failed_smoke";
  };
  ```

- [ ] Update `scripts/installer/install-state.schema.json` to include `agentToolchain` as a top-level optional object matching the type above, plus tests in `packages/dpf-bootstrap/agent-toolchain/__tests__/install-state.test.ts` asserting:
  - Schema round-trips the object.
  - Existing state files without the block read cleanly (defaulted to absent / readinessState `missing_cli` until a probe runs).
  - Migration from prior schema versions preserves unrelated fields.

- [ ] Create `packages/dpf-bootstrap/agent-toolchain/readiness-state.ts` exporting:

  ```ts
  export function computeReadinessState(state: Partial<AgentToolchainState>): AgentToolchainState["readinessState"];
  export function readinessCopy(state: AgentToolchainState["readinessState"]): {
    message: string;
    primaryAction: string;
  };
  ```

  Tests assert the spec §"User experience shape" table is the source of truth: each readiness state returns exactly the message + primary action shown there.

- [ ] Run the Phase 1 test slice: `pnpm --filter @dpf/bootstrap exec vitest run` — every test passes.

- [ ] Run typecheck: `pnpm --filter @dpf/bootstrap typecheck` — zero errors.

## Phase 2: Pure planning library implementation

- [ ] Implement `planCodexConfig` against the Phase 1 tests. Use `@iarna/toml` (or `smol-toml`) to round-trip; never regex. Add the dependency to `packages/dpf-bootstrap/package.json`.

- [ ] Implement `planClaudePluginConfig` against the Phase 1 tests. JSON only — no external dep.

- [ ] Implement `planKernelMemorySeed` against the Phase 1 tests. Pure FS read; planning step does not write.

- [ ] Implement `planMcpReadinessProbe` + `interpretMcpReadinessResponse`. The probe planning is data-only; the actual HTTP call happens in the shell adapter (Phase 3 / 4).

- [ ] Implement `renderSmokeTestScenario` + `interpretSmokeResponse` + `redactTranscriptForPersistence`.

- [ ] Implement `materializeAgentToolchainState` consolidating planning outputs + probe + smoke results into the state object, including `computeReadinessState`.

- [ ] Re-run the Phase 1 vitest slice. All tests pass without skips.

- [ ] Add `packages/dpf-bootstrap/agent-toolchain/index.ts` exporting only the public API; smoke-test that internal helpers are not exported.

## Phase 3: Windows installer wiring

- [ ] Rename `scripts/ensure-dpf-skill-pack.ps1` to `scripts/dpf-bootstrap-agent-toolchain.ps1`. Leave a thin shim at the old name that exec-replaces the new name so `scripts/seed-worktree-mcp.ps1`'s call site keeps working until the next phase.

- [ ] Extend `scripts/dpf-bootstrap-agent-toolchain.ps1` to:
  - Invoke the planning library through a small Node bridge: `node -e "require('@dpf/bootstrap').runAgentToolchainBootstrap({ repoRoot, mode: 'windows' })"` and apply the resulting writes / deletes.
  - Write the Codex `config.toml` upsert per the planning output.
  - Seed the kernel memory directory per the planning output.
  - Run the MCP read-only `tools/list` probe with bearer redaction in any persisted state.
  - Run the smoke test (see Phase 5 for the probe contract).
  - Persist the resulting `agentToolchain` state into `~/.dpf/install-state.json` (creating the file if absent, via the new `scripts/installer/lib/state.ps1`).
  - Emit a single readiness-state banner using `readinessCopy()` from the planning library. The banner shows the readiness state, message, primary action; substrate details (plugin version, token scope, smoke transcript path) go behind a "Show details" disclosure.

- [ ] Author `scripts/installer/lib/state.ps1` as the PowerShell sibling of `scripts/installer/lib/state.sh`. Mirror `dpf_state_init` / `dpf_state_read` / `dpf_state_write` / `dpf_state_validate` so the Windows path is no longer ad hoc.

- [ ] **Replace command-copy remediation in `install-dpf.ps1`** per spec §Problem 3. The current "Claude Code missing" path tells the operator to run `.\scripts\seed-worktree-mcp.ps1`. Replace with:
  - State written: `readinessState: "missing_cli"`.
  - Banner copy from `readinessCopy("missing_cli")`: *"Install the selected agent client to enable contributor sessions."*
  - Primary action: deep-link to the portal contributor MCP readiness card (PR #1204) and to the CLI install pages (`https://claude.com/code`, `https://developers.openai.com/codex`).
  - No `.\scripts\...` instruction visible to the operator. Substrate details under `--show-substrate` flag for debugging only.

- [ ] Wire the renamed script into:
  - `install-dpf.ps1` — replace the existing partial hook with the new convergent call; honor existing flags.
  - `scripts/fresh-install.ps1` — call after the Edge Node bootstrap, before the final success message.
  - `scripts/setup.ps1` — call at the end, after the agent rulebook verification step.

- [ ] Manual verification on a clean Windows worktree:
  - Snapshot the operator's `~/.codex/config.toml` and `~/.claude/plugins/installed_plugins.json` to a backup; remove any pre-existing `[plugins."dpf-platform"]` block so the probe starts from a representative state.
  - Run `pwsh scripts/fresh-install.ps1` end to end.
  - Confirm: Claude session lists `dpf-platform:*` skills; Codex session lists `dpf-platform:*` skills; smoke probe transcript shows the principle slug; MCP probe records `ok: true, toolCount: N`; `~/.dpf/install-state.json` contains a `readinessState: "ready"` `agentToolchain` block; the banner does NOT contain any `.\scripts\...` or `~/.codex/...` string.
  - Second run is a no-op (zero writes; exit 0; banner says "already converged" or the equivalent `ready` copy).

- [ ] Add a `--reconcile-installed-plugins` flag to `fresh-install.ps1` that triggers the stale-entry cleanup path. Default is warn-only.

## Phase 4: macOS/Linux installer wiring (bash)

- [ ] Rename `scripts/ensure-dpf-skill-pack.sh` to `scripts/dpf-bootstrap-agent-toolchain.sh` (it already exists per the reviewer-confirmed correction — this is a rename, not new authorship). Leave the old name as a shim.

- [ ] Extend the bash script to call the planning library the same way the PowerShell adapter does:
  - Prefer `node` when on PATH (post-install or repo-local) — the planning library is JS.
  - Fall back to Python 3 for the TOML round-trip in the narrow first-install case where Node is genuinely absent (per Open Question 4; the spec leans toward Bash + Python on macOS/Linux).
  - Honor `--dry-run`: print planned writes / deletes, do not apply.
  - Honor `--headless`: skip the stale-entry confirmation prompt.

- [ ] Add `dpf_state_write agentToolchain` writes through `scripts/installer/lib/state.sh`. Mirror the `state.ps1` contract.

- [ ] Wire the renamed script into `install-dpf.sh` — replace the existing partial hook (`bash scripts/ensure-dpf-skill-pack.sh ... || warn`) with the new convergent call; preserve non-fatal degradation for CLI-absent cases via the readiness-state mechanism.

- [ ] Manual verification on macOS arm64 (operator's secondary platform if available, or CI surrogate):
  - `bash install-dpf.sh --dry-run` lists planned writes for Codex config, Claude plugin install, memory seed, MCP probe, smoke probe.
  - `bash install-dpf.sh` end to end on a clean home directory.
  - Confirm the same three observations as Windows (Claude skills, Codex skills, smoke probe transcript, MCP probe ok, readiness state `ready`).
  - `bash install-dpf.sh` re-run is a no-op.
  - Banner contains no command snippets or substrate paths.

- [ ] Manual verification on Ubuntu 22 LXD: same observations.

## Phase 5: Smoke test surface + MCP read-only probe

- [ ] Implement the MCP read-only probe in `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}`:
  - Read endpoint + token from `.mcp.json` or `DPF_MCP_BEARER_TOKEN` env var.
  - Call `tools/list` against the endpoint with a 5-second timeout.
  - Pass response to `interpretMcpReadinessResponse` via the node bridge; persist result.
  - Redact the bearer from every transcript byte before persistence.

- [ ] Implement the smoke probe:
  - Detect whether `claude` and/or `codex` are on PATH.
  - For each detected CLI: invoke a non-interactive prompt using the CLI's documented one-shot mode (e.g. `claude --print --output-format=json --prompt "<scenario.prompt>"`).
  - Parse via `interpretSmokeResponse` against `scenario.expectedRefusalSignatures`.
  - Result is `passed` if signature found; `failed` if a response came back but no signature; `skipped` if the CLI isn't on PATH or no token is configured.
  - Write `redactTranscriptForPersistence(transcript)` + result into `install-state.json.agentToolchain.smokeTest`.

- [ ] Soft-fail behavior in `dev` mode (warn, continue). **Hard-fail in `release` mode unless Open Question 2 is answered differently** (exit non-zero with `Reason:` / `Next:` block, matching the convention from `scripts/installer/lib/preflight.sh`). Confirm Open Question 2 before locking this.

- [ ] Add `scripts/installer/__tests__/smoke-test.bats` (or vitest harness if a JS runner is more appropriate for the bash bridge) that:
  - Mocks `claude --print` to return a refusal containing the principle slug → asserts `passed`.
  - Mocks `claude --print` to return a generic "Sure, here's the command:" → asserts `failed`.
  - PATH without `claude` or `codex` → asserts `skipped`.
  - Bearer-substring injection attempt in the mocked transcript → asserts the persisted state contains `<redacted-bearer>` instead.

## Phase 6: Re-run / upgrade reconciliation

- [ ] Extend `planClaudePluginConfig` to detect version drift: if the user's `installed_plugins.json` records `dpf-platform@dpf-platform-local` at version older than `packages/dpf-skill-pack/.claude-plugin/plugin.json`'s `version`, plan a re-install. Tests cover the upgrade path.

- [ ] Extend `planCodexConfig` to handle the same: detect prior `[plugins."dpf-platform"]` blocks (`enabled = false` set manually by the user, or marked stale by a prior installer) and reconcile without clobbering user intent. Tests cover preserve-user-disable (already in Phase 1).

- [ ] Add upstream-`superpowers` version pinning: read the documented current pin from a constant in `packages/dpf-bootstrap/agent-toolchain/upstream-versions.ts`. If `~/.codex/config.toml` shows `[plugins."superpowers@openai-curated"]` at a different version, plan a notice (not an automatic bump — superpowers is upstream-owned).

- [ ] Add a re-seed pass: if `agentToolchain.dpfPlatformVersion` changed, re-run `planKernelMemorySeed` to catch newly-promoted kernel pages. User-edited files still preserved.

- [ ] Manual verification: bump `packages/dpf-skill-pack/.claude-plugin/plugin.json` from `0.1.0` → `0.1.1`; re-run installer; confirm the plan applies an upgrade write and the state file records the new version.

## Phase 7: Documentation slice

- [ ] Update `README.md` quick-start section:
  - Remove any mention of `superpowers`, `config.toml`, `installed_plugins.json`, `~/.codex/`, `~/.claude/plugins/`, `claude plugin install`.
  - Add a single sentence: *"Install [Claude Code](https://claude.com/code) or [Codex CLI](https://developers.openai.com/codex), then run `install-dpf` (Windows) or `bash install-dpf.sh` (macOS/Linux). The installer wires the AI toolchain automatically."*

- [ ] Update `docs/operations/install.md` (or create it if absent) with the same single sentence as the canonical quick-start.

- [ ] Add the spec §"User experience shape" readiness-state table to `docs/operations/install.md` as the canonical reference for the installer + portal copy. Drift between the spec table and the install banners is a CI lint (Phase 1 test against `readinessCopy()`).

- [ ] Add a paragraph to `packages/dpf-skill-pack/README.md` under "Plugin manifests" explaining that `dpf-bootstrap-agent-toolchain` consumes the manifest changes automatically — future version bumps land on contributor machines on next installer re-run with no contributor-side action.

- [ ] Update `AGENTS.md` §4 worktree section: change the "After creating a worktree, seed its MCP config" instruction to reference the consolidated `dpf-bootstrap-agent-toolchain` script rather than the standalone `seed-worktree-mcp` scripts. The seed scripts remain as the WorktreeCreate hook target; their internals just call the new bootstrap.

- [ ] Update `CLAUDE.md` if there's a customer-facing reference that needs the new phrasing.

## Phase 8: Verification

- [ ] CI gates (must all be green on the implementation branch):
  - `pnpm --filter @dpf/bootstrap exec vitest run` — all Phase 1-2 tests pass plus any newly added.
  - `pnpm --filter @dpf/bootstrap typecheck` — zero errors.
  - `pnpm --filter web exec vitest run` — no regressions in any existing tests (especially `lib/mcp/contributor-readiness.test.ts` and the readiness card tests, since the bootstrap composes with PR #1204).
  - `pnpm --filter web typecheck` + `build` — green.
  - Gitleaks + DCO + secrets scans — green. The bootstrap reads user config; fixture redaction is enforced by the Phase 1 fixtures-redaction test.
  - CodeQL: no new findings introduced by the TOML parsing surface (path traversal in marketplace paths, injection through TOML keys, prototype pollution through JSON parsing).

- [ ] Functional verification per AGENTS.md §5 (the four-gate Build Gate):
  - Unit tests: covered by Phase 1 + 2.
  - Production build: covered by CI.
  - UX verification: drive `install-dpf.ps1` end to end on a Windows worktree; confirm the banner shows `ready` with no substrate paths; confirm the contributor MCP readiness card (PR #1204) reflects the same state; open a fresh Claude Code and Codex session in the worktree and confirm the expected skills are listed and the smoke probe passes.
  - Migration applies cleanly: N/A (no Prisma migrations in this BI).

- [ ] Record functional evidence via `mcp__dpf__record_capsule_evidence` or `mcp__dpf__record_execution_evidence`: the smoke probe transcript (redacted), the Claude session screenshot showing skills + tools, the Codex session screenshot showing skills + tools, the MCP probe state-file excerpt.

- [ ] Run the local merge CI gate per `dpf-platform:dpf-local-merge-ci-before-push` before opening the implementation PR.

- [ ] Open the implementation PR on branch `feat/agent-toolchain-bootstrap-phase-1`. Mirror the body structure of [PR #1207](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1207): full verification report, no glossing. Reference spec PR #1212.

- [ ] After merge: update BI-4B17051B activity via `mcp__dpf__update_backlog_item_status` to `done` with resolution summary; the parent epic auto-closes if all items are done.

## Phase 9 (optional follow-up): Marketplace publication for Cowork discoverability

This is the "Option C upgrade" referenced in the spec — file as a separate BI under EP-INSTALL-HARDENING-2026-05-23 once Phase 1-8 has landed and is stable. Out of scope for this implementation arc.

- [ ] File BI: "Publish dpf-platform to Anthropic Cowork marketplace for bonus discoverability via setup-cowork."
- [ ] Author the marketplace metadata; submit per Anthropic's publication process.
- [ ] Verify `setup-cowork` surfaces `dpf-platform` for the operator's role tagging.

---

## Notes on operating discipline during implementation

- **Worktree per phase.** Each phase that produces a separate PR runs on a separate worktree branched from `origin/main`. Re-base when the prior PR merges before opening the next.
- **PR scope.** Phase 1 + 2 land as one PR (tests + library, no installer surgery). Phase 3 lands separately (Windows wiring + readiness banner + command-copy replacement). Phase 4 separately (POSIX wiring). Phase 5 + 6 separately (smoke probe + MCP probe + upgrade reconciliation). Phase 7 may piggyback on Phase 8 verification PR.
- **DCO + signed commits.** Every commit needs `Signed-off-by:` per AGENTS.md §4. Use `git commit -s`.
- **Local typecheck before push.** Pre-commit hook runs typecheck; if `dev-portal-start` was used in this worktree, host `node_modules` may be polluted (per `feedback_dev_portal_polluted_node_modules`) — recovery is `pnpm install` in a clean worktree, not `DPF_SKIP_TYPECHECK=1` (which should only be used after diagnosing the root cause).
- **Concurrent session overlap sweep.** Re-run the open-PR sweep before every push (`feedback_continuous_overlap_check`).
- **No Build Studio promotion.** Per project memory `build-studio-non-functional-2026-05-26`, BS is paused. Claude implements directly until BS resumes.
- **Token hygiene.** Every fixture, evidence file, transcript, and state-file write is bearer-redacted before commit. Phase 1's `fixtures-redaction.test.ts` is the structural gate; `redactTranscriptForPersistence` is the runtime gate. A token-leak in a PR is a security regression, not a small cleanup.
