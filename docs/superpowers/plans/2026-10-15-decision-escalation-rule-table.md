---
status: draft
backlog: BI-74B2A8CD
---

# Decision escalation rule table: implementation and verification

For agentic workers: execute this plan one independently reviewable backlog item
at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
`dpf-local-merge-ci-before-push` plus the completion gate below before any success
claim, and `dpf-pr-with-dco` for handoff.

## Authority and retained scope

BI-74B2A8CD, original WC-8D031416 and branch
`fix/decision-escalation-rule-table` remain the delivery identity. The canonical
design is [the September 25 rule table](../specs/2026-09-25-decision-escalation-rule-table-design.md),
including its October 15 substrate amendment. This plan supplies executable
sequencing; it does not claim that the amendment has a new native review PASS.
The historical fa441250 design approval and coverage remain historical.

One atomic delivery implements OBJ-HUMAN-ONLY-DAMAGING, OBJ-ONE-RULE,
OBJ-RULINGS and OBJ-LEGACY-SAFE. A rule without its persisted route and human
surface predicates leaves the contract half applied; those pieces do not ship
independently. BI-E27F3600 owns reviewer instantiation and the eventual interim
hold change in its separate room and branch. BI-50DF2A92 owns jurisdiction facts;
this delivery accepts a regulated declaration but does not invent its evidence.

## Acceptance carried from the existing baseline

| AC | Objective | Acceptance criterion |
|---|---|---|
| AC-1 | OBJ-HUMAN-ONLY-DAMAGING | With no declarations, every escalate or defer from a lexical, mixed, conflict, below-confidence, coverage-gap or fault branch records escalationRoute independent_review and is absent from the founder review, owner ruling, coworker-decisions and attention surfaces. |
| AC-2 | OBJ-HUMAN-ONLY-DAMAGING | A critical decision, or one declaring an irreversible, outward or authority consequence, a crossed threshold, or a regulation, records human and appears on those surfaces with the damaging reason. |
| AC-3 | OBJ-RULINGS | A confident aligned WWWD proposal the owner never ruled on is decided with novelProposition recorded, and a high-risk decision at 0.9 or more confidence is decided. |
| AC-4 | OBJ-ONE-RULE | The conformance walk passes, and fails if a ladder branch or a new surface reintroduces a confidence-derived human escalation; the principle page states the decision rule verbatim. |
| AC-5 | OBJ-LEGACY-SAFE | Rows with a NULL escalationRoute appear on every surface exactly as before. |
| AC-6 | OBJ-HUMAN-ONLY-DAMAGING | Live, after deploy: over 48h the development install records zero human routes from non-damaging decisions, and every independent_review row carries a follow-on. |

## Execution clarifications

1. The amendment defines **six** bases, including policy-limit. The exhaustive
   decision walk is 6 × 4 × 4 × 2 × 2 = **384** cases. The old five-base count is
   historical arithmetic, not an instruction to omit policy-limit.
2. AC-5 governs replay as well as lists. NULL stays legacy: restore a recorded
   route when present, never recompute a historical route from incomplete
   payloads or rewrite old rows. A replayed legacy unresolved result keeps its
   existing hold behavior. New evaluations receive a route before persistence.
3. AC-3's high-confidence case runs within the profile's delegated autonomy and
   with no damaging declaration. Above a profile limit remains policy-limit,
   as the October 15 amendment specifies; this work does not increase a profile's
   authority. Damage still outranks confidence and a decisive recommendation.
4. A decline remains a decisive no. The independent-review interim must never
   turn decline into permission. Fault paths use caller-supplied risk and
   declarations, so a resolver failure cannot erase damage.
5. The domain route is `independent-review`; the Prisma enum member is
   `independent_review`. One explicit persistence adapter owns the conversion.
   Readers restore the recorded decision, including reason and follow-on.
6. `INDEPENDENT_REVIEW_INTERIM = "proceed"` remains the recorded R3 interim.
   `heldForIndependentReview` means review is outstanding, not that the step was
   physically held in this interim. Messages state that distinction. E27 alone
   supplies fulfillment and changes the interim after its own qualification.
7. Action-path proposal, propose-boundary, sensitivity, Work Case consequence,
   steering and operator graduation behavior remain unchanged. Reusing the
   closed consequence vocabulary does not remove any existing damaging ground.

## Phase 0 — bind current evidence and impact

Internal sequencing only. Publish this actual immutable plan with DCO, sync the
original Workroom to its actual head and record new coverage against the existing
baseline's exact objective and acceptance IDs. Never adopt an older SHA to make
an obsolete receipt look current. Check coverage, read the normal implementation
readiness result and resolve any actual refusal before production-code edits.
Do not launch native provider or unknown-review retries while the coordinated
execution-safety rollout is held. Independent client review stays separately
attributed and is never a native receipt.

Before Red, claim exact source paths and consume every testImpact and
guardObligation from verificationState.changeImpactContract. Resolve related
tests for each production file. Unresolved impact advice expands verification.
Confirm source readiness after the main refresh; do not install through a shared
node_modules junction. Assess and record the actual authorization-sensitive risk.

## Phase 1 — one pure rule and a compatible consumption contract

Internal sequencing; no partial release. Extend
`apps/web/lib/govern/authority/escalation-gate.ts` with DAMAGING_CONSEQUENCES,
DECISION_BASES, DECISION_ROUTES, DecisionDeclarations,
resolveDecisionEscalation and describeDecisionEscalationRule. Keep the existing
resolveEscalation result unchanged over its full action domain.

Add `decisionBasisFor`, `withDecisionEscalation` and `decisionAllowsStep` in the
existing decision-perspective module boundary. Extend its types with the
recorded escalation result and explicit evaluationFault marker. Only the rule
table chooses routes. Priority is damage, then decided, then independent review.
Preserve outcomeType for consumers that measure uncertainty rather than humans.

Red-green verification: escalation-gate.conformance.test.ts covers all 384 cases,
each damage precedence combination, all existing action cases, policy-limit,
decline, no-declaration legacy-subset comparisons and invalid historical data.
Helper tests cover interim proceed, damaging fault, decisive decline and legacy
hold. Agree the concrete exported types with E27 before it integrates them.

## Phase 2 — durable route, evaluator wiring and replay

Internal sequencing. Add nullable escalationRoute, escalationReason and
escalationFollowOn to DecisionInteraction in
`packages/db/prisma/schema/decision-governance.prisma` with the generated
DecisionEscalationRoute enum and one forward-only migration. No defaults or
historical backfill. Follow the data-impact declaration and enum generation
procedures; generated clients are not hand edited.

Refactor existing `persistence.ts`, `evaluator.ts`, `profession-gate.ts` and
`directional-outcome.ts`. Compose escalation after final alignment/coverage
adjustments and on every fault return before persistence. Wire allowed and
operator messages through the shared result. Remove only the novel-aligned
human gate; retain delegated policy limits. Update governing-principles.ts and
its ratchet for the retired aligned-not-settled reason.

Wire declarations through org-business-gate.ts and its actual MCP/funding
callers. Threshold facts come from configured policy, not a guessed amount;
missing configuration never invents a threshold. Review every other gate's
caller to preserve explicit risk/declarations across thrown evaluator paths.

Red-green verification: resolver/evaluator faults, coverage overrides,
constitutional escalation, normal recommend/arbitrate/decline, profile limits,
novel aligned proposals, persistence round trips and idempotent hits. A legacy
NULL replay must neither recompute a route nor silently acquire permission.
Apply the additive migration in the governed shared target; old rows remain
readable and rolling old code remains compatible with the extra columns.

## Phase 3 — one human predicate, all human-facing projections

Internal sequencing. Add human-escalation.ts exporting humanEscalationWhere and
isHumanEscalation. The query is routed human OR legacy NULL with unresolved
outcomeType. Preserve existing tenant, visibility, enforcement, resolution and
withdrawal predicates by AND composition; never replace those constraints.

Replace human-routing interpretations in founder review, owner-ruling-queue,
attention/sources/ai-decision, founder-review-pack, concierge-sweep-runner,
decision-governance-route-context, triage-conductor, decision-audit, decision-help,
decision capture actions and coworker-decisions pages/actions. Survey the current
tree rather than assuming the historical surface count. Include
DecisionPerspectiveGatePanel and route DTOs when they offer an owner action.
Read-only uncertainty analytics and craft-gap consumers keep their outcomeType
semantics; document the bounded guard allowlist with a reason per retained site.

Red-green verification: matching Prisma and in-memory predicates, legacy NULL
rows, human routes with decisive outcomes, independent-review exclusions,
already-resolved records, cross-tenant/hidden records and capture actions.
Conformance guards new raw human outcome filters while permitting documented
uncertainty analytics. Principle-page sentences match the generated rule text.

## Phase 4 — integrated delivery and live acceptance

This is the single shippable boundary for BI-74B2A8CD. Run affected suites,
both web typecheck programs and all impact guards, then the current governed
integration/publication procedure. Any unavailable native check stays UNRUN.
Obtain an independent source assessment; maintain DCO and protected GitHub
checks/merge queue. No competing runtime or release producer.

Use the canonical served target after the sole coordinator's governed advance.
Verify human damaging, independent-review gap, decisive novel recommendation
and legacy cases across the existing review/attention experience, keyboard flow
and both themes; record UX-fit evidence. No new dashboard or navigation.

AC-6 is an explicit post-deploy observation obligation: record deployment time,
served identity, cohort counts, any non-damaging human-route violations and
missing follow-ons over 48h. Zero observations is insufficient evidence of
benefit. Do not claim the 48h acceptance from source tests or handoff alone.

## Backlog coverage

Parent and sole atomic mapping: BI-74B2A8CD, deliverable rule-table-and-surfaces.
Dependencies: BI-F6FD946F's retained corpus-gap behavior; E27 consumes this
delivery but owns review execution separately. Current immutable coverage
receipt: pending publication and native validation. Historical receipt
cmv8uauod1qym01p0rbbj5111 is invalid for the current head and is not reused.
Traceability: OBJ-HUMAN-ONLY-DAMAGING, OBJ-ONE-RULE, OBJ-RULINGS,
OBJ-LEGACY-SAFE; contracts resolveDecisionEscalation, humanEscalationWhere,
decisionAllowsStep; flows decisionBasisFor, withDecisionEscalation;
verification AC-1, AC-2, AC-3, AC-4, AC-5, AC-6.

## Risk and rollback

This changes authorization-related decision routing and has high consequence
if damage facts, declined outcomes, replay or tenant constraints are lost.
The exhaustive rule walk and integrated fault/replay/capture tests are mandatory.
No phase ships alone. Revert the one code PR to restore prior behavior; retain
nullable columns and recorded evidence rather than dropping data. E27 does not
change the interim constant until its independent reviewer is qualified.
