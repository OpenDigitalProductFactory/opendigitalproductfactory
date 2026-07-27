# AI Cockpit & Model Routing — SysML Architecture Note

| Field | Value |
| --- | --- |
| Date | 2026-06-14 |
| Status | Historical baseline — superseded by the live AI-routing projection |
| Notation | SysML v2 (`sysml2` EA notation) — viewpoint over the canonical DPF EA graph |
| Package | `PKG-AIC` "AI Cockpit & Model Routing" |
| Owner | Enterprise Architect, AI Platform team |
| Source design | [`2026-06-14-odysseus-review-depth-pass.md`](2026-06-14-odysseus-review-depth-pass.md), [`2026-06-14-odysseus-ux-routing-model-review.md`](2026-06-14-odysseus-ux-routing-model-review.md) |
| Substrate spec | [`2026-06-14-sysml-architecture-substrate-design.md`](../superpowers/specs/2026-06-14-sysml-architecture-substrate-design.md) |
| Current projection | [`apps/web/lib/ea/ai-routing-architecture-registry.ts`](../../apps/web/lib/ea/ai-routing-architecture-registry.ts) + [`ai-routing-architecture-extract.ts`](../../apps/web/lib/ea/ai-routing-architecture-extract.ts) |

> **Superseded current-state writer (2026-07-26).** This note preserves the first
> AI-cockpit SysML baseline and its original decisions. The seed-time model writer
> has been replaced by the versioned Parity Engine projection above, which preserves
> the `sysml:aic:` stable identities while adding the BPMN route, ArchiMate
> realization, and materialized cross-notation links. Use the
> [routing architecture design](../superpowers/specs/2026-07-26-ai-routing-architecture-explainability-design.md)
> for current viewpoint ownership and status.

This is the first real SysML v2 model seeded over DPF's current state. It applies the
SysML substrate (Phase 1, landed in this change) to the Odysseus-derived AI-cockpit /
use-case model-routing / coworker-thread-receipt / inbound business-email design. The
canonical model is the DPF EA graph (`EaElement`/`EaRelationship`); the markdown here is
the human-readable companion and the source for the seed. Per the substrate spec's stance,
runtime/DB/portal validation of the EA seed is the **deferred follow-up thread**; the
routing/email behaviour (Slice E1) is verified by source-local tests now.

**Legend.** `[D]` = deterministic fact (grounded in code/schema). `[J]` = architect-authored
judgment (design intent, not yet realized). Verification status: **green** = automated test
passes today; **planned** = future slice.

---

## SysML Architecture Note (skill template)

- **Scope:** AI inference routing (use-case policy matrix, receipts, fallback/escalation),
  coworker-thread governance metadata, and inbound business-email processing. Changes the
  AI platform decomposition and the routing data contract; adds a SysML model package.
- **Changed requirements/constraints:** REQ-AIC-1…9 + CON-AIC-1 (below). REQ-AIC-5 (email→utility)
  realized this change; the rest are modeled and allocated, realized across later slices.
- **Changed interfaces/ports:** `routeAndCall` options now carry the `email-triage` task type +
  `interactionMode:"background"` `[D]`; `TaskRequirement` gains `budgetClassDefault`/
  `reasoningDepthDefault`/`residencyPolicy` `[D]`. Planned: `ThreadTurnReceipt` read view,
  `tasks/submit` inbound→coworker, inbound email webhook.
- **Allocations:** routing obligations → `pipeline-v2`/`request-contract`/`task-requirements`;
  receipts → `RouteDecisionLog`/`RouteOutcome`/`AdapterRunTelemetry`; email → marketing inbound
  loop + Communication Fabric; thread → `AgentThread`. (Full table below.)
- **Verification cases:** VC-AIC-E1, VC-AIC-MATRIX, VC-AIC-SYSML green today; others planned.
- **Data authority impact:** No new source-of-truth tables. Routing authority stays in the
  routing pipeline + `TaskRequirement`; receipts stay in the three telemetry tables; the SysML
  model is seeded into the existing EA graph (no new EA tables — substrate spec §3 boundary).
- **EA/current-state catch-up:** New `sysml2` notation + two viewpoints + this model package +
  cross-notation `sysml_allocates`/`sysml_traces`/`sysml_verifies` bridges to ArchiMate.
- **Open architecture risks:** (1) EA seed not runtime-validated from the worktree (deferred).
  (2) `residencyPolicy="local_only"` left unset by default to avoid starving no-local installs —
  privacy hardening is an operator opt-in. (3) Receipt view + thread fields are modeled but
  unbuilt; tracked as REQ-AIC-2/9.

---

## 1. Requirements (`requirement`)

Stable IDs are the `infraCiKey`s in the EA seed (`sysml:req:REQ-AIC-N`).

| ID | Requirement | Status |
| --- | --- | --- |
| REQ-AIC-1 | **Use-case model routing.** Every LLM call is routed by use case (`taskType`) through a governed policy matrix, not a single global model setting. | green (matrix load-bearing) `[D]` |
| REQ-AIC-2 | **Visible model receipt.** Each coworker turn exposes requested policy, actual responding model, and any fallback/escalation. | planned `[J]` |
| REQ-AIC-3 | **No silent frontier escalation for sensitive work.** Privacy-sensitive use cases must not silently escalate to a frontier/cloud model; any escalation carries a reason code. | planned `[J]` |
| REQ-AIC-4 | **Fallback/escalation auditability.** Fallback and escalation are recorded as reason-coded evidence. | partial — fallback recorded `[D]`; escalation reason codes planned `[J]` |
| REQ-AIC-5 | **Email triage on the utility tier.** Inbound business-email triage routes to the utility tier (cheap/local-preferred, never frontier) and minimize-cost. | **green** `[D]` |
| REQ-AIC-6 | **Inbound email → coworker routing.** A triaged email can be handed to the right coworker via the inbound→coworker contract (`tasks/submit`). | planned `[J]` |
| REQ-AIC-7 | **Draft-never-send.** Email replies are drafted and require human approval; never auto-sent. | partial — `OutboundDraft(status="pending-review")` exists `[D]` |
| REQ-AIC-8 | **Business-mailbox transport via OAuth.** Inbound business email is ingested via OAuth/provider-push (Graph/Gmail/Postmark), not stored passwords (conduit-not-broker). | planned `[J]` |
| REQ-AIC-9 | **Durable thread governance metadata.** Coworker threads carry `memoryMode`, durable `attachedSources`, `compactionState`, and a decision link. | planned `[J]` |

## 2. Constraint / parametric (`constraint`)

**CON-AIC-1 — Routing policy constraint.** The selected endpoint's tier, residency, and budget
class are a function of the use case's `(sensitivity × residencyPolicy × budgetClass × minimumTier)`.
Invariants:

- `minimumTier(email-*) = adequate` ⇒ frontier endpoints are excluded for email use cases. `[D]`
- `budgetClass(email-*) = minimize_cost` ⇒ cost-per-success ranking prefers cheap/local. `[D]`
- `residencyPolicy = local_only ⇒ only local/on-prem endpoints eligible` (operator opt-in). `[D]`
- `sensitivity ∈ {confidential, restricted} ⇒ no silent escalation to frontier` (REQ-AIC-3). `[J]`

This constraint is realized by `inferContract()` translating the `TaskRequirement` into a
`RequestContract`, and by `routeEndpointV2()` hard-filtering on tier/residency then ranking by
cost-per-success. `[D]`

## 3. Part definitions (`part_definition`) and allocations

Each block is **allocated** (`sysml_allocates`) to the existing substrate that realizes it.

| Block (ID) | Realizing substrate (allocation) | Satisfies |
| --- | --- | --- |
| `PART-AIC-router` Routing Policy Engine | `apps/web/lib/routing/pipeline-v2.ts` (`routeEndpointV2`) `[D]` | REQ-AIC-1 |
| `PART-AIC-contract` Request Contract Builder | `apps/web/lib/routing/request-contract.ts` (`inferContract`) `[D]` | REQ-AIC-1, REQ-AIC-5 |
| `PART-AIC-matrix` Use-Case Policy Matrix | `apps/web/lib/routing/task-requirements.ts` (`TaskRequirement`) `[D]` | REQ-AIC-1, REQ-AIC-5 |
| `PART-AIC-receipt` Turn Receipt View | join of `RouteDecisionLog`+`RouteOutcome`+`AdapterRunTelemetry` `[D]` (view unbuilt `[J]`) | REQ-AIC-2, REQ-AIC-4 |
| `PART-AIC-reasoncodes` Reason Code Registry | scattered unions today (`InferenceError.code`, `EndpointUnavailableReason`, …) `[D]`; consolidation planned `[J]` | REQ-AIC-3, REQ-AIC-4 |
| `PART-AIC-emailpipe` Inbound Email Pipeline | `apps/web/lib/marketing/channels/email-postmark/responder.ts` `[D]` (generalization planned `[J]`) | REQ-AIC-5, REQ-AIC-6, REQ-AIC-7 |
| `PART-AIC-emailtransport` Email Transport | Postmark inbound webhook `[D]`; Graph/Gmail OAuth poller planned `[J]` | REQ-AIC-8 |
| `PART-AIC-thread` Coworker Thread | `AgentThread` (`packages/db/prisma/schema.prisma`) `[D]`; +4 governance fields planned `[J]` | REQ-AIC-9 |
| `PART-AIC-fabric` Communication Fabric | `apps/web/lib/communications/*` + fabric spec §14.4 `[D]`/`[J]` | REQ-AIC-6 |

## 4. Interfaces / ports (`interface_definition`)

| ID | Interface | Where | Status |
| --- | --- | --- | --- |
| `IF-AIC-routeandcall` | `routeAndCall(messages, system, sensitivity, options)` | `routed-inference.ts` `[D]` | green |
| `IF-AIC-receipt` | `ThreadTurnReceipt` (read join of the 3 telemetry tables) | planned `[J]` | planned |
| `IF-AIC-tasksubmit` | `tasks/submit` inbound→coworker | fabric spec §14.4 `[J]` | planned |
| `IF-AIC-webhook` | `/api/communications/<provider>/webhook` inbound email | convention `[J]` | planned |

## 5. State machines (`state`)

**SM-EMAIL — Inbound email lifecycle** `[D]` for the built path:
`received → pre-filtered → classified → { spam → dropped | qualified/support/other → engagement-linked? → drafted → pending-approval → published }`.

**SM-ROUTE — Route decision** `[D]`:
`requested → capability-filtered → cost-ranked → selected → { dispatched → success | failure → fallback(reason) → retry | exhausted → error }`. Escalation-to-higher-tier with reason code is `[J]` (REQ-AIC-3/4).

**SM-THREAD-PRIVACY — Thread memory mode** `[J]` (REQ-AIC-9):
`normal ↔ scoped (retrieval blocked) ↔ private (persist + retrieval blocked)`.

## 6. Verification cases (`verification_case`)

| ID | Verifies | Evidence | Status |
| --- | --- | --- | --- |
| VC-AIC-E1 | REQ-AIC-5 | `apps/web/lib/routing/task-requirements.email.test.ts` | **green** |
| VC-AIC-MATRIX | REQ-AIC-1 | `apps/web/lib/routing/request-contract.email.test.ts` | **green** |
| VC-AIC-SYSML | substrate (Phase 1) | `packages/db/src/seed-ea-sysml2.test.ts`, `seed-ea-viewpoints.test.ts` | **green** |
| VC-AIC-DRAFT | REQ-AIC-7 | `OutboundDraft.status="pending-review"` assertion | planned |
| VC-AIC-RECEIPT | REQ-AIC-2 | receipt-view join test | planned |
| VC-AIC-THREAD | REQ-AIC-9 | thread-metadata migration + test | planned |
| VC-AIC-TRANSPORT | REQ-AIC-8 | OAuth inbound poller integration test | planned |

## 7. Traceability summary

```
REQ-AIC-1 ──satisfies── PART-AIC-router, PART-AIC-contract, PART-AIC-matrix ──verifies── VC-AIC-MATRIX ✓
REQ-AIC-5 ──satisfies── PART-AIC-matrix, PART-AIC-contract, PART-AIC-emailpipe ──verifies── VC-AIC-E1 ✓
CON-AIC-1 ──refines──── REQ-AIC-1, REQ-AIC-3, REQ-AIC-5
PART-AIC-router ──sysml_allocates──▶ archimate:application_component (routing pipeline)
REQ-AIC-5 ──sysml_traces──▶ archimate:business_capability (inbound business-email processing)
VC-AIC-E1 ──sysml_verifies──▶ archimate:event_evidence (test run evidence)
```

## 8. What landed in this change vs. what is modeled-for-later

**Landed + verified `[D]`:**
- SysML v2 notation, two viewpoints, cross-notation bridges (Phase 1 substrate).
- Use-case policy matrix made load-bearing: `TaskRequirement` posture defaults honoured by
  `inferContract` (REQ-AIC-1 / VC-AIC-MATRIX).
- Email triage pinned to the utility tier (REQ-AIC-5 / VC-AIC-E1), wired into the live
  marketing inbound responder.
- This historical model was seeded into the EA graph. Its stable identities are now
  defined by `ai-routing-architecture-registry.ts` and reconciled by
  `ai-routing-architecture-extract.ts`; runtime projection evidence is owned by
  `BI-AA314BF4`.

**Modeled, realized later `[J]`:** REQ-AIC-2 (receipt view), REQ-AIC-3/4 (escalation reason
codes), REQ-AIC-6 (tasks/submit), REQ-AIC-8 (OAuth transport), REQ-AIC-9 (thread fields).
These are the next slices, each with a planned verification case above.
