---
status: binding
---

# Initiative Readiness and Goal-Completion Reconciliation

- **Date:** 2026-08-08
- **Status:** Approved for implementation planning
- **Epic:** EP-129D11FD
- **Backlog item:** BI-CF5A1078
- **Traceability-repair Workroom:** WC-A285BC4B
- **Scope:** platform — all DPF delivery surfaces and governed initiative work
- **Related work:** BI-4A48AE7D (deterministic process matrix), BI-9C7F2190 (evidence-gated receipts), BI-1AE92E82 (missing-spec research), BI-68ECA8E1 (evidence trust), BI-D61F908D (evidence/capsule join), BI-121DC3A3 (PR readiness), and PR #4451 (merged equivalent pre-mutation Workroom claim guard)
- **Kernel decisions:** DI-43E534BC675B (new umbrella BI linked to existing work); DI-D0B0B4D24136 (shared readiness projection)

> **2026-08-22 live-graph reconciliation:** PostgreSQL recovery replaced the original placeholder backlog identifiers. This file now names parent `BI-CF5A1078`, epic `EP-129D11FD`, and the live delivery graph recorded in the companion plan. The architecture, objectives, and acceptance contract are unchanged; fresh governed receipts bind the reconciled blob before further implementation.

---

## 1. Executive decision

DPF will add one versioned, pure **initiative-readiness policy** that projects existing live records into four distinct lifecycle verdicts: `design`, `plan`, `implementation`, and `completion`. Every governed transition consumes the same verdict. Missing, stale, unresolved, unauthorized, or untraceable evidence is a denial for the transition that needs it; it is never silently converted into readiness.

This does **not** forbid provisional ideas. Capture and design remain cheap. The policy prevents a provisional initiative from being described or treated as implementation-ready, and prevents an initiative or governed task from being declared complete until its objective and required evidence reconcile.

The design extends, rather than replaces:

- `BacklogItemActivity` as the entity-scoped receipt ledger;
- `FeatureBuild.designDoc`, `designReview`, `buildPlan`, and `planReview` as Build Studio's canonical artifacts;
- `WorkCapsuleActivity` as the append-only declaration of lifecycle work intent, while `WorkCapsule.activityKind` retains its existing outcome-category meaning;
- the plan/backlog coverage receipt as the delivery graph;
- the completion-evidence runtime as the shipped-change evidence projection;
- `TaskRun` plus `ToolExecution.taskRunId` as the task execution/audit chain.

One narrowly scoped retention-pin table is introduced because no existing cross-artifact relation can prevent deletion of approved repository, document, and Build Studio evidence for the lifetime of a permanent baseline. No general workflow engine or second review store is introduced.

### 1.1 Outcomes

After this change:

1. **OBJ-IR-001:** A feature, archetype, or cross-domain initiative may be captured and designed while provisional, but cannot enter planning or implementation without the required design/review receipts.
2. **OBJ-IR-002:** Recommendations distinguish `design candidate` from `implementation ready`; an underspecified item is never recommended as build-ready.
3. **OBJ-IR-003:** Implementation claims and Build Studio phase transitions fail closed with a stable denial code and a useful next action.
4. **OBJ-IR-004:** A backlog item, epic, FeatureBuild-backed task, or other governed initiative task cannot become complete merely because code exists or an agent returned a confident answer.
5. **OBJ-IR-005:** Completion requires objective reconciliation plus the work-type/change-class evidence matrix, applicable specialist reviews, dependency disposition, authorization, and live delivery evidence.
6. **OBJ-IR-006:** Archetypes require an explicit four-dimension provisioning decision: template substrate, WSID profession corpus, AI coworker, and skills/tools.

### 1.2 Non-goals

- Do not gate ordinary conversation or ungoverned personal tasks.
- Do not make every captured idea produce a full specification.
- Do not treat Build Studio as the only implementation surface.
- Do not infer review applicability or completion from prose sentiment.
- Do not reimplement the separately owned Workroom adoption defect in this design line; PR #4451 now supplies the independently reviewed equivalent pre-mutation claim guard and unrelated-abandoned-capsule regression.
- Do not declare BI-CF5A1078, EP-129D11FD's linked prevention outcome, or the external `/goal` complete unless that pre-mutation guard remains merged and its regression evidence remains current. The policy slices may merge independently, but the parent outcome remains governed by this explicit dependency.
- Do not claim that repository code controls the Codex desktop `/goal` primitive. DPF controls its own durable backlog, WorkCapsule, FeatureBuild, TaskRun, and MCP completion surfaces; external clients must reconcile through those governed records.

---

## 2. Incident and verified failure paths

The initiating incident was EP-55AF36AC, the veterinary archetype initiative. Live state showed an open epic with 19 items, 16 open/build items, no canonical specification, no implementation plan, and no recorded specialist reviews. The problem is not that the initiative was captured; it is that available surfaces could present or advance fragments as executable work without proving the initiative's design completeness.

The following paths were verified in code and live state:

| Surface | Current behavior | Failure |
|---|---|---|
| Backlog triage | A `build` outcome can move an item to `open`. | `open` is easily read as executable even when the item has no design. |
| Backlog recommendation | `hasSpec` and `hasPlan` are scoring bonuses. | An underspecified item remains eligible for build recommendations. |
| Backlog read projection | `hasSpec` is true when either a spec **or a plan** is indexed. | Design and plan are conflated; a plan can mask a missing specification. |
| Build Studio promotion | Checks status, outcome, altitude, and WIP; creates a build in `ideate`. | The response does not distinguish a provisional design build from an implementation-ready build. |
| Build Studio phase gates | Require design/review before plan and plan/review before build. | This protection is local to Build Studio and is not shared with external work claims. |
| External WorkCapsule claim | Claim has no explicit design/review/plan/implementation intent. | An external agent can claim implementation work before design readiness. |
| Backlog completion | Completion evidence checks source/tests/build plus UX/migration declarations. | It does not prove specification, reviews, dependency resolution, authorization, or objective satisfaction. |
| Epic reconciliation | An epic may auto-close when all children are done/deferred. | Child terminal states are treated as equivalent to the initiative objective being met. |
| Remote/child TaskRun | Successful agent content can directly mark a run `completed`. | Agent confidence is accepted without reconciling the governed objective or linked initiative state. |
| WorkCapsule adoption | An unrelated abandoned capsule can be reused by repo/branch matching. | PR #4451 supplies the separate pre-mutation identity guard; exact readback remains defense in depth. |

### 2.1 Root cause

Readiness is represented as scattered optional fields and surface-local gates, not as one shared, typed decision. The system can observe artifacts, but it does not answer the lifecycle-specific question: **is this governed subject allowed to cross this transition now, and what exact evidence supports that answer?**

---

## 3. Research & benchmarking

This design compares three open-source leaders and adopts only the concepts that fit DPF's existing coordination plane.

### 3.1 Backstage Software Templates

Backstage templates model work as ordered steps, provide a review page before execution, assign a unique task ID, and expose task success/failure and logs. A failed step prevents subsequent steps from running. Its software catalog separately centralizes ownership and metadata.

- **Adopt:** preview/readiness before execution; stable task identity; step outcomes and logs; ownership metadata separate from workflow execution.
- **Adapt:** DPF's work may run on four peer surfaces, so readiness cannot live in one scaffolder UI. It must be a coordination-plane projection every surface consumes.
- **Reject:** treating one template runner as the mandatory execution surface.

Sources: [Backstage Software Templates](https://backstage.io/docs/features/software-templates/), [Writing templates](https://backstage.io/docs/features/software-templates/writing-templates/), [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/).

### 3.2 Open Policy Agent

OPA separates policy, data, and query APIs; correlates decisions with a `decision_id`; supports decision logs and readiness; and activates policy/data bundles together only after validation. An undefined decision may have no result.

- **Adopt:** a pure versioned decision over supplied facts; stable decision IDs and denial codes; decision logging; retain the last valid policy if a replacement is invalid.
- **Adapt:** DPF implements the small policy as typed TypeScript beside its canonical data readers instead of adding an external policy service.
- **Reject:** interpreting an undefined/missing result as permission. DPF maps missing policy inputs or results to `input-required` or `denied` for governed transitions.

Sources: [OPA REST API](https://www.openpolicyagent.org/docs/rest-api), [OPA bundle management](https://www.openpolicyagent.org/docs/management-bundles).

### 3.3 Argo Workflows DAGs

Argo makes task dependencies explicit, supports fail-fast DAG execution, and allows downstream work to depend on explicit upstream results such as `Succeeded`, `Failed`, `Skipped`, or `Omitted`.

- **Adopt:** dependencies are edges with terminal dispositions, not prose; unresolved failed upstream work blocks dependent execution by default.
- **Adapt:** DPF reuses its plan/backlog coverage graph and live backlog statuses instead of introducing a workflow DAG table.
- **Reject:** equating `Skipped` or `Omitted` with success. DPF requires an accountable, reasoned `not-applicable` or `deferred` disposition where the profile permits it.

Sources: [Argo DAG walkthrough](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/), [Argo enhanced depends logic](https://argo-workflows.readthedocs.io/en/latest/enhanced-depends-logic/).

---

## 4. Existing substrate and ownership

| Concern | Canonical owner | This design's use |
|---|---|---|
| Initiative/work metadata | `BacklogItem` and `Epic` | Subject identity, work type, scope, status, acceptance, linked epic. |
| Entity-scoped timeline | `BacklogItemActivity` | Typed readiness/review receipts and decision audit. |
| Build Studio artifacts | `FeatureBuild` | Adapter reads design, reviews, plan, verification, acceptance. No copies. |
| External work identity | `WorkCapsule` | Actor/surface/session, work intent, subject links, delivery evidence join. |
| Task objective and state | `TaskRun` | Objective to reconcile before terminal success. |
| Action audit | `ToolExecution.taskRunId` | Trace tool evidence to a TaskRun and its capsule/subject. |
| Plan decomposition | plan/backlog coverage receipt | Deliverables, mapped BIs, dependency edges, and new traceability fields. |
| Shipped-change evidence | completion-evidence runtime | Source, tests, build, UX, migration, and later matrix-derived evidence. |
| Change-class requirements | BI-4A48AE7D | Supplies required checks; this design consumes rather than duplicates it. |
| Evidence trust | BI-68ECA8E1 | Future signatures/provenance hardening; this design records actor, tool execution, digest, and policy version now. |

`BacklogItemActivity` is sufficient because readiness receipts are immutable entity facts projected at read time. Adding a status column to `BacklogItem`, a review JSON column per specialist, or a new `InitiativeReadiness` table would duplicate derived state and drift.

---

## 5. Classification and readiness profiles

Readiness requirements are selected from structured data, never from title keywords.

### 5.1 Governed initiative classification

An item is governed by this policy when at least one authoritative signal applies:

- `workType = feature`;
- archetype scope is explicitly selected (`archetype-category`, `archetype-leaf`, or an existing canonical equivalent);
- cross-domain/common scope is explicitly selected;
- the item is the originating backlog item for a FeatureBuild;
- a WorkCapsule or TaskRun explicitly links to a governed item/epic/build;
- an accountable operator records an explicit governed-initiative classification receipt.

If a surface cannot determine whether an implementation claim is governed, it returns `classification-required`; it does not infer the lighter profile. Capture/design work remains allowed while classification is resolved.

Profile selection is monotonic and uses the strongest current or unresolved historical structural signal: `archetype > cross-domain > feature > fix > doc-only`. Every member of the closed `BacklogItem.workType` enum maps explicitly:

| Work type | Readiness profile | Reason |
|---|---|---|
| `bug` | `fix` | Repairs observed behavior. |
| `chore` | `fix` | Maintains the existing system without adding a user-facing capability. |
| `refactor` | `fix` | Changes implementation structure while preserving behavior. |
| `feature` | `feature` | Adds or materially changes capability. |
| `tool` | `feature` | Adds or changes an executable platform capability, even when its consumer is another agent or operator. |
| `skill` | `feature` | Adds or changes an executable coworker capability, not documentation alone. |
| `doc` | `doc-only` | Changes documentation without executable behavior. |

This table is the authoritative work-type mapping and is exhaustive by construction against `BACKLOG_WORK_TYPE_VALUES`. Unknown, malformed, or newly added-but-unmapped values return `classification-required`; they never inherit the weakest profile. The mapping was selected by `DI-CD15302DA59B` over uniformly classifying all non-documentation work as `feature` or all four omitted values as `fix`.

Contradictory structured signals return `classification-required`. Once a governed profile has been recorded or a FeatureBuild/archetype/cross-domain fact exists, changing editable backlog fields cannot silently downgrade it. A downgrade requires a separate authorized classification-disposition receipt, current artifact digest, concrete reason, and proof that no contradictory structural fact remains.

### 5.2 Profiles

| Profile | Additional design obligations |
|---|---|
| `feature` | Research, canonical design, architecture review; data/UX/security/compliance/domain lenses according to the applicability decision. |
| `cross-domain` | Feature obligations plus named domain boundaries, contract owners, dependency graph, and each affected domain's review or accountable N/A. |
| `archetype` | Feature obligations plus the four-dimension provisioning plan and archetype completeness verification. |
| `fix` | Reproduction, causal evidence, regression test, blast-radius decision; full feature design only if the fix changes contracts or creates new behavior. |
| `doc-only` | Canonical source/owner and link/doc checks; implementation gates that cannot apply are explicitly N/A by policy, not manually waived. |

### 5.3 Archetype provisioning profile

Every new archetype design includes a `## Provisioning plan` with explicit decisions for:

1. template substrate and all canonical template consumers;
2. WSID profession corpus;
3. AI coworker establishment or accountable reason that no new coworker is required;
4. skills and tool grants, including an accountable reason for each N/A.

Before planning, the design must prove whether the proposal extends an existing category/leaf/axis. Before completion, `node scripts/check-archetype-completeness.mjs` must pass for a new category/leaf. A template-only archetype cannot be ready or complete.

---

## 6. Lifecycle semantics

Readiness is transition-specific. A subject never has one ambiguous `ready` Boolean.

| Target transition | Allowed work | Required minimum |
|---|---|---|
| `capture` | Create/triage a provisional idea. | Identity, title, accountable owner or source, structured classification status. |
| `design` | Research, draft specification, perform reviews. | Governed BI/epic link and design-intent capsule/build. Missing design evidence is expected, not a denial. |
| `plan` | Decompose an approved design into executable work. | Canonical design digest, research, passed design-checklist approval, captured architecture/data advisories, all applicable specialist review dispositions, no unresolved blocking design findings. |
| `implementation` | Change production source or execute a build plan. | Plan readiness plus approved plan, plan/backlog coverage, traceability, dependency disposition, authorization, exact active capsule identity. |
| `completion` | Mark BI/epic/build/task complete. | Implementation readiness plus objective reconciliation and all applicable delivery/acceptance evidence. |

### 6.1 Build Studio semantics

Promotion to Build Studio creates a **design build** in `ideate`; it does not prove implementation readiness. The promotion result and UI say `Design needed` with the action `Continue design` until the shared plan verdict passes. `ideate → plan` and `plan → build` consume the same policy through FeatureBuild adapters. Existing Build Studio artifacts remain canonical.

### 6.2 External WorkCapsule semantics

`claim_backlog_item_for_work` accepts a required `workIntent` for governed work:

- `design`, `review`, and `plan` map to their respective lifecycle targets;
- `implementation` invokes implementation readiness;
- legacy callers that omit intent are treated as `implementation` for governed items, preventing silent bypass.

`WorkCapsule.activityKind` is not reused: its closed values describe outcome activity (`delivery`, `support`, `improvement`, and so on), not lifecycle intent. The selected intent is persisted atomically as a `WorkCapsuleActivity` of kind `work-intent-declared`, with a versioned payload containing `design | review | plan | implementation`, policy version, and subject. The kind is added to the canonical WorkCapsule activity tuple and parity validators. A changed intent appends a new event and requires reevaluation; history is never overwritten. Latest intent is ordered by `(recordedAt DESC, id DESC)`, and work-intent events are covered by the append-only invariant. Claim success is followed by exact readback of capsule ID, subject, projected latest work intent, branch, worktree, executor, active lease, and non-abandoned status. PR #4451 supplies the separate pre-mutation adoption guard; this policy also denies an adopted capsule whose readback does not match the requested subject/session/worktree tuple.

---

## 7. Shared policy contract

The pure module lives in the backlog/process-policy domain and has no database imports:

```ts
type ReadinessTarget = "design" | "plan" | "implementation" | "completion";
type ReadinessVerdict = "allowed" | "input-required" | "denied";

type InitiativeReadinessDecision = {
  decisionId: string;
  policyVersion: string;
  subject: { kind: "backlog-item" | "epic" | "feature-build" | "task-run"; id: string };
  transitionObject: {
    kind: "backlog-item" | "epic" | "feature-build" | "work-capsule" | "task-run";
    id: string;
    expectedVersion: string;
    targetState: string;
  };
  profile: "feature" | "cross-domain" | "archetype" | "fix" | "doc-only";
  target: ReadinessTarget;
  verdict: ReadinessVerdict;
  satisfied: ReadinessRequirementResult[];
  unmet: ReadinessRequirementResult[];
  blockers: ReadinessRequirementResult[];
  evaluatedAt: string;
};
```

`evaluateInitiativeReadiness(facts, target)` is deterministic. Database adapters gather and normalize facts, call the evaluator, and render the result. List/get/recommend paths are pure reads and never persist a decision merely because a user viewed a page. Only attempted protected transitions and explicit evidence writes persist a decision receipt. The evaluator never queries, mutates, or authorizes.

The persisted transition record is a distinct `initiative_readiness_decision` activity payload, not an overloaded gate receipt. It contains `decisionId`, server-derived subject and transition object, target, profile, verdict, policy version, facts digest, stable codes, evidence refs, the repository-derived objective reconciliation, authority-decision ref plus minimized authority snapshot, enforcement state, and timestamp. `initiative_gate_receipt` records evidence; `initiative_readiness_decision` records how that evidence governed an attempted transition. A caller may submit an objective-to-evidence mapping proposal through `record_initiative_evidence`, but it can never attest its own objective satisfaction or create an allowed completion decision.

### 7.1 Stable requirement and denial codes

Initial codes:

- `CLASSIFICATION_REQUIRED`
- `CANONICAL_DESIGN_REQUIRED`
- `RESEARCH_REQUIRED`
- `SPEC_APPROVAL_REQUIRED`
- `CANONICAL_DESIGN_AMBIGUOUS`
- `REVIEW_REQUIRED`
- `REVIEW_FAILED`
- `BLOCKING_FINDINGS_OPEN`
- `PLAN_REQUIRED`
- `PLAN_REVIEW_REQUIRED`
- `PLAN_COVERAGE_REQUIRED`
- `TRACEABILITY_INCOMPLETE`
- `DEPENDENCY_UNRESOLVED`
- `AUTHORIZATION_DENIED`
- `ARTIFACT_AUTHOR_REQUIRED`
- `CAPSULE_IDENTITY_MISMATCH`
- `DELIVERY_EVIDENCE_REQUIRED`
- `ACCEPTANCE_EVIDENCE_REQUIRED`
- `OBJECTIVE_RECONCILIATION_REQUIRED`
- `OBJECTIVE_BASELINE_REQUIRED`
- `OBJECTIVE_BASELINE_CONFLICT`
- `ARCHETYPE_PROVISIONING_INCOMPLETE`
- `ARCHETYPE_COMPLETENESS_FAILED`

Codes are API contracts. Human messages may improve without changing automation behavior.

### 7.2 Fail-closed rules

- Missing fact for a required requirement → `input-required`.
- Explicit failing review, authorization denial, identity mismatch, or unresolved blocking finding → `denied`.
- The newest row for a subject/gate is authoritative. A stale digest, unknown receipt version, missing accountable actor, or malformed newest payload evaluates that gate as missing/invalid; the reader never falls back to an older pass.
- A newer fail supersedes an older pass for the same artifact/gate.
- No result from the policy is `denied`, never allowed.
- Read/projection failure on a governed transition denies the transition and records an auditable error; it does not fall back to existing permissive behavior.

---

## 8. Typed readiness receipts

A new `initiative_gate_receipt` activity kind is recorded through a shared governed handler exposed by thin, reviewer-class-specific tool definitions. The split is required because MCP tool grants and `requiredCapability` are static per tool; a single parameterized tool would let an agent granted one review lane submit another lane's approval. Every definition uses the same schema/handler and adds no parallel storage.

The handler accepts a typed immutable artifact locator, not a caller-asserted digest:

```ts
type InitiativeArtifactLocator =
  | { kind: "feature-build-revision"; revisionId: string }
  | { kind: "document-version"; versionId: string }
  | {
      kind: "repo-blob-at-commit";
      repositoryFullName: string;
      commitSha: string;
      path: string;
      providerBlobId: string;
    };
```

The server resolves the current digest and author from one of the canonical artifact identities:

- a `BuildArtifactRevision.id` and its stored `valueDigest`;
- a `DocumentVersion.id` and its `contentSha256`;
- a provider-authenticated repository blob for the exact repository/commit/path tuple. The provider commit identity must map unambiguously through the canonical `PrincipalAlias`/DCO identity and WorkCapsule provenance to a platform principal and, when applicable, agent. Missing, null, spoofed, or multiply mapped author identity returns `ARTIFACT_AUTHOR_REQUIRED`; two null identities never count as independent. Capsule `headSha` or generic external evidence alone is insufficient.

A mutable worktree path may be drafted and reviewed, but cannot receive final approval. If the artifact cannot be resolved, approval is `input-required`. The persisted JSON payload is schema-validated and includes the server-resolved digest:

```ts
type InitiativeGateReceipt = {
  schemaVersion: 1;
  receiptId: string; // server-generated BacklogItemActivity.id
  policyVersion: string;
  gate:
    | "classification" | "research" | "design-spec" | "spec-approval"
    | "architecture-review" | "data-review" | "ux-fit-review"
    | "security-review" | "compliance-review" | "domain-review"
    | "plan-review" | "dependency-disposition"
    | "archetype-provisioning"
    | "archetype-completeness";
  decision: "pass" | "fail" | "not-applicable";
  subject: { kind: "backlog-item" | "epic" | "feature-build" | "task-run"; id: string };
  artifactRef: InitiativeArtifactLocator;
  artifactDigest: string; // server-resolved; never accepted from caller input
  artifactAuthorRef: string; // server-resolved principal/agent provenance
  authorityDecisionId: string;
  authoritySnapshot: {
    decision: "allow" | "deny";
    effectiveHumanCapability: string;
    effectiveAgentGrant: string;
    tokenScope: string;
    organizationId: string;
    actionKey: string;
    policyVersion: string;
  };
  reason: string;
  findingRefs: string[];
  resolvedFindingRefs: string[];
};
```

Actor identity, agent identity, subject, timestamp, artifact author/digest, authority decision, and server clock come from authenticated/resolved context, not caller-supplied payload fields. `BacklogItemActivity` supplies the storage anchor, not the semantic subject: a server-owned receipt-anchor resolver persists the actual subject shown above and validates its BI/epic/build/task/capsule graph. `record_initiative_evidence` stores an objective-to-evidence mapping only as a distinct `initiative_objective_mapping` proposal. That proposal has no pass/fail verdict and cannot satisfy completion until the terminal-transition repository independently resolves every reference and records its own reconciliation.

The initial reviewer-class tools use one human capability and exactly one narrow agent grant each. Static `TOOL_TO_GRANTS` OR semantics never combine multiple reviewer grants on one tool:

| Thin tool | Gates | Human capability | Agent grant | Independent of artifact author? |
|---|---|---|---|---|
| `record_initiative_evidence` | classification, research, dependency, and objective-to-evidence mapping proposals | `manage_backlog` | `initiative_evidence_write` | No; these are evidence, not approval. |
| `record_initiative_design_review` | design/spec and plan approval | `manage_backlog` | `initiative_design_review` | Yes |
| `record_initiative_architecture_review` | architecture advisory/disposition | `manage_ea_model` | `initiative_architecture_review` | Yes |
| `record_initiative_data_review` | data advisory/disposition | `manage_ea_model` | `initiative_data_review` | Yes |
| `record_initiative_ux_review` | UX-fit review | `manage_backlog` | `initiative_ux_review` | Yes |
| `record_initiative_security_review` | security review | `manage_compliance` | `initiative_security_review` | Yes |
| `record_initiative_compliance_review` | compliance review | `manage_compliance` | `initiative_compliance_review` | Yes |
| `record_initiative_domain_review` | domain/clinical review or N/A | `manage_backlog` | `initiative_domain_review` | Yes |
| `record_initiative_archetype_review` | archetype provisioning/completeness | `manage_taxonomy` | `initiative_archetype_review` | Yes |

The new narrow grant keys extend the existing agent-grant registry and seed, not the human capability axis or database model. The handler rechecks the tool's exact capability/grant intersection and persists the effective capability, grant, token scope, policy version, organization, action key, and allow/deny outcome in `AuthorizationDecisionLog`. The receipt also stores the minimized `authoritySnapshot` above so its decision-time authority remains independently interpretable after the operational authorization log reaches its normal retention cutoff. Unknown tool/gate combinations default-deny. Authorization is a system-derived transition fact and is never a caller-written gate receipt.

For every independent lane, authenticated reviewer principal **and** reviewer agent must differ from the server-resolved artifact author principal/agent. Superuser status does not waive independence. The first slice has no break-glass self-approval path; adding one later requires a separate design with second approval, expiry, rationale, and durable audit.

### 8.1 Not-applicable

`not-applicable` is evidence, not absence. It requires:

- an authenticated accountable actor with the capability for that review gate;
- a non-empty, subject-specific reason;
- the current artifact digest;
- no open finding produced by that lens.
- the same reviewer independence and authority-at-decision checks as a pass/fail receipt.

The deterministic profile may make a gate intrinsically N/A (for example, migration verification on a doc-only change). In that case the policy emits a system-derived N/A result and no human receipt is required. Domain/clinical review is N/A for this platform-control design because it changes no veterinary care contract; veterinary is a regression fixture only. Domain review remains required for the veterinary archetype design itself.

### 8.2 Review findings

Review receipts identify blocking findings by stable reference. The `dpf-architecture-review` output remains advisory by contract: readiness requires that the advisory was captured and every critical/important finding was resolved or accountably dispositioned, not that the advisory skill emitted a fictional gate pass. A design-checklist reviewer owns spec approval. A pass cannot coexist with unresolved blocking findings on the reviewed digest. Resolution produces a new receipt that names resolved finding refs; findings are never deleted or edited in place.

Adapters for existing Build Studio issues derive a stable finding ID from artifact revision + review lane + normalized issue hash. Rereviewing the same finding retains its reference; resolving it names that reference. Raw restricted finding content remains in its owning review/document artifact. Default readiness projections expose only status, sanitized reason, accountable role, and next action; artifact locators and finding content require their owning capability.

### 8.3 Existing FeatureBuild reviews

Build Studio's existing `designReview` and `planReview` JSON are advisory input facts only; by themselves they cannot satisfy governed design or plan approval because they do not prove authenticated decision-time authority or independent reviewer identity. They are not copied into `BacklogItemActivity`. The Build Studio adapter may satisfy the gate only by invoking the same governed review handler, resolving the current `BuildArtifactRevision`, and emitting the same authenticated, independent receipt as any other surface. A receipt may reference the FeatureBuild artifact and digest for cross-surface visibility, but the artifact remains owned by FeatureBuild.

Build Studio can request the same thin specialist tools or import a valid receipt resolved to its current `BuildArtifactRevision`. Its primary/independent checklist review owns design/plan approval only when the adapter records that governed receipt; generic review JSON never advances readiness. Its architecture lane remains advisory. Data, UX, security, compliance, and domain evidence are explicit specialist receipts, never inferred from the generic checklist. Every phase mutation door—main action, MCP phase tool, plan-to-build helper, ship, and complete—calls the shared transition adapter.

### 8.4 Canonical scope/design and objective baseline

An artifact locator proves identity, not canonicity. A passing accountable spec/design review therefore appends one `initiative_scope_baseline` activity in the same transaction as its receipt. The baseline is the canonical selection and immutable completion reference:

```ts
type InitiativeScopeBaseline = {
  schemaVersion: 1;
  baselineId: string;
  subject: { kind: "backlog-item" | "epic" | "feature-build"; id: string };
  profile: "feature" | "cross-domain" | "archetype" | "fix" | "doc-only";
  artifactRole: "design-spec" | "problem-statement" | "documentation-scope";
  artifactRef: InitiativeArtifactLocator;
  artifactDigest: string;
  objectiveStatements: Array<{ objectiveId: string; artifactAnchor: string; statementDigest: string }>;
  acceptanceStatements: Array<{ acceptanceId: string; objectiveIds: string[]; artifactAnchor: string; statementDigest: string }>;
  supersedesBaselineId: string | null;
  approvalReceiptId: string;
  authoritySnapshot: InitiativeGateReceipt["authoritySnapshot"];
};
```

Canonicity is server-resolved and subject-scoped:

- a repository design must be an immutable blob under `docs/superpowers/specs/*.md`, explicitly linked to the subject in its governed evidence; a plan path or arbitrary repository document cannot become the design;
- a managed document must use the platform's canonical design/scope document kind, be visible to the same organization/subject, and name its current immutable `DocumentVersion`;
- a FeatureBuild design must be the current `BuildArtifactRevision` owned by the subject's active, non-abandoned build;
- plan artifacts remain separately canonical through plan-coverage v2 and can never substitute for the scope/design baseline.

The canonical artifact must mark every objective and acceptance statement with a unique stable `OBJ-*` or `AC-*` identifier, and every acceptance statement must name at least one objective ID. The server—not the caller—parses all such markers from the immutable artifact, verifies that every anchor resolves inside that exact blob/version/revision, normalizes each marked statement, computes each statement digest, rejects duplicate IDs, invalid links, missing text, or caller-supplied manifest fields, and produces the complete baseline manifest. The independent design-checklist reviewer approves that server-produced manifest together with the artifact; it is not a second self-attested input. A source/document linter and the checklist review guard the higher-level completeness requirement that every normative objective/acceptance statement in the design is marked.

There is exactly one current baseline chain per governed subject. The writer locks the receipt-anchor `BacklogItem` row, reads the current chain head, and requires `expectedCurrentBaselineId` (null for the first baseline). An initial conflict, chain fork, unrelated artifact, subject mismatch, or multiple unresolved current candidates returns `CANONICAL_DESIGN_AMBIGUOUS`. Supersession is append-only: a new approved baseline must name the exact prior head, and the prior baseline remains auditable. `approvalReceiptId` is the exact same-transaction passing `spec-approval` `initiative_gate_receipt` activity ID; the writer validates matching subject, artifact locator/digest, reviewer authority/independence, and pass decision before the baseline can commit.

The baseline, not mutable prose, defines the objective that completion reconciles. It stores stable artifact anchors and statement digests rather than copying potentially sensitive design text; authorized readers resolve content from the immutable owning artifact retained by the baseline's required artifact pin. `BacklogItem`/Epic descriptions, `TaskRun.objective`, `WorkCapsule.objective`, prompts, and agent summaries are execution context only after a baseline exists. A governed TaskRun or capsule must map its scoped execution objective to baseline `objectiveId`/`acceptanceId` values through its server-resolved subject envelope; conflicting or unmapped text returns `OBJECTIVE_BASELINE_CONFLICT`.

The baseline and exactly one `InitiativeArtifactRetentionPin` commit atomically. A FeatureBuild pin references the exact `BuildArtifactRevision` with `onDelete: Restrict`; a managed-document pin references the exact `DocumentVersion` and, when blob-backed, its exact `DocumentBlob`, both with `onDelete: Restrict`; a repository pin first stores the provider-authenticated exact blob bytes in the existing content-addressed `DocumentBlob`/immutable `DocumentVersion` substrate, verifies the archive digest equals the provider blob digest, and pins both archive rows while retaining the original provider locator. The pin and every superseded baseline's pin are permanent, append-only governance records. If archival or pinning fails, approval does not commit.

Changing objective or acceptance scope requires a new independently approved baseline. The supersession review receives a server-generated semantic diff. Removed or weakened statements require explicit independent disposition for each affected stable ID and cannot be hidden by renumbering or paraphrase; otherwise readiness becomes `input-required`. Completion always uses the latest unambiguous approved chain head and records its `baselineId`/digest in the transition decision.

---

## 9. Plan coverage, dependencies, and traceability

The existing `plan-backlog-coverage` receipt remains the canonical decomposition graph. Its current unversioned payload is treated as legacy version 1. Governed feature/archetype/cross-domain implementation requires version 2; the reader remains capable of projecting version 1 for existing items but version 1 cannot satisfy the new traceability gate. Version 2 adds `schemaVersion: 2`, an immutable plan artifact reference/digest, and the following fields to each independently shippable deliverable:

```ts
{
  requirementRefs: string[];
  contractRefs: string[];
  flowRefs: string[];
  verificationRefs: string[];
}
```

The coverage validator requires:

- every implementation deliverable maps to one live backlog item;
- every referenced dependency key exists and the graph is acyclic;
- each design acceptance criterion maps to at least one deliverable and verification ref;
- each changed external/data/UI contract maps to an owner and verification ref;
- dependencies are `done`, or carry an accountable permitted disposition before dependent implementation;
- deferred work cannot satisfy a required acceptance criterion.

This is a graph projection over the existing receipt and live backlog state. It does not create a second backlog or duplicate child statuses.

---

## 10. Objective and completion reconciliation

Completion is a separate policy target, not the absence of more implementation steps.

### 10.1 Backlog items

Before `update_backlog_item_status(..., "done")`, the existing completion-evidence hook first evaluates completion readiness. The completion projection must prove:

- exactly one current approved `initiative_scope_baseline` and its immutable artifact digest;
- canonical design and approved plan for the applicable profile;
- no unresolved blocking review finding;
- implementation capsule/evidence belongs to this subject;
- all required matrix-derived build/UX/migration/security/archetype checks passed;
- acceptance criteria have live evidence references;
- dependency obligations are satisfied;
- the terminal-transition repository has server-derived an authoritative objective reconciliation that maps every objective/acceptance statement to passed evidence.

### 10.2 Epics

All child items being `done` or permissibly `deferred` is necessary but not sufficient. Auto-close invokes epic completion readiness. Readiness receipts and the scope baseline for an epic are anchored to its canonical `originatingBacklogItem`; a new governed epic without that link is `classification-required` and cannot complete. This preserves `BacklogItemActivity` as the single entity-scoped ledger rather than creating an `EpicActivity` twin. Required baseline acceptance statements must reconcile to child evidence, and a deferred child cannot satisfy a required statement. When reconciliation fails, the epic remains open and records the denial decision.

### 10.3 FeatureBuilds

The existing phase/release evidence is adapted into completion facts. Build completion cannot close the originating backlog item or epic unless their independent completion verdicts allow it.

### 10.4 WorkCapsules

`update_work_capsule_status(..., "complete")` is a protected terminal transition. A reason alone is insufficient. If the capsule links a governed subject, the central resolver must prove that subject's completion verdict, exact active/non-abandoned capsule identity, executor binding, and delivery evidence before the capsule becomes complete. Ungoverned business-activity capsules use their own outcome-anchor completion contract; they never inherit WWMD policy merely because they share the WorkCapsule model.

### 10.5 TaskRuns

A TaskRun is governed when it links through an active WorkCapsule, FeatureBuild originator, or explicit governed-subject envelope. Before writing `completed`:

1. resolve the governed subject from `WorkCapsule.taskRunId`, build origin, or the explicit subject link;
2. collect tool evidence through `ToolExecution.taskRunId` and receipt links;
3. require its server-resolved objective mapping to the current approved scope baseline and evaluate those baseline objectives/acceptance statements against subject evidence;
4. treat any caller-supplied objective mapping as a proposal, independently resolve its referenced evidence, and persist the repository's authoritative objective reconciliation in the transition decision;
5. write `completed` only if the verdict is allowed.

If a governed TaskRun lacks a resolvable subject, it becomes the existing canonical `input-required` state with `OBJECTIVE_RECONCILIATION_REQUIRED`; it is not silently treated as ordinary chat. Ungoverned conversational TaskRuns retain their current completion behavior.

All production writers of TaskRun terminal success—not only remote MCP and child-thread dispatch—must call one `completeTaskRun` domain boundary. That boundary resolves governed subject context and runs reconciliation; for an ungoverned run it preserves the existing completion update. Direct `taskRun.update({ status: "completed" })` calls are migrated or guarded by a source invariant so a newly added execution path cannot bypass reconciliation.

The implementation inventory includes remote MCP submit, child-thread dispatch, scheduled tasks, brand extraction, deliberation runs, pattern observation/experiments, build-phase execution, and every other production `TaskRun` success writer found by the source invariant. `WorkCapsule.taskRunId` is defined as the semantic `TaskRun.taskRunId`, never the Prisma row `id`; ambiguity or an inconsistent graph denies reconciliation.

### 10.6 Canonical terminal-transition repository

BacklogItem `done`, Epic `completed`, FeatureBuild/phase terminal success, WorkCapsule `complete`, and governed TaskRun `completed` all pass through one terminal-transition repository. It composes each domain's existing mutation logic but owns subject resolution, readiness evaluation, authority decision, audit receipt, and mutation atomicity. Direct terminal writes outside this boundary are prohibited by a source invariant.

The subject resolver treats caller-supplied IDs as lookup hints. It verifies user/principal and organization visibility, canonical BI/epic origin, build origin, active/non-abandoned capsule, TaskRun ownership, semantic task ID, and exact executor/session binding. Contradictory or ambiguous graphs return `OBJECTIVE_RECONCILIATION_REQUIRED`. External agents complete governed work using the exact active capsule/subject binding from their claim; a PAT identity or caller-supplied TaskRun ID alone cannot bind a different subject.

### 10.7 External goal clients

DPF clients must treat a DPF initiative goal as complete only after reading an allowed completion decision for the linked subject and listing any separately linked unfinished defects or child BIs. For this initiative, PR #4451's independently reviewed pre-mutation guard is an explicit dependency: neither BI-CF5A1078 nor the external `/goal` can reconcile complete unless that guard is merged and its claim-path regression evidence remains current. The server-side durable state is authoritative. Client prose cannot override it.

---

## 11. Integration surfaces

| Surface | Required change |
|---|---|
| `get_backlog_item` / list projections | Return `designReadiness`, `planReadiness`, `implementationReadiness`, and `completionReadiness`; fix `hasSpec` so plans do not satisfy it. |
| `recommend_backlog_item` | Separate design candidates from implementation-ready candidates; implementation mode filters to allowed implementation decisions. |
| Triage | Preserve capture, return provisional classification/readiness instead of implying build readiness. |
| `promote_to_build_studio` | Allow design promotion; retain provisional/design-stage classification internally, show `Design needed` / `Continue design`, and consume policy at phase transitions. |
| `claim_backlog_item_for_work` | Require/persist intent; evaluate the corresponding target; enforce exact capsule readback. |
| Backlog status update | Evaluate completion before existing delivery-evidence checks; persist denial receipt. |
| Epic auto-close | Reconcile epic objective and child evidence before closing. |
| Every terminal mutation door | Route BacklogItem, Epic, FeatureBuild, WorkCapsule, and governed TaskRun success through the canonical terminal-transition repository. |
| Portal backlog/build UI | Show lifecycle-specific readiness, blockers, evidence sources, and direct next action without exposing coordination-plane jargon by default. |
| Audit/API | Emit policy version, decision ID, facts digest, stable codes, subject, target, actor, and evidence refs. Never emit secrets or raw restricted artifacts. |

### 11.1 Authorization

Reading readiness follows existing organization, portfolio, backlog, and build visibility; resolving an item ID never bypasses tenant/subject authorization. Recording a gate receipt requires both write scope and the exact reviewer-class tool grant/capability from §8. A caller cannot record a different specialist lane or approve its own artifact. Superuser status is not an independence bypass. The tools derive actor identity from authentication, and capability intersection remains single-source in the agent registry/runtime.

Default read projections expose stable code/status, sanitized reason, accountable role, and next action. They do not return raw activity payloads. Restricted findings and artifact locators require both subject visibility and their owning specialist capability; unauthorized or cross-organization reads reveal neither content nor opaque references.

### 11.2 Atomicity and race safety

Fact collection, gate-specific authority resolution, `AuthorizationDecisionLog` write, readiness decision write with minimized authority snapshot, and the protected state mutation execute in one serializable transaction wherever the state is local to PostgreSQL. The decision contains a canonical `factsDigest`; its `transitionObject` names the exact backlog item, epic, FeatureBuild, WorkCapsule, or TaskRun row, expected version, target state, and semantic subject binding. The mutation uses compare-and-set subject/artifact versions read by that transaction. A CAS/serialization miss returns `STALE_EVIDENCE`, changes no terminal state, and reevaluates. Gate receipt ordering is `(recordedAt DESC, id DESC)`; transition decisions use `(recordedAt DESC, decisionId DESC)`, never timestamp alone.

The authoritative audit for a transition is the same-transaction authorization decision plus `initiative_readiness_decision` activity. This deliberately does not pretend the current generic MCP wrapper can inject a `ToolExecution.id` into a handler before that audit row exists. The decision ID is generated before handler execution and returned in the tool result; the later `ToolExecution` may join through that result but is secondary operational audit. A required authority/decision write failure denies the transition. Tool-specific audit serialization allowlists only receipt/decision ID, subject, gate, verdict, canonical digest, policy version, authority decision ID, and stable codes; it excludes raw review text, secrets, restricted artifact locators, and full findings.

If evidence changes, the artifact changes, authorization changes, or either authoritative write fails, the mutation does not commit. Denial decision writes may be best-effort only after denial is already safe; an allowed transition never commits without both authoritative records.

For transitions that enqueue external work, only the local allowed state/receipt commits atomically; dispatch occurs through the existing durable queue/outbox seam after commit. An external side effect is never used as evidence that the local transition committed.

### 11.3 Operator messages

Denials answer three questions in plain language:

1. What state is the initiative actually in?
2. What exact evidence is missing or failing?
3. What is the safest next action and who is accountable?

First-view example: `Veterinary is still being designed. Build work can't start yet. Five design decisions or reviews are missing.` The focused evidence disclosure may then name the reviews and recovery actions. Terms such as canonical design, receipt, digest, policy code, and capsule stay in operator-only technical detail.

---

## 12. UX design

The policy changes behavior across backlog, Build Studio, and work execution, so UI treatment is part of the contract.

### 12.1 Progressive disclosure

- First viewport: one plain lifecycle label (`Design needed`, `Ready to plan`, `Ready to build`, `Design changes needed`, `Readiness unavailable`, or `Complete`) and one primary next action. Internal verdict/profile terms stay behind technical disclosure.
- Evidence panel: grouped requirements with pass/fail/missing/N/A, accountable reviewer, artifact, and timestamp.
- Technical detail disclosure: decision ID, policy version, stable codes, capsule/task links, and artifact digests.

### 12.2 Placement and convergence

| Surface | Placement | Existing components to extend | Constraint |
|---|---|---|---|
| `/ops?itemId=BI-*` | Canonical readiness home for the focused backlog item; compact row summary for the list. | `BacklogItemRow`, existing item panel/drawer seam, `StatusBadge`, shared notices. | No new route, dashboard, tab, nav item, or extra badge/card on every row. The readiness-aware next action replaces/feeds the existing build-action slot. |
| `/build` | Execution adapter: combine readiness permission with current FeatureBuild execution position; focused evidence lives in the existing detail drawer. | `BuildStudioWorkflowActionCard`, `ActionBanner`, `BuildOperatorOverview`, `ReviewReadinessStrip`, `UnifiedEvidenceTimeline`, `Notice`, `DetailsDrawer`. | No second status band, drawer pattern, or competing narrator. |
| `/build/work` | Operator work/capsule detail and technical evidence. | `WorkControlPanel`, `WorkCapsuleTable`, and the existing Work Control panels. | Capsule IDs and raw receipts remain operator detail; do not introduce a second drawer pattern. |

The source projection supplies a compact list summary and a full focused-item decision. `/ops` batch-loads one compact summary per visible row; it never evaluates four full decisions per row or issues N+1 activity queries. Satisfied/unmet evidence loads only for the focused item.

### 12.3 Action hierarchy

- Provisional initiative: primary action `Continue design`.
- Failed review: primary action `Resolve blocking findings`; never offer a generic `Mark ready` escape hatch.
- Missing accountable review: primary action `Assign review` or `Request review`, subject to authorization.
- Completion denial: primary action opens the specific missing acceptance/evidence mapping.

When work cannot proceed, the implementation command is omitted rather than left as a disabled, tooltip-only trap. One enabled recovery action remains. A user without mutation permission sees the state and the accountable role that can act, but no unusable mutation control.

### 12.4 Empty, failure, permission, and legacy states

| State | First-view language | Recovery |
|---|---|---|
| No design evidence | `Design needed` | `Continue design` |
| Failed/blocking review | `Design changes needed` | `Resolve findings` |
| Projection unavailable | `Readiness unavailable` | Retry/evidence recovery; server still denies implementation. Do not render this as a failed review. |
| Evidence exists but is restricted | Requirement state plus `Details restricted` | Name the accountable role; do not mislabel as missing. |
| Read-only operator | Honest state, no mutation controls | Explain which authorized role can act. |
| Existing terminal item predating policy | `Not verified under the current process` | Technical detail may use `legacy-unreconciled`; first view may not. |

Viewing status/evidence, opening disclosures, and navigating never sends a coworker prompt. `Continue design` and `Request review` show a preview of the captured outcome/review scope, context being shared, and expected next step; only the explicit confirmation dispatches coworker work.

### 12.5 Accessibility and theme

State is conveyed by text/icon in addition to color. All styling composes shared primitives, semantic type/spacing utilities, and `--dpf-*` theme tokens. Drawers return focus to their trigger; reevaluation announces its settled outcome through the appropriate live region; actions are at least 44px; blocker explanations are never tooltip-only. Desktop and narrow viewports must keep the one primary recovery action visible without overlap or horizontal navigation memory. No new page-local card, badge, status map, or hardcoded color implementation is allowed.

---

## 13. Data architecture and migration decision

One forward Prisma/PostgreSQL migration adds a nullable typed `gateKey` to `BacklogItemActivity`, its query index, conditional deletion guards, and the narrowly scoped `InitiativeArtifactRetentionPin` model. No derived readiness column is stored. The existing activity cascade relationship remains for ordinary history; changing the whole foreign key to restrict would break unrelated backlog deletion semantics.

- A closed `InitiativeGateKey` enum names the gate keys in §8. `BacklogItemActivity.gateKey` is populated only for `initiative_gate_receipt`; non-gate activity remains null.
- `BacklogItemActivity.kind/payload` stores immutable typed gate, canonical scope baseline, objective-mapping-proposal, and transition-decision records.
- A composite index on `(backlogItemId, gateKey, recordedAt DESC, id DESC)` serves latest-gate projection; existing timeline indexes remain.
- `InitiativeArtifactRetentionPin` has one unique `baselineActivityId` FK to the `initiative_scope_baseline` activity (`onDelete: Restrict`), typed `sourceKind`, canonical digest/locator, and exactly one retained-artifact branch: `buildArtifactRevisionId`, or `documentVersionId` plus `documentBlobId` when that version is blob-backed. Every artifact FK uses `onDelete: Restrict`. A database check constraint and write-time invariant enforce the source/FK shape and exact version/blob relationship. Repository sources use and pin both a governance-archive `DocumentVersion` and its existing content-addressed `DocumentBlob`.
- FeatureBuild, WorkCapsule, TaskRun, and ToolExecution retain their existing ownership.
- Readiness is derived and cached only within a request; no duplicated Boolean readiness columns.
- Artifact digests are server-resolved from immutable canonical revisions and detect stale approval without copying artifact content.
- `WorkCapsuleActivity` stores work intent; `WorkCapsule.activityKind` retains its prior outcome-category contract.

For a page batch, the adapter performs one PostgreSQL `DISTINCT ON (backlogItemId, gateKey)` read ordered by `backlogItemId, gateKey, recordedAt DESC, id DESC`, scoped to the requested item IDs and non-null gate keys. The result is bounded by `item count × gate count` regardless of timeline length. The newest row is passed to validation even when malformed, stale, or failing; an older pass is never resurrected. Full receipt history and restricted findings load only in the focused detail view. The migration has no historical gate-key backfill because these activity kinds do not yet exist; compatibility tests cover long ordinary timelines and long gate histories.

Governance records and retention pins are append-only. The implementation enumerates and guards the server action, REST backlog delete, REST epic delete, FeatureBuild creator-delete action, managed-document deletion, and every other deletion door. In addition, a PostgreSQL `BEFORE DELETE` trigger on `BacklogItem` raises when the item owns `initiative_gate_receipt`, `initiative_scope_baseline`, `initiative_objective_mapping`, or `initiative_readiness_decision` activity, and a trigger refuses update/delete of any retention pin. The pin FKs make direct or cascade deletion of a referenced `BuildArtifactRevision`, its `FeatureBuild`, or a referenced/archived `DocumentVersion` fail at the database boundary. A governed subject with records or linked builds/capsules/tasks cannot be hard-deleted; it must be archived/deferred according to the canonical lifecycle. Ordinary backlog items that have only ordinary activity retain their current delete behavior. A source invariant prohibits update/delete operations on the four governance activity kinds and retention pins outside an explicit future retention/release boundary.

These minimized control-plane activities, every superseded baseline pin, and every pinned immutable artifact use the `initiative-governance-record` retention class: Platform Governance is accountable, Data Governance owns disposition, duration is permanent, and there is no automated purge or release operation in this slice. Legal/privacy holds therefore survive automatically and can only lengthen protection. Retention registry/sweep code treats pins and pinned artifacts as excluded, and build/document/repository cleanup must consult the same canonical pin relation. Any future exceptional erasure or release requires a separate governed design, an explicit hold check, authority evidence, coordinated pin/artifact disposition, and preservation of non-personal decision integrity. `AuthorizationDecisionLog` may follow its existing operational retention because the immutable activity retains the minimized decision-time authority snapshot; raw token values, findings, document content, and unnecessary personal attributes are never copied into that snapshot. If review material is a regulated record, its artifact remains in the managed document/compliance substrate and the readiness record holds only an opaque reference/digest. The receipt provides authenticated internal attribution and auditability, not cryptographic non-repudiation against a database administrator; DPF makes no stronger assurance claim without reusing the existing sealed decision-chain substrate in a separate governed design.

`Epic.originatingBacklogItemId` ownership is widened from execution-decomposition only to the canonical initiative receipt anchor. A governed operation assigns or changes it after overlap/conflict checks and emits an activity. Legacy epics remain visible; before a new governed transition, an operator links an existing canonical BI or files one. Conflicting non-null anchors deny rather than overwrite. The veterinary fixture must exercise this convergence path.

---

## 14. Security and compliance design

Threats and controls:

| Threat | Control |
|---|---|
| Caller forges reviewer identity | Actor and agent IDs come from authenticated execution context. |
| Caller forges or reuses an artifact digest | Server resolves immutable canonical artifact identity/digest; unresolved/mutable sources cannot receive approval. |
| Creator, cleanup, or cascade deletes an approved/superseded artifact | Atomic permanent retention pin plus restrictive artifact FKs and application guards; repository blobs are archived content-addressably before approval commits. |
| General writer self-approves specialist gate | Gate-specific capability/grant intersection. |
| Artifact author uses a qualified/superuser identity to approve itself | Mandatory author/reviewer principal+agent independence; no first-slice break glass. |
| Approval survives changed artifact | Receipt binds to current artifact digest; mismatch makes it stale. |
| Old pass masks newer failure or malformed evidence | Latest row per gate wins; a malformed/stale newest row makes the gate missing and never revives an older pass. |
| Missing policy result allows transition | Fail closed with auditable stable code. |
| Restricted review content leaks | Sanitized projection plus organization/specialist field authorization; raw payloads are not returned. |
| Denial is bypassed through another surface | Every terminal state writer uses the canonical transition repository and a source invariant rejects direct writes. |
| Evidence changes between check and mutation | Serializable/CAS evaluation and mutation with a facts digest and artifact/subject version. |
| Subject/task/capsule graph is misbound | Server-owned resolver verifies organization, ownership, semantic IDs, origin links, capsule activity, and executor binding. |
| Classification is downgraded to escape gates | Monotonic strongest-profile lattice and separately authorized downgrade disposition. |
| Raw MCP audit duplicates restricted findings | Tool-specific allowlist serializer records IDs/codes/digests, never raw review content. |
| Subject deletion erases the entity audit | Application guards plus a conditional database trigger block deletion only for governance-bearing subjects; lifecycle disposition replaces deletion while ordinary deletion remains compatible. |
| Operational authority log expires before a permanent receipt | Every permanent minimized governance record embeds the allowlisted decision-time authority snapshot; raw credentials and unnecessary personal data are excluded. |
| Caller self-attests objective completion | Evidence writers can propose mappings only; the terminal repository resolves evidence and persists the authoritative reconciliation. |
| Policy rollout causes silent lockout | Observe decisions before enforcement only where the manufacturing-spine reliability/SLO gate requires it; enforcement activation is versioned and explicit. |

Compliance review is applicable because the change creates approval/audit semantics. It must confirm identity, retention, access, internal attribution, authority-at-decision, and the boundary between control-plane receipts and regulated managed documents before implementation. This spec does not claim cryptographic non-repudiation. Domain/clinical review is N/A for this platform policy as documented in §8.1, but the N/A itself requires an independent authorized current-artifact receipt.

---

## 15. Rollout and compatibility

This work composes with the manufacturing process spine's reliability → observability → enforcement order.

1. Land the pure evaluator, fixtures, read projection, and decision logging behind a versioned server-side enforcement state.
2. Run projection/observability against live items to measure false denials and malformed legacy evidence.
3. Adapt Build Studio gates, which already fail closed, to the shared policy.
4. Enforce new implementation claims and explicit implementation recommendations.
5. Enforce backlog/epic and governed TaskRun completion after the relevant receipt writers and projections meet their reliability threshold.

Compatibility rules:

- Existing provisional items remain visible and designable.
- Existing completed items are not retroactively reopened; they display `Not verified under the current process`. `legacy-unreconciled` is an internal projection key only.
- New completion transitions after enforcement activation use the current policy.
- Legacy claim callers without `workIntent` default to implementation for governed items.
- Enforcement state and policy version are recorded with every decision so rollout cannot be mistaken for evidence absence.

Each adapter has an explicit activation record with owner, policy version, observation start, sample size, error rate, false-denial disposition, reliability/SLO threshold, deadline, rollback rule, terminal enforcement state, and enforcement timestamp. Observation mode may inform projections but can never label work ready. Build Studio's already-enforced phase gates may switch to the shared evaluator once equivalence tests pass. New implementation-claim behavior may enforce at launch because no legacy permission is removed. Backlog/epic/WorkCapsule/TaskRun completion enforcement waits for its receipt writers and central completion boundary to meet the process-spine reliability threshold. There is no global Boolean that silently enables every adapter at once.

The initiative cannot be declared complete while any enumerated implementation or terminal-completion adapter remains observation-only, while a direct terminal writer remains, while its source-invariant test is red, or while PR #4451's equivalent pre-mutation capsule-claim protection lacks merged regression evidence. Exact post-claim readback remains defense in depth; it is not accepted as a substitute for preventing unrelated capsule reuse or mutation before claim success.

UI rollout converges the existing action/status story in place. It does not add a temporary readiness dashboard, route, or second Build Studio status band.

---

## 16. Test and verification contract

TDD is mandatory. The first regression fixtures reproduce the current permissive failures before implementation.

### 16.1 Pure evaluator tests

- provisional feature: design allowed, plan/implementation/completion input-required;
- approved feature design: plan allowed, implementation blocked until plan coverage/review;
- failed/stale/malformed/self-unauthorized review cannot satisfy a gate;
- an arbitrary artifact, conflicting design candidate, or forked baseline chain returns `CANONICAL_DESIGN_AMBIGUOUS`;
- reasoned accountable N/A satisfies only a policy-permitted applicable lens;
- newer fail supersedes older pass;
- dependency failed/deferred/unresolved semantics;
- every lifecycle target and stable denial code;
- archetype missing each of four provisioning dimensions;
- objective partially reconciled cannot complete.
- mutable BI/Epic/TaskRun/WorkCapsule text cannot replace an approved baseline, and scope-reducing supersession without per-statement disposition cannot complete.

### 16.2 Adapter and integration tests

- `hasSpec` is false for plan-only indexed artifacts;
- recommendations separate design candidates and implementation-ready items;
- Build Studio design promotion remains possible while build transition blocks;
- legacy Build Studio `designReview`/`planReview` JSON cannot approve a gate until the adapter produces the same authenticated independent current-revision receipt;
- only a subject-linked canonical spec/document/current BuildArtifactRevision can establish the scope baseline; arbitrary repo paths and simultaneous candidates are rejected;
- the server-produced baseline manifest includes every marked objective/acceptance statement and rejects omitted markers, invalid anchors, wrong digests, duplicate stable IDs, unlinked acceptance IDs, and caller-supplied manifest content;
- `approvalReceiptId` must name the same-transaction passing `spec-approval` receipt for the same subject and artifact digest;
- baseline creation and supersession use the exact current-head CAS, preserve history, and deny concurrent forks;
- external design claim succeeds; implementation claim fails until ready;
- capsule identity mismatch denies even when readiness evidence passes;
- backlog done and epic auto-close deny incomplete reconciliation;
- governed remote and child TaskRuns become `input-required`, not completed;
- ordinary conversational TaskRun remains unaffected;
- authorization and visibility tests for receipt writer/read projection;
- decision/audit payload contains no secrets;
- pure presenter tests for every readiness state and plain-language next action;
- `/ops` tests for provisional, ready, permission-loss, selected-item, projection-failure, restricted-evidence, and legacy states;
- `/build` tests proving readiness feeds existing action/overview/details seams and creates no second status narrator;
- opening status/evidence/navigation/preview dispatches zero prompts or tools; one dispatch occurs only after confirmation;
- batch list projection has a bounded query shape and focused evidence loads separately;
- a token/agent holding one reviewer grant cannot write another gate or its N/A disposition;
- a general backlog writer cannot approve architecture, data, UX, security, compliance, or domain gates;
- artifact author/reviewer equality denies approval, including superusers;
- fake digest, mutable path, unverified repo blob, stale expected digest, and missing/ambiguous/spoofed repository author mappings are rejected with `ARTIFACT_AUTHOR_REQUIRED` where applicable;
- two null author/reviewer identities never satisfy independence;
- a caller-written objective mapping cannot complete a subject; the transition repository must resolve and persist authoritative reconciliation;
- governed TaskRun/WorkCapsule objective text that conflicts with or lacks stable current-baseline mappings is denied;
- concurrent artifact mutation causes CAS failure and no state change;
- authority/decision audit failure leaves every protected subject nonterminal;
- `update_work_capsule_status(..., "complete")` cannot bypass readiness;
- a source invariant finds no direct governed terminal TaskRun/BI/Epic/FeatureBuild/WorkCapsule writes outside the transition repository;
- mismatched user/task/capsule/build/organization graphs deny without leaking details;
- cross-organization/insufficient-capability reads return neither raw receipt payload nor restricted refs;
- ordinary activity-only backlog deletion remains compatible, while governance-bearing deletion is denied at application doors and by the database trigger;
- the permanent governance record retains its minimized authority snapshot after the operational authorization-log cutoff and remains hold-safe;
- build creators, direct database writes, cascades, document/blob/storage GC, repository-ref cleanup, and retention sweeps cannot delete a current or superseded baseline's pinned artifact bytes; a repository archive digest mismatch prevents approval;
- long-history batch reads return exactly the newest row per item/gate with bounded `items × gates` cardinality, and a malformed newest row never falls back to an older pass;
- `work-intent-declared` is registered in the canonical activity tuple/parity validators, uses `(recordedAt DESC, id DESC)`, and cannot be updated or deleted;
- parent completion and external goal reconciliation remain denied unless PR #4451's equivalent pre-mutation capsule identity evidence is merged and current, even when post-claim readback would detect a mismatch;
- TaskRun stores `input-required` while the MCP wire projects `input_required`;
- profile downgrades cannot erase stronger current or historical structured evidence;
- plan coverage v2 detects dependency cycles, not only unknown keys.

### 16.3 Veterinary incident fixture

A fixture equivalent to EP-55AF36AC — archetype epic, populated child backlog, no canonical spec/plan/reviews/four-dimension provisioning receipts — must:

- remain capturable and designable;
- be excluded from implementation-ready recommendations;
- deny implementation claims and completion;
- enumerate the exact missing archetype, design, review, plan, dependency, and objective evidence;
- become ready only after complete, current, authorized evidence is supplied.

### 16.4 Mandatory gates

- affected Vitest suites;
- `pnpm --filter web build` with zero errors;
- UX verification on the canonical nonproduction environment for backlog, Build Studio, and governed-task paths;
- the §13 schema/index/retention-pin/conditional-trigger migration applies cleanly against representative existing data, preserves ordinary deletion, and prevents governance-record or pinned-artifact cascade deletion;
- `node scripts/check-archetype-completeness.mjs` because the archetype contract is touched;
- documentation-impact verification for agent skill, MCP tool, backlog UI, Build Studio, TaskRun, and architecture surfaces;
- independent semantic review of the stable committed tree;
- exact-tree local merged-code CI before push/PR;
- served-DOM UX sweep and axe checks for `/ops`, `/build`, and `/build/work`, at desktop and narrow viewports;
- no regression from the measured route baselines (`/ops`: 181 visible words and 9 existing sub-legible controls; `/build`: 169 visible words and 0 sub-legible controls), with zero new sub-legible text;
- light, dark, and organization-theme verification plus hardcoded-color/style-drift scans;
- a `sweep-measurement` UX-fit manifest under `docs/ux-fit/` whose `scope.files` exactly matches UI-impacting files.

---

## 17. Refactoring budget

Twenty percent of implementation capacity is reserved for refactoring within the touched seams. It may be spent only on changes that reduce duplicate readiness logic or make the new policy testable:

- extract shared subject resolution for BI/epic/build/task/capsule links;
- consolidate FeatureBuild review normalization;
- separate current completion-evidence fact collection from decision rendering;
- remove `hasSpec`/`hasPlan` conflation and duplicate surface-local readiness helpers.

The budget cannot fund unrelated cleanup, schema redesign, or visual restyling. Each refactor must be covered by characterization tests and listed in the implementation evidence.

---

## 18. Documentation impact

Implementation must update:

- MCP tool schemas and examples for work intent, readiness projection, and gate receipt recording;
- Build Studio lifecycle and evidence-gate documentation;
- backlog status/recommendation/completion semantics;
- external-agent/contributor procedure for exact capsule readback and completion reconciliation;
- archetype paved road to point at the shared readiness profile;
- route/UI help text for `Design needed` versus `Ready to build` work;
- architecture orientation or process-spine spec cross-link, without duplicating doctrine.

---

## 19. Acceptance mapping

| Acceptance ID | Objective IDs | Requested outcome | Design section |
|---|---|---|---|
| AC-IR-001 | OBJ-IR-001 | Preserve provisional capture | §6 capture/design semantics |
| AC-IR-002 | OBJ-IR-002 | Prevent build-ready promotion/recommendation | §§6, 11 |
| AC-IR-003 | OBJ-IR-001, OBJ-IR-005 | Canonical approved design and immutable objective baseline | §§7–8.4, 10 |
| AC-IR-004 | OBJ-IR-001, OBJ-IR-005 | Architecture/data/UX/security/compliance/domain reviews or accountable N/A | §§5, 8, 14 |
| AC-IR-005 | OBJ-IR-001, OBJ-IR-005 | Approved implementation plan and traceability | §9 |
| AC-IR-006 | OBJ-IR-005 | Dependencies resolved | §9 |
| AC-IR-007 | OBJ-IR-003, OBJ-IR-005 | Authorization | §§8, 11.1, 14 |
| AC-IR-008 | OBJ-IR-004, OBJ-IR-005 | Objective and acceptance evidence | §10 |
| AC-IR-009 | OBJ-IR-001, OBJ-IR-006 | Feature/archetype/cross-domain profiles | §5 |
| AC-IR-010 | OBJ-IR-006 | Archetype four-dimension completeness | §§5.3, 16.3 |
| AC-IR-011 | OBJ-IR-003, OBJ-IR-004 | WorkCapsule identity defect kept separate but blocks overall reconciliation | §§1.2, 6.2, 10.7, 15 |
| AC-IR-012 | OBJ-IR-003, OBJ-IR-004, OBJ-IR-005 | Fail-closed, auditable behavior | §§7, 8, 14 |
| AC-IR-013 | OBJ-IR-004, OBJ-IR-005 | Task/goal completion reconciliation | §10 |
| AC-IR-014 | OBJ-IR-001, OBJ-IR-002, OBJ-IR-003, OBJ-IR-004, OBJ-IR-005, OBJ-IR-006 | Reserve 20% of implementation capacity for touched-seam refactoring | §17 |

---

## 20. Review gate and unresolved decisions

This design is approved for implementation planning after the following independent reviews were recorded and all blocking findings were resolved. The immutable repository commit and execution-evidence receipt bind the approval; any content change requires rereview:

- architecture: ownership, adapter coverage, phase semantics, and rollout composition with EP-129D11FD;
- data architecture: receipt ownership, typed gate key/index, lifecycle, digest validity, conditional deletion guard, and migration compatibility;
- UX fit: first viewport, action hierarchy, evidence disclosure, accessibility, and cross-surface consistency;
- security/compliance: reviewer authority, separation of duties, audit retention, artifact visibility, and fail-closed behavior;
- domain/clinical: accountable N/A for this platform control, while remaining mandatory for the veterinary archetype itself.

Review resolutions incorporated into this draft:

1. `input-required` is already the canonical A2A TaskRun state (`TaskRun.status` contract and task lifecycle projections); no new status is introduced.
2. Reviewer-class tools reuse `manage_backlog`, `manage_ea_model`, `manage_compliance`, and `manage_taxonomy`; no new capability key is proposed.
3. Plan coverage gains schema version 2; the reader projects legacy version 1 for visibility, while governed implementation requires version 2 traceability.
4. A governed approval atomically selects one subject-scoped canonical scope/design baseline; arbitrary locators and conflicting/forked baseline chains fail closed.
5. Completion reconciles the immutable current baseline, not mutable BI/Epic/TaskRun/WorkCapsule prose; supersession is independently approved, CAS-protected, diffed, and append-only.
6. PR #4451's separate pre-mutation Workroom claim protection remains an explicit dependency of the overall prevention goal and must retain merged regression evidence.
7. A server-produced manifest binds every marked objective/acceptance statement to the approved artifact and exact passing receipt; arbitrary, omitted, duplicated, unlinked, or wrong-digest entries fail closed.
8. A permanent atomic retention pin protects current and superseded BuildArtifactRevision, DocumentVersion/DocumentBlob, and archived repository evidence from creator, cascade, cleanup, or purge deletion.

One rollout decision remains evidence-dependent: each adapter's live reliability/SLO determines whether it may enforce immediately or must begin in observation mode under §15. That is recorded per adapter, not guessed or decided by a global flag.
