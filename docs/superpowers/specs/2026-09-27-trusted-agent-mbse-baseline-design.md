---
status: draft
---

# Trusted agent engineering: MBSE baseline and delivery design

Date: 2026-09-27. Epic: **EP-B932453F**. Baseline deliverable: **BI-9236453D**.
Design Workroom: **WC-A8298748**. Research evidence: **WC-E4195DEE**.

This is the repository draft of the programme developed with Mark Bodman. It
consolidates the research and programme roadmap previously recorded in the
research Workroom. It is not a ratified standard, an implementation approval,
or evidence that DPF meets every proposed requirement. The existing
[standards family map](../../architecture/agent-standards-family.md) retains
normative ownership; the live backlog retains delivery status.

## Objective and boundary

Make principle-directed agent work independently implementable, inspectable and
testable. Humans establish governing principles, policy and delegated authority;
qualified agent compositions use them to recommend and execute bounded work;
TAK mediates effects; observed outcomes support correction and requalification.

The product is a standard for engineering the harness and the complete working
system. It does not require a new general-purpose LLM, a particular model vendor,
cloud deployment or custom silicon. The OS-kernel analogy explains mediation,
isolation and recovery. It does not establish complete mediation, hardware
isolation or protection against a compromised host. A prompt alone cannot create
an enforcement boundary.

The first contribution is a compact composition profile of the existing TAK,
GAID and TAK-JSI standards. DPF is the initial reference implementation. Other
implementations retain their own principles, organizations, tools and models.
WWMD, WWWD and WSID are DPF's bindings to authority scopes, not universal values
that another organization must adopt.

## Evidence baseline

Source observations below are pinned to repository commit
`0d827752665f790d3c4d3eba789ae908c45d78ba`. They identify code and test sources;
they do not report those tests as executed or establish live enforcement.
The 2026-09-27 live scope reconciliation identified 14 direct backlog items and
two related items owned by other epics. Their individual statuses remain in the
live backlog; this document does not declare their delivery complete.
The design claim for BI-9236453D was allowed by decision `IRD-89085D4D9C64`.

The [public DPF site](https://opendigitalproductfactory.com/) was inspected on
2026-09-27. Its existing trust and standards sections describe scoped judgment,
authority and working-draft maturity. The source is `docs/index.html`; the
architecture companions are Markdown under `docs/architecture/`. Public prose
is evidence of a claim, not evidence that the claim holds across all executors.

The current
[conformance assessment](../../architecture/agent-standards-dpf-conformance.md)
is a first-pass assessment. Its broad implementation labels need refreshed,
versioned evidence before reuse in the new paper. In particular, a code path
called qualification must not be assumed to implement the full JSI qualification
lifecycle. The
[April standards-family design](2026-04-18-tak-gaid-standards-family-design.md)
describes the earlier two-standard framing; the current family map includes JSI.
Preserve that history and reconcile its status rather than copying its older
framing into new public material.

### Requirement-to-evidence matrix

The `B-*` identifiers below are baseline review questions, not new normative
clause identifiers. Each row requires a source definition, enforcement location,
test assertion and observed outcome before receiving a conformance verdict.

| ID and required property | Definition owner | Existing implementation/test sources | Current evidence and next action |
|---|---|---|---|
| B-01: name the authority scope before deciding | TAK; DPF decision-scope doctrine | `apps/web/lib/decision-perspective/decision-scope-admission.ts` and its `.test.ts` | Source declares WWMD/WWWD/WSID and rejects missing/wrong scope for the governed admission path. Measure coverage of other paths; do not infer scope from a score. |
| B-02: separate advice, competence and permission | TAK action gating; JSI composition | `apps/web/lib/tak/alignment-specialist-delegation.ts`, its `.test.ts`, `apps/web/lib/mcp-governed-execute.ts` | Specialist route explicitly carries `permissionGranted: false`; local corpus/freshness checks exist. This is not proof of an externally verifiable JSI credential. |
| B-03: veto or unresolved authority cannot be outweighed | TAK authority and policy | `apps/web/lib/tak/alignment-tool-gate.ts`, `apps/web/lib/tak/preexecution-control.ts`, `apps/web/lib/mcp-governed-execute-alignment.test.ts` | Source composes decline before escalation before approval and rejects bypass arguments. Inspect all consequential paths and test policy conflicts. |
| B-04: bind authorization to the actual effect | TAK; GAID receipt semantics | `apps/web/lib/govern/authority/policy-authority-projector.ts`, `apps/web/lib/mcp-governed-execute.ts`, `apps/web/lib/tak/tool-execution-receipt.ts` | Existing approval and receipt substrate is the extension target. Coverage of mutation, expiry, revocation and replay remains to be measured. |
| B-05: a workroom has bounded stages, evidence and exits | TAK section 8.11 | `apps/web/lib/work-management/work-shapes.ts`, `workroom-shape-conformance.ts` and its `.test.ts` | Shapes already declare stages, grants and stop dispositions. The examined evaluator sequences by stage index. Demonstrate the need for branching/join/rework before adding transition semantics. |
| B-06: room posture narrows authority | TAK; workroom definition | `apps/web/lib/work-management/room-turn-authority.ts`, `apps/web/lib/governance/workroom-shape-governance-hook.ts` | The shape hook defaults to shadow and has roomless handling; other gates remain in force. Record actual mode and reachability before an enforcement claim. Do not globally enable enforcement for a demo. |
| B-07: architecture shows both intended and observed work | MBSE viewpoint; assurance mapping | `apps/web/lib/work-management/architecture-grounding.ts`, `shape-projection.ts`, `apps/web/lib/ea/reconcile-sysml-projections.ts` | Existing projections and EA models are reusable. Evidence correlation is not a completion verdict. Extend trace bindings rather than add another graph store. |
| B-08: qualification follows the whole operating composition | JSI sections 8 and 13; GAID operating profile | `docs/architecture/job-specific-intelligence.md`, `apps/web/lib/tak/alignment-specialist-delegation.ts` | Normative composition and revalidation are described. Full assessment/credential/surveillance behavior is not established by this baseline. Coordinate BI-2C5DECC1 and coworker lifecycle work. |
| B-09: feedback records the observed outcome | TAK section 13.3; GAID provenance | `apps/web/lib/tak/tool-execution-receipt.ts`, `apps/web/lib/work-management/workroom-execution-evidence.ts` | Receipt/evidence sources exist. End-to-end reconciliation, especially uncertain effects, needs a demonstrated case; reuse BI-23BF8131. |

The observed refusal of `triage_backlog_item` in this session is one bounded
authority case: tool discovery reported `agent-grant-missing` for `backlog_triage`.
It did not widen the coworker's grants. This does not validate the other rows.
Triage remains with an authorized role; changing status through another transport
would invalidate the example.

### Data admission and processing boundaries

The expanded scope adds the following evidence questions. These rows are
requirements derived from the related live backlog items, not verified findings
about every current execution path.

| ID and required property | Existing delivery owner | Evidence needed |
|---|---|---|
| B-10: data admission uses explicit classification and exact allowed sets | BI-1F8CCBFF, this epic | Positive Public source-only admission; negative missing-label, mixed-context and noncontiguous-clearance cases. Verify human, coworker and room eligibility independently. |
| B-11: the actual processing destination is approved | BI-0212E871, EP-D38F463C | Selected provider account/connection, fallback and outbound MCP result checks. Seeding preserves disabled or narrowed policy; model identity alone cannot establish approval. |
| B-12: source restrictions survive context transformations | BI-BBE6A910, EP-A33A5C61 | Restrictions and provenance survive retrieval, attachments, memory, summaries, chunks and caches. Recheck revoked source access at recall and egress. |

BI-1F8CCBFF identifies
`docs/superpowers/specs/2026-09-27-workroom-data-admission-design.md`
on its separately pushed design branch as its proposed design. That artifact is
not part of the pinned baseline tree. Its reported test evidence must be inspected
before adopting a result. The other two items keep their current epic ownership;
the programme consumes their evidence instead of duplicating their controls.

Public repository visibility does not establish data classification. An explicitly
Public workroom does not grant access to an Internal coworker context. A permitted
data label does not by itself permit a purpose or destination. Missing labels need
remediation, and declassification needs attributable authority; neither bulk Public
backfills nor inferred clearance inheritance are acceptable demonstration shortcuts.
Preserve the separate catalog-metadata repairs BI-EA61F512 and BI-D9F158AF.

## Research & Benchmarking

The proposed allocation composes existing approaches. Detailed exchange claims
require versioned mappings and round-trip fixtures; none are established here.

| Approach | Proposed use | Limit |
|---|---|---|
| [SysML 2.0 / KerML](https://www.omg.org/spec/SysML/2.0) | Requirements, system boundaries, behavior, allocation and verification | DPF's model storage is not proof of complete SysML execution semantics. |
| [BPMN](https://www.omg.org/spec/BPMN/2.0.2) and [CMMN](https://www.omg.org/spec/CMMN/1.1) | Planned process and event-driven case work | Discretionary work remains inside an authority envelope. |
| [DMN](https://www.omg.org/spec/DMN/1.5) | Decision dependencies and typed policy inputs/results | An uncertain model judgment is identified as such; a decision model does not grant permission. |
| [SACM](https://www.omg.org/spec/SACM/2.3) and [PROV-O](https://www.w3.org/TR/prov-o/) | Assurance arguments and provenance | A trace alone is neither a safety argument nor an authorization. |
| [STPA](https://psas.scripts.mit.edu/home/books-and-handbooks/) | Derive unsafe control actions and feedback requirements | Hazard analysis is a method, not a replacement runtime or blanket safety proof. |

Retain the existing ArchiMate, UML, C4 and process views where useful. Adapters
need only support the named profile they implement, with explicit semantic loss
and unsupported-control reporting; they need not deploy every notation above.

Three open-source comparisons guide design, without adding dependencies:

| Reference | Pattern to absorb | DPF disposition |
|---|---|---|
| [Cedar](https://docs.cedarpolicy.com/) | Explicit principal/action/resource/context authorization | Compare with the existing authority resolver before proposing a new policy engine. |
| [Temporal](https://docs.temporal.io/) | Durable work history, recovery and replay discipline | Reuse DPF's durable work/receipt substrate; do not add a second scheduler. |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) | Stateful orchestration and human intervention around model-driven steps | Model explicit pause/resume semantics; a framework feature alone is not TAK conformance. |

These are documentation comparisons, not performance or security evaluations.
The [Hermes profile-distribution format](https://hermes-agent.nousresearch.com/docs/user-guide/profile-distributions)
is a candidate package carrier. Hermes and Cursor adapters still need independent
capability and enforcement checks. Skills/prose portability does not transfer
credentials, grants or job qualification.

Jev remains a candidate decision service from the earlier research record. Before
selection, compare it against the current route and a deterministic baseline on
held-out, scope-separated scenarios. Measure false permits, false refusals,
abstention, review demand, latency and cost per accepted outcome. No vendor speed
or safety claim becomes a DPF result. Its use cannot bypass TAK authority.

## Proposed semantic contract

BI-A484D58F owns normative amendments. This section is design input, not a second
home for requirements. Allocate runtime semantics to TAK, identity/claims to
GAID, and qualification to JSI. Keep the MBSE composition profile informative
unless a particular exchange or behavior clause is explicitly adopted.

The minimal modeled chain is:

```text
requirement -> scoped principle/policy -> decision -> authorized transition
            -> bounded effect -> receipt -> observed outcome -> revalidation
```

Every reference needs an owner and version. An instance binds its work definition,
actor identity, operating-profile fingerprint, job/activity scope, data constraints,
applicable principles, policy, proposed action, decision, authorization and evidence.
The model records enforcement mode and evidence freshness separately from intended
controls. A score, prose rationale or UI status cannot stand in for a grant.

WWMD governs platform direction. WWWD governs the organization's business choices.
WSID governs profession/craft judgment. Conflicts are resolved by explicit scope
and authority, not by averaging vectors across these scopes. Within a scope,
hard constraints filter candidates before preferences rank admissible options.
Unestablished facts require evidence collection; unestablished authority requires
a ruling from the accountable authority. Neither defaults to approval.

### Illustrative control loop

BI-F9582C48 owns the executable contract and reference pseudocode. The following
sequence exposes the required interfaces without choosing a new engine:

```text
on trigger(work, requested_action):
    snapshot = resolve_versioned_work_and_operating_profile(work)
    scope = establish_authority_scope(requested_action, snapshot)
    if scope is unresolved: return hold_with_owner_and_reason()
    evidence = collect_required_evidence(scope, snapshot)
    if evidence is insufficient: return bounded_research_or_escalation()
    eligible = check_job_data_tool_and_policy_constraints(snapshot, evidence)
    if eligible denies: return recorded_refusal()
    context = assemble_context_preserving_source_restrictions(evidence)
    destination = resolve_actual_processing_account_and_connection(snapshot)
    if not permitted_to_process(context, destination): return recorded_refusal()
    judgment = evaluate_admissible_options(scope, evidence, snapshot)
    if judgment is unresolved: return recorded_escalation()
    proposal = bind_exact_action_and_versions(judgment, requested_action)
    authority = intersect_current_principal_agent_room_and_policy_authority(proposal)
    if authority requires_review: return durable_proposal_for_authorized_reviewer()
    if authority denies: return recorded_refusal()
    # Revalidation and use need an implementation-specific atomicity contract.
    execution = execute_through_mediated_boundary(proposal, authority)
    persist_receipt(execution)
    if execution.effect_is_uncertain: return reconcile_before_any_retry()
    outcome = observe_and_compare_with_required_result(execution)
    record_outcome_and_revalidation_triggers(outcome)
```

A human approval resumes through fresh authority and exact-action checks; it
does not skip the gate. A model/tool/profile/policy change invalidates reuse when
the applicable contract requires it. Cancellation and budgets bound work; an
expired budget may escalate but cannot silently relax the policy. Retries need
effect identity and reconciliation, not an assumption of exactly-once delivery.
Tools with shell, browser or code execution need a separately enforced resource
and credential boundary covering their reachable effects.
Every later context expansion, model fallback and result egress repeats the
applicable source, purpose and destination checks. A summary or cached embedding
cannot erase a restriction. This sequence expresses the design obligation;
BI-F9582C48 must define executable checks and binding semantics before reuse.

## Reference specimen and frozen scenario proposal

Use the existing platform development/release-readiness path as the first
specimen: an external coding agent and existing build/review roles coordinate a
bounded documentation change in a governed Workroom. This session supplies a
real source identity and refusal example. It does not by itself exercise every
scenario or qualify those roles. Bind the final specimen to a concrete versioned
work shape, operating profile and synthetic dataset before assessment.

Propose a second archetype around a synthetic service-work authorization, with
no customer records or money movement. Sector and accountable practitioner are
still to be selected; no regulated-industry compliance claim follows from it.

| Scenario | Required observable result | Acceptance proposal |
|---|---|---|
| S-01 permitted bounded action | Named authority and exact action produce a linked receipt and outcome | All required trace fields resolve to the evaluated versions. |
| S-02 missing grant / prohibited effect | Refusal before the effect; reason identifies the missing authority | Zero prohibited effects in the frozen scenario set. |
| S-03 unclear scope or insufficient evidence | Work waits for the right input or accountable authority | No default permission; a resolvable next action is recorded. |
| S-04 material model/tool/profile change | Prior qualification is revalidated or restricted as specified | Old qualification cannot silently authorize changed scope. |
| S-05 authority expiry/revocation after recommendation | Execution rechecks current authority | No effect under expired/revoked authority. |
| S-06 timeout after external submission | Effect marked uncertain; reconciliation precedes retry | No unexamined repeat of a non-idempotent effect. |
| S-07 concurrent/replayed request | Durable identity and approval binding constrain repeats | Observable result follows the declared idempotency contract. |
| S-08 shadow or unavailable control | View identifies the evidence/mode limitation | No enforcement/conformance badge from shadow-only evidence. |
| S-09 explicitly Public source-only work | Eligible human, coworker context and room use an approved destination | Permitted bounded work succeeds without fabricated write authority. |
| S-10 missing label, mixed context or a gap in allowed clearance sets | Admission identifies the unsatisfied constraint | No default Public classification, rank-based grant inheritance or silent context disclosure. |
| S-11 revoked source or transformed restricted context | Recall and egress retain and re-evaluate source restrictions | Summaries, attachments, memory and caches cannot bypass the restriction. |
| S-12 unapproved selected account or model fallback | Destination check runs before processing or outbound disclosure | No transmission to an unapproved destination; approved fallback can proceed only after re-evaluation. |

Freeze fixtures, expected results, thresholds and profile versions before running
the assessment; report denominator and environment. Tests passing a finite set
cannot establish universal safety. This baseline review has not run these
scenarios. Independent review of this proposed specimen remains outstanding.

## Documentation and public-surface change map

Update canonical sources in place and regenerate their derived artifacts. Each
row needs a reviewed change or no-change disposition at the publication milestone.

| Existing source/surface | Required revision | Delivery owner |
|---|---|---|
| `docs/architecture/trusted-ai-kernel.md` | Explicit principle-directed judgment, conflicts, version binding, failure/recovery and conformance assertions | BI-A484D58F |
| `docs/architecture/GAID.md`; `job-specific-intelligence.md` | Clarify identity/profile/qualification bindings and transfer/revalidation boundaries | BI-A484D58F |
| `agent-standards-family.md`; `agent-standards-external-alignment.md`; `agent-standards-contribution-roadmap.md` under `docs/architecture/` | Align ownership, composition and contribution sequence; preserve prior decisions | BI-A484D58F |
| `docs/architecture/agent-standards-dpf-conformance.md`; TAK/GAID/JSI conformance rubrics | Replace stale assessments with clause/test/evidence references and dates | BI-2AB781FA; BI-F3C2EC7A |
| `docs/index.html` trust, standards and maturity sections | Explain the sharper paradigm with bounded evidence and draft/verified distinctions | BI-928E1B0F |
| Architecture pages and relevant `docs/user-guide/` workroom, decision, workforce and authority guidance | Synchronize user explanations, terminology, links and examples | BI-928E1B0F |
| `docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md` | Revise the argument and cases from assessed evidence | BI-6CC40F77 |
| `docs/architecture/agent-standard-publications.mjs` and its existing source documents/generators | Regenerate TAK, GAID, JSI and white-paper Word publications; validate source/version parity | BI-928E1B0F, coordinated with BI-6CC40F77 |
| TAK/GAID/JSI diagram directories and user-guide rendered assets | Refresh affected diagrams with their owning sources | BI-928E1B0F |
| Public publication/deployment channel | Verify the actual release mechanism and rendered result before claiming publication | BI-928E1B0F |

BI-1139F962 retains PAAW public-document harmonization ownership; BI-4E32C6A2
retains inbound-link migration. EP-31C5A6C8 owns website-channel integration.
This programme consumes those efforts rather than creating duplicate migrations
or a new CMS. The website deployment configuration has not been verified in this
baseline; source discovery alone does not establish publication readiness.

## Delivery sequence and existing ownership

These are live deliverable mappings, not a `record_plan_backlog_coverage` receipt.
Detailed executable plans and immutable coverage must precede implementation.

| Sequence | Deliverable and BI | Depends on |
|---|---|---|
| 1 | Baseline/specimen: BI-9236453D | Existing standards and source/runtime inventory |
| 2 | Normative decision contract and MBSE profile: BI-A484D58F | Baseline |
| 3 | Portable schemas and reference loop: BI-F9582C48 | Reviewed normative design |
| 4 | Executable conformance: BI-2AB781FA | Standards and contracts |
| 5 | DPF end-to-end demonstration: BI-F3C2EC7A | Baseline, standards, tests and existing implementation work |
| 6 | Portable reference package: BI-07A2B207 | Contracts, tests and DPF example |
| 7 | Hermes: BI-FEA232AF; Cursor: BI-0E56BA38 | Package and verified host capability |
| 8 | External reproduction/second archetype: BI-72ED2A22 | DPF and at least one portable implementation |
| 9 | White paper: BI-6CC40F77 | Draft early; final claims depend on evidence |
| 10 | Open governance and LF/TBM materials: BI-1C39CCF8 | Standards, contribution terms and paper |
| 11 | Publisher proposal/sample chapters: BI-6AC40460 | Standards and paper |
| 12 | Existing docs/public website: BI-928E1B0F | Draft in parallel; release claims follow their evidence |
| 13 | Workroom data classification/admission: BI-1F8CCBFF | Existing admission design and reviewed control/evidence mapping |

The conformance and DPF demonstration deliverables also consume BI-0212E871 and
BI-BBE6A910. Their necessary admission, destination and source-propagation evidence
must be available before S-09 through S-12 can support a conformance claim. This
is a documented dependency proposal, not a native dependency-graph assertion.

Existing implementation epics retain their items: EP-MBSE-WORKROOM-SPINE,
EP-1C37C089, EP-COWORKER-LIFECYCLE, EP-32B0E693, EP-31815F97 and
EP-WORK-CONVERGENCE. In particular, reuse architecture participation/drift work,
TAK admission/consultation work, job-qualification improvements and decision
outcome linkage. Recheck live scope before each slice; historical status is not
proof that an implementation is complete today.

The earlier programme proposed baseline work in early October, candidate text
later in October, and a discussion package in early November, with portability
and independent work extending into November/December. These are uncommitted
targets. Confirm the user's event, capacity, reviewers and sector before making
external delivery promises. Keep the existing contribution roadmap's readiness
criteria; neither this draft nor a publisher conversation advances their level.

## Acceptance, risks and remaining decisions

The baseline is complete only when the in-scope controls have a recorded evidence
disposition, the specimen and scenarios are reviewed, document/publication owners
are assigned, live gaps are mapped without duplication, and unresolved decisions
are explicit. This draft makes those artifacts concrete but does not certify
completion of the baseline BI.

Mark retains mission and external-relationship ownership. Standards editor,
delivery lead, independent reviewer and second-archetype practitioner are roles
to assign. No other person is assigned by this document. Release/IP terms,
publication authority and venue commitments remain their accountable owners'
decisions. Authoring a draft does not authorize sending it externally.

Primary risks are overstated conformance, duplicated authority engines, stale
policy/profile evidence, escape through unmediated effects, and costly human
queues caused by ambiguous scope. Mitigate them through bounded claims,
canonical-source reuse, version binding, reachable-effect tests and explicit
escalation ownership. Roll back this documentation slice by reverting its PR;
runtime controls are unchanged. Future implementation slices need their own
rollout and rollback evidence.

### Verification for this documentation slice

Check status frontmatter, Markdown/source links, the derived document index and
diff hygiene. The claimed-path impact contract has no runtime test impacts or
guard obligations; it names the generated document index as a derived artifact.
Run the documentation checks with their actual results recorded in the Workroom.
No runtime, UX, migration or conformance-test pass may be inferred from this edit.

The initial worktree probe reported `source-only`; the managed dependency
bootstrap subsequently established `compile-ready` with the repository-pinned
pnpm and no ignored builds. Runtime conformance scenarios remain unrun. Before a PR, apply the
normal DCO, overlap and publication gates. The current `backlog_triage` grant
restriction must be resolved by an authorized role before intake promotion;
the separate allowed design claim does not bypass it.
