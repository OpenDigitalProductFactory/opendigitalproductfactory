# Plan — Routing dead-end visibility: name the real cause instead of guessing

**Umbrella item:** BI-E2CCFAC1 — *Routing dead-ends require a DB write or an engineer to clear — no self-healing, no preflight, no owner-facing recovery on any install*
**Related:** BI-04E4F111 (write-once connection status), BI-5493BBD9 (unprofiled Qwen3.8), BI-91F0E312 (harness records deferrals as failures), BI-0A59F936 (scheduled turns stripped of web tools; absorbed BI-IMP-7E89183D), BI-090221E7 (/finance renders unknown as $0.00), BI-64F2EA96 (marketing approval loop never closes)
**Date:** 2026-08-16 (extended the same day with the remediation slices below)

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

---

# Extension — the remediation slices (same branch, same day)

The naming half above tells the operator the truth; this extension makes the coworkers able to RUN. Seven proven root causes from the live install, implemented as one coherent change because no single one of them alone produces a working coworker.

## 1. Connection status lifecycle — BI-04E4F111

`AiProviderConnection.status` was effectively write-once (the seed upsert updates only `label`; posture updates never touch status), while routing eligibility filters `connection.status === "active"` (`provider-suitability/runtime.ts`). Three repairs:

- `activateProvider` (`lib/govern/activate-provider.ts`) brings the `provider-default-<id>` connection out of `unconfigured`/`disabled` **before** clearance derivation, so every activation path heals the connection with the provider.
- Boot reconciliation (`lib/inference/provider-connection-reconcile.ts`, wired in `instrumentation.ts` with a 20-min net) heals installs already in the split state — only the `disabled` veto behind an `active` provider, only default connections; a deliberately disabled org-scoped connection stays disabled.
- The providers list derives its eligibility badge from `resolveRuntimeConnectionStatus(provider.status, connection.status)` instead of the raw provider status, with a connection-specific remediation line; the provider detail page renders "connection disabled" instead of a green "active" when vetoed.

## 2. Scheduled turns get their web tools — BI-0A59F936 (absorbed BI-IMP-7E89183D)

`resolveAutonomousWorkTools` passed no `externalAccessEnabled`, so `getAvailableTools` stripped every `requiresExternalAccess` tool (search AND the keyless fetch) from every scheduled turn. New `lib/tak/scheduled-external-access.ts`:

- `resolveScheduledTurnExternalAccess(agentId)` — the per-session human toggle's job falls to the agent's standing `web_search` grant (DB-first, registry fallback). Independent of `USE_UNIFIED_COWORKER` by design.
- `scheduledTaskNeedsExternalResearch` + `assertScheduledResearchCapability` — a watch-kind task or research-shaped prompt with no external tool in its resolved surface fails **before** the model runs, with an error naming the missing grant. Completing "ok" with confident unresearched output was the failure mode; both scheduler call sites (loop + forced-tool backstop) now carry the resolved posture.

## 3. Honest endpoint-test harness — BI-91F0E312

Deferred ≠ failed, structurally:

- `endpoint-test-runner.ts`: probe/scenario results carry `outcome: passed|failed|deferred` and `passed: boolean|null` (null = never reached the model). A `LocalProviderCapacityDeferredError` — including a `local-integration-ci` lease claimed mid-run — classifies as deferred.
- A run containing any deferral is `status: "incomplete"`: no `avgScore`, no `ModelProfile` capability writes, and `verifyModels` reports it as `deferred`, not failed.
- `eval-runner.ts` (DE-\* dimension evals): an inconclusive cycle no longer bumps `evalCount`/`profileConfidence` (which dampened the exponential-smoothing weight of the next REAL measurement — how placeholder scores became sticky), writes no manufactured avgScore, and the stale-run reaper records `incomplete` rather than `failed`.

## 4. Re-profile qwen3.8-27b — BI-5493BBD9

Runtime action after 3: re-run the dimension eval so `ModelProfile` carries measured `reasoning`/`codegen`/`toolFidelity` instead of 5 ms discovery estimates. No hand-edited scores — the fix in 3 is what lets a real measurement land at full weight.

## 5. Reachability preflight + coworker visibility — BI-E2CCFAC1 (this BI's remaining half)

- `route-readiness.ts` now evaluates a **confidential** coworker at the payload-screening escalation ceiling (`restricted`) too: the declared level is a floor, screening escalates real turns, and readiness reported "ready" for coworkers whose every real turn died. Blocked-at-ceiling surfaces as not-ready with the escalation named.
- New `lib/coworker-service-catalog/routing-reachability-preflight.ts` + Inngest cron `inference/routing-reachability-preflight` (every 6 h, catalog-registered): dry-runs routing for every production coworker, raises ONE deduplicated owner-visible health issue (`CoworkerRoutingUnreachable`) plus an attention notification on zero-eligible, resolves it on recovery.
- `/platform/ai/runtime-health` gains a "Coworker routing" table (coworker, data class incl. escalation, ready/blocked, why) — coworker turns are an activity class, not a build phase, which is why nothing warned the owner before.

## 6. /finance honesty + burn/revenue/runway — BI-090221E7

- Unrecorded ≠ zero: existence counts gate the copy — "all up to date" only when invoices exist; "Money You Owe" renders "Not recorded → record supplier bills" when no bill has ever been recorded.
- New `lib/finance/burn-runway.ts`: pure `computeBurnRunway` (trailing 90-day burn incl. supplier-contract commitments, revenue, runway) with explicit `unknown` states, `committed-only` basis, `cash-growing`, and a `preRevenueWithBurn` flag; rendered as a four-card row with record-it links, never a fabricated $0.00.
- Proactive half: a `finance-controller` proactivity self-task ("Review burn, revenue, and runway", weekly/twice-weekly) reads the same state and tells the owner what to record or watch. Keyed on the roster coworker — the LIFE-009 conformance gate rejects the `finance-agent` chat persona, which has no Agent row (that identity gap is BI-79298169).

## 7. Marketing approval loop — BI-64F2EA96 (filed this session)

- The landing surface leads with a first-viewport "Waiting on you / In progress" strip: pending drafts, ready-to-publish posts, or stalled briefs (saved briefs with nothing reviewable — the live month-long limbo), each deep-linked.
- The hero CTAs' anchors (`#marketing-approval-queue`, `#marketing-publish-queue`) now actually exist on the queue sections — they previously pointed at nothing.

## Backlog coverage

- **Decision:** `decomposed`
- **Parent:** `BI-E2CCFAC1`
- **Mappings:**
  - Naming half (exclusion buckets → runtime-health/resolve_model_selection) -> BI-E2CCFAC1
  - Connection status lifecycle (activation heal, boot reconcile, UI truth) -> BI-04E4F111
  - Scheduled-turn external access + loud research failure -> BI-0A59F936 (absorbed BI-IMP-7E89183D by merge)
  - Honest endpoint-test harness (deferred ≠ failed, incomplete runs) -> BI-91F0E312
  - Re-profile qwen3.8-27b with measured dimensions (runtime action; depends on the harness fix) -> BI-5493BBD9
  - Reachability preflight + coworker visibility + escalation-ceiling readiness -> BI-E2CCFAC1
  - /finance honesty + burn/revenue/runway + finance-controller self-task -> BI-090221E7
  - Marketing waiting-on-you queue + real hero anchors -> BI-64F2EA96
- **Dependencies:** re-profile depends on the harness fix; the preflight builds on the naming half. Everything else is independently shippable and shipped together here because no single fix alone produces a working coworker (the three-legged failure documented on BI-0A59F936).
- **Governed coverage receipt: blocked by BI-B9403248.** `record_plan_backlog_coverage` was submitted for capsule WC-522D96E3 with planArtifactRef {repo-blob-at-commit, OpenDigitalProductFactory/opendigitalproductfactory, 4093f5131b46b95537d8558268515a13d84a8ca5, this file, blob ae866799ddae0f77dfef5afd92715164e12cfe83} and refused with "Repository artifact ownership is missing or ambiguous for this subject" — claim-at-start leaves the capsule headSha unset and external CLI sessions structurally cannot satisfy the DCO-provenance leg (P1 BI-B9403248). This block records the same mappings the receipt would carry.

## Design grounding

Extends THIS plan (the naming half's declared "next slice"), the marketing progressive-disclosure contract from BI-8AB9C904 (strip added above the existing disclosure, not replacing it), and the scheduled-job catalog/self-task registries as the front doors for new recurring work. Kernel consults: DI-00FC30F08495 (marketing surfacing options; near-tie, operator directive in the session goal settled it), DI-22A333BD5397 (finance explicit-unknown; high confidence). UX-fit manifests: `docs/ux-fit/2026-08-16-marketing-waiting-on-you-strip.ux-fit.json`, `docs/ux-fit/2026-08-16-finance-explicit-unknown.ux-fit.json`.

## Verification (extension) — executed 2026-08-16 evening

- Unit: ~70 new/updated tests across activate-provider, provider-connection-reconcile, scheduled-external-access, endpoint-test-runner (deferral), eval-runner, route-readiness (escalation ceiling), burn-runway, catalog parity, scheduler assertions. `tsc --noEmit` clean.
- Functional, on the contributor preview (lease claimed for the bind, then released so local dispatch could run) against live workspace data:
  - **Re-profile (4):** dimension eval DE-D6D0492A ran the platform's own runner (force mode) against the live model; all 7 dimensions conclusive. ModelProfile moved from 90/52/40 (estimates stamped "evaluated") to measured **90/86/82** — raw toolFidelity 100, confirming the model tool-calls correctly. First attempt DE-FE93C57B hit a 60 s call timeout on one codegen golden and correctly short-circuited without fabricating scores.
  - **Runtime-health (5):** the new Coworker routing table rendered; Platform Admin (confidential, escalates to restricted) read **Blocked** with the escalation named while restricted had zero eligible endpoints, and flipped to **Ready** after the re-profile — the escalated-sensitivity readiness working end-to-end.
  - **/finance (6):** Monthly Burn **Unknown**, Monthly Revenue **None recorded**, Runway **Unknown**, Money You Owe **Not recorded**, Overdue **No invoices recorded yet** — no fabricated $0.00, no false "all up to date".
  - **/customer/marketing (7):** first viewport leads with "5 campaign briefs saved — nothing has reached your review queue yet".
  - **Acceptance turn:** asking the Finance Specialist to record real recurring supplier costs previously died instantly with "No AI model can handle this request" (visible in the same thread's history). It now **routes** (RouteDecisionLog: sensitivity restricted → local qwen3.8-27b, 1 candidate ranked, 14 excluded), **runs** a multi-minute agentic loop on the local model, and **acts** — load_tools, get_finance_period_summary, surface_open/surface_list attempts with a transparent narration of what is still missing.
  - **Residual, filed as BI-79298169:** the coworker cannot COMPLETE the recording — `surface_*` tools reject with "The executing coworker identity is not active" (finance-agent is a routing persona with no Agent row), and no write tool exists for supplier commitments/bills (the seeded provider-cost-intake service references a nonexistent skill). This is an identity/tool-coverage gap, not a routing gap, and blocks any model — cloud or local — from finishing the job.
