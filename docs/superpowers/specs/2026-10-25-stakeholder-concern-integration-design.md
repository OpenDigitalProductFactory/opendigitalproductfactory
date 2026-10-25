---
title: Stakeholder concerns across decisions, Workrooms and action controls
date: 2026-10-25
status: draft
specKind: design
backlogItem: BI-FECE4497
epic: EP-DECISION-TIER-REBALANCE
---

# Stakeholder concerns across decisions, Workrooms and action controls

This is the canonical proposed integration design for BI-FECE4497. It records future behavior, not delivered protection. Independent spec, architecture, data, security, domain and UX review remain required before implementation. The xlarge umbrella must be decomposed with live backlog coverage; this document is not that receipt.

## 1. Outcome and authority

An uninformed human or AI should encounter applicable protections without first naming the regulation, specialist or failure pattern. DPF must connect knowledge to useful, competent action while making remaining uncertainty visible.

**OBJ-1:** Compare stakeholder-specific benefits, burdens, incentives and separately evidenced sentiment across material alternatives, including indirect and adversarial effects.

**OBJ-2:** Preserve traceable derivation from source prose and context through structured assessment, scope-owned decisions, process coverage and exact execution evidence.

**OBJ-3:** Establish that the selected Workroom process covers applicable concerns, in addition to conforming to its declared shape.

**OBJ-4:** Prevent a governed consequential action when an applicable mandatory condition is absent, stale, failed or contradicted; continue permitted independent work.

**OBJ-5:** Reassess affected pending work after material source/context changes and learn from actual outcomes without silently changing policy.

**OBJ-6:** Give operators a concise consequence-first explanation using existing surfaces and shared primitives.

WWMD governs platform design, WWWD the organization's business judgment and WSID professional practice. Neighboring doctrine informs context without acquiring another scope's authority. An impact estimate is not a grant. A favorable vector score does not overcome a prohibition, required control or authority limit.

Best possible outcomes means explicit, legitimate trade-offs under governing constraints; it does not imply all interests can be simultaneously satisfied. Adversaries are modeled to anticipate behavior, not to maximize their gains.

## 2. Design grounding and parallel ownership

The [research report](../research/2026-10-25-stakeholder-concern-integration.md) records source inspection, comparators, standards and rejected alternatives. Reuse the [job-specific inventory](2026-07-25-job-specific-decision-vector-inventory-design.md), [stance derivation](2026-07-31-stance-derived-dimension-vectors-design.md), [trust envelope](2026-08-05-trustworthy-decision-evidence-trust-envelope-design.md) and [Workroom competence design](2026-08-30-paaw-competence-evolution-workroom-design.md).

Source baseline: f0fe6b72e412c01468a4e0641f3d1dde63b951e6. Current source is stronger than some historical planning text; do not infer runtime delivery from a draft spec or a backlog status alone.

| Boundary | Existing owner / carrier | This design's addition |
| --- | --- | --- |
| Shared/local decision criteria | BI-C6801B5A; wiki-taxonomy.ts and profession projections | Per-party impact attribution and explicit projection provenance, not a second axis registry. |
| Evidence and export | BI-5D887D7F; DecisionInteraction and trust envelope | Assessment-version and dependency binding, not another ledger. |
| Policy-to-action authority | BI-514826D3; resolve-policy-action-authority.ts | Consume exact existing authority; neither presume the entire deferred bridge is delivered nor bypass it. |
| Qualification revalidation | BI-6DB95601 | Pass source/profile impacts to its existing lifecycle. |
| Declared shape conformance | BI-3913EB49; workroom-shape-conformance.ts | Coverage of applicable concerns, with separate reasons for structural conformance versus missing expertise/control evidence. |
| Deterministic preconditions | BI-035BE8D1; mcp-governed-execute-preflight.ts | Concern-coverage adapter contract through that owner, not competing preflight logic. |
| Payload classification | BI-12CD3010 | Consume canonical classification and evidence. No sensitive-word heuristic or alternate screening path. |
| Bounded deliverable completion | BI-A798975C | Reuse exact agreed acceptance/revision identity; concern checks cannot silently add completed scope. |
| Optional feature-extractor research | BI-734E0C69 | Model-independent schema first; no resumed model experiment or new service. |

Concurrent approval, inference and Workroom deliveries retain their paths. This design branch owns only this spec, its research and generated documentation index. Source implementation claims are acquired per delivery slice after refreshed overlap checks. Claims observed from one connection are not a complete inventory of all work.

No deferred item is reopened by this design. Funding allocation and investment purpose require recorded owner scope; the environment and executor do not establish it. Favor consolidation of existing context, references and checks. Actual refactoring allocation follows the owner's recorded policy rather than an invented per-task quota.

## 3. Shared assessment contract

Use one versioned assessment contract for all three scopes. A context snapshot is bound to:

- canonical organization and requesting/executing Principal references;
- purpose, activity, actual action and target asset/data identifiers;
- environment identity from the server, not caller prose;
- decision profile/material/source versions and relevant applicability facts;
- Workroom identity, shape key/version, stage/iteration, persisted roster, effective qualifications and authority;
- baseline and material alternatives, including defer/no-change where meaningful;
- an exact context digest, assessment schema version and derivation provenance.

Preserve unbound/missing identity honestly. Do not fabricate a backlog subject for a Workroom assessment: the current DecisionSubjectKind only supports backlog_item. Add a nullable, indexed Workroom foreign key to DecisionInteraction instead of encoding a fake subject.

Each alternative has stable option IDs. Each affected-party entry uses existing identity when known, or a scoped role/cohort reference when individual identity is unnecessary. It records direct/indirect/adversarial involvement and the evidence for that classification. Do not create a parallel stakeholder or person directory.

Each impact claim records:

- affected party and option; baseline, dimension, benefit or burden;
- causal explanation and source spans; normative, measured, predicted or inferred status;
- raw quantity/range and unit when supported; otherwise an explicitly ordinal assessment;
- likelihood and evidence confidence separately; unknown is neither zero nor numerical certainty;
- time horizon, reversibility, exposure and relevant cumulative cohort/window;
- inherent effect, control assumption and residual effect;
- source/model/prompt/schema versions sufficient to reproduce the derivation.

Sentiment is separately recorded as reported, observed or predicted, with timestamp and source. Never infer consent or well-being from positive sentiment. A role's absence from the roster is not evidence it is unaffected.

Discovery is bounded by an explicit scope, source set, budget and truncation/omission record. No result claims every stakeholder or future harm was discovered. Material coverage gaps feed existing risk/escalation policy, not an unconditional request for human approval.

### 3.1 Prose to vector

The extractor proposes structured claims with source spans; validation resolves referenced entities, scope and source versions before admitting them. An embedding helps retrieval, not the direction or magnitude of a welfare claim.

Keep benefit and burden separately visible before projection. A versioned mapping records how a claim contributes to an existing shared or profession-local axis. Organization policy supplies permitted weights; a caller cannot invent private fleet axes or new authority through prose. New axes require the existing inventory process.

Prevent double counting when one underlying effect appears in multiple corpora, parties or controls. Preserve correlated effects and overlaps; do not sum unlike units or pretend ordinal scores are money. A win-win statement names the beneficiaries, horizon, uncertainties and any adversely affected parties. Do not call a total-score improvement a Pareto improvement.

Hard constraints are evaluated before ranking feasible alternatives. An unavailable mandatory check cannot become a favorable score. Model confidence and scoring-margin stability do not establish legal applicability or control effectiveness.

## 4. Concern applicability and process coverage

A concern is a source-backed assertion about an interest, hazard, obligation or competent-practice requirement. It is not automatically binding because an LLM generated it or a page was retrieved.

Resolve concerns from current organization/activity/jurisdiction/data/asset context and relevant WWMD/WWWD/WSID sources. Distinguish confirmed applicable requirements, potential applicability, advisory considerations and evidenced not-applicable conclusions. Preserve why a rule binds and its owning authority. Existing regulation applicability and retention resolvers remain canonical.

For each material applicable concern, record:

1. the source/version and affected parties;
2. whether it is mandatory, advisory or unresolved, and who owns that classification;
3. required competence, independence, action prerequisites and evidence freshness;
4. permitted alternative controls, where governing policy explicitly allows them;
5. actual coverage and next permitted action.

Reuse the existing coordinator/Process Overseer. Coverage is a derived input to conformance and transition admission, not a new orchestrator. A conformant shape may still have inadequate coverage.

The following are different facts: capability available; qualified participant included; check invoked; check succeeded for this target/attempt; effectiveness supported by outcomes. Presence or invocation alone satisfies neither success nor effectiveness.

A mandatory requirement survives removal of a participant, tool or stage. Repair can select another qualified permitted participant or an approved alternate control, but cannot widen grants, invent a qualification, bypass independent review, or suppress the concern. Existing explicit not-applicable qualification semantics remain intact; absence of a platform qualification scheme must not create an impossible prerequisite.

Proportionality is policy-driven. Routine reversible actions can use current validated context and standing authority. Consequential unresolved conditions narrow/hold the affected action and route a supported remedy. Read-only investigation and unrelated permitted work continue. Budget exhaustion records incomplete coverage rather than implying success.

## 5. Persistence and lineage

### 5.1 Reuse managed documents

Store the bounded assessment as an organization-owned managed Document/DocumentVersion, with existing DocumentBlob offloading and content digest. Register the assessment document kind/format in the owning typed validation registry; do not add unvalidated free-form closed-set strings.

Create a new immutable version for changed context or analysis. A derived coverage status never edits a historical assessment. Use the document's existing access and lifecycle mechanisms; retain source excerpts only when permitted and needed. Do not copy full prompts, private records or long evidence logs into Workroom JSON.

Add nullable, indexed foreign keys from DecisionInteraction and Workroom to the exact assessment DocumentVersion. Proposed names are stakeholderAssessmentVersionId and concernAssessmentVersionId respectively. The Workroom pointer denotes its current assessment; each decision retains the version it actually used. Document.currentVersionId is not an execution binding.

### 5.2 Extend DocumentReference for dependencies

Use sourceDocumentId/sourceVersionId for the assessment and existing document-version targets when available. For canonical non-document sources, extend the same reference carrier:

- a typed dependency-purpose classification and nullable targetVersionDigest;
- canonical targetExternalRef resolved by the owning source adapter;
- an index covering dependency purpose and targetExternalRef for change fanout;
- a source-version/target/purpose uniqueness contract for idempotent insertion.

Do not create a second reference table or general graph service. Existing WorkroomRelation only relates rooms; EvidenceBundle requires a deliberation run; RiskAssessment represents hazards, not all benefits. These are the verified reasons to extend DocumentReference.

The source adapter validates target existence, tenant/scope access and the exact version/digest. A polymorphic targetExternalRef is a validated reference, not a claimed database foreign key. Source kind and version semantics have closed, typed contracts. Missing/unresolvable targets are retained as unverified, never silently dropped or accepted as current.

Normalization matters: current coverage state, action-relevant binding and dependency fanout must have typed/indexed carriers, not repeated scans or primary filtering of metadata JSON. The assessment blob contains detailed claims; server projections derive the concise view. Data review must approve indexes and cardinality before migration.

### 5.3 Atomicity, sealing and retention

The governed assessment writer validates tenant, source versions and context, saves the managed document version and dependencies, and binds decision/room references atomically where one datastore transaction permits. Blob creation follows the existing durable blob protocol; an orphan blob cannot become a published assessment.

Seal the assessment version/digest and context digest into the decision's versioned trust-envelope payload. Current SealablePayload does not do this automatically. Legacy payloads continue to verify by their original schema; never recompute old chains or backfill old decisions as assessed.

Use the existing canonical JSON helper. Material changes produce a new assessment and decision attempt; previous rows and evidence remain attributable. Access checks apply to both the summary and drill-down. The summary must not reveal an unauthorized party, document title, harm allegation or source existence.

Retention follows the governing evidence/managed-document policy and applicable holds. An obligation can require erasure as well as retention; do not universally maximize all retention periods across unrelated records. Source deletion/erasure may leave a permitted digest and an unavailable-evidence status; never imply the original remains inspectable. Adding relations must not let ordinary document cleanup cascade-delete sealed decisions. Data review must define retention pins and deletion behavior.

No schema migration occurs in this design PR. The schema slice needs generated data-impact evidence, sensitivity/category/retention declarations, forward-only expand migration and tests against existing rows.

## 6. Action boundary

A completed assessment informs an existing decision; it does not grant execution authority. The action adapter supplies server-derived target/context plus the assessment binding to the current deterministic preflight and authority system.

Before a governed consequential mutation:

1. Resolve the exact action, resource/target and applicable data/environment identity.
2. Resolve required concern coverage and source versions from authoritative stores.
3. Refuse a failed mandatory condition; hold an unresolved mandatory condition with a supported repair. Never issue an approval card for a deterministic precondition failure.
4. Obtain the existing action-specific authority under the correct owning scope, with its normal expiry, revocation, delegation and independence constraints.
5. At the mutation boundary revalidate the context/target/source/assessment and authority binding. Serialize with the subject mutation or use revision fencing so a check-to-use race cannot reuse stale coverage.
6. Write the action receipt with the exact assessment version, current action binding and observed result. Retries are idempotent and remain bound to the same target/attempt; input-changing repair creates a new attempt.

All human/AI UI, headless, scheduled and external MCP adapters re-enter the same governed domain writer for the covered action. Identify unmanaged database/shell/third-party access separately; this design does not protect direct credentials merely by displaying a warning.

Production-data deletion is the first proposed consequential acceptance class, not permission to execute a live destructive test. Verify target identity and selected record scope, retention and holds, authoritative permission, applicable required recovery evidence and downstream dependencies. A backup is not permission to violate an erasure duty or retention hold. Missing coverage blocks that deletion while permitting a safe scoped alternative such as inspection where authorized.

The first enforcement adapter may ship only when its owning preflight/authority contracts are delivered and independently exercised. A declined or unavailable mandatory control is not converted into retry-until-approved behavior.

## 7. Change propagation and outcome feedback

A change event carries canonical source reference, old/new version, effective time and scope. Use indexed DocumentReference dependencies to find affected assessment versions, then typed decision/room relationships to find pending/live work. Bound and checkpoint fanout; repeated events coalesce by source version and target.

Advance the current coverage state through the existing Workroom evidence/projection path. Historical decisions retain their original assessment. Future-effective requirements can prepare future process versions without misreporting current applicability.

A missed event cannot leave consequential authorization valid indefinitely: pre-action freshness/version checks are authoritative. Material roster, tool, skill, corpus, qualification, shape or policy changes also invalidate the affected context digest. Changes to one effect do not indiscriminately block unrelated actions.

External regulatory feeds produce reviewable candidates and applicability evidence. Only the existing authorized adoption/versioning path creates binding policy. If no lawful current interpretation is available, expose the uncertainty and use existing disposition rules.

Record observed benefits/burdens, control failures and recovery against the decision/assessment/action. Separate outcome evidence from human agreement with a recommendation. Aggregate small actions by an explicit cohort/window and stable underlying effect, avoiding duplicate counting. Known remaining exposure stays visible even when a local action completed successfully.

Feedback can nominate a doctrine/weight/control change. It cannot self-promote a new mandatory requirement, weaken an existing safeguard or expand autonomy.

## 8. Operator experience

Use existing decision detail and Workroom surfaces, their authorized read model and report-kit components. Default disclosure contains:

- who gains and who bears material burdens;
- the protections that matter for this action and whether they were actually checked;
- remaining uncertainty and a plain-language next permitted action.

An expandable comparison shows alternatives by affected-party role, benefit/burden, horizon, evidence quality, control assumptions and residual risk. Keep reported sentiment visibly separate. A second disclosure shows sources, governing scope, shape/version and execution evidence for people who need the trace.

Use text plus semantic intent, not color-only assurance. Cover narrow layouts, keyboard use, light/dark themes, localization and RTL. Unknown/not assessed/stale/failed/not applicable must be distinguishable. A green overall score must never hide an unmet mandatory condition.

Routine safe actions do not acquire an extra approval dialog. When human judgment is genuinely required, present the exact choice, consequences and residual uncertainty. Generic confirmation is not a substitute for required expertise or an enforceable check.

No new global dashboard or separate stakeholder-maintenance form is proposed. Existing owner corrections enter the source's authorized path, preserve the prior version and trigger reassessment. Do not let a display edit rewrite an already sealed assessment.

## 9. Acceptance contract

The original item criteria are preserved by the following measurable cases. Verification codes below describe future evidence obligations, not tests already run.

| AC | Objectives | Acceptance statement | Verification |
| --- | --- | --- | --- |
| AC-S01 | OBJ-1, OBJ-2 | A decision displays a versioned trace from source claim through party/option impact, projected feature, owning doctrine, control, process coverage, action and observed result; missing and not-applicable links differ. | V-TRACE: source/DTO/persistence/UI round trip. |
| AC-S02 | OBJ-3 | An owner who names no regulation still receives a context-derived applicability assessment; unverified applicability is labeled and routed. | V-APPLY: sourced jurisdiction/activity fixtures. |
| AC-S03 | OBJ-4 | A production-data deletion with absent mandatory target, retention/hold, authority or recovery evidence cannot mutate data, even with a favorable score or generic credential. | V-DELETE: guarded mutation fixtures and transaction-race tests. |
| AC-S04 | OBJ-3, OBJ-4 | Removing a specialist/tool/stage cannot erase an obligation; an alternate control works only under recorded permitted policy. | V-ROSTER: coverage/conformance separation. |
| AC-S05 | OBJ-5 | Source, policy and process changes identify affected live/pending work, invalidate stale coverage, and preserve prior decision context. | V-CHANGE: indexed fanout, missed-event and retry fixtures. |
| AC-S06 | OBJ-3, OBJ-4 | Available, invoked, succeeded and effective checks are distinct; human and AI action adapters share the applicable boundary. | V-CONTROL: adapter parity and evidence-status matrix. |
| AC-S07 | OBJ-1 | Fast-credit alternatives expose customer/company gains, workload, fraud incentives and victim harm; open-source alternatives expose transferred maintenance burden. | V-IMPACT: labeled qualitative/quantitative fixtures. |
| AC-S08 | OBJ-4, OBJ-6 | A routine low-risk action proceeds under valid standing authority without a new approval; unresolved consequential coverage holds only affected action and supplies a supported next step. | V-ROUTINE: positive and held happy paths. |
| AC-S09 | OBJ-1, OBJ-5 | Missing data, stale corpora, conflicting duties, changed targets, failed checks, repeated small actions and cross-adapter bypass attempts cannot create false assurance. | V-NEGATIVE: adversarial and benign-error matrix. |
| AC-S10 | OBJ-2, OBJ-3 | Shared document/reference, context and coverage contracts replace competing representations; no new decision engine, stakeholder directory or permission service is introduced. | V-ARCH: independent architecture review and call-site map. |
| AC-S11 | OBJ-1, OBJ-2 | Prose-derived impacts carry source spans and epistemic class; sentiment cannot substitute for benefit, consent or authority; unknown cannot become zero. | V-DERIVE: extraction and validation round trip. |
| AC-S12 | OBJ-1, OBJ-2 | Scope-owned projections use governed axes/weights, preserve cost signs and correlations, and record any exclusion or transformation. | V-VECTOR: sign, missingness and duplicate-effect tests. |
| AC-S13 | OBJ-2, OBJ-4 | An assessment changed between preflight and mutation refuses the stale attempt; replay against another target or version fails. | V-FENCE: concurrent target/source/authority changes. |
| AC-S14 | OBJ-2 | Old unassessed decisions remain honest and verifiable; new seals commit to exact assessment/context digests without rewriting old chains. | V-SEAL: old/new payload and tamper tests. |
| AC-S15 | OBJ-2, OBJ-6 | Cross-organization/source access is refused and summaries do not leak inaccessible stakeholder or evidence information. | V-ACCESS: permitted/denied read and write parity. |
| AC-S16 | OBJ-2, OBJ-5 | Dependency lookup is indexed and bounded; fanout resumes idempotently and never treats partial population as complete. | V-SCALE: explain plans, cardinality fixtures and checkpoint proof. |
| AC-S17 | OBJ-2, OBJ-4 | Additive migration accepts legacy data; assessment/evidence cleanup cannot erase sealed decisions or violate applicable erasure/retention duties. | V-DATA: populated migration, retention and cleanup tests. |
| AC-S18 | OBJ-5 | Feedback records observed outcomes separately from agreement and can only propose governed doctrine/weight changes. | V-OUTCOME: observation and proposal-authority tests. |
| AC-S19 | OBJ-6 | The served comparison is legible at narrow width and by keyboard, localized and theme-aware; all assurance states have text. | V-UX: measured existing-route budget and accessibility review. |
| AC-S20 | OBJ-3, OBJ-4 | Exhausted consultation budget, absent qualification scheme or unavailable direct access coverage is reported honestly without inventing authority or impossible prerequisites. | V-BOUNDS: budget, not-applicable and unmanaged-path fixtures. |

Original BI criteria AC-1 through AC-10 map respectively to AC-S01, S02, S03, S04, S05, S06, S07, S08, S09 and S10; the remaining cases make their boundaries explicit. They do not replace the original acceptance contract.

## 10. Delivery boundaries and dependency disposition

These are candidate delivery boundaries for independent review, not executable plan coverage. Before writing an implementation plan, search live work again, map each boundary to a new/existing BI, obtain the umbrella scope baseline and record governed decomposition/coverage.

| Boundary | Deliverable and likely source seams | Dependency / stop condition |
| --- | --- | --- |
| D1 | Typed assessment, source/party/option/projection validation and representative fixtures; proposed shared module under decision-perspective. | Confirm inventory projection compatibility with BI-C6801B5A; no new uncontrolled axes. |
| D2 | Managed assessment document kind, typed decision/room version links, indexed versioned DocumentReference dependencies and versioned seal extension. | D1 and independent data/security review; existing Document writer and trust envelope owners. |
| D3 | Concern applicability and coverage projection feeding existing shape conformance, with qualified participant/control evidence. | D1/D2; reuse delivered BI-3913EB49, coordinate with current Workroom changes. |
| D4 | Exact-action preflight and mutation fencing for the first production-data-deletion class, including human/AI adapter parity. | D3; delivered tested precondition/authority/retention contracts from existing owners. Do not implement the entire policy bridge here. |
| D5 | Source-change invalidation, bounded dependency fanout and cumulative/observed-impact feedback. | D2/D3; existing qualification-impact lifecycle from BI-6DB95601. |
| D6 | Existing decision/Workroom comparison and trace disclosure, authorized MCP/headless projection and served verification. | D2/D3; coordinate with current progressive-disclosure and Workroom UI owners. |

D1-D6 are independently reviewable and cannot remain only Markdown tasks when planning begins. No implementation is admitted under the xlarge umbrella. A parent design publication does not complete the feature or any existing dependency.

## 11. Compatibility, rollout and rollback

Expand first: new references/fields are nullable and legacy assessments read not-assessed. Existing mandatory controls continue unchanged. Shadow assessment can measure extraction/coverage without changing verdicts, but cannot be presented as enforced protection.

Pilot one named decision class and one representative organization context with explicit governing policy and fixture evidence. Admit enforcement only after independent review and canonical served tests establish the exact covered adapters/targets. Missing shadow assessment does not create a new platform-wide denial.

Once a profile requires a coverage check, missing/unreadable assessment cannot bypass that requirement. Rollback may disable an unactivated observational producer; it cannot silently disable an active mandatory safeguard or rewrite history. The release owner must preserve a compatible refusing path or approved operational alternative for affected actions.

No new runtime, external provider or paid service is required. No live production deletion is a verification step. No grant, posture, investment policy, regulation adoption or private peer record is modified by this design.

## 12. Research & Benchmarking

The [research report](../research/2026-10-25-stakeholder-concern-integration.md) compares three open-source approaches (OPA, Cedar, BMAD) and three commercial systems (OpenPages, ServiceNow IRM, Camunda), including data/relationship models, adopted patterns and rejected mechanisms. NIST AI RMF MAP informs stakeholder/context assessment and W3C PROV-DM informs lineage. These are design references, not compliance certification.

## 13. Review and completion

Required design reviewers: independent spec approval, architecture, data stewardship, security, compliance/domain and UX fit. Reviewers must assess exact immutable artifacts under their own principal and permitted grants. The author cannot mint independent approval.

Design publication requires document guards and the applicable semantic-review path. Implementation additionally requires live decomposition/coverage, claimed exact paths, source-local checks and canonical runtime evidence appropriate to each slice.

The design is accepted only when reviewers resolve the data-reference/seal/retention contract, concern authority and proportionality, source-change fencing, initial enforcement class and delivery ownership. Unresolved issues remain explicit; a written boundary is not proof of protection.
