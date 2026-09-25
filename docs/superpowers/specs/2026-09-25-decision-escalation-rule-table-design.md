---
status: active
---

# One escalation rule table for actions and decisions

Backlog: BI-74B2A8CD (EP-AUTONOMOUS-DECIDE). Depends on BI-F6FD946F (PR #5658),
which gives the corpus-gap route somewhere to go. Consumed by BI-E27F3600, which
supplies the independent reviewer this design routes undecided steps to.

## 1. Problem

The platform has two escalation concepts, and only one of them is governed.

`resolveEscalation` (`apps/web/lib/govern/authority/escalation-gate.ts`,
BI-6B3DA9DD) decides whether a coworker ACTION mints a human approval envelope.
A human is engaged only when the action is damaging, or when nothing recorded
can steer it. Its conformance test walks the whole input domain and checks the
kernel principle page word for word.

Nothing like it governs DECISION outcomes. The evaluator's two ladders set
`outcomeType: "escalate"` on conditions of their own, and every human-facing
surface treats `escalate`/`defer` as "put this to a person":

| Ladder branch | File:line on 549d4df24ad | What it actually is |
|---|---|---|
| lexical relevance | `directional-outcome.ts:50` | platform capability gap (embeddings down) |
| mixed stance | `directional-outcome.ts:64` | vector gap: needs a discriminating vector |
| principle conflict | `evaluator.ts:176` | vector gap |
| `riskTier === "critical"` | `directional-outcome.ts:73`, `evaluator.ts:185` | damaging |
| `riskTier === "high"` | `evaluator.ts:185`, `directional-outcome.ts:124` | a raised bar, not damage (ruling R2) |
| below confidence / band / ceiling | `directional-outcome.ts:83`, `evaluator.ts:194-234`, `:249` | corpus gap: the uncertainty band |
| aligned but never ruled | `directional-outcome.ts:114` | novelty, not uncertainty (ruling R1) |
| coverage gap (`defer`) | `evaluator.ts:68` | corpus gap |
| evaluator threw | `evaluator.ts:302`, `profession-gate.ts:92` | evaluation fault |

Surfaces that read `escalate`/`defer` as "a person must answer" (`git grep` on
the same commit): `lib/founder-review/queue.ts`, `lib/decision-perspective/owner-ruling-queue.ts`,
`lib/attention/sources/ai-decision.ts:161`, `app/(shell)/platform/ai/founder-review/page.tsx:63`,
`app/(shell)/coworker-decisions/{page,decisions/page,review/page,review/actions}.tsx|ts`,
`lib/actions/org-decision-capture.ts`, `lib/actions/decision-perspective.ts`,
`lib/build/autonomous-build-eligibility.ts:150`.

Measured on the development install, trailing 14 days: the only `escalate`/`defer`
rows came from the profession gate (677) and kernel consults (7). None came
from WWWD or Build Studio. Every one was a corpus or capability gap, and none
was damaging. BI-F6FD946F already stops the craft rows from reading as owner
calls. This design makes that true for every gate, structurally, and guards it.

`riskTier` also does duty for three different things: damaging, irreversible
and regulated. Reversibility, an explicit threshold and regulation are absent
from the decision path, even though the action path already knows
`ToolConsequence = outward | irreversible | authority`.

## 2. Founder doctrine and rulings

Doctrine, 2026-09-24: "We only need escalation when the evaluation against the
proper decision for permission / validation to proceed is not decisive ... The
middle uncertainty band of the decision is where escalation happens, and the
need to optimize the decision by adding new vectors, adjusting weights and
adding corpus material may be needed ... The only human decision requirements
are when the task is outside the ability for the platform to ack, or there is a
destructive, non reversable or threshold set that requires human involvement.
We also have certain regulatory requirements that would dictate this as well."

Rulings recorded on BI-74B2A8CD, 2026-09-25:

- **R1. Novel-aligned proposals proceed.** A confident, doctrine-aligned WWWD
  verdict acts, even though the owner never ruled on that exact question.
  Novelty is recorded, not gated. This supersedes the BI-F5F2869D ruling for
  that branch only.
- **R2. Only `critical` is damaging.** `high` raises the confidence bar and is
  not a human condition by itself.
- **R3. Undecided and non-damaging goes to an independent AI reviewer.** The
  step that asked is held for a separately instantiated reviewer coworker
  (BI-E27F3600), whose verdict unblocks or blocks it. Optimisation runs in
  parallel. Interim, until BI-E27F3600 lands: the step proceeds with the gap
  recorded.

## 3. Design

### 3.1 One module, two entry points

`escalation-gate.ts` stays the single home of the rule. It gains a decision
entry point beside `resolveEscalation`. Both share one definition of damage:

```ts
/** Declared reach that makes something damaging, for an action or a decision. */
export const DAMAGING_CONSEQUENCES = ["outward", "irreversible", "authority"] as const;

export type DecisionDeclarations = {
  consequence?: ToolConsequence | null;   // same type the action path uses
  thresholdExceeded?: boolean;            // an operator-set threshold was crossed
  regulated?: boolean;                    // a confirmed regulation requires a person
};

export const DECISION_BASES = [
  "decided",           // recommend | arbitrate | decline
  "corpus-gap",        // coverage gap, below confidence/band/ceiling, not confident enough for the risk
  "vector-gap",        // mixed stance, principle conflict
  "capability-gap",    // lexical relevance: embeddings unavailable
  "evaluation-fault",  // the evaluator or resolver threw
] as const;

export const DECISION_ROUTES = ["decided", "human", "independent-review"] as const;

export function resolveDecisionEscalation(input: {
  basis: DecisionBasis;
  riskTier: DecisionRiskTier;
  declarations: DecisionDeclarations;
}): { route: DecisionRoute; reasonCode: DecisionEscalationReasonCode; damaging: boolean; followOn: DecisionBasis | null };
```

The table is first-hit, and the order is the safety property:

1. **Damaging → `human`.** Damaging means `riskTier === "critical"`, a declared
   consequence, `thresholdExceeded`, or `regulated`. This holds whatever the
   corpus decided. Reasons: `damaging-critical-risk`, `damaging-consequence`,
   `damaging-threshold`, `damaging-regulated`.
2. **`decided` → `decided`.** The recorded corpus answered. It is the decision
   path's steering, as `wwmd`/`room-authority` are the action path's.
3. **Everything else → `independent-review`**, with `followOn` set to the basis
   (`corpus-gap`, `vector-gap`, `capability-gap`, `evaluation-fault`). The
   follow-on names the optimisation work; the route names who resolves the step.

`evaluation-fault` is not a person's job. A fault on a damaging decision still
reaches a person through rule 1, because the declarations and risk tier are
caller inputs, not evaluator outputs.

### 3.2 Where the basis comes from

`decisionBasisFor(evaluation)` in `lib/decision-perspective/` maps an evaluation
result to its basis, using fields the result already carries: `outcomeType`,
`gapReason`, `coverageGap`, `principleConflict`, `stanceAlignment`,
`relevanceMethod`, and a new `evaluationFault: true` set only by the two
`failClosedEvaluation` functions. No ladder branch computes a route itself.

### 3.3 Ladder changes the rulings require

- `evaluator.ts:185`: escalate on `critical` only (R2). A `high` decision falls
  through to the confidence checks. `:249` ("not high enough for a
  ${risk}-risk decision") already raises the bar, so a high-risk decision
  needs ≥ 0.9 or arbitration eligibility to be decided.
- `directional-outcome.ts:124` (high-risk approval): removed (R2).
- `directional-outcome.ts:114` (`aligned-not-settled`): no longer escalates. The
  result carries `novelProposition: true`, and the rationale says the owner has
  not ruled on this question before (R1). The `gapReason` value stays in the
  type for historical rows.

### 3.4 Recording the route

A new nullable column, `DecisionInteraction.escalationRoute`, typed by a Prisma
enum `DecisionEscalationRoute { decided, human, independent_review }` (the enum
generator emits the TypeScript union; AGENTS.md §8). Also
`escalationReason String?` and `escalationFollowOn String?`. Forward-only migration:

- Existing rows stay `NULL`. `NULL` means "recorded before the rule table",
  and every predicate treats it exactly as today: `escalate`/`defer` → a person.
  No backfill, so no history is rewritten and a rollback of the code is safe.

`persistDecisionInteraction` writes the three fields from `evaluation.escalation`.
Both gate wrappers (`evaluatePerspectiveGate`, `evaluateProfessionDecisionGate`)
set `evaluation.escalation` through one helper, `withDecisionEscalation(evaluation,
declarations)`, before persisting. The idempotent-hit path in `evaluatePerspectiveGate`
recomputes it from the stored evaluation, so a legacy row read back gets a route.

### 3.5 One predicate for "a person must answer"

`lib/decision-perspective/human-escalation.ts` exports:

```ts
/** Rows a person must answer: routed human, or legacy rows that escalated. */
export function humanEscalationWhere(): Prisma.DecisionInteractionWhereInput;
export function isHumanEscalation(row: { outcomeType: string; escalationRoute: string | null }): boolean;
```

`humanEscalationWhere()` is `OR [{ escalationRoute: "human" }, { escalationRoute: null,
outcomeType: { in: ["defer","escalate"] } }]`. Every surface in §1's list replaces
its literal `outcomeType: { in: [...] }` with it. `UNRESOLVED_OUTCOMES` in
`owner-ruling-queue.ts` stays as the legacy leg inside the helper and is not
re-declared anywhere else. A guard (§3.7) fails the build if a new file selects
`outcomeType: { in: [...escalate...] }` outside the helper.

### 3.6 What callers do with each route

`allowed` is derived in one place, `decisionAllowsStep(evaluation)`:

- `decided`: `recommend`/`arbitrate` allow; `decline` does not.
- `human`: does not allow; the row is in the person's queue.
- `independent-review`: `INDEPENDENT_REVIEW_INTERIM = "proceed"` (R3 interim), so
  the step is allowed and the result carries `heldForIndependentReview: true`
  plus the follow-on. BI-E27F3600 flips this one constant to `"hold"` when its
  reviewer instantiation lands, and routes the held step to that reviewer. No
  call site changes then.

Operator messages come from the route in all three gates:

- `human` names the damaging reason, per `show-the-consequence-before-the-confirm`.
- `independent-review` names the follow-on ("insufficient corpus", "stance points both
  ways", "embeddings unavailable") and says it is not an owner call.

The profession gate's BI-F6FD946F message becomes the corpus-gap case of this rule.

### 3.7 Guard

Extend `escalation-gate.conformance.test.ts`:

1. **Exhaustive decision walk** over basis × riskTier × consequence × threshold ×
   regulated (5 × 4 × 4 × 2 × 2 = 320). It proves:
   - (a) `human` if and only if damaging;
   - (b) with no declarations, the new human set is a subset of the legacy rule
     (`escalate`/`defer` → person). The decision path may only remove escalations
     unless a caller declares damage;
   - (c) a damaging decision is never `decided`.
2. **Wiring**: both gate wrappers call `withDecisionEscalation`, and no file under
   `lib/decision-perspective/` assigns a route itself.
3. **Single predicate**: no `.ts`/`.tsx` under `apps/web` outside
   `human-escalation.ts` selects `outcomeType` in a list containing `escalate`.
4. **The principle follows the process**: `describeDecisionEscalationRule()`
   sentences are stated verbatim on `escalation-is-a-gate-not-a-trust-tier.md`.
   The page also stops naming the non-existent `check-escalation-gate.ts`.

### 3.8 Declarations: who supplies them

The input exists from day one; callers wire it as their facts exist:

- The WWWD gate (`evaluate_org_business_decision`, `approve_demand_for_funding`)
  accepts `consequence` and `thresholdExceeded` from its caller. Funding approval
  sets `thresholdExceeded` when the amount crosses the organization's configured
  funding threshold, if one is configured. Otherwise it does not set it.
- `regulated` comes from BI-50DF2A92's `assessJurisdictionCoverage` once that
  lands. The jurisdiction setup and coverage-gap design (BI-50DF2A92)
  is not on `main` yet, so this design defines the input and does not wire it.
  Follow-up BI to wire it; the regulatory ceiling's fail-closed default on the
  ACTION path (`lib/autonomy/regulatory-ceiling.ts`) is out of scope here and is
  named in that follow-up.

## 4. Research & Benchmarking

- **DMN decision tables (OMG DMN 1.4), hit policy FIRST.** An ordered rule list
  where the first match wins and the order is part of the contract. Adopted:
  §3.1 is a FIRST table, and the conformance walk is the DMN "completeness"
  check done exhaustively.
- **AWS IAM policy evaluation.** An explicit deny outranks any allow, whatever
  else matches. Adopted as rule 1: damage outranks a decided corpus, exactly as
  `resolveEscalation` puts damage before steering.
- **Open Policy Agent.** Policy as data, evaluated by a separate engine. The
  separation of decision from enforcement is adopted. The engine is rejected
  under `absorb-dont-adopt`: the rule is 3 branches over closed enums, and a
  new runtime would add more surface than it retires.
- **NIST AI RMF (MANAGE 2.4) and EU AI Act Art. 14.** Human oversight is
  proportionate to risk and is where risk is. Adopted: the human condition is
  a property of the decision's declared consequence, threshold and regulation,
  not of confidence. Confidence routes to review and optimisation.

## 5. Deliverables, in order (one PR, one clean revert)

1. `escalation-gate.ts`: `DAMAGING_CONSEQUENCES`, `resolveDecisionEscalation`,
   `describeDecisionEscalationRule`, reason codes; `isDamagingAction` reads the
   shared constant.
2. Prisma enum + nullable columns + migration; `persistDecisionInteraction` writes them.
3. `decisionBasisFor`, `withDecisionEscalation`, `decisionAllowsStep`,
   `human-escalation.ts`.
4. Ladder changes R1/R2 (`evaluator.ts`, `directional-outcome.ts`) with their tests.
5. Both gate wrappers compose the helpers; operator messages come from the route.
6. Every §1 surface switches to `humanEscalationWhere`/`isHumanEscalation`.
7. Conformance extension (§3.7) and principle page update.

## 6. Acceptance

- AC-1: No non-damaging decision is put to a person. With no declarations,
  every `escalate`/`defer` produced by a lexical, mixed, conflict,
  below-confidence, coverage-gap or fault branch records
  `escalationRoute = independent_review` and is absent from the founder
  review, owner ruling, coworker-decisions and attention surfaces.
- AC-2: A `critical` decision, or one declaring an irreversible, outward or
  authority consequence, a crossed threshold, or a regulation, records `human`
  and appears in those surfaces with the damaging reason.
- AC-3: R1 and R2 hold. A confident aligned WWWD proposal the owner never ruled
  on is `decided`, with `novelProposition: true`. A `high` decision at ≥ 0.9
  confidence is `decided`.
- AC-4: The conformance walk (§3.7) passes, and fails if a ladder branch or a
  new surface reintroduces a confidence-derived human escalation.
- AC-5: Legacy rows (`escalationRoute` NULL) appear on every surface exactly as
  before.
- AC-6: Live, after deploy: over 48h the development install records zero
  `human` routes from non-damaging decisions. Every `independent_review` row
  carries a follow-on.

## 7. Out of scope

- Instantiating the independent reviewer and holding the step for it: BI-E27F3600.
- Wiring `regulated` from jurisdiction coverage, and the action-path regulatory
  ceiling's fail-closed default: follow-up BI (§3.8).
- Follow-on dispatch for `vector-gap` and `capability-gap` (the corpus-gap one
  exists: BI-F6FD946F). They are recorded on the row so they can be counted
  before anything is built for them.
