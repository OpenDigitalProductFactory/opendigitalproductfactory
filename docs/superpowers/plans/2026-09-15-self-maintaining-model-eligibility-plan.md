---
status: active
---

# Self-Maintaining Model Eligibility (Plan)

**Backlog item:** `BI-7F2FBDA3` · **Direction (operator, 2026-09-15):** providers retire and introduce models almost weekly; the platform must absorb that proactively and without a human.

## Why

On 2026-09-07 every governed reviewer for BI-648F01A0 failed to route: the
Codex/ChatGPT endpoint was excluded by a **hardcoded** set
(`CHATGPT_CODEX_UNSUPPORTED_MODELS = {"gpt-5.3-codex"}`), the configured
preference never moved to a supported successor, and nothing re-checked the
provider until the nightly 03:10 discovery. Anything declared in source about
model identity is stale the day it merges.

## What already exists (this plan extends it; nothing is duplicated)

| Substrate | Where | Role |
|---|---|---|
| Nightly discovery + profiling | `inference/model-discovery-refresh` → `runModelRevalidation` → `autoDiscoverAndProfile` | cadence |
| Presence reconciliation | `reconcileDiscoveredModelPresence` (retire after 2 misses, re-admit when re-listed) | lifecycle |
| Stale codex pin repair | `clearStaleCodexPins` | the only successor logic, codex-only, discovery-time only |
| Reachability preflight | `routing-reachability-preflight` (6-hourly, owner-visible issue on zero eligible models) | alarm |
| Learned-override channel | `ModelProfile.capabilityOverrides` (admin `toolUse` override; discovery never clobbers it) | storage |
| Audit | `ModelCapabilityChangeLog` | provenance |

## Phases

| # | Deliverable | Module | Contract |
|---|---|---|---|
| A | **Learned per-auth-mode eligibility.** `capabilityOverrides.authEligibility[<authMethod>] = { supported, source: discovery \| runtime-refusal \| seed, learnedAt, expiresAt?, reason? }`. Discovery under an auth mode re-admits every listed model; a provider refusal at inference benches the model for 24 h; the checked-in Codex set is consulted only when nothing was learned. | `apps/web/lib/routing/model-auth-eligibility.ts`; wired in `routing/loader.ts` (`profileToManifest`), `inference/ai-provider-internals.ts` (codex discovery), `routing/fallback.ts` (refusal path) | Learned always beats seed; a refusal record expires; every change writes `ModelCapabilityChangeLog`. |
| B | **Family successor.** An unavailable preferred model resolves to the newest eligible model in the same family on the same provider (tier → recency → version), from the already-fenced candidate set, and the route resolution records `successorOf`. | `apps/web/lib/routing/model-successor.ts`; wired in `routing/preference-finalization.ts` | Never crosses providers or policy fences; `RoutePreferenceResolution.applied[].successorOf`. |
| C | **Refusal-triggered re-discovery.** `inference/provider-catalog-refresh.requested` runs `autoDiscoverAndProfile(providerId)` on demand, quiescence-gated, debounced 10 min per provider, then invalidates the routing loader cache. | `apps/web/lib/queue/functions/provider-catalog-refresh.ts` | Enqueue never fails the inference that noticed the refusal. |
| D | **Unroutable-floor alarm.** `get_ai_platform_posture` gains `unroutableFloors`: production coworkers whose floor + residency has no eligible endpoint, from `computeCoworkerRoutingReachability`. | `apps/web/lib/ai-platform-posture/get-ai-platform-posture.ts` | Honest zero: an empty list means every production coworker can route. |

## Backlog coverage

- Decision: atomic
- Parent: `BI-7F2FBDA3`
- Learned per-auth-mode eligibility, family successor, refusal-triggered re-discovery, unroutable-floor alarm -> `BI-7F2FBDA3`
- Dependencies: builds on `BI-EB6DBAF0` (local-CI memory sampler) and the reviewer-chain findings on `BI-D0A0A10B`
- Receipt: blocked-by: no initiative scope baseline exists for BI-7F2FBDA3 — the readiness receipt chain cannot mint one on this install until reviewer routing is unblocked (BI-D0A0A10B), which is the very defect this plan removes
- Rationale: the four phases are one routing contract. Learned eligibility without successor resolution leaves a refused pin stranded on generic ranking; a successor without learned eligibility keeps selecting the refused model; on-demand re-discovery is what makes both current between nightly runs; and the alarm is only honest once the other three define "unroutable". Shipping any one alone would reproduce the 2026-09-07 outage in a new shape.

## Out of scope

The data-handling residency policy itself (WWWD): this work keeps the catalog
honest inside whatever residency the organization set. Measured capability
probes beyond what discovery extracts today are a follow-on.

## Acceptance

- A model the provider refuses under the active auth mode is excluded on the next route with no code change, and re-admitted when discovery lists it again.
- A pinned model that retires routes to its family successor with an audit row.
- A refusal triggers provider re-discovery within the debounce window.
- Posture reports every floor with no eligible endpoint.
