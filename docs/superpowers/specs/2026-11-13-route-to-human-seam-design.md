---
status: draft
---

# One routeToHuman seam: design

**Backlog:** BI-5E067004 (keystone of EP-8717D32C). **Plan:** [`2026-11-13-route-to-human-seam.md`](../plans/2026-11-13-route-to-human-seam.md).
**Principle:** `principles/escalation-is-a-gate-not-a-trust-tier`. A person is engaged only when the action is damaging, or when nothing recorded can steer it.

## Problem

The escalation gate (`resolveDecisionEscalation`, BI-6B3DA9DD) runs only on the coworker MCP tool path. Background producers write owner-attention issue reports directly: build-stall escalation, PR delivery reconciliation, PR follow-through, the assurance merge gate and the index sweep. In the 14 days to 2026-11-13 there were 91 such reports. None was consulted against doctrine, and 57 were still with the owner. Most named mechanical blockers an agent can fix, such as PIR-QGQUH, a failing Prose Lint Guard.

## Design

1. **One seam.** `apps/web/lib/govern/authority/route-to-human.ts` is the only code that may write an owner-attention report: `selfFixClass` set, or `build-stall-escalation` with an owner notification. Producers pass:
   - the producer id and the subject;
   - the blocking facts;
   - the damage declarations: consequence, threshold, regulation, sensitivity, risk tier and propose boundary.
2. **Damage first.** Damaging declarations go to a person without a consult, exactly as before. This is tighten-only.
3. **A decisive consult.** Otherwise the seam asks the owning scope, WWMD for platform work, through `principle_decide`. It offers three options, `resume`, `route-to-agent` and `escalate`, with a **fixed feature vector per blocker class**. The old responder was deleted because it sent no features and every option scored 0. The recorded result becomes a decision basis, and `resolveDecisionEscalation` returns `decided`, `independent-review` or `human`.
4. **The non-owner route reuses existing substrate.** An ordinary issue report (`type: routed-repair`, no `selfFixClass`) is projected by issue-report triage into an agent-pullable backlog item. The build is not abandoned and its item is not parked (BI-B6894001). WWMD chose this over a new queue table (DI-82749A6FBEA1).
5. **Every owner report says why.** It states the damaging reason, or which scope could not decide and why.
6. **A CI guard.** `scripts/check-no-unrouted-owner-escalation.mjs` in the `check-no-*` loop fails on an owner-attention literal outside the seam.

## Research: comparable implementations

- **PagerDuty Event Orchestration.** Events pass one rules engine before anyone is paged. Rules suppress, route to automation, or page by condition. *Adopted:* one routing seam in front of every producer, with automation as a first-class destination. *Rejected:* rules authored ad hoc per service. DPF's rules come from the governed scope (WWMD) with a fixed feature extraction.
- **Kubernetes admission control.** Every write passes one admission chain, and a validating webhook rejects writes that skip policy. *Adopted:* the guard. A bypass fails CI, not just review. *Rejected:* a runtime-only check, which would only surface after deploy.
- **Google SRE practice on paging** (*Site Reliability Engineering*, ch. 6, "Monitoring Distributed Systems"): page a human only for what is urgent, actionable and needs intelligence; route the rest to tickets or automation. *Adopted:* the damage test decides who needs a person, and non-damaging work becomes backlog work for an agent.

**Standard:** ITIL 4 incident management distinguishes functional escalation (to a more capable resolver) from hierarchical escalation (to authority). The `agent` and `independent-review` routes are functional escalation. Only damaging cases are hierarchical.

## Out of scope

- Re-promoting parked items: BI-5BF1D4D0.
- `status: "escalated"` in the PR delivery state machine. It is a delivery stop, and the owner learns of it only through a report the seam now writes.
- Work-item routing in `route-work-item.ts`, which writes to a different table.
