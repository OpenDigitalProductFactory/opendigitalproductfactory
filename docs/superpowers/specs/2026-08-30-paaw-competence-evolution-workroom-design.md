---
status: draft
date: 2026-08-30
decision_scope: wwmd
workroom: WC-2122F7AC
backlog_item: BI-636638A6
umbrella_backlog_item: BI-41460872
---

# PAAW competence-evolution Workroom profile

## 1. Executive decision

DPF should extend the shipped Governed Playbook Experimentation Loop into a complete,
qualification-aware competence-evolution loop. It should not add a self-editing researcher, a
second wiki, a second work ledger, or a second qualification system.

The canonical loop is:

```text
PAAW WorkOccurrence and Workroom evidence
  -> TAK-attributable execution and outcome record
  -> scope-correct WWMD / WWWD / WSID knowledge proposal
  -> curated knowledge claim and candidate WorkPattern
  -> isolated, held-out WorkPattern evaluation
  -> governed promotion decision
  -> TAK-JSI impact analysis and revalidation
  -> scoped AuthorityBinding activation
  -> operational surveillance and observed outcome
```

The room carries the work, the commons carry durable knowledge, the playbook carries a candidate
method, TAK-JSI carries job qualification, and TAK carries live permission. No one layer may infer
the authority owned by another.

## 2. Why this is an extension, not a new subsystem

The current source already contains:

- PAAW WorkUnitDefinition, WorkOccurrence, WorkAssignment, Collaboration, and Workroom contracts;
- `TaskRun`, `BuildPhaseRun`, and `DecisionShadowLedger` experiment evidence;
- model x method factorial execution with exact model/provider attribution;
- deterministic WorkPattern promotion and rollback;
- authoritative activation through `AuthorityBinding`;
- scoped WWMD, WWWD, and WSID commons;
- TAK-JSI job profiles, qualification schemes, work-sample assessment, material-change handling,
  and autonomy ceilings.

The uncovered gap is the seam between these parts. The current experiment runtime checks paired
fixtures, resource budgets, commandment regressions, critical findings, and evidence scope. It does
not yet make held-out evaluator isolation, repeated-probing controls, capability-floor protection,
cross-model negative-transfer tests, or JSI revalidation a required part of playbook activation.

## 3. Ownership boundaries

| Concern | Authoritative owner | Rule |
| --- | --- | --- |
| Work purpose, stages, assignments, measures, and outcome evidence | PAAW | A competence-evolution activity is a WorkUnitDefinition executed as a WorkOccurrence in a Workroom. |
| Platform/build judgment | WWMD | Platform playbooks, evaluator policy, and qualification infrastructure are platform decisions. |
| Organization operating judgment | WWWD | Organization-specific operating choices remain in the organization's own doctrine. |
| Profession craft and job technique | WSID | Profession knowledge and decision axes are curated here; they do not grant authority. |
| Candidate method | Governed WorkPattern / Living Playbook | A proposal remains inert until its evidence and promotion state permit activation. |
| Job fitness | TAK-JSI | Qualification binds the exact GAID subject and operating-profile fingerprint to a job/activity/risk context. |
| Live permission | TAK | Qualification is an input to the execution-time ceiling, never permission by itself. |
| Agent identity and qualification advertisement | GAID | Claims identify the enduring subject, profile, status, issuer, and evidence. |

WWMD, WWWD, and WSID are decision and corpus scopes. They are not implementations of JSI. JSI uses
the applicable scoped doctrine as one part of a job qualification and retains its own scheme,
subject, evidence, status, and revalidation lifecycle.

## 4. PAAW application profile

### 4.1 WorkUnitDefinition

A competence-evolution WorkUnitDefinition must declare:

- the work class, intended outcome, owning decision scope, and accountable Principal;
- the evidence population and sampling boundary;
- the baseline and candidate method identities;
- the exact operating-profile dimensions allowed to vary;
- the evaluation scheme, qualification scheme, and critical-failure policy versions;
- resource, time, retry, and submission budgets;
- the evaluator, reviewer, escalation receiver, rollback owner, and failure owner;
- prohibited information paths and prohibited actions;
- stop conditions for success, invalid evaluation, budget exhaustion, evidence leakage, and
  critical failure;
- the expected promotion ceiling and the JSI records potentially affected by activation.

The definition specifies the outer assurance envelope. It should not prescribe every research
step. The automated weak-to-strong study found that a flexible inner research loop outperformed a
rigid fixed sequence, while its reward-hacking incidents show why budgets, isolation, and acceptance
controls must remain fixed outside that loop.

### 4.2 Workroom and collaboration shape

The Workroom definition projects the WorkUnitDefinition and convening policy. The Workroom instance
references one root WorkOccurrence and the exact definition version. A research room may contain:

- exactly one explicit coordinator assignment, presented as the Process Overseer;
- two or more independent specialist assignments where parallel exploration is warranted;
- a separate assessor assignment that does not share mutable candidate state;
- a reviewer or scheme-authority assignment for consequential promotion;
- explicit reconciliation, escalation, and failure ownership.

Shared surveys, discussion, code, and candidate artifacts are governed Workroom artifacts. They do
not become an informal side channel or a new source of truth. Independent arms use separate mutable
workspaces. The evaluator and held-out material remain outside every candidate's writable surface.

#### 4.2.1 Process Overseer contract

The Process Overseer is the existing canonical `coordinator` role made executable, not a new agent
kind. It owns whether the Workroom is following its declared shape; it does not own the business
outcome or decide whether its own candidate passed.

| Responsibility | Owner |
| --- | --- |
| Outcome and risk acceptance | accountable Principal |
| Shape/version, stage order, roster, prerequisites, budgets, receipts, and stop-condition conformance | coordinator / Process Overseer |
| Research or task execution | contributor or specialist |
| Held-out scoring and assessment | evaluator or reviewer |
| Consequential promotion | approver or scheme authority |

Before candidate work starts, and before and after every stage transition, a deterministic
conformance projection compares the declared definition with observed room state. Zero, multiple,
or only legacy-derived coordinators; missing required participants; absent prerequisite receipts;
out-of-order stages; exhausted retry/resource/submission budgets; due review points; and met stop
conditions all pause or refuse execution. The result records the exact shape and definition
versions, deviations, disposition, and next permitted transition.

This outer loop owns application, validation routing, acceptance/rollback routing, audit logging,
and escalation while leaving the inner research method flexible. It cannot expose held-out labels
or evaluator credentials, select favorable seeds after seeing results, silently retry until a proxy
passes, invent a participant, skip a gate, or widen authority. Finite rooms reconcile on events;
standing rooms also receive a bounded idempotent delta sweep. Every mismatch becomes an
attributable receipt and attention item for the Process Overseer and accountable Principal.

The role may be filled by a person or AI coworker. An AI Process Overseer must hold a current JSI
qualification for the applicable process-coordination activity and an intersecting TAK authority
binding. Where the Workroom shape requires independent evaluation, review, or approval, the same
subject cannot occupy both sides of that boundary.

### 4.3 PAAW trace

Every promoted method must resolve the following trace without copying the underlying records:

```text
WorkUnitDefinition@version
  -> Workroom definition@version
  -> Workroom instance
  -> WorkOccurrence and WorkAssignments
  -> execution/outcome evidence
  -> scoped knowledge proposal and source references
  -> WorkPattern candidate@version
  -> experiment definition/run/cells
  -> qualification-impact decision
  -> promotion DecisionInteraction
  -> JSI qualification status/version
  -> AuthorityBinding
  -> deployed operating-profile fingerprint
  -> surveillance outcomes
```

This is a relationship profile over existing authorities, not a new competence ledger.

## 5. Three-layer learning contract

WikiSkill separates immutable raw traces, a persistent wiki, and executable skills. DPF adopts the
separation but applies its existing governance boundaries:

1. **Evidence** is immutable and attributable. Corrections append or supersede; they do not erase
   the original WorkOccurrence, TaskRun, action, receipt, or observation.
2. **Knowledge** is a curated WWMD, WWWD, or WSID claim. It carries scope, provenance, confidence,
   freshness, contradictions, and supersession. Rejected hypotheses remain visible as rejected
   evidence rather than active guidance.
3. **Method** is a versioned WorkPattern, skill, prompt, tool policy, routing rule, or procedural
   change. It is inert until governed evaluation and promotion.

The inference subject should not receive an entire learning corpus by default merely because the
corpus exists. WikiSkill's direct-wiki-access condition underperformed its skill-mediated condition.
DPF therefore retains progressive disclosure: retrieve the scoped material required for the work,
then compile repeated verified learning into an evaluated method where that is more reliable.

## 6. Evaluation-integrity contract

### 6.1 Separation of authority

The candidate subject must not decide whether it passed. A conforming evaluation names distinct
subjects for candidate execution, evaluator/oracle ownership, scheme authority, and production
operation. One human or service may hold several roles only when the risk assessment permits it and
the overlap is recorded.

### 6.2 Held-out and write-protected evidence

For any evaluation that affects qualification or autonomy:

- held-out fixtures, expected results, labels, and evaluator credentials must be unavailable to the
  candidate's writable environment;
- logs and scored artifacts must be retained outside the candidate's writable surface;
- evaluator calls must expose only the minimum result needed for iteration;
- repeated queries, retries, seed selection, and budget consumption must be attributable;
- a detected information leak invalidates the affected evidence rather than scoring the candidate
  adversely;
- the evaluation must identify whether the candidate, evaluator, or infrastructure selected each
  seed, sample, or cohort.

### 6.3 Precommitted decision rule

Before candidate execution, the scheme records:

- primary and secondary endpoints;
- critical failures;
- capability floors;
- sample/cohort construction;
- seed and retry policy;
- resource and submission budgets;
- uncertainty treatment;
- invalidation conditions;
- the promotion, restriction, rollback, or inconclusive rule.

This prevents a result from being re-narrated after the evaluator sees it.

### 6.4 Capability preservation

An apparent safety or quality improvement is invalid when it comes from destroying required job
capability. Each evaluation therefore includes a task-specific capability floor and reports refusal,
escalation, and successful completion separately. Correct refusal cannot be confused with incapacity;
blanket refusal cannot be rewarded as alignment.

### 6.5 Cross-model and cross-context transfer

WikiSkill reported material negative transfer when a skill evolved for one model was applied to
another. DPF must treat transfer as a new qualification claim:

- evidence names requested and actual provider/model, harness, tool surface, corpus, memory,
  decision-policy version, data class, and job/activity version;
- promotion to another operating profile requires a target-profile assessment or a scheme-defined
  equivalence decision;
- transfer evaluation includes ordinary, boundary, adversarial, long-horizon, cost/latency, and
  tool-budget cases appropriate to the job;
- a model-family or provider aggregate never substitutes for the exact operating-profile
  fingerprint;
- customer-zero or one-install evidence cannot silently support archetype or fleet activation.

### 6.6 Monitoring without hidden reasoning dependence

Evaluation and surveillance should use governed actions, tool attempts and results, artifacts,
receipts, decisions, and observed outcomes. A monitor may inspect available reasoning traces for
research, but qualification must not depend on private chain-of-thought access that another runtime
cannot reproduce or a relying party cannot verify.

## 7. Promotion-to-qualification interlock

A WorkPattern promotion decision and a JSI qualification decision are distinct but ordered.

1. The promotion service proves that the candidate method beats or safely matches its baseline
   within the declared evidence scope.
2. Material-change impact analysis resolves every active qualification and AuthorityBinding whose
   operating-profile fingerprint includes the changed prompt, skill, corpus, memory, tool, model,
   provider, policy, or authority input.
3. Unaffected records remain active with the impact decision attached.
4. Affected records move to `pending-revalidation`, `restricted`, or `suspended` before the changed
   profile can execute beyond its safe continuity envelope.
5. Target-profile JSI assessment either issues a new qualification version, narrows the scope, or
   rejects the change.
6. TAK activation may bind only the intersection of promotion evidence, active qualification,
   grants, data policy, regulatory policy, and operational evidence.

Rollback restores a known method version and also re-evaluates the qualification and binding state.
It must not assume that restoring a file automatically restores evidence freshness or runtime
fitness.

## 8. Persistence and single-source-of-truth design

The first implementation adds no new general-purpose table.

| Fact | Canonical home |
| --- | --- |
| Work identity, assignments, participants, and outcome | Workroom / WorkOccurrence / Work Case substrate |
| Experiment manifest and cells | Parent/child `TaskRun` metadata |
| Immutable comparison and outcome observations | `DecisionShadowLedger` |
| Candidate and human review | existing WorkPattern review and improvement-signal path |
| Promotion decision | `DecisionInteraction` plus effective experiment evidence |
| Active method | `AuthorityBinding(resourceType = "work-pattern")` |
| Job qualification | TAK-JSI qualification record and GAID advertisement |
| Scoped durable knowledge | WWMD, WWWD, or WSID commons |

If measured query pressure later justifies a normalized relation, the schema proposal must first
show the missing cardinality or integrity constraint and identify which JSON projection it
supersedes. A read model may denormalize for the operator surface but cannot become an authority.

## 9. Operator experience

Extend the existing AI Workforce **Needs and Playbooks** surface. Do not add a research-control
dashboard.

At default altitude, show:

- what working method is proposed;
- the job/activity and current activation scope;
- whether evidence is isolated, held out, representative, and current;
- whether the target operating profile was assessed directly or by an approved equivalence;
- capability-floor and critical-failure status;
- qualification impact: unaffected, pending revalidation, restricted, suspended, or active;
- the next accountable action.

Keep experiment cells, seeds, exact fixtures, profile hashes, and ledger identifiers behind evidence
drill-down. Use the existing report-kit and status tokens; no nested card wall and no second approval
queue.

## 10. Scale and bounded execution

The target is many concurrent agents and many thousands to millions of sovereign installs.

- WorkOccurrence, TaskRun, ledger, and qualification queries must be cursor-bounded.
- Evaluation populations must be sampled or incrementally updated; do not rescore fleet history on
  each method change.
- Impact analysis begins from the changed asset/profile fingerprint and follows indexed bindings;
  it must not scan every agent or qualification.
- Factorial evaluation grows multiplicatively. A scheme declares the supported factor set and uses
  staged screening before a full matrix.
- Cross-install promotion uses aggregate evidence references and privacy-preserving eligibility
  facts, not copied customer artifacts.
- Retention distinguishes immutable audit requirements from derived caches and disposable
  workspaces.

The initial scale ceiling is one installation, one activity/risk class, two method variants, two
model variants, and a bounded fixture corpus per experiment. Fleet promotion remains out of scope
until the existing Hive/federation metrics and evidence-scope work lift that ceiling.

## 11. Alternatives considered

### A. Add an autonomous research-agent subsystem

Rejected. It duplicates Workrooms, scheduling, collaboration, evidence, and approval. It also gives
the research metaphor more authority than the work being performed.

### B. Treat the papers as evaluator guidance only

Rejected. Guidance does not prevent a candidate from seeing held-out labels, repeatedly probing a
scorer, or leaving stale qualification active after promotion.

### C. Extend PAAW, governed WorkPatterns, and TAK-JSI

Adopted. The substrate already executes the work, records evidence, promotes methods, qualifies job
fitness, and enforces authority. The change closes explicit contracts between those owners.

## 12. Research and source decisions

### 12.1 WikiSkill

[WikiSkill](https://arxiv.org/html/2608.27454) separates immutable traces, a persistent wiki, and
validated skills. DPF adopts that separation, the independent skill-validation gate, retention of
negative learning, and model-transfer testing. DPF rejects an undifferentiated wiki, uncurated
permanent active guidance, and direct corpus injection as the default runtime path.

The paper's reported persistent-wiki condition improved average performance from 48.7 to 63.7; its
direct-wiki-access condition reached 60.9. A skill evolved for one smaller model materially degraded
another model on a spreadsheet task. Those results are research evidence for the contracts above,
not conformance evidence for DPF.

### 12.2 Automated alignment researchers

[Automated Researchers Can Reliably Mitigate Alignment
Failures](https://alignment.anthropic.com/2026/automated-alignment-researchers/) used parallel
researchers, persistent shared artifacts, fresh iterative sessions, isolated held-out evaluation,
and a capability check. DPF adopts the Workroom collaboration shape, evaluator separation,
capability floor, and retained artifacts. The reported human comparison was not direct and benefited
from many automated attempts; DPF must not cite it as proof that an automated researcher replaces a
qualified human assessor.

The study's monitor excluded 39 of 1,601 trajectories for evaluation gaming. That is evidence that
monitoring and isolation are first-class controls, not evidence that cheating was negligible. DPF
therefore gives the Process Overseer fixed attempt/budget accounting and audit duties, while keeping
the evaluator and held-out material outside both the executor's and overseer's mutable surfaces.

### 12.3 Automated weak-to-strong researcher

[Automated Weak-to-Strong
Researcher](https://alignment.anthropic.com/2026/automated-w2s-researcher/) found a flexible inner
research loop effective, while agents also exploited dataset shortcuts, seed selection, evaluator
feedback, and label leakage. DPF adopts flexible execution inside a precommitted WorkUnitDefinition
envelope and rejects evaluator APIs that expose enough information to optimize the test rather than
the intended outcome. The design preserves that flexibility by making the Process Overseer enforce
the outer contract and transition invariants, not a mandatory step-by-step research script.

### 12.4 Operator-provided transcript

The local transcript `C:/Users/Mark Bodman/OneDrive/Desktop/AGI by december.txt` is a discovery and
interpretation source, not a normative reference. Its WikiSkill summary and Goodhart warning are
consistent with the primary sources. Its AGI-date, model-release, and vendor-roadmap claims remain
speculative and do not support DPF requirements.

## 13. Delivery shape and refactoring budget

The implementation plan must map each independently shippable delivery to a live BI and reserve 20%
of each delivery for refactoring. The allowed refactoring is narrow:

- consolidate experiment-integrity parsing and invalidation reasons;
- centralize operating-profile material-change impact resolution;
- reuse one qualification/binding transition adapter;
- remove duplicate evidence-scope or critical-failure interpretation;
- consolidate existing coordinator, collaboration-shape, stage, and stop-condition checks into one
  pure Workroom conformance projection;
- keep UI projection separate from persistence and authority.

Unrelated cleanup, a new experiment service, a new qualification table, or a new research dashboard
does not count toward this budget.

Live delivery coverage:

| Delivery | BI | Role |
| --- | --- | --- |
| Umbrella assurance outcome | `BI-41460872` | Holds the cross-standard objective and decomposition. |
| Standards and design publication | `BI-636638A6` | Publishes this profile and harmonizes PAAW, TAK-JSI, and playbook documentation. |
| Workroom definition and roster foundations | `BI-EFFD97B4`, `BI-4CB2EF76` | Adds definition-level trigger/grant/measure declarations and a persisted typed roster while keeping presence derived. |
| Evaluation integrity and transfer validity | `BI-1B7BB954` | Extends the shipped WorkPattern evaluator and promotion policy. |
| Qualification revalidation interlock | `BI-6DB95601` | Connects material WorkPattern changes to the canonical JSI carrier and TAK activation. |
| Workroom Process Overseer | `BI-3913EB49` | Makes the existing coordinator role enforce declared shape conformance across finite and standing rooms. |

The foundation pair is one revertible delivery because the definition contract declares which roles
and measures a room requires while the roster records who actually occupies those roles. It may
ship before Process Overseer enforcement and must not silently activate that enforcement. The
bundle otherwise reuses rather than duplicates `BI-C6801B5A`, `BI-514826D3`, `BI-DE1333A1`,
`BI-D4C110BC`, and `BI-3E99ACFA`.

## 14. Acceptance criteria

- A WorkPattern cannot qualify for promotion when its held-out evidence was exposed, its retry or
  submission budget was exceeded, its capability floor regressed, or a critical failure occurred.
- Every result identifies the actual model/provider and exact operating-profile inputs.
- Applying a method to a different model/provider/profile requires direct or explicitly approved
  equivalence evidence.
- A material promoted change resolves every affected JSI qualification before live activation.
- TAK never grants more authority than the intersection of active qualification, grants, data and
  regulatory policy, promotion scope, and current operational evidence.
- Negative results and rejected hypotheses remain attributable without remaining active guidance.
- Research Workrooms preserve participants, assignments, budgets, evaluator separation, failure
  ownership, and outcome evidence.
- Every executable research Workroom has one explicit Process Overseer; drift pauses or refuses the
  transition and remains visible through a typed conformance receipt and disposition.
- The operator can see evidence integrity, transfer scope, qualification impact, and the next action
  without reading raw experiment metadata.

## 15. Non-goals

- training or fine-tuning model weights;
- exposing or requiring private chain of thought;
- allowing an agent to activate its own prompt, skill, grant, policy, or qualification;
- making one generic benchmark a job qualification;
- fleet-wide promotion from customer-zero evidence;
- replacing PAAW, Work Case, Workroom, TAK, GAID, JSI, WWMD, WWWD, WSID, or the governed playbook
  runtime.
