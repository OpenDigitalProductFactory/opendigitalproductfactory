# Coworker Execution Adapter Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make execution adapter (HTTP, Claude Code CLI, Codex CLI, Codex-as-MCP) a first-class routing dimension with capability negotiation, per-thread CLI session lifecycle, normalized harness events, and shadow/race execution modes — so the coworker panel surfaces harness-native features safely.

**Architecture:** Eight phases (A–H) extending the existing routing layer. Adapter registry already exists ([execution-adapter-registry.ts](apps/web/lib/routing/execution-adapter-registry.ts)) with `claude-cli` and `codex-cli` registered. Plan adds capability profiles, telemetry, per-thread CLI sessions, normalized event taxonomy, and shadow/race modes on top of that foundation. Phase H (refactor budget, ~20% of effort) threads through every preceding phase.

**Tech Stack:** TypeScript, Next.js (apps/web), Prisma + PostgreSQL, Vitest, React (panel UI), docker exec into sandbox containers, Claude Code CLI, Codex CLI 0.125.0+, MCP stdio.

**Reference docs:**
- Spec: [docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md)
- Audit: [docs/superpowers/audits/2026-04-29-cli-substrate-status-review.md](docs/superpowers/audits/2026-04-29-cli-substrate-status-review.md)
- Codex JSONL evidence: [docs/superpowers/audits/evidence/2026-04-29-codex-cli-jsonl-probe.md](docs/superpowers/audits/evidence/2026-04-29-codex-cli-jsonl-probe.md)
- Hard dependency (receipts): [docs/superpowers/specs/2026-04-27-artifact-provenance-receipts-design.md](docs/superpowers/specs/2026-04-27-artifact-provenance-receipts-design.md)

---

## Reality check vs spec (2026-05-16 reconciliation)

This plan was first authored 2026-04-29. On 2026-05-16 it was reconciled against `origin/main` (267 commits ahead of the original branch base). Reconciliation note: [docs/superpowers/audits/2026-05-16-substrate-spec-reconciliation.md](docs/superpowers/audits/2026-05-16-substrate-spec-reconciliation.md). Implementers must know the following:

1. **`apps/web/lib/ai-inference.ts` is a 2-line re-export.** The real file is [apps/web/lib/inference/ai-inference.ts](apps/web/lib/inference/ai-inference.ts). Spec references resolve there.
2. **`codex-cli-adapter.ts` already exists** at [apps/web/lib/routing/codex-cli-adapter.ts](apps/web/lib/routing/codex-cli-adapter.ts) (360 lines). Phase B is **extension**, not creation. It already shells out to `docker exec ... codex exec`, but does not parse `--json` output.
3. **`executionAdapter` is a string field on `RoutedExecutionPlan` populated by [apps/web/lib/routing/execution-plan.ts:70-83](apps/web/lib/routing/execution-plan.ts#L70).** Phase A6 extends this to `string | ExecutionAdapterSelector` and adds the optional `capabilityRequirements` field. The `isCliAdapter` short-circuit at [ai-inference.ts:353-360](apps/web/lib/inference/ai-inference.ts#L353) is what Phase A6 replaces with `parseExecutionAdapterSelector` + `resolveExecutionAdapter`.
4. **`AgentThread`** has no `cliSession*` columns on main; Phase A3 adds them via migration `20260516120200_add_agent_thread_cli_session`.
5. **Receipts substrate (`ToolExecutionReceipt`) is shipped on main** as of 2026-04-30 (migration `20260430023000_artifact_provenance_receipts_slice_1`). Phase B6 can mint `ToolExecutionReceipt` rows directly; no fallback needed.
6. **PR #520 (merged 2026-05-13) extended `cli-adapter.ts` to mount platform tools via `--mcp-config`** when an `mcpSession` token is present. Phase A6 preserves that path; the new `isCliAdapter` resolver derives the boolean from the structured selector kind and does not interfere with the MCP mount.
7. **PR #607 (merged 2026-05-15) added `RouteDecisionLog.actorKind`/`actorId`/`agentId` + `RouteOutcome.agentId` attribution columns.** Phase A7 telemetry writes follow that convention by populating `AdapterRunTelemetry.agentId` from the same attribution context.
8. **PR #623/#629 (merged 2026-05-15/16) added skill telemetry** (`SkillUsageEvent`, `ToolExecution.skillId`, `AgentSkillAttributionChip`, `/platform/ai/skills` Telemetry tab). Phase A7 populates `AdapterRunTelemetry.skillId` from the same active-skill context so adapter telemetry joins cleanly to skill telemetry.
9. **PR #602 (merged 2026-05-14) introduced `WorkCapsule` + `WorkCapsuleActivity`** with sandbox lease lifecycle (`leaseExpiresAt`, sweeper). Phase C wires `CliSessionService.claim()` to consume an existing `WorkCapsule` lease rather than allocate its own sandbox slot. See spec §9.0 boundary statement.
10. **PR #608 (merged 2026-05-15) added `overloaded` error classification** for Claude 529 / HTTP + CLI stderr. Phase B (Codex normalizer) mirrors this error taxonomy for parity.
11. **Operations Map ([2026-05-10 spec](docs/superpowers/specs/2026-05-10-ai-coworker-visual-control-surface-design.md)) consumes this spec's `NormalizedEvent` shape**, does not replace Phase E. Many-coworker schematic vs one-thread cockpit are complementary surfaces.

Phase A is sized for one PR (`A1–A8`). Phases B onward ship as separate PRs.

---

## DPF-specific operational rules (READ BEFORE COMMITTING)

These apply to **every** task in this plan:

1. **DCO sign-off required.** Every commit uses `git commit -s`. The DCO app rejects unsigned commits.
2. **`git commit --only` with positional paths.** Concurrent Claude sessions may run in parallel worktrees and stage files in shared branches. Always commit only the files you wrote, by explicit path. Never `git add -A` or `git add .`.
3. **Worktree cwd:** `d:\DPF-coworker-assess` — branch `feat/coworker-c-status-and-a2a-sequencing`. Do NOT commit into `d:\DPF` (main worktree).
4. **Never wipe DB for code fixes.** When schema changes during development, use `pnpm prisma migrate dev` against the dev DB. Never `docker volume rm` against `dpf-postgres` — credentials and seed live there. If Prisma client generation drift, the pre-commit hook auto-regens (see commit `2f352bbf`).
5. **Pre-commit only runs typecheck.** vitest must run locally before push. Pre-push hook will reject if tests fail. Always run `pnpm test --filter @dpf/web -- --run path/to/your.test.ts` before committing, and `pnpm test --filter @dpf/web -- --run` (no path) before push.
6. **No mass bash on session start.** Do not auto-run `pnpm install`, `pnpm build`, `docker compose up`, or any heavy infra command without explicit go-ahead in the task.
7. **Docker changes need explicit approval.** Tasks touching `docker-compose*.yml` or `Dockerfile*` must list the change and wait for human go before applying.
8. **Update tests/docs alongside code.** Every code change includes test + doc update in the same commit.

---

## Phase A status (2026-05-16)

Phase A is being shipped in this PR. Status of each task:

| Task | Status | Commit (on branch `feat/coworker-c-status-and-a2a-sequencing`) |
| --- | --- | --- |
| A1 — `AdapterCapabilityProfile` model | **shipped** | `146ad988` |
| A2 — `AdapterRunTelemetry` model (incl. `agentId` + `skillId` per PR #607/#623 conventions) | **shipped** | `e2e6f970` |
| A3 — `AgentThread.cliSession*` columns + index | **shipped** | `9c19ebf1` |
| A4 — `ExecutionAdapterSelector` + capability requirement types | **shipped** | `73480c15` |
| A5 — capability probes + DB-backed cache | **shipped** | `2b15f68e` |
| A6 — resolver + call-site swap (preserves PR #520 mcpSession plumbing; legacy-string passthrough for non-structured kinds) | **shipped** | `d9e01710` |
| A7 — wire telemetry write at end of every coworker run | in this PR | (forthcoming commit) |
| A8 — Phase A integration verification | in this PR | (forthcoming commit) |

Phases B–H remain as separate PRs and follow the task descriptions below.

## Phasing summary

| Phase | Goal | PR-sized? | Depends on |
| --- | --- | --- | --- |
| **A** | Capability profile + telemetry tables; replace hard-coded CLI check with structured selector | Yes (single session) | None |
| **B** | Codex CLI `--json` parsing + event normalizer + ToolExecution minting + MCP-`--json` refusal guard | Yes | A |
| **C** | `CliSessionService` + per-thread session lifecycle + sandbox affinity + sweeper | Yes | A |
| **D** | Claude CLI normalizer parity (thinking, todos, subagents, hooks) | Yes | B (taxonomy reuse) |
| **E** | Coworker panel cockpit UI (zones, health LED, trace tab, role-gated disclosure) | Larger; split if needed | D |
| **F** | Shadow execution mode + budget controls + nightly outcome scoring | Yes | A |
| **G** | Race execution mode + quota-pool spreading | Yes | F |
| **H** | Refactor allocation (interface extraction, panel state separation, ledger consolidation) | Threaded through every phase | — |

---

## Phase A: Capability profile + telemetry foundation

**Spec acceptance:** "every existing coworker run works identically, but the route plan now carries a structured `executionAdapter` field and writes a telemetry row." (spec §12 Phase A)

This phase is sized for one implementation session. Goal is zero behavior change in production paths plus two new DB tables and structured adapter resolution.

### Task A1: Add `AdapterCapabilityProfile` Prisma model

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append model near other adapter-related models — search for `model RoutingRecipeRun` and add nearby)
- Test: `packages/db/test/adapter-capability-profile.test.ts` (new)

- [ ] **Step 1: Write the failing schema test** — write a Vitest test that imports `PrismaClient`, creates an `AdapterCapabilityProfile` row, asserts the unique `[adapterKind, adapterVersion]` constraint rejects duplicates.
- [ ] **Step 2: Run test, verify it fails** — `pnpm test --filter @dpf/db -- --run adapter-capability-profile.test.ts`. Expect "model not found" error.
- [ ] **Step 3: Add the model to schema.prisma** — copy the schema from [spec §4.1](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#41-adaptercapabilityprofile-table-new) verbatim.
- [ ] **Step 4: Generate Prisma migration** — `pnpm --filter @dpf/db prisma migrate dev --name add_adapter_capability_profile`. Verify the migration file is created under `packages/db/prisma/migrations/`.
- [ ] **Step 5: Run test, verify it passes.**
- [ ] **Step 6: Commit** — `git commit -s --only packages/db/prisma/schema.prisma packages/db/prisma/migrations/<timestamp>_add_adapter_capability_profile/migration.sql packages/db/test/adapter-capability-profile.test.ts -m "feat(routing): add AdapterCapabilityProfile prisma model (Phase A1)"`

### Task A2: Add `AdapterRunTelemetry` Prisma model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Test: `packages/db/test/adapter-run-telemetry.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create a row with all fields, assert `executionMode` enum-like values are accepted, assert `raceCohortId` index exists by querying `pg_indexes`.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Add the model from [spec §4.3](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#43-adapterruntelemetry-table-new) verbatim.**
- [ ] **Step 4: Generate migration** — `pnpm --filter @dpf/db prisma migrate dev --name add_adapter_run_telemetry`.
- [ ] **Step 5: Run test, verify it passes.**
- [ ] **Step 6: Commit** — only the schema, migration, and test files.

### Task A3: Add `AgentThread.cliSession*` columns

**Files:**
- Modify: `packages/db/prisma/schema.prisma:2642-2654` (`model AgentThread`)
- Test: `packages/db/test/agent-thread-cli-session.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create an `AgentThread`, set `cliSessionId = "test-uuid"`, `cliSessionLastUsedAt = new Date()`, fetch by `cliSessionId`, assert the index works.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Add columns** per [spec §4.2](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#42-agentthread-extension): `cliSessionId`, `cliSessionAdapterKind`, `cliSessionContainerId`, `cliSessionLastUsedAt`, `cliSessionWorkdir`, plus `@@index([cliSessionLastUsedAt])`.
- [ ] **Step 4: Generate migration** — `pnpm --filter @dpf/db prisma migrate dev --name add_agent_thread_cli_session`.
- [ ] **Step 5: Run test, verify it passes.**
- [ ] **Step 6: Commit.**

### Task A4: Define `ExecutionAdapterSelector` and `AdapterCapabilityRequirement` types

**Files:**
- Create: `apps/web/lib/routing/execution-adapter-types.ts`
- Test: `apps/web/lib/routing/execution-adapter-types.test.ts` (new)

- [ ] **Step 1: Write the failing test** — import the types, assert exhaustive `ExecutionAdapterKind` union via a type-level test using `assertType<>` or vitest type assertion. Assert that `parseExecutionAdapterSelector("claude-code-cli:oauth")` returns the expected object.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — copy types from [spec §5.1](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#51-new-executionadapterselector-field). Add a `parseExecutionAdapterSelector(s: string)` helper for round-tripping legacy string-typed `executionAdapter` field values (e.g. `"claude-cli"` → `{ kind: "claude-code-cli", authMode: "oauth" }`).
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Commit.**

### Task A5: Backfill capability profiles for current adapters

**Files:**
- Create: `apps/web/lib/routing/capability-probes/probe-claude-cli.ts`
- Create: `apps/web/lib/routing/capability-probes/probe-codex-cli.ts`
- Create: `apps/web/lib/routing/capability-probes/probe-http-anthropic.ts`
- Create: `apps/web/lib/routing/capability-probes/probe-http-openai.ts`
- Create: `apps/web/lib/routing/capability-profile-cache.ts`
- Test: `apps/web/lib/routing/capability-profile-cache.test.ts` (new)
- Test: `apps/web/lib/routing/capability-probes/probe-claude-cli.test.ts` (new)
- Test: `apps/web/lib/routing/capability-probes/probe-codex-cli.test.ts` (new)

For each probe, the function takes an `AdapterCapabilityProfile` shape (without `id`/`probedAt`) and returns it populated. HTTP probes are static (no actual HTTP calls — capability is known from provider docs). CLI probes shell out to `<cli> --version` to get adapter version, then return a profile.

- [ ] **Step 1: Write failing tests for each probe** — one test per probe asserting the returned shape's expected booleans. For Codex: `supportsMcpAttach=true, supportsMcpAttachPerInvoke=false, knownDegradations=[{trigger: "--json + MCP", behavior: "stream malformed", source: "openai/codex#15451"}]`.
- [ ] **Step 2: Write failing test for `capability-profile-cache.ts`** — `getOrProbeCapabilityProfile(adapterKind, adapterVersion)` returns cached row if exists, else runs probe and writes row.
- [ ] **Step 3: Run all tests, verify they fail.**
- [ ] **Step 4: Implement probes** — each probe is ~30 lines. Codex probe shells out: `docker exec ${SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1"} codex --version`, parses `codex-cli X.Y.Z`. Claude probe similarly: `docker exec ... claude --version`.
- [ ] **Step 5: Implement cache** — read by `[adapterKind, adapterVersion]` unique key; on miss, run probe, write row, return.
- [ ] **Step 6: Run tests, verify they pass.**
- [ ] **Step 7: Commit.**

### Task A6: Replace hard-coded `isCliAdapter` check with capability-aware resolution

**Files:**
- Modify: `apps/web/lib/inference/ai-inference.ts:351-360` (the `isCliAdapter` boolean is at L353; surrounding context L351-L360)
- Test: `apps/web/lib/inference/ai-inference.call-provider.test.ts` (extend existing)

Steps:

- [ ] **Step 1: Write failing test** — given a route plan with `executionAdapter: "claude-cli"`, assert it still resolves to the existing claude CLI handler. Given `executionAdapter: "codex-cli"`, assert codex handler. Given a *new* structured selector `{kind: "claude-code-cli", authMode: "oauth"}`, assert same handler. Given `{kind: "claude-code-cli", authMode: "oauth", capabilityRequirements: [{capability: "supportsSubagents", required: true}]}` and a profile that lacks subagents, assert it falls back to next adapter.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Modify [ai-inference.ts:353-360](apps/web/lib/inference/ai-inference.ts#L353)** — keep backward compat: if `executionAdapter` is a string, treat it as legacy. If it's a `ExecutionAdapterSelector` object, resolve via `adapter-registry.resolve(selector, profile)`. Both paths share the same downstream handler invocation.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit.**

### Task A7: Wire telemetry write at end of every coworker run

**Files:**
- Modify: `apps/web/lib/inference/ai-inference.ts` (after handler returns, before return to caller)
- Create: `apps/web/lib/routing/adapter-telemetry-writer.ts`
- Test: `apps/web/lib/routing/adapter-telemetry-writer.test.ts` (new)

- [ ] **Step 1: Write failing test for `writeAdapterTelemetry()`** — pass a `RunOutcome` shape, assert one row written with correct adapter kind, status, tokens.
- [ ] **Step 2: Write failing integration test** — mock the existing inference path, run a fake provider call, assert one telemetry row appears.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement** — `writeAdapterTelemetry(outcome: RunOutcome)`: Prisma create wrapped in `.catch(() => {})` so telemetry failure cannot break a coworker turn.
- [ ] **Step 5: Wire into ai-inference.ts** — capture `startedAt` before handler call, capture `finishedAt`/status/tokens after, call `writeAdapterTelemetry()` async (don't await — fire-and-forget pattern matches existing `prisma.toolExecution.create().catch(() => {})`).
- [ ] **Step 6: Run tests, verify they pass.**
- [ ] **Step 7: Run full vitest suite locally** — `pnpm test --filter @dpf/web -- --run`. Inspect for regressions. Required before push.
- [ ] **Step 8: Commit.**

### Task A8: Phase A integration verification

**Files:** none (verification only)

- [ ] **Step 1: Manual smoke test** — start the portal locally (`pnpm dev` or whatever the project uses; check [README.md](README.md) — do NOT auto-start docker). Send a coworker message via the panel. Verify telemetry row appears: `psql ... -c "SELECT * FROM \"AdapterRunTelemetry\" ORDER BY \"startedAt\" DESC LIMIT 5;"`.
- [ ] **Step 2: Verify capability profiles populated** — `psql ... -c "SELECT * FROM \"AdapterCapabilityProfile\";"`. Expect 4 rows (claude-cli, codex-cli, http-anthropic, http-openai).
- [ ] **Step 3: Verify backward compat** — existing coworker recipes with string `executionAdapter` still work. No 500s in portal logs.
- [ ] **Step 4: Update [docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md) §15** — mark Phase A as "shipped <date>".
- [ ] **Step 5: Open PR** — `gh pr create` against `feat/coworker-c-status-and-a2a-sequencing` (worktree branch). Title: `feat(routing): adapter capability profiles + telemetry foundation (Phase A)`.

**Phase A acceptance:** all 4 capability profile rows present, telemetry table accumulating rows, no behavior change in existing coworker flows.

---

## Phase B: Codex CLI `--json` parsing + ToolExecution minting

**Spec acceptance:** "a coworker with `executionAdapter.kind = codex-cli` can run a `command_execution` and have a `ToolExecution` row appear in DB tied to the thread." (spec §12 Phase B)

### Task B1: Define `NormalizedEvent` taxonomy

**Files:**
- Create: `apps/web/lib/routing/normalized-event-types.ts`
- Test: `apps/web/lib/routing/normalized-event-types.test.ts` (new, type-level)

- [ ] **Step 1: Write failing type test** — assert exhaustive switch over `NormalizedEvent.kind` produces compiler error if a kind is missing.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — copy types from [spec §8.1](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#81-normalized-event-types) verbatim.
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Commit.**

### Task B2: Capture Codex JSONL replay fixtures

**Files:**
- Create: `apps/web/lib/routing/__fixtures__/codex-jsonl/probe-1-shell-cmd.jsonl`
- Create: `apps/web/lib/routing/__fixtures__/codex-jsonl/probe-2-reasoning.jsonl`
- Create: `apps/web/lib/routing/__fixtures__/codex-jsonl/probe-3-error.jsonl`
- Create: `apps/web/lib/routing/__fixtures__/codex-jsonl/README.md`

The three probes are documented in [docs/superpowers/audits/evidence/2026-04-29-codex-cli-jsonl-probe.md](docs/superpowers/audits/evidence/2026-04-29-codex-cli-jsonl-probe.md). Convert each `jsonl` block into a fixture file.

- [ ] **Step 1: Read the evidence file** — extract the three JSONL blocks.
- [ ] **Step 2: Write each as one fixture file** — one event per line, no wrapping JSON. Match the evidence file exactly.
- [ ] **Step 3: Write `__fixtures__/codex-jsonl/README.md`** — document each fixture's source command and Codex version (0.125.0). State that re-capturing requires `docker exec dpf-sandbox-1 codex exec --json --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox "<prompt>"` per the evidence file.
- [ ] **Step 4: Commit fixtures** as one commit so they are easy to refresh later.

### Task B3: Codex event normalizer

**Files:**
- Create: `apps/web/lib/routing/codex-event-normalizer.ts`
- Test: `apps/web/lib/routing/codex-event-normalizer.test.ts` (new, replay-based)

The normalizer takes an async iterable of parsed JSONL lines and yields `NormalizedEvent`s per the [spec §8.2 mapping](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#82-per-adapter-normalizer-mapping):

| Codex event | NormalizedEvent |
| --- | --- |
| `thread.started` | (capture thread_id; emit `task.started` with `taskId=thread_id`) |
| `turn.started` | (no emit — bookkeeping only) |
| `item.started type=command_execution` | `tool.invoked` |
| `item.completed type=command_execution` | `tool.completed` |
| `item.completed type=agent_message` | `message.delta` |
| `item.completed type=reasoning` | `thinking.delta` |
| `item.completed type=plan_update` | `plan.proposed` or `todo.updated` (heuristic: if items have `status` field → todo; else → plan) |
| `item.completed type=file_change` | `artifact.produced` |
| `item.completed type=mcp_tool_call` | `tool.invoked` + `tool.completed` (paired) |
| `item.completed type=web_search` | `web.search` |
| `turn.completed` | `task.completed` (with `usage`) |
| `turn.failed` | `task.completed` with `status=error` |
| `error` | `adapter.degraded` (impact derived from message) |

- [ ] **Step 1: Write failing test for shell cmd fixture** — replay `probe-1-shell-cmd.jsonl`, assert the normalized event sequence: `task.started`, `tool.invoked`, `tool.completed`, `message.delta`, `task.completed`.
- [ ] **Step 2: Write failing test for reasoning fixture.**
- [ ] **Step 3: Write failing test for error fixture** — assert `task.completed` with `status=error`.
- [ ] **Step 4: Run tests, verify they fail.**
- [ ] **Step 5: Implement normalizer.** Stream-friendly; `async function* normalize(lines)`. Maintain a `Map<itemId, ToolInvokedEvent>` so we can pair `item.started` → `item.completed` for `command_execution`.
- [ ] **Step 6: Run tests, verify they pass.**
- [ ] **Step 7: Commit.**

### Task B4: Schema-drift detector

**Files:**
- Create: `apps/web/lib/routing/codex-schema-fixture.ts`
- Modify: `apps/web/lib/routing/codex-event-normalizer.ts` (add detector hook)
- Test: `apps/web/lib/routing/codex-schema-fixture.test.ts` (new)

- [ ] **Step 1: Write failing test for `detectSchemaDrift(line)`** — given a known-shape event, return `null`. Given an unknown shape (e.g. `{type: "item.completed", item: {item_type: "agent_message"}}` — the renamed-field variant from issue #4776), return `{reason: "field 'item_type' not in v0.125.0 schema, did you mean 'type'?"}`.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — fixture is a hand-curated shape map per Codex version. `detectSchemaDrift` validates against the pinned shape, returns drift reason or null.
- [ ] **Step 4: Wire into normalizer** — on every parsed line, call detector. If drift detected, emit `adapter.degraded` event AND set a flag the adapter forwards into telemetry (`schemaDriftDetected = true`).
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Commit.**

### Task B5: MCP-active + `--json` refusal guard

**Files:**
- Modify: `apps/web/lib/routing/codex-cli-adapter.ts`
- Test: `apps/web/lib/routing/codex-cli-adapter.test.ts` (extend if exists, else create)

- [ ] **Step 1: Write failing test** — given a route plan with `mcpAttachPolicy.allowedServers.length > 0` AND adapter is `codex-cli`, assert the adapter returns (does not throw) `{status: "error", errorClass: "codex-mcp-json-degradation", message: "<refers to openai/codex#15451>"}` and writes a telemetry row with that errorClass. Returning rather than throwing matches the existing adapter contract — exceptions in this layer become 500s upstream.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — at the top of `codex-cli-adapter.execute()`, check if route plan has any MCP attach config. If yes AND `--json` will be used, return a structured error referencing issue #15451.
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Commit.**

### Task B6: ToolExecution minting from Codex events

**Files:**
- Modify: `apps/web/lib/routing/codex-cli-adapter.ts` (consume normalized events, mint rows)
- Test: `apps/web/lib/routing/codex-cli-adapter.test.ts` (new test cases)

The adapter wraps the existing subprocess invocation. Once the JSONL stream is parsed and normalized, for each `tool.invoked`/`tool.completed` pair, write a `ToolExecution` row with:
- `threadId` from route plan
- `toolName` from event (`shell`, `mcp_tool_call:<server>:<tool>`, `web_search`, `file_change`)
- `parameters`: digest only (full args may contain secrets — store digest, full payload behind a feature flag)
- `result.success` from `status === "ok"`
- `auditClass = "cli-adapter-codex"` (new value — document in adapter-types.ts)

If receipts spec has landed (`prisma.toolExecutionReceipt` exists), also mint a receipt row. Otherwise skip silently (per spec §15 fallback).

- [ ] **Step 1: Write failing test** — replay `probe-1-shell-cmd.jsonl` through adapter, assert one `ToolExecution` row appears with `toolName="shell"`, `auditClass="cli-adapter-codex"`.
- [ ] **Step 2: Write failing test for receipts fallback** — mock `prisma.toolExecutionReceipt` undefined (model not in schema); assert no error thrown and `ToolExecution` row still written.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement minting**. Use feature-detect for receipt model: `typeof (prisma as any).toolExecutionReceipt?.create === "function"`.
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Run full vitest suite** — `pnpm test --filter @dpf/web -- --run`.
- [ ] **Step 7: Commit.**

### Task B7: Switch Codex adapter to `--json` mode (behind feature flag)

**Files:**
- Modify: `apps/web/lib/routing/codex-cli-adapter.ts` (subprocess args + stream handling)
- Test: existing test extended

The new code path is gated behind `CODEX_JSON_MODE=1` (default off). PR ships dark; flag flips post-smoke. This isolates the live-stream-format change from the deploy.

- [ ] **Step 1: Write failing test for flag-on path** — set `process.env.CODEX_JSON_MODE = "1"`, when adapter runs against a fake stdout stream emitting `probe-1-shell-cmd.jsonl` lines, the adapter returns the agent's final message text correctly extracted from the normalized stream.
- [ ] **Step 2: Write failing test for flag-off path** — without the env var, adapter uses the existing text-parsing behavior unchanged.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Add `--json` to the codex exec argv when `CODEX_JSON_MODE=1`** — also `--ephemeral` for non-session calls. Replace text parsing with line-by-line JSONL parsing → normalizer → final-message extraction (last `message.delta` before `task.completed`). Default branch keeps the existing text path.
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Live smoke test (flag-on)** — `docker exec dpf-sandbox-1 codex exec --json --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox "Echo hello"`, then with `CODEX_JSON_MODE=1` set in the portal env, run a coworker turn that hits the codex adapter. Verify telemetry shows `schemaDriftDetected=false` and a `ToolExecution` row exists.
- [ ] **Step 7: Document the flag** in the PR description with rollout plan: "ship dark, smoke for 24h with `CODEX_JSON_MODE=1` in dev, flip prod default after green."
- [ ] **Step 8: Commit.**

### Task B8: Phase B PR

- [ ] **Step 1: Run full vitest suite** — required before push.
- [ ] **Step 2: Open PR** with title `feat(routing): codex CLI --json parsing + tool execution minting (Phase B)`.

**Phase B acceptance:** Codex coworker turn produces normalized events, `schemaDriftDetected=false`, one `ToolExecution` row per CLI tool call.

---

## Phase C: CliSessionService + per-thread continuity

**Spec acceptance:** "sequential coworker messages on the same thread share the same CLI session and observable plan/todo state." (spec §12 Phase C)

### Task C0: Locate the cron / scheduled-job substrate (PRE-WORK)

**Files:** none (discovery only — outputs into the plan itself or PR description)

A grep for `node-cron` / `registerCron` / `setInterval` against `apps/web/` returns no obvious central pattern. Find it before Task C4, otherwise that task stalls mid-implementation.

- [ ] **Step 1: Search candidates** — `grep -rn "cron\|setInterval\|@vercel/cron\|bull\|bullmq" apps/web/lib/queue/ apps/web/app/api/cron/ 2>/dev/null`.
- [ ] **Step 2: Inspect one existing scheduled job** — there's likely something for the build orchestrator or session cleanup. Read it end-to-end.
- [ ] **Step 3: Document the registration pattern** in the C4 task body below — replace the "ASK — don't guess" line with the concrete pattern. Update via `Edit` tool, commit only the plan file.
- [ ] **Step 4: Commit the plan update** — `git commit -s --only docs/superpowers/plans/2026-04-29-cli-execution-adapter-routing-plan.md -m "docs(plan): document cron substrate pattern for substrate Phase C"`.

### Task C1: `CliSessionService` skeleton + claim/reuse logic

**Files:**
- Create: `apps/web/lib/coworker/cli-session-service.ts`
- Test: `apps/web/lib/coworker/cli-session-service.test.ts` (new)

- [ ] **Step 1: Write failing test for `claim(threadId, adapterKind)`** — first call creates `cliSessionId`; second call within TTL reuses; second call after TTL allocates a new ID and frees the prior one.
- [ ] **Step 2: Write failing test for sandbox-pool affinity** — multiple thread claims pin to different container IDs from the pool.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement `claim()`** — Prisma transaction. Read `AgentThread.cliSession*`, decide reuse vs allocate. Sandbox container choice: simple round-robin from `DPF_SANDBOX_POOL_SIZE` (default 3); pin via `cliSessionContainerId`.
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Commit.**

### Task C2: Per-thread workdir + worktree creation

**Files:**
- Modify: `apps/web/lib/coworker/cli-session-service.ts`
- Test: `apps/web/lib/coworker/cli-session-service.test.ts`

- [ ] **Step 1: Write failing test** — first claim on a thread creates `/workspace/threads/<threadId>` directory inside the sandbox container and a git worktree off `main`. Subsequent claims reuse it.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement `ensureWorkdir(threadId)`** — `docker exec <container> mkdir -p /workspace/threads/<threadId> && cd /workspace/threads/<threadId> && (test -d .git || git worktree add /workspace/threads/<threadId> main)`.
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Commit.**

### Task C3: Concurrency rule (serialize / ephemeral fallback)

**Files:**
- Modify: `apps/web/lib/coworker/cli-session-service.ts` (add lease/concurrency)
- Test: `apps/web/lib/coworker/cli-session-service.test.ts`

- [ ] **Step 1: Write failing test** — two concurrent `claim()` calls on the same thread: one returns the active lease; the other gets a fresh ephemeral session ID (no thread pin) per [spec §9.2](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#92-concurrency-rule).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — Postgres advisory lock per `threadId` (or a Prisma `@@unique` lease table — simpler). On lock conflict, return `{ kind: "ephemeral", sessionId: cuid(), workdir: null }`.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit.**

### Task C4: Sweeper job

**Files:**
- Create: `apps/web/lib/coworker/cli-session-sweeper.ts`
- Modify: existing cron registration (search for `node-cron` or similar — look in `apps/web/app/api/cron/` or `apps/web/lib/queue/`)
- Test: `apps/web/lib/coworker/cli-session-sweeper.test.ts` (new)

- [ ] **Step 1: Write failing test** — given an `AgentThread` with `cliSessionLastUsedAt` 70 minutes ago and TTL 60 min, sweeper nulls all `cliSession*` columns and removes the worktree (mock `docker exec`).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — query stale rows, for each: docker exec rm worktree, set columns to null. Idempotent.
- [ ] **Step 4: Wire to existing cron substrate.** If unsure how cron is registered, ASK — don't guess. Likely candidates to inspect: `apps/web/lib/queue/`, `apps/web/app/api/cron/`.
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Commit.**

### Task C5: Wire `CliSessionService` into Claude + Codex adapters

**Files:**
- Modify: `apps/web/lib/routing/cli-adapter.ts` (Claude path)
- Modify: `apps/web/lib/routing/codex-cli-adapter.ts` (Codex path)
- Test: extend each adapter's existing test

For each adapter, before invoking the CLI subprocess:
1. Call `cliSessionService.claim(threadId, adapterKind)` to get `{sessionId, workdir, kind}`.
2. If `kind === "thread"`: pass `--session-id ${sessionId}` (Claude) or `codex exec resume ${sessionId} || codex exec` (Codex), and `cwd: workdir`.
3. If `kind === "ephemeral"`: pass `--ephemeral` (Codex) or omit `--session-id` (Claude); use `/workspace`.
4. Update `cliSessionLastUsedAt` after successful turn.

- [ ] **Step 1: Write failing tests for both adapters** — given a route plan with `threadId`, assert sessionId is reused across two turns AND the workdir is `/workspace/threads/<threadId>`.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Live smoke test** — start portal, run two coworker turns on the same thread via Codex, verify second turn reuses the thread's session UUID by inspecting the codex stdout (the first event will be `thread.started` with the *same* `thread_id` if resume worked).
- [ ] **Step 5: Run full vitest suite.**
- [ ] **Step 6: Commit.**

### Task C6: Phase C PR

- [ ] **Step 1: Update [spec §15](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#15-migration--backwards-compatibility)** — mark Phase C shipped.
- [ ] **Step 2: Open PR** — `feat(coworker): per-thread CLI session lifecycle (Phase C)`.

**Phase C acceptance:** sequential turns on one thread share session and workdir; concurrent turns get ephemeral fallback; sweeper runs and cleans stale sessions.

---

## Phase D: Claude CLI normalizer parity

**Spec acceptance:** "Claude Code CLI runs surface plan, todo, subagent, and thinking events to the panel." (spec §12 Phase D)

The existing [cli-adapter.ts](apps/web/lib/routing/cli-adapter.ts) parses only `tool_use` blocks. Extend to cover the rest of the [spec §8.2 Claude rows](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#82-per-adapter-normalizer-mapping).

### Task D1: Capture Claude stream-json fixtures

**Files:**
- Create: `apps/web/lib/routing/__fixtures__/claude-stream-json/probe-1-tool-use.jsonl`
- Create: `apps/web/lib/routing/__fixtures__/claude-stream-json/probe-2-todo.jsonl`
- Create: `apps/web/lib/routing/__fixtures__/claude-stream-json/probe-3-subagent.jsonl`
- Create: `apps/web/lib/routing/__fixtures__/claude-stream-json/probe-4-thinking.jsonl`
- Create: `apps/web/lib/routing/__fixtures__/claude-stream-json/README.md`

- [ ] **Step 1: Run live probe inside sandbox** — `docker exec dpf-sandbox-1 claude --output-format stream-json --print "Make a todo list with three items" 2>/dev/null > /tmp/probe-2.jsonl`. Repeat for tool_use, subagent (Task tool), thinking.
- [ ] **Step 2: Copy each captured stream into a fixture file** under `__fixtures__/claude-stream-json/`. Sanitize any PII / OAuth tokens before committing.
- [ ] **Step 3: Document each in README.md** — command + Claude Code version (`docker exec dpf-sandbox-1 claude --version`).
- [ ] **Step 4: Commit fixtures.**

### Task D2: Extend Claude normalizer

**Files:**
- Modify: `apps/web/lib/routing/cli-adapter.ts` (parser section, around L131-L139 currently parsing `tool_use`)
- Or refactor: extract parser into `apps/web/lib/routing/claude-event-normalizer.ts` — likely cleaner — Phase H aligned
- Test: `apps/web/lib/routing/claude-event-normalizer.test.ts` (new)

- [ ] **Step 1: Decide refactor vs extend** — recommend extracting into `claude-event-normalizer.ts` to mirror `codex-event-normalizer.ts`. Counts toward Phase H allocation.
- [ ] **Step 2: Write failing tests for each fixture** — replay each `.jsonl`, assert normalized event sequence:
  - probe-1: `task.started`, `tool.invoked`, `tool.completed`, `message.delta`, `task.completed`
  - probe-2: `todo.updated` events with the right `todos` payload
  - probe-3: `subagent.started`, `subagent.completed`, surrounding `tool.*`
  - probe-4: `thinking.delta` events with `effort` field
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement** by extending the existing parser. Reuse `NormalizedEvent` types from Phase B1.
- [ ] **Step 5: Implement Claude schema-drift fixture** mirroring B4.
- [ ] **Step 6: Run tests, verify they pass.**
- [ ] **Step 7: Run full vitest suite.**
- [ ] **Step 8: Commit.**

### Task D3: Backfill decision for in-flight threads

Spec §12 Phase D step 3 says "Backfill normalized events for in-flight threads." Decide and document — don't silently drop the requirement.

**Files:**
- Modify: `docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md` §12 Phase D (record decision)

Steps:

- [ ] **Step 1: Document the decision: NO BACKFILL.** In-flight threads keep their stored shape (legacy `agentMessage` rows without `normalizedEvents` JSON); only new turns going forward get normalized events. Reasoning: backfill would require re-running prior turns through CLI, which costs tokens and may produce different results from the user's actual experience. Risk of confusion ("why does the trace tab differ from what I remember?") outweighs benefit.
- [ ] **Step 2: Update spec §12 Phase D** to replace "Backfill normalized events for in-flight threads." with "No backfill — legacy threads render via the old code path; new turns from spec ship date forward use normalized events."
- [ ] **Step 3: Add a fallback render in the panel UI** — if `agentMessage.normalizedEvents` is null, render via the existing transcript path. Track as an E-phase task.
- [ ] **Step 4: Commit the spec update** — `git commit -s --only docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md -m "spec(coworker): no-backfill decision for normalized events (Phase D D3)"`.

### Task D4: Phase D PR

- [ ] **Step 1: Open PR** — `feat(routing): claude CLI event normalizer parity (Phase D)`.

---

## Phase E: Coworker panel cockpit UI

**Spec acceptance:** "users see one coherent panel surface for HTTP, Claude Code CLI, and Codex CLI runs without raw harness payloads leaking into the transcript." (spec §12 Phase E)

This phase is larger than A–D. **If a single session can't finish it, split at task E4 (header+rail done) → E5+ in a follow-up.** Each task is still bite-sized.

### Task E1: Find existing panel components

**Files:** none (discovery only)

- [ ] **Step 1: Read [apps/web/lib/actions/agent-coworker.ts](apps/web/lib/actions/agent-coworker.ts)** to understand the message return shape.
- [ ] **Step 2: Find the panel React tree.** Search for `agent-panel-layout` or `coworker-panel`; per audit, there's a layout file at `apps/web/components/agent/agent-panel-layout.ts`. Read its consumers via `grep -rn agent-panel-layout apps/web/`.
- [ ] **Step 3: Document findings** — write a short note in the PR description listing every panel component touched. Don't write to a doc — this is in-PR context only.

### Task E2: Pipe `NormalizedEvent` through `agent-coworker.sendMessage` return

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts` (return shape extension)
- Test: existing `agent-coworker` tests

- [ ] **Step 1: Write failing test** — call `sendMessage()` against a Codex adapter (mocked stream), assert the return shape now includes `events: NormalizedEvent[]` alongside `userMessage`/`agentMessage`.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — capture events emitted during the adapter run; attach to return value. Existing return fields unchanged.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit.**

### Task E3: Persist `NormalizedEvent` per message for replay

**Files:**
- Modify: `packages/db/prisma/schema.prisma` — add `AgentMessage.normalizedEvents Json?` column
- Test: schema test

- [ ] **Step 1: Write failing test** — write an `AgentMessage` with `normalizedEvents: [{kind: "tool.invoked", ...}]`, fetch, assert round-trip.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Modify schema + migration** — `pnpm prisma migrate dev --name add_agent_message_normalized_events`.
- [ ] **Step 4: Wire write in `agent-coworker.ts`** — when persisting agent message, include events JSON.
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Commit.**

### Task E4: Cockpit zones — Header + Status rail

**Files:**
- Locate the existing panel root component first; create new components alongside it
- Create: `apps/web/components/agent/cockpit/cockpit-header.tsx`
- Create: `apps/web/components/agent/cockpit/status-rail.tsx`
- Test: `*.test.tsx` for each (component tests with React Testing Library)

- [ ] **Step 1: Write failing component test for header** — given coworker name + adapter kind, render shows name + adapter badge + health LED placeholder.
- [ ] **Step 2: Write failing component test for status rail** — given a list of normalized `todo.updated` events, render shows current todo list.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement using project CSS variables** — no hardcoded colors. Use the same vars as existing capability-tier badges (search `capability-tier` in apps/web/components/).
- [ ] **Step 5: Wire into the existing panel** — add header and status-rail above transcript.
- [ ] **Step 6: Run tests, verify they pass.**
- [ ] **Step 7: Visual smoke test** — start portal locally, open coworker panel, verify header + rail render.
- [ ] **Step 8: Commit.**

### Task E5: Cockpit zones — Trace tab

**Files:**
- Create: `apps/web/components/agent/cockpit/trace-tab.tsx`
- Test: `apps/web/components/agent/cockpit/trace-tab.test.tsx`

- [ ] **Step 1: Write failing test** — given a list of normalized events, trace tab renders one row per event with kind + summary, expandable to show raw payload.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement.** Progressive disclosure — `<details>` for raw payload, role-gated.
- [ ] **Step 4: Wire as a tab next to transcript.**
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Commit.**

### Task E6: Cockpit zones — Artifacts panel

**Files:**
- Create: `apps/web/components/agent/cockpit/artifacts-panel.tsx`
- Test: `apps/web/components/agent/cockpit/artifacts-panel.test.tsx`

- [ ] **Step 1: Write failing test** — given a list of `artifact.produced` events, render shows one card per artifact with click-through to file/diff.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit.**

### Task E7: Adapter health LED

**Files:**
- Create: `apps/web/lib/routing/adapter-health.ts` (computes health from `AdapterRunTelemetry`)
- Modify: `apps/web/components/agent/cockpit/cockpit-header.tsx`
- Test: `apps/web/lib/routing/adapter-health.test.ts`

- [ ] **Step 1: Write failing test for `computeAdapterHealth(adapterKind)`** — given a fake telemetry table state, return `"healthy"` or `"degraded"` per [spec §14 formula](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#14-telemetry--observability).
- [ ] **Step 2: Write failing component test** — health LED renders green/red based on adapter health.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement** — query last 100 telemetry rows for the adapter, compute success rate + median latency + drift count, return health.
- [ ] **Step 5: Wire LED.**
- [ ] **Step 6: Run tests, verify they pass.**
- [ ] **Step 7: Commit.**

### Task E8: Role-gated disclosure

**Files:**
- Modify: each cockpit component to read role from existing portal RBAC context (search `useUser` or `getCurrentUser`)
- Test: each component test extended with role variants

- [ ] **Step 1: Write failing tests** — given user/operator/admin, assert visible elements per [spec §10.2 table](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#102-progressive-disclosure-audit-q7).
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement role gates.** No new auth model — read from existing context.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit.**

### Task E9: Phase E PR

- [ ] **Step 1: Run full vitest + RTL suite.**
- [ ] **Step 2: Manual UX review** — open panel, verify all zones render, role gates work, theme variables used (no hardcoded colors).
- [ ] **Step 3: Open PR** — `feat(coworker): cockpit panel surface for normalized adapter events (Phase E)`.

---

## Phase F: Shadow execution mode

**Spec acceptance:** "ops can run a one-week shadow of Codex CLI against Claude HTTP for the chat workload and read a comparison report at end of week." (spec §12 Phase F)

### Task F1: Shadow eligibility evaluator

**Files:**
- Create: `apps/web/lib/routing/shadow-eligibility.ts`
- Test: `apps/web/lib/routing/shadow-eligibility.test.ts`

- [ ] **Step 1: Write failing test** — given budget remaining, sample rate, kill switch state, return correct boolean per [spec §6.2 formula](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#62-shadow-—-live--n-alternatives-log-only).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement.** Read `SHADOW_BUDGET_USD`, `SHADOW_SAMPLE_RATE`, `SUBSTRATE_SHADOW_DISABLE` env. Read MTD spend from `AdapterRunTelemetry` sum.
- [ ] **Step 4: Add prompt-sensitivity floor** — only `public` and `internal` route sensitivities are shadow-eligible (spec §13 risk #5).
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Commit.**

### Task F2: Shadow dispatch path

**Files:**
- Modify: `apps/web/lib/inference/ai-inference.ts` — when `executionMode = "shadow"`, fork shadow runs in background
- Test: `apps/web/lib/inference/ai-inference.shadow.test.ts`

- [ ] **Step 1: Write failing test** — route plan with `executionMode: "shadow"` and `shadowAdapters: [{kind: "codex-cli"}]`. Assert primary returns to caller; shadow runs in background; both produce telemetry rows with the same `raceCohortId`.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — `Promise.allSettled` style; primary awaited, shadows fire-and-forget. Fresh cuid for `raceCohortId`. Shadow rows tagged `executionMode: "shadow-alt"`.
- [ ] **Step 4: Ensure shadow runs do NOT touch user-visible state** — separate write path, no `agentMessage` rows for shadow output.
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Commit.**

### Task F3: Outcome scoring batch

**Files:**
- Create: `apps/web/lib/routing/outcome-scoring.ts`
- Modify: cron registration
- Test: `apps/web/lib/routing/outcome-scoring.test.ts`

- [ ] **Step 1: Write failing test for `scoreAdapters(taskClass, providerFamily, capRequirements)`** — given a fake telemetry state, return adapter ranking per [spec §6.4 formula](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#64-outcome-scoring).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement.** SQL aggregation over a 7-day window.
- [ ] **Step 4: Wire to nightly cron.**
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Commit.**

### Task F4a: Locate existing admin/operator page conventions

**Files:** none (discovery)

- [ ] **Step 1: Find admin route root** — `find apps/web/app -type d -name "(admin)" -o -name "(operator)" 2>/dev/null | head`. Read one existing page end-to-end.
- [ ] **Step 2: Identify the chart library** — grep imports in admin pages (recharts? d3? something custom?).
- [ ] **Step 3: Identify the page-test infra** — does the project test app-router pages? Find one example or note its absence.

### Task F4b: Adapter mix chart (test-first)

**Files:**
- Create: `apps/web/app/<admin-route>/operator/adapters/_components/adapter-mix-chart.tsx`
- Test: `apps/web/app/<admin-route>/operator/adapters/_components/adapter-mix-chart.test.tsx`

Steps:

- [ ] **Step 1: Write failing test** — given a fake telemetry-rollup result `[{kind: "claude-code-cli", count: 100}, {kind: "codex-cli", count: 50}]`, render shows two stack rows with correct relative sizes. Use the chart library found in F4a.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement the chart component.**
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Commit.**

### Task F4c: Acceptance-by-adapter chart

**Files:**
- Create: `apps/web/app/<admin-route>/operator/adapters/_components/acceptance-chart.tsx`
- Test: corresponding `.test.tsx`

Steps:

- [ ] **Step 1: Write failing test** — given fake rollup with `userAccepted=true` rate per adapter, render bars with percentages.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Commit.**

### Task F4d: Remaining four panels

Repeat the test-first cycle for: schema-drift incidents, shadow comparison, quota saturation, CLI session lifecycle. Each gets one component file + one test file.

Steps:

- [ ] **Step 1: Schema-drift panel** — failing test → run → implement → commit.
- [ ] **Step 2: Shadow-comparison panel** — failing test → run → implement → commit.
- [ ] **Step 3: Quota-saturation panel** — failing test → run → implement → commit.
- [ ] **Step 4: CLI session lifecycle panel** — failing test → run → implement → commit.

### Task F4e: Compose into the dashboard page

**Files:**
- Create: `apps/web/app/<admin-route>/operator/adapters/page.tsx`

Steps:

- [ ] **Step 1: Compose all six panels into the page** — server-side fetch the rollup data, pass to each component.
- [ ] **Step 2: Smoke-test in dev** — open the page, verify all six panels render with real data from the local telemetry rows.
- [ ] **Step 3: Commit.**

### Task F5: Phase F PR

- [ ] **Step 1: Open PR** — `feat(routing): shadow execution mode + outcome scoring (Phase F)`.

---

## Phase G: Race execution mode + quota-pool spreading

**Spec acceptance:** "under controlled rate-limit pressure, the platform automatically shifts load between `anthropic-api` and `anthropic-oauth` quota pools without user-visible degradation." (spec §12 Phase G)

### Task G1: Quota-pool saturation tracker

**Files:**
- Create: `apps/web/lib/routing/quota-pool-state.ts`
- Test: `apps/web/lib/routing/quota-pool-state.test.ts`

- [ ] **Step 1: Write failing test for `getQuotaPoolSaturation(family)`** — given recent telemetry with 429s, return saturation 0..1.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement** — query last 100 telemetry rows per pool, compute 429-rate / 5xx-rate, return as saturation.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit.**

### Task G2: Adapter ranker uses pool saturation

**Files:**
- Modify: `apps/web/lib/routing/recipe-loader.ts` (or wherever adapter ranking lives — find via `grep cost-ranking`)
- Test: extend existing ranker test

- [ ] **Step 1: Write failing test** — given two adapters serving the same family, prefer the less-saturated pool.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement.** Saturation as a ranking factor.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit.**

### Task G3: Race dispatch path

**Files:**
- Modify: `apps/web/lib/inference/ai-inference.ts`
- Test: `apps/web/lib/inference/ai-inference.race.test.ts`

- [ ] **Step 1: Write failing test** — route plan with `executionMode: "race"` and N shadow adapters; adapter A returns first valid result; adapters B, C are SIGTERM'd; all three write telemetry with same `raceCohortId`; A is `race-primary`, B/C are `race-loser`.
- [ ] **Step 2: Write failing test for race acceptance criteria** — adapter that returns refusal text loses; adapter past latency budget loses; adapter with fabricated tool name loses.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement.** Use `Promise.race` with cancellation tokens. Acceptance check function per [spec §6.3](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#63-race-—-n-adapters-in-parallel-first-valid-wins).
- [ ] **Step 5: Gate behind `SUBSTRATE_RACE_ENABLE` env.**
- [ ] **Step 6: Run tests, verify they pass.**
- [ ] **Step 7: Commit.**

### Task G4: Phase G PR

- [ ] **Step 1: Open PR** — `feat(routing): race execution mode + quota-pool spreading (Phase G)`.

---

## Phase H: Refactor allocation (threaded through every phase)

This phase is not its own PR. It's a budget reserved at every step. Specific deliverables enumerated below — track them as completed across the other phases.

### H1 — Extract `ExecutionAdapter` interface (during Phase A or B)
- [ ] Pull `ExecutionAdapterHandler` definition into a single source of truth at `apps/web/lib/routing/execution-adapter-types.ts` (started in A4).
- [ ] All adapter implementations conform to one interface.

### H2 — Move adapter-specific code out of `routed-inference.ts` (during Phase A)
- [ ] All adapter dispatch logic lives in registry / per-adapter modules. `routed-inference.ts` does ranking and fallback only.

### H3 — Separate panel state (during Phase E)
- [ ] React tree separates: transcript state, task state (active task / approvals), artifact state, trace state. No single component owns all four.

### H4 — Unify CLI session ID generation (during Phase C)
- [ ] `claude-dispatch.ts`, `codex-dispatch.ts`, and the new substrate adapters all call the same `cliSessionService.claim()` helper. No bespoke UUID generation in dispatch files.

### H5 — Cost / quota / outcome ledger consolidation (during Phase F)
- [ ] `AdapterRunTelemetry` is the canonical run ledger. `ToolExecution.duration_ms` and other duplicate columns either reference telemetry IDs or are removed.

---

## Risk-driven checks before merging any phase

Pulled from [spec §13](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md#13-open-risks):

| Risk | Verify before merge |
| --- | --- |
| Codex schema instability | Schema-drift detector wired (B4) AND fixture pinned to live Codex version |
| Sandbox pool exhaustion | Pool size check in sweeper logs; ephemeral fallback path exercised in test |
| Subprocess timeout floor | Per-adapter timeout in capability profile honored by adapter |
| OAuth token churn | Token refresh path covers both Claude and Codex |
| Shadow prompt leakage | Shadow eligibility blocks `sensitive` route sensitivity |
| Race cost amplification | Race requires both env flag AND per-route opt-in; never default |
| Acceptance signal lag | Outcome scoring uses 7-day rolling window |

---

## Post-implementation

- [ ] Update [docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md](docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md) status from "Draft" to "Implemented" with the PR list.
- [ ] Update memory: write a project memory at `memory/project_coworker_substrate_shipped.md` listing what's now possible (CLI features in panel, shadow data, race mode), what's still gated (sensitive routes can't shadow), and the operator levers (`SHADOW_BUDGET_USD`, `SUBSTRATE_RACE_ENABLE`, `CLI_SESSION_TTL_MIN`, `SUBSTRATE_SHADOW_DISABLE`).
- [ ] Schedule follow-up audit ~30 days post-Phase F: did shadow data change adapter ranking? Are there capability requirements we should add to recipes based on observed `capabilitiesUsed` patterns?
- [ ] Convergence follow-up: should Build Studio dispatch ([claude-dispatch.ts](apps/web/lib/integrate/claude-dispatch.ts), [codex-dispatch.ts](apps/web/lib/integrate/codex-dispatch.ts)) migrate to the substrate adapter system? Out of scope for this plan; track as separate spec.
