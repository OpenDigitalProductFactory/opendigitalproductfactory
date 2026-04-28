# Routing Substrate Fix Attempts — History and Constraint Document

| Field | Value |
|-------|-------|
| **Status** | Reference |
| **Created** | 2026-04-27 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Purpose** | Capture the actual history of routing-substrate fix attempts so that attempt #N is constrained by what attempts #1 through #N-1 tried, shipped, and regressed. Companion to [2026-04-27-routing-control-data-plane-design.md](./2026-04-27-routing-control-data-plane-design.md). |
| **Aligns with memory** | `feedback_fix_seed_not_runtime`, `feedback_db_seed_migration_sync`, `project_silent_seed_skips_audit`, `project_agent_grant_seeding_gap`, `feedback_check_tool_signals` |
| **Pattern** | The platform has shipped 18 routing/capability-related design specs and ~179 commits to the routing surface in seven months. Each attempt addressed a real symptom, partially shipped, and produced a follow-up. The pattern that's emerged is the seed/runtime drift class — recurring on every install, treated by each attempt as a one-off bug rather than as the architectural disease. |

---

## Why This Document Exists

Mark observed during a debugging session on 2026-04-27 that he had reached the same architectural conclusion (separate catalog from runtime, treat seed as intent and runtime as derived-from-reality) approximately ten times across prior sessions. Each session shipped a substrate patch, the patch held for some weeks, then a new symptom surfaced and the cycle repeated.

This document mines the actual record — git history, prior design specs, PR descriptions, memory entries — to capture what was tried, what shipped, what regressed, and why each attempt was insufficient. The output is a *constraint document* that future routing-substrate work must satisfy or explicitly justify deviating from.

The reason attempt #11 (the architectural spec dated 2026-04-27) might be different is that it is the first to:

1. Be constrained by an explicit history of prior attempts (this document).
2. Adopt a pattern (control plane / data plane) with a 35-year track record of solving exactly this class of problem in a different domain.
3. Specify failure modes and recovery semantics with property-test rigor rather than as prose intent.
4. Include the watchdog and cost-ledger from the start, so the architecture is observable and financially accountable, not just structurally correct.

If attempt #11 ships and the pattern still recurs, the lesson is in this document, not in another fresh-start spec.

## Inventory of Prior Specs

Eighteen routing/capability/provider design specs have been written. Listed in chronological order with what each tried to address.

| # | Date | Spec | Scope | Status | What it tried |
|---|------|------|-------|--------|----------------|
| 1 | 2026-03-12 | `phase-7a-ai-provider-registry-design.md` | Provider registry table model | Incorporated | First framing: model providers as first-class DB entities with status, pricing, capabilities |
| 2 | 2026-03-13 | `phase-7b-expanded-providers-design.md` | Multi-provider support | Incorporated | OpenAI, Anthropic, Gemini, local — alongside each other in registry |
| 3 | 2026-03-15 | `codex-provider-integration-design.md` | OpenAI Codex integration | Incorporated | First integration of a CLI-subprocess adapter (codex-cli) — new dispatch path |
| 4 | 2026-03-16 | `orchestrated-task-routing-design.md` | Task routing orchestration | Superseded | Initial task→provider matching layer |
| 5 | 2026-03-18 | `ai-routing-and-profiling-design.md` | Pipeline v1 + endpoint manifests | Superseded by V2 | First proper routing pipeline with filter + score stages |
| 6 | 2026-03-19 | `model-level-routing-profiles-design.md` | Per-model scores not per-provider | Superseded | Recognition that providers offer multiple models with different capabilities |
| 7 | 2026-03-20 | `adaptive-model-routing-design.md` | Adaptive tier choice | Superseded | Dynamic preference based on demand patterns |
| 8 | 2026-03-20 | `capability-detection-and-routing-design.md` | Capability detection on activation | Incorporated as EP-MODEL-CAP-001 | Discover capabilities on provider activation |
| 9 | 2026-03-20 | `provider-model-registry-design.md` | Registry shape | Incorporated | Unified registry shape for the various providers |
| 10 | 2026-03-21 | `provider-oauth-authorization-code-design.md` | OAuth flow for subscription providers | Incorporated | OAuth onboarding for Claude Max, ChatGPT subscriptions |
| 11 | 2026-03-29 | `model-routing-simplification-design.md` | Pipeline cleanup | Partially superseded | First simplification pass — recognized accumulated complexity |
| 12 | 2026-03-30 | `db-driven-model-classification-design.md` | DB-backed model class table | Incorporated | Move classification out of code into DB |
| 13 | 2026-04-03 | `utility-inference-tier-design.md` | Cheap "utility" tier | Concept incorporated | Recognition that some tasks should route to cheap tier |
| 14 | 2026-04-04 | `provider-activation-routing-reconciliation-design.md` | Reconcile on activation | Incorporated | First explicit attempt to address activation-vs-routing timing |
| 15 | 2026-04-12 | `unified-capability-and-integration-lifecycle-design.md` | Three sub-phases | Phase 1-3 plans exist | Standardize how capabilities flow from provider activation to agent dispatch |
| 16 | 2026-04-13 | `coworker-active-capability-enforcement.md` | Hard-floor capability check | Shipped as EP-AGENT-CAP-002 | "Agent can't dispatch unless its capability floor is satisfied" |
| 17 | 2026-04-13 | `model-capability-lifecycle-management.md` | EP-MODEL-CAP-001 lifecycle | Shipped as EP-MODEL-CAP-001-A through D | Capability evaluation, revalidation, override layers |
| 18 | 2026-04-20 | `routing-architecture-current.md` | Snapshot of where we are | Reference doc | "This is the current state, all earlier docs are superseded" |
| 19 | 2026-04-27 | `routing-control-data-plane-design.md` | This attempt | Draft | Control plane / data plane separation per network-routing patterns |

The numbering shows the trajectory: increasing sophistication, real architectural progress, but always a follow-up attempt arriving 1-3 weeks later because the prior attempt's scope didn't cover something that turned out to matter.

## Pattern: What Each Recent Attempt Shipped, What Came Back

### Attempt #15 → #16 → #17 — Capability lifecycle (2026-04-12 to 2026-04-13)

**Shipped (PRs):**
- EP-MODEL-CAP-001-A — capability profile schema additions
- EP-MODEL-CAP-001-B — source-priority tool use resolver (`resolveToolUse`)
- EP-MODEL-CAP-001-D — scheduled revalidation with advisory lock
- EP-AGENT-CAP-002 — agent capability floor enforcement, `NoEligibleEndpointsError` extension

**What stuck:** the typed capability model (`ModelCapabilities` interface, `supportsToolUse: boolean`, etc.). The agent capability floor at hard-filter stage. The revalidation cadence.

**What regressed or gapped:**
- `TOOL_TO_GRANTS` map drift — every tool added after the spec landed without an accompanying grant entry resulted in a default-deny that nobody noticed (this is the "promote_to_build_studio dead code" finding from 2026-04-27).
- Capability profile fields are populated by *LLM grading* on profile generation. The grading uses a different vocabulary than the router consumes (`deep-thinker`/`fast-worker`/`specialist` vs `frontier`/`strong`/`adequate`). The grading writes to `capabilityTier`; the router reads `qualityTier`. Two parallel columns, two vocabularies — incomplete unification.
- The capability check passes through the request contract via `minimumCapabilities`, but at runtime the agent's *resolved* identifier (`agent.agentId === "coo"`) doesn't match the registry's `agent_id` (`AGT-ORCH-000`), so `getAgentToolGrants` returns null and the filter is silently skipped. The hard floor design assumes a single canonical agent identifier; the implementation has three (registry, route map, DB cuid).

### Attempt #18 — Snapshot consolidation (2026-04-20)

**Shipped:**
- Documentation refresh acknowledging "all the earlier docs are superseded" but pointing at the current pipeline.
- Tier contract regression test (`tier-contract.test.ts`) — 9 task types, all asserting tier matches.
- Provider-tier preference (PR #107): `user_configured > bundled` so configured Anthropic wins over local gemma.
- Pricing seed + tier-floor → minimumDimensions translation (PR #126).

**What stuck:** the regression test. The provider-tier preference fix (this is what made anthropic-sub winnable once activated).

**What regressed or gapped:**
- The "configured but not selected" timing problem persists — the provider goes through credential-saved → models-discovered → models-profiled → activation-event in sequence, and routing decisions made between any pair of those steps see incomplete state. The April 20 snapshot describes the *eventual* flow but does not address the transient window. Tonight's session demonstrated this concretely: anthropic-sub was active in the DB for ~50 minutes before the first coworker call routed to it.
- The CLI adapters (claude-cli, codex-cli) still don't write `TokenUsage`. Spec doesn't address it.
- The state column (`ModelProvider.status`) is written from many call sites without a state machine. A `disabled` provider can still appear in the candidate pool because the hard filter at `pipeline-v2.ts:54` checks `status !== "active" && status !== "degraded"` — meaning `"disabled"` is excluded, but `"unconfigured"` slips through some code paths (verified tonight: codex was selected as primary despite being `disabled`).

## The Recurring Failure Class — Named Explicitly

Every "regressed or gapped" entry above can be classified as one of four bug types. These are the recurring failure class. They are not new bugs each time; they are the same bugs in different costumes.

### Class A: Vocabulary mismatch between layers
*Multiple parts of the system use different words for the same concept.*

Concrete instances observed:
- `capabilityTier` (`deep-thinker`/`fast-worker`/...) vs `qualityTier` (`frontier`/`strong`/...) — the LLM grader writes one column, the router reads another. Tonight's debugging confirmed.
- `agent_id` (`AGT-ORCH-000`) vs `agentId` (`coo`) vs `id` (cuid) — three names for the same agent.
- `costModel` (`token`/`compute`) vs effective-pricing computation paths — handled differently in different functions.
- Build phase strings (`ideate`/`plan`/...) compared via raw `===` in 14 places without a state machine to keep them aligned.

Past fixes: each instance patched in isolation when it surfaced. None made the *vocabulary* canonical.

### Class B: Three-place hand-aligned data
*The same fact lives in 3+ places and can drift.*

Concrete instances:
- `PLATFORM_TOOLS` (declared) + `TOOL_TO_GRANTS` (mapped) + `agent_registry.json:tool_grants` (granted) — three places to keep in sync per tool. Tonight: 7 tools defined but missing from `TOOL_TO_GRANTS`. Default-deny.
- `ModelProvider` (catalog) + `ModelProfile` (per-model) + live-discovery overrides — tier and capability data spread across three layers, no clear authority.
- Agent identifier (registry / route map / DB) — same as Class A.

Past fixes: tooling additions (boot audit log for pins, regression test for tier contract). None made the system *unable* to ship without alignment.

### Class C: Trusted seed values vs reality
*The seed declares state values that the runtime trusts even when they don't reflect current reality.*

Concrete instances:
- `ModelProvider.status` set to `active` by seed → router treats provider as candidate even though credentials never saved. Patched at boot via reconcile script (PR #285) but the underlying pattern persists.
- `ModelProvider.capabilityTier` set to `basic` by default seed for all providers → router would reject all candidates if it read this column (it doesn't; it reads `ModelProfile.qualityTier`). Lucky escape.
- `AgentToolGrant` rows written by seed → if a grant is added in code (`TOOL_TO_GRANTS`) but not seeded, runtime denies. The 2026-04-27 fix to add `build_promote` etc. inserted the grants directly to live DB, embodying the bug we're trying to escape.

Past fixes: reconcile-on-boot scripts. They run once and don't cover post-boot state changes.

### Class D: Unobserved silent failure
*The system encounters an error condition, logs it (or doesn't), and proceeds with degraded behavior that the user/operator can't see.*

Concrete instances:
- `reviewDesignDoc` auto-advances `ideate → plan` when intake gate passes. When it doesn't pass, the reason is logged to `BuildActivity` (a table nobody reads in chat) and the tool result still says "Design review: pass." Agent has no signal to self-correct. (This is `feedback_check_tool_signals` in memory — known, recurring.)
- Workspace coworker on gemma model claimed "I logged this as a backlog item" without ever calling `create_backlog_item`. Agent fabrication. Detection log line `[tool-trace] NO-CALL-BUT-MENTIONED` exists but doesn't trigger remediation.
- CLI adapter call returns token counts but doesn't persist `TokenUsage`. Cost is silently lost. Tonight: $0 tally for ~30 real Anthropic calls.
- "Test connection" on provider config page returns green while real coworker calls on the same provider are rate-limited. Two diagnostic surfaces, two different conclusions about provider health.

Past fixes: occasional improved logging. No systematic "every silent failure is itself a detected anomaly that surfaces to the operator."

## The Constraint List for Attempt #11

For attempt #11 (the 2026-04-27 control-plane / data-plane spec) to be measurably different from attempts 1-10, it must satisfy these constraints. If it doesn't, it will recur as the same pattern.

### Constraint 1: Single source of truth per concern (addresses Class A and B)
Tier vocabulary must collapse to one canonical type (`QualityTier`) with deterministic derivation from model family (`assignTierFromModelId`). The LLM grader stops writing tier — only writes friendly-name and best-for prose. Agent identifiers collapse to one canonical key with explicit translation only at edges (UI labels, audit display).

**Verification:** boot invariant fails the build if any `ModelProfile.qualityTier` is not in the canonical enum, or if any agent has more than one identifier in active use without an explicit translation table.

The 2026-04-27 spec partially addresses this in §8.1 invariants, but does not eliminate the parallel `capabilityTier` and `qualityTier` columns. **This is a gap.** A follow-up should remove `capabilityTier` once `qualityTier` is everywhere.

### Constraint 2: Catalog vs runtime separation (addresses Class C)
The seed writes the catalog (declarations: providers exist, models exist, agents exist, tools exist, capabilities are required for tools). The runtime writes observed state (status, tier-from-grading-when-empirical, recent success rates, rate-limit headroom). These two writes never overlap on the same column.

**Verification:** boot invariant lists every column the seed writes; for each, classifies "catalog" or "runtime"; runtime columns must have an explicit derivation function declared and at least one writer that's not the seed.

The 2026-04-27 spec addresses this in §3.1 (control plane reads catalog/probes/policy as separate inputs) and §11 (state transitions are named functions, not raw column writes). **This is well-addressed.**

### Constraint 3: Reality probes as gates (addresses Class C)
A provider doesn't enter the candidate pool because seed says it's active. It enters because (a) status is active *and* (b) credentials resolve *and* (c) a recent probe call succeeded. Failing any of those, it falls out automatically until conditions change.

**Verification:** the routing decision audit log includes a probe timestamp for each candidate. A candidate selected without a recent successful probe is itself an anomaly the watchdog detects.

The 2026-04-27 spec addresses this in §3.3 (state machine), §11.3 (probe-based recovery), §10.2 (watchdog detectors). **This is the core architectural change.**

### Constraint 4: Silent failure becomes loud failure (addresses Class D)
Every silent-failure case observed historically has a corresponding watchdog detector or invariant check. The system surfaces to the operator what the agent fabricates, what the data plane drops, what the cost ledger fails to capture, and what state transitions get attempted out of valid sequence.

**Verification:** for each past silent-failure incident in this document, locate the detector or invariant that would fire. If none exists, the spec is incomplete.

The 2026-04-27 spec addresses this in §10 (watchdog with three classes of detectors) and §12 (cost capture with boot invariants). **Mostly addressed.** Status of specific historical incidents:

- The "test connection passes while real calls are rate-limited" inconsistency: addressed by the §10.2 Class A detector "Diagnostic-vs-real reconciliation mismatch". **Closed.**
- The agent-fabricated `verificationOut` problem: explicitly out of scope per §9.1, deferred to a separate spec. **Gap, but acknowledged and out of scope.**
- The chat coworker "I logged it" without calling the tool: addressed by the §10.2 Class A detector "Hallucinated tool-use (NO-CALL-BUT-MENTIONED)". **Closed.**
- Silent outcome-event drop: addressed by the new `DispatchEvent` paired with `OutcomeEvent` and the §3.6 idempotency / §10.2 drop-detection contract added in review. **Closed.**
- CLI-adapter metering forgotten on new dispatch paths: addressed by the §12.1 OutcomeEvent-bus enforcement (the bus check is the primary enforcement, the wrapper is convenience). **Closed.**
- Recovery state lost on restart: addressed by the new §11.7 `EndpointRecoveryState` persistence. **Closed.**

### Constraint 5: Invariants enforced at boot, not in tests (addresses all four classes)
A test that verifies an invariant runs in CI and catches drift at PR-time. An invariant enforced at boot catches drift at install-time, including drift introduced by data migrations, manual DB writes, and out-of-band config changes. Both are necessary; tests alone are insufficient because they don't run in production.

**Verification:** the spec's §8.1 lists boot invariants. Each invariant has a corresponding code path that throws on startup if violated.

The 2026-04-27 spec addresses this in §8.1 with five named invariants. **Adequately addressed**, with room for more invariants over time as new drift patterns are discovered.

### Constraint 6: Migration must be reversible per phase (addresses pattern of partial-shipping)
Past attempts shipped partial improvements (capability lifecycle phases 1-3, EP-AGENT-CAP-002, etc.) that improved the system without finishing the architectural goal. The remainder remained on the backlog and was forgotten as new symptoms emerged. The new spec's migration must be designed so that *each phase's value is independent of subsequent phases* — Phase A delivers operability gains regardless of whether Phase E ships, and the platform is no worse off if implementation pauses after Phase B.

**Verification:** for each phase in §7, articulate what *only that phase delivers* and what's preserved if implementation stops after that phase.

The 2026-04-27 spec addresses this in §7 with explicit per-phase value statements ("Phase A alone delivers operability gains"). **Adequately addressed.**

### Constraint 7: Cost capture is universal or it's lying (addresses Class D, specifically the metering gap)
A successful inference call without a corresponding `TokenUsage` row is a metering bug, regardless of which dispatch path served it. CLI subprocess adapters, direct HTTP, MCP service calls, embedding calls — every dispatch produces a metering row.

**Verification:** the watchdog has a Class A detector "outcome events without metering rows" that fires on any drift between the two streams.

The 2026-04-27 spec addresses this in §12.1 (universal token usage capture as an invariant). **Well addressed.**

### Constraint 8: Use-it-or-lose-it economics for subscription providers (newly added)
Subscription pricing inverts the cost-optimization logic. Routing should preferentially use subscription quota when burn rate is lagging the window, throttle when ahead, behave normally when on track. This is a capability the prior architectures didn't model at all — they treated subscription pricing as "$0 per call" without modeling the wasted-quota loss when calls don't happen.

**Verification:** the routing decision audit log records the burn-rate score that influenced the score. The watchdog has detectors for end-of-window underutilization and mid-window over-consumption.

The 2026-04-27 spec addresses this in §6.5 (scoring) and §12.2.1-12.2.3 (cost ledger derivation, agent inspection tool, anomalies). **Newly introduced.**

## Gaps in Attempt #11

For honesty: the 2026-04-27 spec is not perfectly complete against the constraint list. The known gaps:

1. **`capabilityTier` column not retired.** The spec collapses tier to `qualityTier` for routing but doesn't specify removal of the legacy `capabilityTier` column. A follow-up data-model spec should retire it explicitly.
2. **Test-connection vs real-traffic reconciliation.** The watchdog does not yet specifically detect "diagnostic ping passes while real traffic fails" — a concrete incident from the 2026-04-27 debugging session.
3. **`NO-CALL-BUT-MENTIONED` not a watchdog detector.** The agent-loop already has the trace; the watchdog should consume it as a Class A detector for hallucinated tool use.
4. **Artifact provenance / fakery prevention.** Explicitly deferred per §9.1. The next spec in the architectural sequence.
5. **Capability-derived grants.** Explicitly deferred per §9.2. Replaces the static grant model.
6. **Master Data Management for agent identifiers.** Explicitly deferred per §9.3. The agent_id / agentId / cuid problem.
7. **Build phase state machine.** Explicitly deferred per §9.4. Structurally similar to the endpoint state machine in this spec.

The first three are gaps in *this* spec and should be addressed before implementation begins (or noted explicitly as known limitations). The last four are out of scope and tracked for follow-up.

## What "Done" Looks Like

For attempt #11 to be the last attempt at this architectural class, the following must be true after implementation:

1. **No new routing-substrate spec is needed for at least 12 months.** The architectural pattern is stable and accommodates new providers, new models, new agents, new task types without requiring spec-level rework.
2. **Boot invariants catch drift before it ships.** Any change to `PLATFORM_TOOLS`, `TOOL_TO_GRANTS`, agent registry, or pricing that violates an invariant fails CI. Drift is structurally hard. (Initial CI guard landed in [`.github/workflows/audit-routing-invariants.yml`](../../../.github/workflows/audit-routing-invariants.yml), running [`apps/web/scripts/audit-routing-spec-boot-invariants.ts`](../../../apps/web/scripts/audit-routing-spec-boot-invariants.ts) against a baseline of pre-existing violations — new violations block merge, baseline ones stay tracked as backlog items until fixed. This is the *measurement substrate* the rest of attempt #11 is built on.)
3. **Operators can diagnose routing problems without reading logs.** The dashboard at `/admin/routing/health` and the `RoutingAnomaly` table answer 95% of "why did it route there?" questions without anyone running SQL.
4. **The platform is unbillable-by-misconfiguration**, not silently free-tier. Pricing is mandatory at boot for active providers; CLI adapter calls write `TokenUsage`; no dispatch path accrues cost off-the-books.
5. **Subscription quota is treated as a budget to spend, not just a constraint to avoid.** The cost ledger surfaces burn rate; the routing scorer prefers subscription endpoints when lagging; agents can introspect their own subscription headroom via `get_subscription_status`.
6. **The watchdog itself is the most reliable component.** It's a routing client, uses the cheapest non-rate-limited route, can synthesize narrative explanations of anomalies in operator-readable language. If the watchdog is silent, the operator can be confident routing is healthy.

## What This Document Is Not

It is not the architectural spec. The architectural spec is `2026-04-27-routing-control-data-plane-design.md`. This is the *constraint document* — the explicit record of prior attempts that the next attempt must be measurably different from.

It is not a guarantee that attempt #11 will succeed. It is an explicit articulation of what success looks like and what failure modes to watch for.

It is not a substitute for review by someone with operational context. Mark's pattern recognition across the prior attempts is itself the most important constraint; this document codifies what I could mine from the public record (commits, specs, memory entries), but the institutional knowledge of "this is what really happened on attempt #5" lives in his head and should override anything in this document if they conflict.

## Updating This Document

When the next routing-substrate work begins, this document should be updated with:
- Which constraints the implementation actually satisfied vs. compromised on.
- Which new failure modes were discovered during implementation.
- Whether attempt #11 made the cycle stop or just delayed the next iteration.

If a new attempt is required after #11 (call it #12), the first responsibility of #12's spec is to update this document with what #11 taught.

---

**Companion documents:**
- [Routing Control Plane / Data Plane — Design Spec](./2026-04-27-routing-control-data-plane-design.md) — the architectural spec this constrains
- [Routing Architecture — Current State (2026-04-20)](./2026-04-20-routing-architecture-current.md) — pre-attempt-#11 baseline
