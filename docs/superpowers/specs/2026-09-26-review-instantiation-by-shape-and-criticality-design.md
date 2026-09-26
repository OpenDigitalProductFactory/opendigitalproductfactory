---
status: active
---

# Review is instantiated by workroom shape and step criticality

- **Backlog item:** BI-E27F3600 (EP-AUTONOMOUS-DECIDE)
- **Profile:** feature
- **Depends on:** BI-74B2A8CD (one escalation rule table for actions and decisions). This design reads that table; it does not define a second one.
- **Authored:** 2026-09-26

## 1. Problem

Founder, 2026-09-24: "For a review need based on process, we need a separate
instantiation of an ai-coworker to perform that job based on the workroom shape.
The shape and need for review is predicated on the criticality of the step in the
process and the workroom in question."

Today review is chosen by file extension, twice, and the room is never consulted.
All citations are to origin/main @ 400dd678fd6.

- `selectSemanticReviewSpecialists`
  (`apps/web/lib/change-review/semantic-change-review-operation.ts:114-130`) takes
  only `changedFiles`. It maps `.tsx/.jsx/.css/.scss` to AGT-903, prisma and
  migrations to AGT-902, lockfiles to AGT-131, and architecture/spec/plan
  markdown to AGT-181.
  - Every caller passes `specialistIds: []`
    (`mcp/packs/change-review-pack.ts:196`, `build-studio-semantic-review.ts:116`).
  - The four personas are hardcoded in `routed-semantic-review.ts:13-18`, and any
    other id makes the review inconclusive (`:53-57`).
- `deriveImpactedAcumens` (`decision-perspective/acumen-impact.ts:35-106`) is a
  second, independent path classifier. It uses different ids (profession keys,
  resolved to coworkers through `acumen-room-shapes.ts:52-57`) and feeds the
  advisory Build Studio acumen consults.

Three defects follow:

1. **No room.** A schema change in a spike and the same change in a regulated
   release draw the identical review.
2. **No criticality.** No step anywhere declares how critical it is.
   `WorkShapeStage` (`work-management/work-shapes.ts:56-66`) has no such field.
   Review is all-or-nothing per extension, and a one-line comment edit to a
   `.tsx` file draws the same UX review as a new screen.
3. **A roster, not an instantiation.** Four ids are compiled in. A semantic
   review is a `TaskRun` with no room binding and no participant row
   (`semantic-review-background.ts:200-304`). The only lane that binds a
   reviewer to a room is the initiative-readiness lane:
   `initiativeReviewBinding.workroomRef`
   (`mcp/external-coworker-task-adapter.ts:150-170`), which is also the only
   thing that confers `independent-reviewer` steering
   (`govern/authority/resolve-coworker-tool-authority.ts:114-163, 251-294`).

Whether a review may block is presently one global switch:
`scripts/semantic-review-policy.json` `"mode": "shadow"` and
`DPF_SEMANTIC_CHANGE_REVIEW_MODE`. Neither reads the room or the step.

## 2. Objectives

**OBJ-NEED:** Whether a step is reviewed, and how deeply, is derived from the workroom's shape and the step's criticality, not from file extension.

**OBJ-CRAFT:** Changed files select which crafts review within that need, through one classifier; the second classifier and the hardcoded roster are retired.

**OBJ-INSTANCE:** Each review is a coworker instantiated for that step in that room: bound to the room and head, visible as a room participant, with its own recorded evidence obligation.

**OBJ-AUTHORITY:** Whether a review verdict may block, and whether it may reach a person, is read from the single escalation rule table (BI-74B2A8CD), never from a second switch.

**OBJ-UNDECIDED:** An undecided, non-damaging decision is held for this instantiated reviewer, replacing the interim "proceed with the gap recorded" (ruling R3 on BI-74B2A8CD).

| AC | Objective | Acceptance criterion |
|---|---|---|
| AC-1 | OBJ-NEED | Two changes touching identical files, in workrooms of different shape or at steps of different criticality, draw different reviews, and the recorded review names the shape and criticality that caused the difference. |
| AC-2 | OBJ-NEED | A routine step in a small delivery room draws no specialist review for a comment-only change; a critical step in a large room draws the full specialist set for the same files. |
| AC-3 | OBJ-CRAFT | `selectSemanticReviewSpecialists` and the `SPECIALIST_SYSTEM_PROMPTS` roster are removed; specialists come from `deriveImpactedAcumens` resolved to live coworkers, and a craft added to the registry can review without a code change. |
| AC-4 | OBJ-INSTANCE | Each specialist review writes a `WorkroomParticipant` row with role `reviewer` and a `TaskRun` bound to the room and head through a review binding; the room timeline shows who reviewed, for which step, at which criticality. |
| AC-5 | OBJ-AUTHORITY | The verdict authority (advisory, blocking, or blocking-with-person) for every criticality is computed by one function in the escalation rule module; a conformance test walks every criticality and proves a verdict reaches a person only when the step is damaging. |
| AC-6 | OBJ-UNDECIDED | With this shipped, `INDEPENDENT_REVIEW_INTERIM` is `hold`: an undecided non-damaging decision holds its step and dispatches an instantiated reviewer, whose verdict releases or blocks it. |

## 3. Design

### 3.1 Step criticality: one derived value, from signals that already exist

`resolveStepCriticality()` returns `routine | consequential | critical`, computed
from facts the platform already records. No new stored field is needed until a
shape wants to declare one explicitly.

| Signal | Source | Contribution |
|---|---|---|
| effective delivery shape | `initiative-readiness/shape-requirements.ts:45-101` (`effectiveShape`) | small → routine, medium → consequential, large/xlarge → critical floor for its governed stages |
| stage advance kind | `work-shapes.ts:52-54` | a `governed-decision` stage is at least consequential |
| transition risk | `decision-perspective/graduated-autonomy.ts:61-71` (`deriveTransitionRiskTier`) | high → consequential, critical → critical |
| damaging declaration | the BI-74B2A8CD rule table (consequence, threshold, regulated, `critical` risk) | always critical |

The function takes the maximum; nothing lowers a floor. A work shape may also
declare `criticality` on a stage (an optional field on `WorkShapeStage`), which
acts as one more floor. This is how a shape author says "this stage matters"
without code.

### 3.2 Review need, per criticality

| Criticality | Review depth | Specialists drawn | Verdict authority (from the rule table) |
|---|---|---|---|
| routine | change-reviewer only | none | advisory |
| consequential | change-reviewer + impacted crafts | `deriveImpactedAcumens`, capped at 3 | blocking by an AI reviewer; never reaches a person |
| critical | change-reviewer + every impacted craft + architecture | all impacted, plus enterprise-architecture | blocking; reaches a person only if damaging |

The room's `workroomShape` narrows further. `change-consequential` is the only
collaboration shape whose inclusion order has a `reviewer`
(`work-management/room-shapes.ts:60-67`). A room of that shape draws the reviewer
role even at a consequential step. A `craft-stewardship` room caps depth at
consequential unless the step is damaging.

### 3.3 One craft classifier

`deriveImpactedAcumens` becomes the only path classifier, because it is the one
keyed on professions, and professions are what the registry, corpora and gap
nominations already key on. It resolves to live coworkers through
`acumen-room-shapes` (`coworkerAgentId`), and otherwise through the registry
family's first active role, the same resolution BI-1A2FD647 uses.

`selectSemanticReviewSpecialists`, the AGT-9xx map and `SPECIALIST_SYSTEM_PROMPTS`
are removed. The persona text comes from the craft's own corpus, which
`specialist-craft-context.ts` already layers on (#5564).

### 3.4 Instantiation

A review is dispatched as a `request_coworker` packet with a new
`stepReviewBinding` that follows the `initiativeReviewBinding` precedent:

```ts
stepReviewBinding: {
  workroomRef: { kind: "workroom-head"; workroomId; repositoryFullName; branchName; headSha };
  stageKey: string;
  criticality: "routine" | "consequential" | "critical";
  professionKey: string | null;      // null for the change-reviewer
  writerToolName: "record_semantic_review_outcome";
}
```

- The dispatcher is the existing server-side reviewer dispatch
  (`backlog/initiative-readiness/server-reviewer-dispatch.ts`), extended. It
  writes the `TaskRun` idempotently on
  `requestKey = step-review:<workroom>:<stage>:<head>:<profession>`.
- Before dispatch it upserts a `WorkroomParticipant` role `reviewer` with
  `assignmentSource: "step-review"` through the single writer
  (`work-management/room-participant-assignment.server.ts:82`). The reviewer is
  visible in the room and admitted to act there.
- `resolveBoundInitiativeReviewBinding` generalises to recognise
  `stepReviewBinding`, so the reviewer's writer call carries
  `independent-reviewer` steering and is decided without an approval envelope,
  per `escalation-is-a-gate-not-a-trust-tier`.
- The verdict is the existing semantic-review receipt (`ExternalEvidenceRecord`
  `semantic-change-review.receipt`). It gains `stageKey`, `criticality` and
  `authority`, so AC-1's traceability lives on the record itself.

### 3.5 Authority reads the rule table

BI-74B2A8CD adds `resolveDecisionEscalation`. This design adds its review twin in
the same module:

```ts
resolveReviewAuthority({ criticality, damaging }): "advisory" | "blocking" | "blocking-with-person"
```

The review path and the decision path read the same `damaging` definition, so
"may this verdict block?" and "may this reach a person?" cannot disagree. The
conformance walk in `escalation-gate.conformance.test.ts` is extended to cover it.

The global switch stays as a calibration ceiling. `semantic-review-policy.json`
`mode` (shadow/enforce) still wins while calibration samples are zero, so
turning this on cannot start blocking uncalibrated reviews. What changes is that,
once enforced, the authority is per step rather than global.

### 3.6 Undecided decisions (ruling R3)

`decisionAllowsStep` (BI-74B2A8CD §3.6) flips `INDEPENDENT_REVIEW_INTERIM` to
`hold`. An `independent_review` route dispatches a step review at criticality
`consequential` with the decision's follow-on (corpus, vector or capability gap)
in the packet. The reviewer's receipt releases or blocks the held step. This is
where the founder's "middle band" is resolved by a coworker instead of a person.

## 4. Research & Benchmarking

- **GitHub CODEOWNERS plus rulesets.** Path-owned reviewers, with branch rules
  deciding whether review is required. DPF adopts path-to-craft selection
  (OBJ-CRAFT) and rejects path alone as the source of need: rulesets attach to
  the target branch, which is DPF's room, and that is exactly what DPF's current
  selector ignores.
- **Gerrit label policies (Code-Review -2..+2, submit requirements).** The
  verdict's authority is a property of the label's policy, not of the reviewer.
  Adopted: authority comes from the step's criticality through one rule
  (OBJ-AUTHORITY), never from which coworker reviewed.
- **NIST SP 800-53 SA-11 / SSDF PW.7 (review proportional to risk).** Review
  depth scales with the criticality of the component. Adopted as §3.2.
- **Rejected: a per-review external policy engine (OPA).** A small closed-enum
  table inside the existing module retires more than it adds, per
  `absorb-dont-adopt`.

## 5. Deliverables (the plan maps each to a backlog item)

1. `resolveStepCriticality` plus the optional stage `criticality` floor.
2. `resolveReviewAuthority` in the escalation rule module, with the conformance extension.
3. One craft classifier: remove `selectSemanticReviewSpecialists` and the persona roster.
4. `stepReviewBinding`, room-bound dispatch and the reviewer participant row, with steering recognition.
5. Receipt fields `stageKey`, `criticality`, `authority`.
6. Flip `INDEPENDENT_REVIEW_INTERIM` to `hold` and dispatch step reviews for undecided decisions.

## 6. Out of scope

- Calibrating the semantic reviewer so the global mode can move to enforce.
  That is data-gated; this design makes enforcement per-step when it happens.
- Coworker-led promotion of craft material (BI-1C9E7EB2).
