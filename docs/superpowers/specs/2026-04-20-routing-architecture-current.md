# Routing architecture (current state as of 2026-04-20)

**Status: CURRENT.** This document describes how DPF chooses which LLM handles a given call. It supersedes the earlier design docs listed at the bottom — those remain for historical context but should not be consulted for current behaviour.

## Principle

> The routing layer picks the right LLM dynamically for each call based on the task's requirements and the candidate pool's capability tier. There are no hard pins from agents to specific providers/models. The system adapts as models are added or retired.

Captured in memory: `feedback_no_provider_pinning`.

## The pipeline

```
caller
  └─> routeAndCall(messages, systemPrompt, sensitivity, options)
      ├─ 1. inferContract(taskType, messages, tools, outputSchema, routeContext)
      │      → RequestContract
      │         • taskType, reasoningDepth, budgetClass
      │         • requiredCapabilities (toolUse, structuredOutput, streaming, codeExecution,
      │           webSearch, computerUse, imageInput, pdfInput)
      │         • minimumDimensions (reasoning/codegen/toolFidelity/… score floor)
      │                ← translated from task's minimumTier via TIER_MINIMUM_DIMENSIONS
      │         • minimumCapabilities (agent-level capability floor, EP-AGENT-CAP-002)
      │         • minContextTokens, sensitivity, modality
      │
      ├─ 2. loadEndpointManifests()  → one EndpointManifest per active ModelProfile
      │      Each manifest carries: providerId, modelId, qualityTier,
      │      reasoning/codegen/toolFidelity/etc. scores, pricing, supportsToolUse,
      │      sensitivityClearance, providerTier (bundled|user_configured).
      │
      ├─ 3. routeEndpointV2(manifests, contract, policies, overrides)
      │    ├─ Stage 1: pin override (exists but is intentionally empty in this install)
      │    ├─ Stage 2: blocked endpoints removed
      │    ├─ Stage 3: policy filter (PolicyRule conditions applied)
      │    ├─ Stage 4: hard filter — excludes endpoints that fail
      │    │           • sensitivity clearance
      │    │           • minimumCapabilities (agent floor)
      │    │           • requiredCapabilities (task)
      │    │           • minimumDimensions (tier floor — NEW in PR #126)
      │    │           • model class (chat / reasoning / code)
      │    │           • context window
      │    │           • rate-limit pre-flight
      │    ├─ Stage 5: cost-per-success ranking
      │    │           • successProb = capability × quality × confidence × (1 − failureRate)
      │    │           • rankScore = 1000 / (cost / successProb) when cost > 0
      │    │                       = successProb × 100  when cost = 0 (free/bundled)
      │    │                       = successProb × 50   when cost unknown (penalised)
      │    │           • budgetClass blends cost vs quality weights
      │    ├─ Stage 6: tier preference — user_configured > bundled (PR #107)
      │    ├─ Stage 7: capacity penalty — rate-limited endpoints get penalised
      │    └─ Stage 8: select winner + build diverse fallback chain
      │
      └─ 4. callWithFallbackChain(decision, messages, systemPrompt, tools)
           Dispatches through the selected endpoint's execution adapter:
             • codex-cli     for providerId="codex"        (OpenAI sub OAuth)
             • claude-cli    for providerId="anthropic-sub" (Claude sub OAuth)
             • chat          for direct API keys
             • responses     for ChatGPT web API
           Falls through the chain on failure (auth, rate-limit, timeout).
```

## Task → tier map

The canonical task-type floor. Encoded in [BUILT_IN_TASK_REQUIREMENTS](../../apps/web/lib/routing/task-requirements.ts) and overridable per-install via the `TaskRequirement` DB table.

| Task type | Min tier | Required capabilities | Preferred score floor |
|---|---|---|---|
| greeting | adequate | — | conversational ≥ 40 |
| status-query | adequate | — | instructionFollowing ≥ 40 |
| summarization | adequate | — | instructionFollowing ≥ 50 |
| data-extraction | strong | structuredOutput | structuredOutput ≥ 70 |
| web-search | strong | toolUse | toolFidelity ≥ 60 |
| creative | strong | — | conversational ≥ 60, reasoning ≥ 50 |
| reasoning | frontier | — | reasoning ≥ 80 |
| code-gen | frontier | toolUse | codegen ≥ 75 |
| tool-action | frontier | toolUse | toolFidelity ≥ 70 |

## Tier → dimension floor

Encoded in [TIER_MINIMUM_DIMENSIONS](../../apps/web/lib/routing/quality-tiers.ts). Injected into `contract.minimumDimensions` by `inferContract` based on the task's `minimumTier`.

| Tier | codegen | toolFidelity | reasoning | instructionFollowing |
|---|---|---|---|---|
| frontier | ≥ 85 | ≥ 85 | ≥ 85 | (not set — other dims cover it) |
| strong | ≥ 70 | ≥ 70 | ≥ 70 | |
| adequate | ≥ 50 | ≥ 50 | ≥ 50 | |
| basic | — | — | — | (no floor) |

## Model capability profiling

Each `ModelProfile` carries:

- **Dimension scores** (reasoning, codegen, toolFidelity, instructionFollowing, structuredOutput, conversational, contextRetention) — 0–100.
- **qualityTier** — derived from scores, one of frontier/strong/adequate/basic.
- **capabilities** — toolUse, structuredOutput, streaming, webSearch, imageInput, pdfInput, computerUse.
- **pricing** — `inputPerMToken`, `outputPerMToken`. Seeded by model-name patterns for known families; updated by discovery/eval for unknown models.
- **modelStatus** — active / degraded / retired.

Profiles are populated by:
1. Seed data in `packages/db/data/model-profiles.json` + `seedModelPricing()` / `ensureBuildStudioModelConfig()` in `packages/db/src/seed.ts`.
2. Auto-discovery — on provider activation, models returned by the provider's `/v1/models` endpoint are profiled into rows with default scores, then evaluated (EP-INF-006 exploration + EP-MODEL-CAP-001-D revalidation).
3. Admin UI — operators can override dimension scores and tier labels per install.

## Agent-level overrides

`AgentModelConfig` per agent:
- `minimumTier` — agent-level minimum quality tier (e.g. build-specialist requires `strong`).
- `budgetClass` — `quality_first` | `balanced` | `minimize_cost`.
- `minimumCapabilities` — hard floor (e.g. `{ toolUse: true }` for any agent that uses MCP tools).
- `minimumContextTokens` — context window requirement.
- **`pinnedProviderId`, `pinnedModelId` — deliberately unused.** Seed leaves these null. Admin UI still supports setting them but `[pin-audit]` in `instrumentation.ts` logs a warn on every boot if any row has a non-null pin, so regressions are visible.

The agent's floor **ANDs** with the task's floor — whichever is stricter wins.

## What happens when models come and go

- **New model via discovery**: profiled into `ModelProfile` with auto-discovery scores. Enters the candidate pool on the next routing call. Competes on the same contract. No agent-side change required.
- **Model retired** (status=retired or modelStatus=disabled): hard-filter excludes it. Routing picks the next-best candidate. No agent-side change.
- **Provider OAuth expires**: fallback chain diversifies across providers. If codex OAuth expires, routing falls cleanly to anthropic-sub for tool-action tasks.
- **Wrong model selected**: the fix is on the tiering side — adjust the task's `minimumTier` or dimension thresholds, or fix the model's capability profile, or add a `requiredCapability`. Never a pin.

## Regression test

[`apps/web/lib/routing/tier-contract.test.ts`](../../apps/web/lib/routing/tier-contract.test.ts) — for each task type in `BUILT_IN_TASK_REQUIREMENTS`:

1. Call `inferContract(taskType, canonical_message, tools)`.
2. Call `routeEndpointV2(manifests, contract, policies, overrides)`.
3. Assert selected model's `qualityTier >= task.minimumTier`.
4. Assert `supportsToolUse` / `structuredOutput` / `streaming` if required.
5. Assert dimension scores meet `preferredMinScores` floors.

9/9 passing as of PR #126. A live equivalent lives at [`apps/web/scripts/probe-tier-contract.ts`](../../apps/web/scripts/probe-tier-contract.ts) for diagnosing the live install.

## History and superseded docs

The following earlier design documents each tackled some slice of this problem and reached partial completion. This document consolidates the current state. They remain in the repository for historical context only:

| Date | Doc | What it addressed | Status |
|---|---|---|---|
| 2026-03-16 | `orchestrated-task-routing-design.md` | First framing: task routing orchestration | Superseded |
| 2026-03-18 | `ai-routing-and-profiling-design.md` | Pipeline v1 + endpoint manifest | Superseded |
| 2026-03-19 | `model-level-routing-profiles-design.md` | Per-model scores vs per-provider | Superseded |
| 2026-03-20 | `adaptive-model-routing-design.md` | Adaptive tier choice based on demand | Superseded |
| 2026-03-20 | `capability-detection-and-routing-design.md` | Capability detection on provider activation | Incorporated (EP-MODEL-CAP-001) |
| 2026-03-29 | `model-routing-simplification-design.md` | Simplification pass | Partially superseded |
| 2026-03-30 | `db-driven-model-classification-design.md` | DB-driven classification | Incorporated |
| 2026-04-03 | `utility-inference-tier-design.md` | Utility-tier cheap routing | Concept incorporated as adequate tier |
| 2026-04-04 | `provider-activation-routing-reconciliation-design.md` | Reconcile on provider activation | Incorporated |

## Related memory

- `feedback_no_provider_pinning` — routing is dynamic, no pins.
- `feedback_evidence_before_diagnosis` — when routing misbehaves, query state before speculating.
- `feedback_fix_seed_not_runtime` — a routing misbehaviour caused by stale seed data is fixed in the seed, not the runtime path.

## PRs that assembled the current state (recent)

- #107 — Inngest self-sync on boot + provider-tier preference (user_configured > bundled)
- #112 — codex-cli tool parser accepts wrapper variants
- #118 — claude-cli tool parser rescue from assistant text
- #124 — remove stale provider-config overrides from docker-entrypoint
- #125 — remove all provider pins from Prisma seed + boot audit
- #126 — pricing seed + stop auto-requiring webSearch cap + tier-floor → minimumDimensions + regression test
