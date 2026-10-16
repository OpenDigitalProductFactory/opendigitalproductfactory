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

## 7. Owner-directed revision, 2026-10-15 — pending independent review

The owner requested delivery-relevant specialists in every Workroom run, including
their contribution to the deliverable rather than only its final review. The
owner also requested one PR for related participation and UX consultation repairs.
This revision is a proposal awaiting renewed design and plan coverage; the old
receipts do not approve these additions. Research intake: BI-0AABCD1F.

### Required participation precedes review authority

For each run, derive required professions from the declared deliverables, their
acceptance criteria, the shape's stages and recorded sensitivity. Changed paths
supplement that selection; they cannot substitute for deliverable requirements.
An HTML UX prototype and a UX-bearing document require UX expertise even before
a React file exists. Data, security, architecture, operations and domain work
similarly carry their owning professions into the stages producing that work.

Use the existing shape stage, participant assignment and review binding
substrate. Reuse profession/coworker registries and their live grants; do not
introduce a second profession roster or use a caller-supplied identity as proof
of expertise. Authoring assistance and independent review have distinct evidence
obligations. An authoring specialist cannot satisfy its own independent review.

The three-specialist cap in section 3.2 and the existing
`MAX_ACUMEN_CONSULTS_PER_PHASE` cap must not silently discard required professions.
Bound concurrency or schedule batches while retaining every required obligation.
A missing provider or incomplete consultation remains explicitly outstanding.
Participation requirements do not promote an uncalibrated critic to blocking
verdict authority; section 3.5's calibration ceiling remains in force.

### Request, execution and contribution are different facts

Record the profession, selected coworker, stage, immutable input revision,
dispatch identity, execution state, returned findings, corpus references and the
author's disposition through existing room/task/evidence records. A catalog
request in `requested` state with no execution result cannot satisfy a completed
contribution. Reuse matching evidence only when its scope and revision remain
valid. Distinguish a missing required contribution from an advisory finding.

### Governed external-client consultation

This connection identifies as `AGT-EXT-CODEX`. A live request naming `ux-design`
returned `software-engineer` with `declaredBorrow: false` (DI-C86741F070DF).
Current code intentionally ignores a borrow when any agent identity exists.
Design a supported cross-profession consult for a governed external participant:
preserve the authenticated actor and ledger attribution, resolve the consulted
profession separately, and retain the same token, membership and grant checks.
Never remove the actor identity to make an external client look anonymous.
Whether this is an explicit consult or an executed specialist contribution must
be visible in the evidence; neither can claim to be the other's completed work.

The live calibrated UX critique search returned zero entries. No proposal may
claim founder/designer-calibrated support from that result. Preserve founder
feedback through the existing draft capture path and retain human-owned verdict
authority. This work does not make agent proposals calibration-eligible.

### Additional acceptance proposals

| AC | Objective | Acceptance criterion |
|---|---|---|
| AC-7 | OBJ-CRAFT | Declared deliverables select their required professions before changed files exist; a UX prototype receives UX participation, and a non-UX deliverable receives its owning specialists without a new hardcoded coworker map. |
| AC-8 | OBJ-INSTANCE | A run requiring more than three professions retains all of their obligations; batching or capacity failure cannot be reported as complete participation. |
| AC-9 | OBJ-INSTANCE | Requested, executing, completed, failed and unavailable contributions are distinguishable; only revision-bound returned evidence satisfies a completed contribution, and independent review remains separate from authoring. |
| AC-10 | OBJ-CRAFT | A governed external Codex caller can consult UX through the supported path with its own authenticated identity retained, the consulted UX profession named, and the result correctly attributed without widening authority. |

### Fulfillment contract for AC-9 and AC-10 — review proposal

The existing service-catalog entry point in `mcp/packs/coworker-service-catalog-pack.ts`
calls `createCoworkerEngagement` in `coworker-service-catalog/engagements.ts`.
That function inserts a request with `workCapsuleId: null`. The A2A adapter in
`coworker-service-catalog/a2a-tasks.ts` projects that request as submitted; it
does not enqueue execution. Repair that connection through the existing task,
room and evidence lifecycle. Adding a participant or posting a room message is
not fulfillment. This proposal does not add a second task model or review queue.

The fulfillment executor must resolve the existing engagement, offer, provider,
requesting actor, exact input artifact revision and authorized room on the server.
It must check current consent, effective grants, membership, data sensitivity,
offer authority, funding and any required approvals before scheduling work.
An executed invitation establishes only its recorded participation permission;
it is not a blanket authorization to run a service or disclose an artifact.
Caller metadata, an engagement ID and an accepted historical review are not
substitutes for these checks. A declined or unavailable request stays outstanding
with its actual reason; it cannot manufacture an initiative reviewer packet.

Reuse the governed task dispatch and capacity machinery behind
`mcp/external-coworker-task-adapter.ts`. Its existing callers require either
general collaboration authority or an exact server-issued review binding.
An engagement fulfillment binding therefore needs independent authority review:
it must bind only this approved offer, provider, actor, room, artifact and allowed
reader/result writer. Calling the dispatcher directly from engagement creation
without those checks would widen authority and is excluded. Authorization must
precede participant assignment and enqueue; participant assignment grants no new
tools. Resolve any narrower offer or provider boundary before dispatch.

Derive a stable dispatch identity from the engagement and immutable input scope
on the server. Repeated fulfillment of the same scope returns the original task.
Revalidation is required before its execution, including revocation after enqueue.
Creation, association and enqueue must survive interruption through the existing
durable task lifecycle, with tests at each persisted boundary. Reconcile a missing
association to the original task rather than create another. Unknown provider
effects remain unknown until the existing task's supported recovery resolves them;
an automatic retry must not make a second paid or externally visible request.

A returned contribution binds the provider principal, profession, engagement,
task, room stage, input artifact revision, consulted corpus references and versions,
criteria applied, findings and author disposition. Missing corpus evidence is an
explicit limitation. A consult answer is advisory and does not become independent
review approval. Reuse is checked against the current revision, obligation and
reviewer independence; a later artifact cannot inherit a pass from stale evidence.
Persist through the existing task/engagement/room evidence records; audit the schema
before implementation and identify any missing contract through the normal design
process instead of hiding it in unvalidated caller metadata.

For the explicit profession consult, retain the authenticated actor used by
`mcp/packs/profession-decision-pack.ts` and its permission checks. Resolve a
separate consulted profession from the registered corpus and stamp both identities
on the decision evidence. Never clear `context.agentId` or impersonate the UX
coworker. A fulfilled UX service must actually execute as the selected eligible
specialist; merely consulting UX doctrine does not satisfy its execution evidence.

The routing reproduction supplied by another chat is an acceptance fixture,
not a verified completed review: BI-2BBD9D34 reports requested engagements despite
an executed UX invitation. Test the same distinction against the prototype at
`docs/ux-fit/2026-10-12-routing-management/routing-explorer.html`, immutable source
`68c6c46255bc2d5c6cf3a1e394ecc7a00ef2f6db`. The original approved UX request
CE-D5126472 is another recovery case: preserve its approved input and digest;
do not submit a replacement engagement to make the old request appear fulfilled.

Verification must include rejection before any assignment/enqueue when authority
is missing, replay after interruption at each durable boundary, provider revocation,
unknown effects, partial profession coverage, stale revision, and self-review.
Positive proof requires an actual eligible UX run returning criteria and corpus
evidence for the exact prototype, plus a separately attributed external consult.
Mocked dispatch and source tests establish local contracts only. Live fulfillment
must be exercised on the served canonical target after the containing release.

### Related work and boundaries

- BI-E27F3600 owns shape/criticality-based review instantiation. BI-0AABCD1F
  records the consultation/execution research; reconcile its final delivery
  mappings before implementation rather than treating triage intake as approved.
- Live search found BI-39C7D449 (specialist review joined to WSID), BI-6BB728F1
  (profession material domain mismatch), BI-6B33B1C8 (craft corpus curation),
  BI-D543F934 (UX-fit evidence) and BI-3913EB49 (shape-conformance overseer).
  Their current acceptance/status must be reconciled before assigning duplicate
  scope. A search hit is not proof of delivery.
- BI-7AA4EB6B owns the compact provider-page UX. Its implementation stays with
  the other chat; shared participation evidence may be consumed there.
- The owner requested autonomous routine DEV work, with external credentials
  reserved for human handling. The observed executor-transfer tool nevertheless
  declares unconditional `consequence: authority`, pinned by a test. This design
  does not disable that gate or change global permissions. Any refinement needs
  a server-verifiable owner mandate and its own authorized authority review.
- BI-74B2A8CD remains an unmerged prerequisite. Its existing workroom and branch
  are preserved. Do not invent its functions, switch undecided decisions to
  `hold` without an executable reviewer path, or claim this combined work ready
  while that dependency is unresolved.


## 8. Native execution amendment, 2026-10-16 - independent assessment pending

This amendment supersedes section 3.4's proposed external terminal-writer
mechanism. Source inspection found that `record_semantic_review_outcome` records
CI outcome correlation; it does not write the specialist's terminal verdict.
The UX critic's existing offer is proposal-only. Neither that tool nor the
critic gains blocking authority to satisfy this design.

Use the existing semantic-review TaskRun and its fenced per-agent TaskNode
checkpoints. One immutable request names the room, current stage, exact head,
criticality, authority and complete required-profession selection. Each required
craft has a distinct persisted branch obligation and attributable result; the
independent core reviewer evaluates those advisory proposals. This replaces
AC-4's separate TaskRun per specialist with distinct durable branches of the
same canonical TaskRun. A request, invitation or checkpoint without a returned
result is not a completed contribution.

Participant assignment and new TaskRun admission must share one transaction,
using the existing participant writer and existing explicit assignment source.
Before either write, recheck the original actor's current token, consent,
grants and room action access; legitimate invitation authority; the provider's
current identity pair, grants, sensitivity and independence; and restrictive room
policy. Never revive a removed participant or widen a restrictive policy. A
refusal creates neither an assignment nor an inference request. Repeated
admission subscribes to the original identity. Each actual model call rechecks
current access, including the final independent core after craft completion.

The server derives stage and criticality from recorded room, shape, item and
transition facts. A caller cannot lower those facts. Missing stage, shape or
required craft remains explicit outstanding work. Review need precedes craft
selection; shape-required authoring contributions remain obligations even when
review depth is routine. Authoring and independent review use separate eligible
principals. A registry family alone does not turn a different role into the UX
Design Critic.

The executed receipt retains stage, head, criticality, authority, exact selected
principals, corpus fingerprints and author disposition. The existing global
calibration ceiling remains in force. `INDEPENDENT_REVIEW_INTERIM` stays unchanged
until this amended path is executable and verified; this amendment does not
claim its implementation or native approval.

### Critique capture transport repair

Observed MCP capture was refused with `Unauthorized`. Source confirms the pack
called a browser-session action, whose wiki writer required `auth()` rather than
the already-authenticated MCP identity. Refactor the shared server-only capture
and overlay writer below both transports. The browser action still derives its
user from the browser session. The governed MCP handler supplies only its
verified user argument, pins agent authorship and draft status, and can propose
no human calibration verdict. No public action accepts a replacement user id;
no grant, consent or publishing authority changes. The refused live request
remains refused until the normal containing release and a new authorized call.
