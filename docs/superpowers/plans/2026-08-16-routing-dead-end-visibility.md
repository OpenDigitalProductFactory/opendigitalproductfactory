# Plan — Routing dead-end visibility: name the real cause instead of guessing

**Backlog item:** BI-E2CCFAC1 — *Routing dead-ends require a DB write or an engineer to clear — no self-healing, no preflight, no owner-facing recovery on any install*
**Related:** BI-04E4F111 (write-once connection status), BI-5493BBD9 (unprofiled Qwen3.8), BI-91F0E312 (harness records deferrals as failures)
**Date:** 2026-08-16

## Problem

Two routing dead-ends were found on the live install in one session. Both were invisible to the owner, unfixable through the product, and fatal to the AI coworkers.

1. **Connection switched off behind an active provider.** `anthropic-sub` and `codex` read `active` with twelve Claude models while every endpoint was excluded as *"outside the request allowlist"* — their `AiProviderConnection.status` was `disabled`, and routing filters on the connection (`provider-suitability/runtime.ts:43`). Recovery required raw SQL.
2. **Unsatisfiable policy.** A finance coworker turn classifies `restricted` → `residency=local_only`. Only `local` holds restricted clearance, and the local model fails its own quality floor on unprofiled placeholder scores. Zero eligible endpoints, by construction.

In both cases the router **already knew the exact reason** — `getExclusionReasonV2` computes one per endpoint and `routeEndpointV2` returns them on `decision.excludedReasons`. Every consumer then discarded them and substituted a hardcoded guess:

> "Activate a provider that satisfies this phase's requirements (tools, context, sensitivity) in Providers & Routing."

On an install whose providers were already active, that instruction sent the owner to a page where everything read healthy, with no way forward. `pipeline-v2.ts` already acknowledges this failure mode in-comment — a prior fix logged the reasons and improved the chat copy, but the structured flag consumed by the runtime-health surface still guessed.

## Scope of this change

The **naming** half of BI-E2CCFAC1: make the dead-end legible where it is already rendered. Deliberately *not* in scope here (tracked separately on the BI): boot reconciliation of provider↔connection state, the scheduled reachability preflight, and auto-heal.

## Design

### 1. `apps/web/lib/inference/routing-exclusion-buckets.ts` (new, pure)

Reduces a raw `excludedReasons` list to one actionable cause.

- `stripEndpointPrefix` — removes the `"<endpointId>: "` prefix, preserving reasons whose own text contains `": "` (e.g. `Context window too small: 8192 < 32000`).
- `bucketExclusionReason` — classifies against the stable phrases emitted by `getExclusionReasonV2` into: `connection-excluded`, `sensitivity-clearance`, `quality-floor`, `capability-floor`, `context-window`, `endpoint-status`, `model-class`, `other`.
- `dominantExclusion` — returns the most common bucket with counts, a verbatim sample, and the full breakdown. Ties break toward the more actionable cause rather than input order.
- `explainExclusion` — plain-language message + remediation + destination per bucket.

Two deliberate properties:

- **An unrecognised reason becomes `other`, never a neighbouring bucket.** Absorbing a new exclusion into a known one would render a remediation the operator cannot act on. `other` surfaces the verbatim router reason instead.
- **No bucket says "activate a provider."** That string is the guess being replaced. The `connection-excluded` remedy explicitly directs attention to the *connection* rather than the provider — the distinction that cost this install its routing.

### 2. `apps/web/lib/inference/phase-model-resolution.ts` (edit)

The `no-eligible-endpoint` branch of `resolveRoutedPhase` now derives its flag from `decision.excludedReasons` via the module above, passing `contract.sensitivity` so a clearance block names the data class. Falls back to the original generic string only when there is genuinely nothing to summarise (zero endpoints considered).

This flows to `/platform/ai/runtime-health` and to `resolve_model_selection` (MCP) with no change at either call site.

## Why this surface

`/platform/ai/runtime-health` already does the right thing — verdict banner, per-phase table, severity-flagged errors, remediation actions, "Ask coworker to investigate". It needed a truthful reason, not a rebuild.

Its remaining limitation is recorded on BI-E2CCFAC1 and **not** addressed here: it covers only the five Build Studio phases, so coworker turns (an activity class, not a build phase) are still outside its view. That is why nothing warned the owner that the Finance Specialist could not route. Per-coworker readiness *does* already exist — `projectCoworkerRouteReadiness` in `coworker-service-catalog/route-readiness.ts`, consumed by `/platform/ai/agent/[agentId]` and the roster — but it evaluates at the agent's **declared** sensitivity (`confidential`) and never at the level payload screening escalates to at runtime (`restricted`), so it can report ready for a coworker whose real turns fail. Closing that is the next slice.

## Verification

- `apps/web/lib/inference/routing-exclusion-buckets.test.ts` — 24 tests. Reason strings are the verbatim shapes emitted by `getExclusionReasonV2`; if they change there, these tests are the tripwire. Includes reproductions of both live failures (12 allowlist + 3 quality; 22 clearance + 8 quality + 4 capability).
- `apps/web/lib/inference/phase-model-resolution.test.ts` — 3 added tests asserting the remediation never says "activate a provider" for a connection exclusion, names the data class for a clearance block, and still falls back when there is nothing to summarise.
- Functional check on the live install: drive a blocked route and confirm `/platform/ai/runtime-health` names the dominant cause.

## Risks

- **Reason-string coupling.** Bucketing matches on phrases from `getExclusionReasonV2`. Mitigated by testing against verbatim strings and by `other` degrading safely to the raw reason.
- **Over-confident attribution.** A dominant bucket is not the only cause; the message states counts (`3 of 4`) rather than implying totality, and the full breakdown is retained on the returned object.
