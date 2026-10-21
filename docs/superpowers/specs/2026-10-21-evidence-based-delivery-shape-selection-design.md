---
status: draft
backlog: BI-EB4C25F4
---

# Resolve delivery shape from engineering evidence

BI-EB4C25F4 corrects the selection and recovery contract in
[the existing delivery taxonomy](2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md#33-selecting-the-shape-at-claim).
It adds no delivery shape, readiness profile, data model, approval queue or
authority. The ordered fix sequence is in this document; there is no separate
feature plan. This draft is not an independent approval or implementation
admission.

## Observed defect and existing coverage

The live item is open, work type `bug`, effort `large`, under EP-129D11FD.
An exact live epic query returned all 67 items without truncation. Existing
BI-02470C7E delivered the owner pick-list behavior intentionally; this correction
supersedes that selection contract, not its delivery evidence. BI-C5E51A15
approval calibration and BI-6B3DA9DD escalation remain separate.

Source inspected at `ff4494cd311bbf8d7cf32715ccc1792d8a46be6b` shows:

- `derive-delivery-shape.ts` returns no result for a bug with recorded Medium,
  Large or Xlarge effort because it treats the work type's Small default and
  the recorded estimate as contradictory rules. An unsupported size can instead
  fall through to the unsized Small default.
- `claim-backlog-item-handler.ts` supplies effort, work type and sensitivity.
  Missing information and rule conflicts become the same `work_shape_required`
  response. The response, MCP description, external skill and claim hook all
  instruct the assistant to ask the owner to choose internal taxonomy.
- `build-studio-attachment.ts` uses the same pure resolver but leaves an
  unresolved room unshaped with a prose reason. It does not resolve the missing
  engineering facts. An unattended claim raises owner attention.
- `addsSubstrate` is understood by the pure resolver, but neither production
  caller supplies it. A work-type label or a touched file does not prove that
  a new capability, tool, route, schema element or role is being added.
- A replay can derive a new shape from changed item metadata. The fix must
  preserve a prior explicit binding and its provenance instead of silently
  replacing an existing declaration.

The operator explicitly rejected requiring a nontechnical owner to choose
engineering taxonomy and delegated routine technical recommendations. This
does not authorize damaging actions, new grants, self-approval, emergency-lane
declarations or silent removal of existing review obligations.

## Objectives

**OBJ-SHAPE-FACTS:** Resolve consistent engineering evidence systematically and distinguish absent or invalid technical facts from a genuine business decision.

**OBJ-SHAPE-AUTHORITY:** Preserve existing declarations, independent scope ownership, risk controls and human-only authority while repairing selection.

**OBJ-SHAPE-SURFACES:** Give external claims and unattended Build Studio the same classification, provenance and useful technical recovery.

## Acceptance contract

| Criterion | Objectives | Observable result |
| --- | --- | --- |
| AC-SHAPE-1 | OBJ-SHAPE-FACTS, OBJ-SHAPE-SURFACES | Actual claim and Build Studio caller tests resolve bug items with valid recorded Medium and Large sizes to those shapes, without an owner taxonomy question, and retain the facts and derivation reason. |
| AC-SHAPE-2 | OBJ-SHAPE-FACTS | Missing size for a feature/tool and invalid size/work-type facts produce distinct, bounded technical-assessment recovery containing the exact missing or invalid facts and the accountable engineering role. They do not guess Small, select the largest shape, or instruct a nontechnical owner to pick an enum. |
| AC-SHAPE-3 | OBJ-SHAPE-AUTHORITY | A valid explicit declaration and its source survive replay. A fresh inference cannot silently replace an existing higher declaration or independently approved scope. Existing canonical profile, baseline amendment, sensitivity and review gates continue to judge the change. |
| AC-SHAPE-4 | OBJ-SHAPE-FACTS, OBJ-SHAPE-AUTHORITY | Actual caller tests distinguish an existing-tool repair from an engineering-assessed contract addition explicitly declared Large, and retain the latter through admission and replay. Current independent scope/profile constraints remain authoritative. No test-only boolean is presented as production substrate detection. Multiple files or helpers are not counted as independently shippable units. Unknown contract facts remain unknown. |
| AC-SHAPE-5 | OBJ-SHAPE-AUTHORITY | No bug, urgency cue or unattended caller automatically enters Break-fix. The human-only declaration and existing controls remain. Xlarge retains its decomposition requirement and cannot enter implementation. |
| AC-SHAPE-6 | OBJ-SHAPE-SURFACES | Claim and Build Studio use the shared resolver and expose the same reason codes, fact requirements and technical recovery. Server, tool description, hook and skill no longer instruct routine owner taxonomy selection. No existing room is bulk rewritten. |
| AC-SHAPE-7 | OBJ-SHAPE-AUTHORITY, OBJ-SHAPE-SURFACES | Technical recovery reuses current governed engineering consultation and sizing tools with their existing grants. A denied operation, consequential business appetite choice or missing authority is not converted into permission. A genuine owner question describes consequences rather than internal enum labels. |
| AC-SHAPE-8 | OBJ-SHAPE-SURFACES | Focused RED is observed before production edits, affected tests and both web type programs pass, the exact affected gate and independent review complete, protected publication succeeds, and canonical served acceptance demonstrates useful technical routing or uninterrupted governed admission on a controlled existing case. No duplicate runtime work is started for acceptance. |

## Decision and contracts

CONTRACT-SHAPE-SELECTION extends the existing canonical resolver rather than
creating another classifier. Work type describes the kind of change; effort
describes the implementation unit. Sensitivity describes risk and remains a
separate input to existing readiness gates. Business appetite is an authorized
investment decision. These facts are not interchangeable.

Use this resolution order:

1. Resolve the exact existing room by repository, branch and current claim
   identity before evaluating readiness. Preserve its valid binding and actual
   provenance on replay, including when new item metadata would infer Small.
   A conflicting new declaration uses the existing governed binding/override
   path; inference cannot manufacture an override or lower independently owned
   obligations. Revalidate that binding in the existing admission transaction;
   a concurrent change refuses without a binding write. Persist a new binding
   only after successful admission.
2. A valid recorded ordinary size supplies the base shape for every work type,
   including `bug`. A bug is not inherently a one-file Small delivery. An
   absent size may retain the existing unsized `bug|doc|chore` Small defaults;
   an invalid nonempty size is not absence.
3. Preserve authoritative scope/profile constraints through existing readiness.
   There is no current trusted automatic substrate-addition producer: remove
   the dormant `addsSubstrate` classifier assertion rather than advertise it as
   a source guarantee. Qualified engineering establishes a material contract
   addition from actual source/design evidence and records the appropriate
   ordinary size or explicit shape through existing governed tools, with its
   rationale in the existing evidence/activity lane. That declaration then
   reaches normal admission and independent review unchanged. Preserve Xlarge
   when the recorded unit requires decomposition. Do not infer a new tool from
   `workType: tool`, novelty from a touched path, delivery units from file count,
   or risk from a domain word. Missing material scope facts are part of the
   technical recovery, not a silently invented negative finding.
4. When available evidence cannot establish one shape, hold implementation and
   state exactly which technical fact is missing or invalid. Design and plan
   intents keep their existing nonimplementation behavior. There is no
   unclassified-to-Large/High fallback and no new automatic emergency path.

CONTRACT-SHAPE-RECOVERY extends the current structured refusal. Keep the
`work_shape_required` compatibility code where appropriate, but distinguish
the reason and expose the technical recovery: exact fact keys, a concise
explanation, accountable implementation-planning/software-engineering role,
and existing governed tools that can record or investigate those facts. A
pick list may remain API reference data; it is not a request for business-owner
classification.

The acting engineering assistant can investigate source, contracts, atomic
delivery boundaries and existing review evidence, then record its technical
recommendation within current delegation. Current `size_backlog_item`,
`triage_backlog_item`, design/plan claims and governed engineering consultation
are reused. Naming a coworker is not proof of qualification or a grant. No
alternate actor, approval queue or fabricated operator selection is introduced.
If that route lacks authority, report the actual denied operation and its
existing remedy. If a material business choice remains, present the consequence
to the appropriate owner in plain language.

CONTRACT-SHAPE-PROVENANCE retains `declared` versus `derived`, source facts and
reason codes in the existing Workroom claim/activity record. The actual actor
is the recorder. A routine engineering recommendation under delegation is not
described as a human selecting the taxonomy. Replay does not rewrite the source
of a prior declaration.

CONTRACT-SHAPE-BOUNDARY leaves effective sensitivity, strongest historical
readiness profile, repository baseline ownership, independent review,
classification and receipt validation unchanged. A Small assessment cannot
erase an existing Large obligation or turn a reviewer-owned baseline into
author-owned criteria. The current fix-profile spec-approval path exists and
must be reused rather than changing the bug into a feature to reach it.

FLOW-SHAPE-RESOLVE is: load the actual existing item and binding facts, resolve
through the one classifier, revalidate that binding under the existing
readiness/authority transaction, then persist a new admissible binding with
provenance. Insufficient facts return bounded technical recovery before
implementation. Existing delivered rooms are not retroactively reclassified.

### Production caller and recovery wiring

The source facts are the actual recorded `effortSize`, valid work type, exact
room binding and current canonical review/baseline facts. The repair does not
create a novelty parser or convert a claim into evidence that source was read.
Engineering assessment of domains, contracts, rollback boundaries and delivery
units belongs to the existing authorized engineer/implementation-planner and
its auditable ordinary sizing or declaration. A work-type label alone supplies
none of those facts. An unsized `tool` therefore returns missing technical
facts; it is not automatically Small, Large, or an emergency.

The shared ambiguous outcome names its `reasonCode`, missing/invalid fact keys,
and `recovery` containing the accountable engineering role, existing governed
tools and the evidence to investigate. Claim responses return that same
bounded object. Transient database/source failures remain failures, not proof
of absent technical metadata. The existing pick-list remains reference data
only where compatible callers need it.

`bindBuildStudioDeliveryShape` returns this typed recovery with `bound: null`
and records it in the existing attachment activity payload. The current
`healBuildWorkroomShape` path carries it to `resumePreBuildPhase`: an unresolved
assessment stops preimplementation progression with the bounded technical
reason instead of falling through to the unshaped readiness table or raising
an owner taxonomy choice. The design/ideate phase may still gather missing
facts; no implementation dispatch proceeds while classification is unresolved.
Existing attached rooms are checked through this current-subject heal path,
not through a historical bulk rewrite. The existing resume outcome/activity
mechanism carries the hold; no new scheduler, approval queue or worker is added.

## Research and architectural fit

The current [BMAD Build a Change documentation](https://docs.bmad-method.org/build/build-a-change/)
investigates repository evidence and intent gaps before asking questions and
chooses a proportionate planning path. Adopt evidence-first technical
assessment and explicit missing facts. Retain the existing DPF evaluation's
rejection of BMAD as a dependency; do not import code-size thresholds, a second
workflow engine or its approval semantics.

[DORA's change-approval guidance](https://dora.dev/capabilities/streamlining-change-approval/)
uses practitioner review and automated assurance while reserving consequential
business trade-offs for leadership. Adopt technical ownership and auditable
evidence. This does not waive independent review, regulation, explicit consent
or damaging-action controls. These are comparators for correcting an existing
policy, not evidence that this repair has executed.

The controlling DPF doctrine is the full current source of
`gates-proportional-to-shape`, `consult-scopes-before-asking`,
`escalation-is-a-gate-not-a-trust-tier` and
`classify-ambiguous-requests-before-acting`. The last concerns unresolved
operator intent after inspecting context; it does not make a missing technical
estimate the operator's job. The older taxonomy's owner pick-list instruction
and its contradictory unclassified Large/High rule are explicitly superseded
for routine technical classification by this correction.

### Exact doctrine correction

Replace the current `gates-proportional-to-shape` bullet that instructs an
agent to put the pick list to a person with this scoped rule in the same
implementation change:

> **Engineering resolves technical shape.** Use the current recorded size,
> existing binding, source evidence and authoritative scope within the acting
> engineer's delegation, and record the derivation or explicit assessment.
> Missing or invalid technical facts hold implementation and route to qualified
> engineering assessment; they do not ask a nontechnical owner to choose a
> taxonomy entry. Ask the relevant owner only for a material business appetite,
> damaging action or unresolved authority decision, with plain consequences.
> Existing independent scope, sensitivity controls and higher obligations remain
> authoritative; no inference silently lowers them.

This corrects that one rule rather than creating a second home for the taxonomy.
Retain its surrounding baseline ownership, sensitivity ceilings, delivery
evidence and no-artifact-for-ceremony rules. The kernel page's "Where it lives"
section points to this scoped successor alongside the original taxonomy, so
discovery reaches current direction. The old specification remains historical
design evidence rather than a competing current instruction.

No schema, grant, endpoint, permission projection or frontend component changes
are planned. Existing per-item/per-room reads are sufficient; no global backlog
scan is added to claims. Missing or capped source evidence must be disclosed,
never treated as a negative proof of substrate additions. This is a backend
coordination repair; no new UX baseline or specialist-pass claim is made.

## Ordered fix sequence and verification

One atomic deliverable, `shape-resolution`, maps to BI-EB4C25F4. The following
steps are sequencing within that repair, not independently shippable features.
A classifier-only change while tool/skill/hook still require a human selection
would leave the reported defect reachable. No second taxonomy is extracted.

1. Publish this canonical fix design, preserve the original taxonomy history
   with a successor pointer, obtain the independent receipts current readiness
   requires, and bind immutable atomic coverage to this document. Resolve the
   start-of-work test-impact and guard obligations. Implementation remains
   unadmitted until those gates allow it.
2. VERIFY-SHAPE-RED: add meaningful failing cases in the existing resolver,
   claim handler and Build Studio caller suites for bug Medium/Large, missing
   tool size, invalid facts, replay/provenance, genuine contract floors and
   technical recovery. Include existing baseline and human-only/Xlarge
   controls; observe actual RED through the governed host runner before
   production edits. No mirror-only test stands in for caller behavior.
3. Extend the shared resolver and caller fact/recovery plumbing. Preserve
   current readiness/authority paths. In particular, exercise
   `governed-work-claim.ts` binding revalidation and the actual
   `heal-build-workroom-shape.ts` / `resume-pre-build-phase.ts` consumer.
   Update server/tool, hook, skill and canonical instruction copies together,
   retaining invocation metadata and instruction-plane budgets. Keep denied
   or foreign-owned paths untouched until normal scope coordination permits.
4. VERIFY-SHAPE-GREEN: run the affected suites, existing hook tests, both web
   TypeScript programs and applicable instruction/seed/convergence guards.
   Missing hook graph links require explicit source discovery and expanded
   related checks. Consume the declared style-drift obligation; run the doc
   index, diagram, architecture-count and capability-completeness checks and
   change derived artifacts only if required, with normal scope claims.
5. Freeze a clean signed candidate, run normal preflight and the exact affected
   shared gate, obtain one admissible native review and publish a ready DCO PR
   through branch protection. Reuse valid evidence; queued work is not failure.
6. VERIFY-SHAPE-LIVE: after canonical served membership is proven, observe one
   existing caller's classification or bounded technical recovery under its
   actual authority. Do not start a duplicate build or use an emergency lane as
   a probe. Close only this item's outcomes after normal acceptance.

## Backlog coverage

Coverage is pending. The canonical ordered fix path is this document; the
server chooses the required schema and baseline. The atomic record must name
AC-SHAPE-1 through AC-SHAPE-8, CONTRACT-SHAPE-SELECTION,
CONTRACT-SHAPE-RECOVERY, CONTRACT-SHAPE-PROVENANCE, CONTRACT-SHAPE-BOUNDARY,
FLOW-SHAPE-RESOLVE, VERIFY-SHAPE-RED, VERIFY-SHAPE-GREEN and VERIFY-SHAPE-LIVE.
No receipt id, native verdict, RED result or live acceptance is claimed here.
