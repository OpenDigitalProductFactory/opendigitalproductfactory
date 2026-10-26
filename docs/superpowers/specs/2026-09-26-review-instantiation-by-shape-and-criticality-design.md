---
status: active
---

# Review is instantiated by workroom shape and step criticality

- **Backlog item:** BI-E27F3600 (EP-AUTONOMOUS-DECIDE)
- **Profile:** feature
- **Authored:** 2026-09-26; consolidated 2026-10-23
- **Source prerequisite:** BI-74B2A8CD, merged through PR #6432. Its separate acceptance remains with its owner.

## 1. Problem and intended outcome

The owner requires delivery-relevant specialists in each Workroom run, including
authoring assistance and independent review. UX work needs the UX Design Critic,
WSID guidance and the critique corpus; data, security, architecture, operations
and domain work need their owning professions.

A list of coworker IDs, an invitation or a catalog request cannot establish that
a specialist contributed. The platform must derive the obligation, admit the
right participant within current authority, execute durable work and attribute
its returned evidence to the exact deliverable revision.

The original reproduction at main 400dd678fd6 found two path classifiers, four
hardcoded review personas and no room/step criticality in review selection.
Subsequent source preparation supplies parts of the repair. The execution status
and exact evidence belong in the linked plan and Workroom, separately from this
prospective acceptance contract.

## 2. Objectives and acceptance

**OBJ-NEED:** Whether a step is reviewed, and how deeply, is derived from the workroom's shape and the step's criticality, not from file extension.

**OBJ-CRAFT:** Changed files select which crafts review within that need, through one classifier; the second classifier and the hardcoded roster are retired.

**OBJ-INSTANCE:** Each review is a coworker instantiated for that step in that room: bound to the room and head, visible as a room participant, with its own recorded evidence obligation.

**OBJ-AUTHORITY:** Whether a review verdict may block, and whether it may reach a person, is read from the single escalation rule table (BI-74B2A8CD), never from a second switch.

**OBJ-UNDECIDED:** An undecided, non-damaging decision is held for this instantiated reviewer, replacing the interim "proceed with the gap recorded" (ruling R3 on BI-74B2A8CD).

| AC | Objective | Acceptance criterion |
|---|---|---|
| AC-1 | OBJ-NEED | Two changes touching identical files, in workrooms of different shape or at steps of different criticality, draw different reviews, and the recorded review names the shape and criticality that caused the difference. |
| AC-2 | OBJ-NEED | A routine step in a small delivery room draws no specialist review for a comment-only change; a critical step in a large room draws the full specialist set for the same files. |
| AC-3 | OBJ-CRAFT | New reviews use `deriveImpactedAcumens` and live registered coworkers; the active `selectSemanticReviewSpecialists` classifier and `SPECIALIST_SYSTEM_PROMPTS` roster are retired. A registered craft can participate without a code change, while immutable historical requests retain their original execution contract. |
| AC-4 | OBJ-INSTANCE | Each required specialist has authorized, room-visible `WorkroomParticipant` membership and a distinct fenced `TaskNode` contribution under one canonical semantic-review `TaskRun`, without replacing existing roles. The immutable request and receipt bind the room, current stage, exact head, criticality and authority, and the timeline attributes each returned contribution. |
| AC-5 | OBJ-AUTHORITY | The verdict authority (advisory, blocking, or blocking-with-person) for every criticality is computed by one function in the escalation rule module; a conformance test walks every criticality and proves a verdict reaches a person only when the step is damaging. |
| AC-6 | OBJ-UNDECIDED | Final acceptance requires a qualified reviewer path, activation of `INDEPENDENT_REVIEW_INTERIM = hold`, and executed proof that an undecided non-damaging decision stays held until a current authorized review releases or blocks it. Qualification precedes activation within this delivery; the pre-activation `proceed` behavior does not satisfy final acceptance. |
| AC-7 | OBJ-CRAFT | Declared deliverables select their required professions before changed files exist; a UX prototype receives UX participation, and a non-UX deliverable receives its owning specialists without a new hardcoded coworker map. |
| AC-8 | OBJ-INSTANCE | A run requiring more than three professions retains all of their obligations; batching or capacity failure cannot be reported as complete participation. |
| AC-9 | OBJ-INSTANCE | Requested, executing, completed, failed and unavailable contributions are distinguishable; only revision-bound returned evidence satisfies a completed contribution, and independent review remains separate from authoring. |
| AC-10 | OBJ-CRAFT | A governed external Codex caller can consult UX through the supported path with its own authenticated identity retained, the consulted UX profession named, and the result correctly attributed without widening authority. |

AC-2's comment-only example has no additional declared independent-review
obligation. Required authoring professions remain accounted for even when review
depth is routine. Authoring evidence cannot satisfy that author's independent
review. A craft proposal is advisory; the qualified independent core reviewer
retains the verdict role.

AC-6 is a final delivery criterion with a mandatory internal order: qualify the
reviewer path, activate holds, then verify the held-decision outcome. Keeping
`proceed` during implementation is a safety condition, not a deferred substitute
for delivering holds. Section 3.6 and phase 6 of the plan use this same order.

## 3. Design

### 3.1 Step criticality: take the maximum of recorded floors

Reuse `resolveStepCriticality` and the existing room, shape, item and transition
readers. The server resolves these facts; a caller cannot lower them.

| Signal | Existing source | Floor |
|---|---|---|
| Effective delivery shape | `initiative-readiness/shape-requirements.ts`, `effectiveShape` | small: routine; medium: consequential; large/xlarge: critical |
| Stage advance kind | `work-management/work-shapes.ts` | governed-decision: at least consequential |
| Transition risk | `decision-perspective/graduated-autonomy.ts`, `deriveTransitionRiskTier` | high: consequential; critical: critical |
| Damaging declaration | shared escalation rule: consequence, threshold, regulation or critical risk | critical |
| Declared stage criticality | optional `WorkShapeStage.criticality` | an additional floor |

Use the pinned shape and canonical drive marking, including all active parallel
stages. Missing or unreadable required facts leave preparation outstanding.
Observation must not invent a stage, restart a concluded cycle or reinterpret a
malformed marking. Preserve the recorded basis of each floor in the request.

### 3.2 Review need precedes craft selection

| Criticality | Independent review depth | Required craft coverage | Requested verdict authority |
|---|---|---|---|
| routine | core reviewer | no inferred specialist review; explicit obligations still apply | advisory |
| consequential | core reviewer and impacted crafts | every required or impacted profession | blocking under current policy |
| critical | core reviewer, impacted crafts and architecture | every required profession and enterprise architecture | blocking; a person only for a damaging decision |

The collaboration shape may narrow depth as recorded policy permits.
`craft-stewardship` does not turn a non-damaging craft maintenance step into an
estate-wide review; a damaging fact still wins. Narrowing depth never lowers
criticality or removes a declared contribution.

Bound concurrency, not coverage: execute in batches of at most three while
retaining every required obligation. A missing provider, corpus, capacity or
returned result stays explicitly outstanding. It cannot become a passing review.

### 3.3 One craft classifier and truthful role selection

Declared deliverable, acceptance and stage requirements select professions before
paths exist. `deriveImpactedAcumens` is the single supplementary path classifier.
An HTML prototype or UX-bearing document must not wait for a React file before
receiving UX expertise.

Resolve live coworkers through the profession registry and acumen stewardship
mapping. Prefer the registered steward and validate both canonical and execution
identities, lifecycle and effective grants. A family match does not turn a
different role into the UX Design Critic. Report a missing required role honestly.

Retire the second classifier and hardcoded personas from new-review policy.
Craft context comes from `specialist-craft-context.ts` and the recorded profession
corpus. Historical immutable packets retain their saved selection, prompts,
versions and effects; compatibility readers are not a second active selector.
Exclude authors from every independent reviewer role, including the core.

### 3.4 One canonical task with distinct specialist obligations

Use the existing immutable semantic-review request and canonical `TaskRun`.
Every required craft has a distinct fenced per-agent `TaskNode` obligation and
attributable result. The independent core reviewer assesses the returned advisory
proposals. A request, invitation or checkpoint without a result is incomplete.

Bind room, current active stage or stages, exact head, criticality, authority,
complete profession obligations, selected principals and author identities before
admission. Version new contracts explicitly and preserve historical contracts.

Participant assignment and that TaskRun admission share one transaction through
the existing admission store and participant writer. Use the existing explicit
assignment source. Preserve current roles, removals and restrictive room policy.
A refusal or rollback creates neither a participant assignment nor a task.

Repeated admission subscribes to the original task. Existing fenced checkpoints
and receipt persistence remain authoritative; do not introduce an external
terminal writer, a per-profession TaskRun queue or a new assignment-source enum.
`record_semantic_review_outcome` continues to record CI correlation.

### 3.5 Authority comes from the shared rule, subject to existing ceilings

Reuse `resolveReviewAuthority({ criticality, damaging })` beside
`resolveDecisionEscalation` in `govern/authority/escalation-gate.ts`.
The same damaging fact governs both paths. A conformance walk covers every
criticality and proves a person is reached only on the damaging decision route.

Requested review depth is not a grant. Current consent, tool grants, room and
offer boundaries, sensitivity, policy and calibration may narrow what can act.
The global semantic-review calibration ceiling remains in force; zero samples
do not earn enforcement. The UX critic remains proposal-only. Missing expertise
or low trust is not by itself a reason to demand a human click.

### 3.6 Qualify, activate, and verify undecided-decision holds

The final combined delivery includes all three steps:

1. Implement and qualify the reviewer path with the existing interim behavior
   preserved. Prove authorized admission, actual specialist execution and a
   current attributable result under the applicable policy.
2. After that proof, activate `INDEPENDENT_REVIEW_INTERIM = "hold"`.
   An `independent_review` decision dispatches its room-bound review at least
   at consequential depth and retains its corpus, vector, capability,
   policy-limit or evaluation-fault follow-on.
3. Verify the held-decision path with holds active: a current authorized receipt
   releases or blocks the step, a missing/stale/unauthorized result leaves it
   held, and a damaging decision still reaches a person.

Use the governed shared Contributor preview for pre-activation runtime
qualification and the final held-decision exercise. Source, served health identity
and lease must agree. Verify the containing canonical release afterward through
the governed self-upgrade path. A source-only pass or a release with holds still
unqualified does not complete AC-6. If qualification cannot run or current
authority/calibration forbids it, record that condition and keep activation
outstanding; do not bypass the ceiling or call the feature delivered.

## 4. Research & Benchmarking

The comparison covers two open-source delivery/review systems and two commercial
review products. The inspected configuration and API entities below explain the
adopted distinction between an obligation, eligible actor and returned result.
They are benchmarks, not dependencies or DPF authority sources.

| Comparator | Inspected model | Adopted pattern and rejected substitution |
|---|---|---|
| BMAD Method, open source | [Team configuration](https://docs.bmad-method.org/customize/adopt-bmad-across-a-team/) separates `[agents.<code>]` roster descriptors from `[workflow]` facts, knowledge sources and completion hooks. Its [agent inventory](https://docs.bmad-method.org/reference/skills-and-agents/) distinguishes agent personas from executable workflow skills. | Adopt explicit craft context and workflow-specific obligations. Reject a roster descriptor or loaded persona as proof of authorized execution. DPF keeps current grants, task identity and results in its server coordination plane. Reuse the [existing dependency evaluation](../../security/tool-evaluations/2026-09-15-bmad-method.md); install no second process framework. |
| Gerrit, open source | [LabelDefinitionInfo](https://gerrit-review.googlesource.com/Documentation/rest-api-projects.html#label-definition-info) separates label values, branch applicability, copy conditions and self-approval policy; submit requirements are separate entities. | Adopt policy-bound verdicts and explicit freshness across revisions. Reject selecting review need or authority solely from a reviewer name or copying an old vote without its qualifying condition. |
| GitHub, commercial | [Pull-request review responses](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request) carry reviewer, state and commit identity separately from requested ownership in CODEOWNERS. | Adopt attributable revision-bound results. Reject treating an ownership/request row as a completed review or path ownership as the only source of review depth. |
| GitLab, commercial | [Approval rules and state](https://docs.gitlab.com/api/merge_request_approvals/) distinguish required counts, eligible users/groups and approvals. The approval API can require an exact HEAD `sha` and rejects a mismatch. | Adopt complete obligation accounting, eligibility and current-revision checks. Reject a concurrency cap as a reduction in required coverage. Numeric approval counts alone cannot prove that the required professions contributed. |

The gap filled here is the combination of declared profession obligations,
room/stage criticality, current authority and durable returned contributions.
Source-path ownership or prompt personas alone cannot provide that contract.

[GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
separates path ownership from branch protection requiring approval.
[Gerrit review labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)
separate a reviewer's permitted votes from submit requirements and explicitly
manage outdated patch-set votes. DPF applies those distinctions to craft
selection, step authority and revision freshness.

[NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) supplies a lifecycle
framework for integrating secure-development practices. The specific
criticality table here is DPF's recorded design, not a claim that NIST prescribes
these AI roles or thresholds. A new external policy engine is unnecessary for
this closed rule and existing task substrate.

Owning doctrine remains WWMD for platform policy and WSID for craft.
`professions/ux-design/information-hierarchy-and-density` records useful surface
detail, compact comparison rows, progressive disclosure, readable controls and
human labels. Opaque IDs belong in diagnostic detail when useful. An empty
calibrated critique set is an explicit limitation, not a calibrated verdict.

## 5. Deliverables

The plan maps these ten internal deliverables to the atomic BI-E27F3600 delivery:

1. Step criticality and stage floors.
2. Review authority from the shared escalation rule.
3. One active craft classifier and corpus-backed context.
4. Immutable room/stage/head admission and fenced TaskNode obligations.
5. Review need and traceable receipts.
6. Qualified activation and verification of undecided-decision holds.
7. Declared authoring and review profession obligations.
8. Complete scheduling without silent truncation.
9. Returned contributions, explicit revision extension and author disposition.
10. Actor-preserving external profession consultation.

## 6. Boundaries

This work does not graduate global calibration, publish agent-proposed critiques
as human calibration, grant new tools, widen restrictive room policy or replace
unknown historical effects. It reuses the task, participant, engagement and
evidence substrate; no new table or external policy engine is presumed.

Provider-page and routing UI implementation remain with their existing owners
(BI-7AA4EB6B and BI-2BBD9D34). Routine request/acknowledge/completion handoffs remain
with BI-5366EF78. This framework may consume their evidence but does not close
their acceptance. BI-0AABCD1F remains research intake, not duplicate ownership of
AC-7 through AC-10. Existing overlapping profession/UX work must be reconciled
before assigning duplicate scope.

## 7. Participation, corpus evidence and consultation

### Authoring and independent review

Each run accounts for professions required by its deliverables, acceptance
criteria, active stages and recorded sensitivity. Authoring and independent
review are separate obligations with separate eligible principals. Preserve all
obligations across batches and distinguish an unavailable contribution from an
advisory finding returned by a completed one.

### Executable craft obligations and supplied inputs

AC-7 and AC-9 require the selected profession's actual work, not merely its
identity, a configured service capability or a completed inference. Before
admission, reconcile the requested service and applicable profession procedure
with the authorized executable tool surface and the transport's supported input
channels. Preserve the distinction between required evidence, tool authority and
runtime availability. An advertised browser capability cannot prove that a
worker can render, and a model's image capability cannot prove that its adapter
sent pixels. Missing requirements produce an explicit unavailable contribution;
they do not silently turn the requested service into a source-only substitute.

Use existing service, skill, profession, task and adapter contracts. Do not union
all of a coworker's skills or grants, enable optional runtime capabilities, or
introduce another profession-to-tool map. A registered identity remains data;
unsupported execution must be explained rather than hidden by that declaration.
Configuration can select supported behavior but cannot grant authority or invent
a transport implementation. BI-4538254D owns the cross-cutting architect guidance;
this delivery consumes that boundary rather than creating a competing classifier.

For a UX procedure requiring captured screens, an authorized supplied capture
may satisfy the input requirement without the Critic operating a browser. Bind
the exact source revision and image DocumentVersion/blob digest, capture route,
state, viewport, theme, time and attributed capture producer. Distinguish an
external capture from the Critic's own rendering and from current deployed
acceptance. A later public prototype is not equivalent to an older artifact
merely because their layouts resemble each other. The selected Critic must
receive real image input and perform its own source/corpus-backed assessment;
an engineering screenshot, a second model's findings, an image URL in prose or
base64 serialized into a text prompt cannot establish that contribution.

Supplied images retain the same current original-requester, provider, token,
organization, sensitivity and resource-access checks as other evidence. Reuse
the canonical tool-grant alternatives and document access policy; neither write
permission nor document ownership creates an implicit read grant. Resolve pinned
versions through authorized storage, not arbitrary caller-selected local paths.
Keep image count, MIME, decoded-byte and pixel limits, private staging, cleanup
and the original sensitivity floor. No capture route may bypass a denied access
path, and no supplied input retroactively widens a historical task's authority.

The initial immutable association records supplied inputs before dispatch. A
server-owned receipt binds actual successful image delivery to the task, contribution/node,
request digest, attempt/fence, selected provider/channel and capture digests. Staging or
model-written capture references alone are insufficient. Serialize the existing
metadata checkpoint so a heartbeat or concurrent provenance append is not
mistaken for task-fence displacement or lost evidence. Database checkpoint
recovery never repeats inference. Reuse existing task,
DocumentVersion, blob and receipt machinery without raw-image prompt archives,
a new evidence ledger or agent-authored calibration. Unsupported adapters refuse
before dispatch; an incomplete or uncertain execution never earns an implicit
retry. The original contribution and author response remain required.

### Existing engagement fulfillment

Extend the existing service-catalog engagement and governed task lifecycle.
Resolve the original request, offer, provider, authenticated requester, room,
stage and immutable artifact on the server. Check current consent, effective
canonical grants, data access, sensitivity, offer authority, funding and required
approvals before assignment or scheduling. A prior invitation alone is not
permission to execute a service or disclose an artifact.

Use a stable server-derived execution identity. Admission and association must
survive interruption; observe the same task after a lost response. Unknown
effects stay unknown until supported settlement proves otherwise. A new nonce,
replacement engagement or silent migration is not recovery.

A supported revision extension preserves original request text and input digest,
including structured locators and free-text source scope. The original authorized
requester must explicitly identify the new revision, acknowledge the original
scope and give a rationale. Preserve previous associations, tasks and findings.
Do not dispatch another revision while prior effects are unknown.

### Attributable completion

A completed contribution identifies the actual provider and profession, original
requester, engagement and task, room/stage/head, artifact, applied criteria,
findings, corpus references and versions/fingerprints, calibration limitations
and author disposition. Accept/reject/request-changes dispositions remain
attributable and retain the contribution and rationale.

Evidence comes from actual execution. Metrics-only tool audits may contain no
source bytes; persist compact server-owned read provenance through existing task,
artifact or receipt machinery. Preserve exact blob/version and completeness
evidence. Truncated reads or model-written references cannot prove full-artifact
inspection. Do not make raw-source journaling a prerequisite.

States distinguish requested, executing, completed, failed, unavailable and
unknown work. Reads may repair a projection from the original persisted task;
they never dispatch replacement work or turn a stale result into current proof.

### External profession consultation and critique capture

Keep the authenticated external actor in the profession-decision ledger and
resolve `consultProfessionKey` separately against the registry. Naming UX does
not impersonate its coworker, grant authority or prove a specialist executed.
A fulfilled service must actually run as its selected eligible provider.

UX work consults its recorded profession guidance and calibrated critique lookup.
An empty set stays explicitly uncalibrated. Capture observations through the
existing draft path with agent authorship; human verdict authority stays human.
Refactor browser and MCP transport wrappers over the same server-only writer:
browser auth supplies the browser user, governed MCP supplies its verified user.
Caller-supplied user or founder fields cannot replace either identity.

## 8. Native execution, revalidation and qualification

Before either participant or task write, verify the original actor's current
token, consent, grants and room action access; legitimate invitation authority;
both provider identities and canonical revocations; independence; sensitivity and
restrictive room policy. Never revive a removed participant, union alias grants
to defeat revocation or create membership as a substitute for authority.

Each actual inference rechecks current actor, room, stage/head, provider and
effective policy, including the final core inference after craft completion.
A changed binding or revoked authority stops later calls. Persist selected
principals, complete obligations, corpus fingerprints and attributable results
with the original immutable request and fenced checkpoints.

Qualification must exercise refusal before any write, transactional rollback,
concurrent admission, interruption at persisted boundaries, revocation after
enqueue, unknown effects, partial coverage, stale revisions and self-review.
Positive proof requires an eligible UX execution returning actual criteria and
corpus evidence, a separately attributed external consult, more than three
accounted professions and the final held-decision flow in section 3.6.

Inspect current schema and task/assignment/recovery contracts before coding.
A structural test, mocked dispatch, invitation or admission is not live
fulfillment. Use exact-source governed preview evidence before activation and
bind post-release acceptance to the containing canonical revision.

## 9. Migration and evidence history

### October 25 execution-evidence amendment (unimplemented)

The Critic repair exposed a mismatch between the assigned rendered-surface
procedure and the exact three-reader worker profile, followed by a missing
image-input channel in the remote conversation and Codex adapter. A normal
native document read also demonstrated why the canonical alternative-grant rule
must be reused instead of assuming every named grant is required. These are
concrete execution-contract gaps under AC-7/AC-9, not evidence that a specialist
completed its work. Their native observations are recorded in WC-6CCF8DAB and
WC-8D35443E; the configuration-versus-code case is recorded on BI-4538254D.

The new subsection makes the required evidence and input-delivery contract
explicit without changing the ten marked acceptance statements or five
objectives. Implementation and runtime qualification remain outstanding. Native
review E85C6B35FC8B of the earlier 8c648be artifact remains UNKNOWN and
nonreplayable; this amendment neither settles it nor author-resolves its earlier
findings. Current-artifact review, coverage and implementation admission still
apply. No replacement review is dispatched by editing these documents.

Baseline baseline-c1c09681-bff9-409b-af5a-bf2a45831d5e approved the earlier f336
artifact. New independent review must explicitly disposition AC-3's active/legacy
compatibility clarification, AC-4's canonical task/branch model and AC-6's
qualification/activation/final-acceptance sequence. The other seven acceptance
statements and all five objectives remain unchanged.

Native findings IF-3415A201C6ED70BB (AC-4) and IF-F334257A9580981B (AC-6) remain
open until independent current-artifact resolution. Author edits do not resolve
them. The plan records the exact passing and failing receipts. Earlier complete
documents and their dated checkpoints remain available in
[the 96ea source history](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/96ea6dce4253072a992871d91b970e6f137be848/docs/superpowers/specs/2026-09-26-review-instantiation-by-shape-and-criticality-design.md).

Preserve historical tasks ending BF8A1F1B2D2F and 73E9748A68F5 as unknown unless
their supported original-task settlement proves otherwise. Preserve original
engagements CE-D5126472, CE-1FE20783 and CE-724328D6. The latter's original
`surface-or-prototype` names f52f119b46acb6748b29c55a23ee0b8490a3cfd6;
the earlier 68c6c46255bc2d5c6cf3a1e394ecc7a00ef2f6db fixture is not proof of a
current revision. Select an actual current artifact through the explicit revision
contract rather than relabel either historical input.

The UX critic's separately approved file-read grant was executed and verified
on October 19. Recheck current effective grants and data access on every run.
The previous actor-owned artifact-sharing alternative is outside this delivery:
do not borrow the requester's reader authority when the provider is ineligible.
Any future sharing path needs its own source-disclosure, sensitivity, residency
and provenance assessment; it cannot be a fallback around the current boundary.
