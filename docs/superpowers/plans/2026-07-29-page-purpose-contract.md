# Page Purpose Contract Implementation Plan

**Backlog:** BI-939E57D0 (umbrella), BI-B4A4C76E (typed registry), BI-D27323A0 (evaluator and Self-Upgrade pilot), BI-B6935E5B (enforcement activation)
**Epic:** EP-UX-SYSTEM
**Work Capsule:** WC-102F00C8
**Status:** In progress; Deliverable 1 merged and live, Deliverable 2 implementation in verification

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Independent implementation review

Two independent reviewers examined Deliverable 1 before commit. Their findings
were treated as contract defects and resolved in the implementation:

- The identity ratchet compares the candidate baseline with the Git base
  baseline. On first use it derives the allowed draft set from the base
  commit's route manifest, so the bootstrap PR cannot grandfather its own new
  route.
- Registry summary counts are reconciled against actual route statuses.
- Scenario identity lives only in the `stateScenarios` record key.
- Task and recovery routes are validated against the canonical page manifest.
- A complete positive fixture exercises all four evidence classes, with
  class-specific rejection tests.
- Route-family contract modules own intent only, omit derived route policy, and
  combine through one duplicate-safe index.
- Route-shell and Purpose generators share root discovery, manifest loading,
  deterministic serialization, and check/write behavior.
- The workflow watches its package-script owner and fetches the base history
  required for transition validation.

### Deliverable 2 implementation record (2026-07-30)

WWMD decision `DI-F85F936AF3BF` compared three concrete shapes:
`compose-existing-reports`, `parallel-purpose-dashboard`, and
`dom-markers-only`. The kernel recommended `compose-existing-reports` with high
confidence (composite 3.962, margin 3.116). The implementation follows that
decision:

- one pure `purpose-evaluator.ts` owns deterministic structural checks,
  independent validation-receipt currentness, and purpose coverage;
- `purpose-scenario.ts` owns the page projection while the separately
  implemented `ux-budget/oracles/self-upgrade.ts` adapter owns the
  contract-bound oracle over the same canonical status read model;
- the existing UX sweep, route verdict, league table, and `UxAuditReport` carry
  additive intent, structure, and task-validation values; purpose defects are
  not translated into the accessibility-only `UxFinding.category` vocabulary;
- `/ops/self-upgrade` is the first ratified source contract, with five states
  and a permission-protected read-only oracle endpoint;
- semantic markers expose route/state, essential evidence, state-appropriate
  commands/messages, keyed completion/correction/recovery, consequential-action
  context, one owner-detail disclosure, and one technical disclosure;
- the owner UI no longer offers a redundant update command while current,
  routes blocked/failed states to recovery, and opens technical recovery
  detail after a failed run;
- every deterministic blocking check has a known-bad pure fixture, while
  enforcement remains advisory pending BI-B6935E5B and BI-232BA634.

Two independent exact-SHA reviews then rejected the first implementation. The
release-blocking corrections were incorporated before the gate:

- the update action and compact consequence now precede secondary owner detail
  at phone width;
- current, blocked, failed, and status-unavailable states are mutually
  exclusive, with combination-matrix fixtures;
- the ratified path now matches Delivery > Track & release > Self-upgrade;
- blocked states route to the owning timezone, platform-health, or recovery
  surface, and failed state links to the latest-run recovery detail;
- touch targets, wrapping, confirmation focus, accessible naming, and announced
  action outcomes are explicit;
- the oracle is independently implemented and contract-bound by `oracleKey`
  and `sourceRef`;
- keyed state signals replace generic completion/correction booleans;
- latest-per-evidence-class receipt supersession prevents old failures or stale
  evidence from being masked;
- special-route results compose into the sweep, league table, and
  `UxAuditReport`, while aggregate UX verdicts can no longer erase Purpose
  nonconformance;
- browser capture/evaluation moved into a focused adapter, keeping the sweep
  orchestrator below its module-size ceiling.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/platform-usability-standards.md`
  - `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md`
  - this Page Purpose Contract plan and its Deliverable 1 implementation
- Current code substrate reviewed:
  - `apps/web/lib/ux-budget/page-purpose.ts`
  - `apps/web/lib/ux-budget/route-policy.ts`
  - `apps/web/scripts/ux-route-sweep.ts`
  - `apps/web/lib/ux-budget/ratchet.ts`
  - `apps/web/lib/ux-audit/portal-survey.ts`
  - `apps/web/lib/actions/promotions.ts`
  - `apps/web/lib/self-upgrade/owner-summary.ts`
  - `apps/web/app/(shell)/ops/self-upgrade/page.tsx`
- Source of truth:
  - route identity and eligibility remain owned by the generated route manifest
    and route policy;
  - reviewed purpose remains owned by route-family Purpose Contract sources;
  - Self-Upgrade raw state remains owned by `getSelfUpgradeStatus()`; page and
    evaluator projections are independent consumers of that canonical read;
  - the UX sweep, league table, and `UxAuditReport` remain the reporting owners.
- Decision:
  - WWMD `DI-F85F936AF3BF` selected `compose-existing-reports`; no parallel
    dashboard, persistence model, route inventory, or DOM-self-attested oracle.

## Outcome

Every canonical page route gets one typed Purpose Contract row derived from the
existing route manifest, audience classification, and shell policy. A contract
states who the page serves, the one job it owns, the observable outcome, and the
one primary action or an explicit declaration that the page is informational.
The served-DOM UX sweep evaluates the rendered page against ratified intent
without inventing a second route inventory or treating generated guesses as
human-approved design.

The first shippable slice proves the contract on `/ops/self-upgrade`. The five
AI Workforce lenses adopt the same contract when BI-F2278856 creates their
canonical shallow routes. The all-route review in BI-1B6E3B8B then ratifies
route-family cohorts using live desktop and mobile task evidence.

## Standards basis

- ISO 9241-11:2018 treats usability as an outcome of use in a specified context,
  so `successOutcome` is an observable business or system state rather than a
  rendered screen or click count:
  <https://www.iso.org/standard/63500.html>.
- GOV.UK starts transactional flows with one thing per page, one prioritized
  user group, and only questions needed to deliver the service. It also warns
  that expert internal tools may need denser task switching when research
  supports it:
  <https://www.gov.uk/service-manual/design/form-structure> and
  <https://www.gov.uk/service-manual/design/services-for-government-users>.
- W3C requires headings and labels to communicate topic or purpose, predictable
  navigation, meaningful focus order, and clear recovery:
  <https://www.w3.org/TR/WCAG22/> and
  <https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p01-clear-purpose/>.
- DPF's local standards add measurable default-visible content, a marked and
  reachable primary action, progressive disclosure, honest async states, and a
  regression ratchet in `docs/platform-usability-standards.md`.

These sources support a single-job default, not an inflexible one-control-per-page
rule. Dense list and diagnostic surfaces may support repeated work, but still
declare one governing outcome and one first decision.

## Research and benchmarking

The comparison is about contract and evidence models, not visual feature lists.

| System | Model inspected | Adopt | Reject or gap |
| --- | --- | --- | --- |
| Backstage Software Catalog (OSS) | Versioned entity envelope (`apiVersion`, `kind`, `metadata`, `spec`), generated relations, read-only status, and owner/lifecycle metadata | Schema version, code-owned descriptors, authoritative derived relations, explicit owner | A generic extensible metadata bag would make route intent unqueryable; purpose fields remain typed |
| Storybook (OSS) | Stories as named initial states; `play` functions drive interactions and assert end state in a live browser | State fixtures, executable interaction scenarios, known-good/known-bad capability tests | Component render success is not route findability or task usability |
| GOV.UK Design System and Service Manual (open public standard) | User-focused page/task patterns, one-thing-per-page starting point, end-to-end usability benchmarking | Natural-home starting point, realistic task, completion/time/error/abandonment measures, progressive-disclosure rationale | Do not apply one-question-per-page mechanically to repeated expert operations |
| UserTesting (commercial) | Navigation task with starting URL, task prompt, success URL, success/difficulty results, path flows, behavioral and attitudinal scores | Separate findability start, completion oracle, path evidence, success and perceived ease | A success URL alone permits false success and does not prove the business state changed |
| Maze (commercial) | Goal-based mission, expected and alternate success paths, direct/indirect success, misclicks, duration, exit/unfinished rate | Expected path plus valid alternatives, wrong-turn/backtrack evidence, duration and abandonment | Reject one opaque composite usability score as a release gate; retain inspectable measures |
| Pendo (commercial) | Page/feature/track-event paths and ordered funnels with attempts, drop-off, event properties, and segments | Declare attempt/completion/recovery events and preserve alternate paths for later operational telemetry | Click funnels are supporting evidence, not the success outcome; a user can click through and still fail the job |
| Microsoft HAX (commercial research toolkit) | Eighteen lifecycle guidelines and failure scenarios before, during, when wrong, and over time | Conditional AI capability, uncertainty, correction, explanation, consequence, and global-control contracts | Do not impose AI fields on non-AI routes or let generic trust copy replace service-scoped readiness |

Sources:

- <https://backstage.io/docs/features/software-catalog/descriptor-format/>
- <https://storybook.js.org/docs/writing-tests/interaction-testing>
- <https://www.gov.uk/service-manual/measuring-success/usability-benchmarking-a-website-or-whole-service>
- <https://help.usertesting.com/hc/en-us/articles/23605586114845-Navigation-task-in-UserTesting>
- <https://help.maze.co/articles/6412805094-maze-reports>
- <https://support.pendo.io/hc/en-us/articles/360031863292-Funnels>
- <https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/>

DPF's gap is the join between these models: a versioned route-intent descriptor,
deterministic structural evidence from the served product, and task evidence
that starts before the destination page. No compared system makes all three one
reviewable contract.

## Existing substrate

| Concern | Canonical source | Extension |
| --- | --- | --- |
| Route inventory | `apps/web/lib/ea/route-manifest.json` | Read only; never duplicate or re-walk routes |
| User and destination shape | `apps/web/lib/navigation/route-audience.ts` | Reuse `RouteAudience` and `RouteDestinationKind` |
| Intended page shell | `apps/web/lib/ux-budget/route-shells.ts` | Reuse shell and sweep eligibility |
| Deterministic generation | `apps/web/scripts/build-route-shells.ts` | Refactor shared route-policy assembly, then emit purpose rows |
| Served-DOM measurement | `apps/web/scripts/ux-route-sweep.ts` | Capture only purpose evidence visible in the real page |
| Findings and ratchet | `apps/web/lib/ux-budget/evaluate.ts` and `ratchet.ts` | Compose purpose findings and coverage into existing reports |
| Audit orchestration | `apps/web/lib/ux-audit/portal-survey.ts` and the route league table | Add contract coverage/status; do not add a dashboard |

Current checked-in manifest evidence at the plan base is 310 non-redirect page
routes: 16 cockpit, 6 list, 237 detail, 12 settings, 18 form, and 21 public.
The generic owner fixture can evaluate 200; 110 require a contextual fixture or
an explicit exclusion already carried by the route-shell registry. These counts
are generated facts, not plan constants, and may move before implementation.

## Contract design

### Typed source

Add `apps/web/lib/ux-budget/page-purpose.ts` with a schema-versioned union that
cannot confuse generated suggestions with approved intent:

```ts
type DraftPurposeRecord = {
  schemaVersion: 1;
  status: "draft";
  routePath: string;
  derived: DerivedRoutePurpose;
  suggestions?: Partial<PurposeIntent>;
};

type RatifiedPurposeContract = {
  schemaVersion: 1;
  status: "intent-ratified";
  routePath: string;
  derived: DerivedRoutePurpose;
  intent: PurposeIntent;
  stateScenarios: NonEmptyRecord<string, PurposeStateScenario>;
  taskProtocol: TaskValidationProtocol;
  ratifiedBy: { role: "owner" | "design-owner"; ref: string };
  reviewRef: string;
  intentEvidenceRefs: NonEmptyArray<IntentEvidenceRef>;
  validationReceipts?: NonEmptyArray<TaskValidationReceipt>;
  consequentialAction?: ConsequentialActionContract;
  aiMediated?: AiMediatedContract;
};

type PurposeStateOracleKey =
  | "self-upgrade-status"
  | "fixture-read-model"
  | "route-owned-read-model";

type PurposeStateSource = {
  oracleKey: PurposeStateOracleKey;
  sourceRef: string;
};

type TaskValidationReceiptBase = {
  schemaVersion: 1;
  routePath: string;
  contractHash: string;
  sourceSha: string;
  fixtureVersion: string;
  viewport: string;
  inputMode: "pointer" | "keyboard" | "touch" | "assistive-technology";
  interactionFingerprint: string;
  relevantDependencyFingerprint: string;
  metrics: Record<string, number | boolean | string>;
  thresholds: Record<string, number | boolean | string>;
  reviewerRef: string;
  observedAt: string;
  artifactIds: NonEmptyArray<string>;
};

type AutomatedFunctionalReceipt = TaskValidationReceiptBase & {
  evidenceClass: "automated-functional";
  runnerRef: string;
  completionOracleResult: "passed" | "failed";
};

type ExpertEvaluationReceipt = TaskValidationReceiptBase & {
  evidenceClass: "expert-evaluation";
  evaluatorProfile: string;
  methodRef: string;
};

type RepresentativeUserReceipt = TaskValidationReceiptBase & {
  evidenceClass: "representative-user";
  participantCohort: {
    cohortId: string;
    recruitmentCriteria: NonEmptyArray<string>;
    relevantExperience: string;
    participantCount: number;
  };
  participantAttestationRef: string;
};

type BenchmarkReceipt = TaskValidationReceiptBase & {
  evidenceClass: "benchmark";
  sampleSize: number;
  taskProtocolVersion: string;
  baselineRoundRef: string;
  completionRate: number;
  timingDistribution: { medianMs: number; p90Ms: number };
  easeAndConfidence: { easeMean: number; confidenceMean: number };
  repeatabilityThreshold: string;
  comparisonResult: "improved" | "equivalent" | "regressed";
};

type TaskValidationReceipt =
  | AutomatedFunctionalReceipt
  | ExpertEvaluationReceipt
  | RepresentativeUserReceipt
  | BenchmarkReceipt;
```

`PurposeIntent` carries:

- identity: route owner plus navigation/discovery context;
- context: `primaryUser`, `triggeringNeed`, `prerequisites`;
- intent: one `job` and observable `successOutcome`;
- findability: `parentArea`, `entryPoints`, `navigationLayer`,
  `discoveryCue`, and `expectedPath`;
- content roles: required default-visible keys and deferred-region contracts;
- family consistency: canonical terminology, action location, feedback
  primitive, disclosure pattern, and return behavior.

Each `PurposeStateScenario` declares:

- a stable, whitespace-canonical scenario record key, state predicate, and
  `stateSource` containing a typed oracle key plus canonical source reference;
- essential evidence keys;
- one command or an explicit informational/no-action experience;
- prohibited actions for that state;
- completion signal;
- error/correction behavior;
- recovery action and route.

Safety and AI are orthogonal optional contracts, so a route may carry either or
both. `consequentialAction` requires no-action consequence, reversibility,
confirmation, authority, and recovery. `aiMediated` requires capability scope,
readiness/quality/uncertainty disclosure, invocation, dismissal, correction,
explanation, consequence controls, and return context.

Runtime parsing validates the committed JSON in addition to TypeScript checks.
Closed values remain closed unions; plain-language intent remains text. No
database model is introduced.

### Field ownership

| Field | Authoritative owner | Purpose projection rule |
| --- | --- | --- |
| Route existence/path | route manifest | Reference only |
| Audience | route-audience classifier | Reference as the broad audience |
| Destination kind | route-audience classifier | Reference only |
| Shell / sweep eligibility | route-shell policy | Reference only |
| Route family | `portal-navigation-model.ts` (`domain`, `parentPath`, shell section, and siblings) | Project semantic family from the navigation owner; `UxShell` remains only a presentation/evaluation class |
| Primary persona | ratified purpose intent | Refines the broad audience for this job |
| Family intent defaults | BI-557A6D4E page-family briefs | Consume after those briefs exist; route-specific intent wins explicitly |
| Job/outcome/state/task protocol | ratified purpose contract | New authoritative route-specific intent |

### Draft versus ratified intent

The generator produces one row for every non-redirect page route:

- Derived fields are joined from their existing owners during generation; the
  purpose module does not re-classify them.
- Explicit intent: route-family modules keyed by canonical route path store only
  owner-ratified intent and evidence; derived route policy is added during
  generation.
- Unreviewed routes remain `draft` and surface a coverage finding. Generated
  headings or CTA guesses may be diagnostic suggestions, never ratified facts.
- A route may become `intent-ratified` only with review and a non-empty typed
  `intentEvidenceRefs` set. That status does not claim structural conformance
  or task usability.

The generated output is
`apps/web/lib/ux-budget/route-purpose.generated.json`. It is a projection of
the canonical manifest, not a second inventory. It contains no timestamps and
is sorted in manifest order.

The coverage baseline stores only the exact first-use draft exception set. It
does not duplicate ratified identities; the contract-source index owns those:

- a legacy draft may become ratified;
- a ratified route may not revert to draft when compared with the base generated
  registry;
- a reviewed `intent-quarantined` marker may temporarily suspend enforcement
  with an owner, incident, reason, and review reference;
- a net-new route may not enter as draft;
- a removed manifest route may leave the set;
- family counts are reporting only and never decide the gate.

### Independent evidence statuses and classes

The report keeps these independent:

1. `intent-ratified`: a human approved the declared job and protocol.
2. `structurally-conformant`: deterministic served-DOM checks match the
   ratified scenario.
3. validation evidence: zero or more current receipts reported by explicit
   class: `automated-functional`, `expert-evaluation`, `representative-user`,
   or `benchmark`.

No one status or evidence class implies another. Automated functional
acceptance proves the workflow can complete; it does not prove representative
users can find or efficiently complete it. Unqualified "user validated" is
reserved for current `representative-user` evidence. A single expert or agent
attempt is an observation, not a benchmark.

`TaskValidationReceipt` is canonical evidence, not a free-form reference. A
receipt is current only when it resolves from the audit evidence store and its
route, contract hash, fixture version, interaction fingerprint, and relevant
dependency fingerprint match the evaluated page. `sourceSha` remains provenance:
a SHA mismatch triggers those fingerprint comparisons but does not, by itself,
expire unrelated evidence. Runtime parsing rejects a receipt that omits the
attestation, cohort, sample, baseline, distribution, or comparison fields
required by its evidence class. Otherwise the evaluator reports `stale` or
`not-validated` rather than carrying forward a success claim.

### Evaluator composition

Extend the current sweep and portal-survey report rather than create another
scoring pipeline. The browser captures:

- `data-dpf-purpose-route` and `data-dpf-purpose-state`;
- H1 and lead text as review evidence, not a semantic-equivalence gate;
- primary-action accessible name and viewport geometry;
- `data-dpf-purpose-key` markers for essential state/action/recovery evidence;
- completion, correction, and recovery markers;
- disclosure trigger, `aria-expanded`, controlled panel, content role, and
  whether the region is collapsed;
- viewport size, document overflow, and focus/obstruction evidence.

The evaluator resolves each scenario's `stateSource` independently from the
rendered page, then compares that oracle result with
`data-dpf-purpose-state`. A missing oracle, unknown oracle state, or mismatch
fails structural conformance; the rendered marker cannot attest its own truth.
Deterministic blocking checks then cover state-appropriate action presence or
absence, first-viewport action geometry, required evidence presence, prohibited
actions, recovery/completion markers, disclosure relationships, and
conditional safety/AI fields. Human review owns whether H1, lead copy, labels,
and information scent communicate the declared meaning.

Every blocking check gets one known-good and one known-bad fixture, including a
fixture whose DOM marker deliberately disagrees with its backing state oracle.
A check that cannot fail its known-bad fixture stays advisory.

Draft legacy routes produce an advisory coverage finding. Net-new routes without
intent-ratified contracts block. Consequential or AI-mediated routes require
current applicable validation receipts when a material interaction changes.
Existing route volume/ARIA ratchets remain intact.

`UxAuditReport` gains a purpose coverage summary and each route result gains the
independent intent and structural statuses, validation evidence classes, and
purpose findings. The route league table includes status and exact coverage
debt. This is an additive report projection, not another dashboard or persisted
audit model.

## Delivery graph

### Deliverable 1 - Typed registry and identity ratchet

**Backlog:** BI-B4A4C76E
**Independently shippable:** yes

1. Add versioned draft/ratified contract types, runtime parsing, and invalid
   fixtures.
2. Refactor route-shell generation into a shared pure route-policy builder.
3. Add deterministic purpose generation and freshness commands.
4. Add the exact route-identity draft baseline and net-new route guard.
5. Add known-good/known-bad schema and generation capability fixtures.
6. Update platform usability standards and contributor guidance.
7. Run source tests, generated-file checks, and the exact-SHA gate.

This deliverable is useful on its own: it prevents new routes from arriving
without approved intent, makes legacy debt explicit, and gives later evaluators
one typed contract.

### Deliverable 2 - Evaluator and Self-Upgrade task pilot

**Backlog:** BI-D27323A0
**Depends on:** Deliverable 1
**Independently shippable:** yes

1. Add purpose markers and deterministic served-DOM evidence capture.
2. Compose purpose results into the existing sweep, route league table, and
   `UxAuditReport`.
3. Add known-good/known-bad capability fixtures for every blocking check.
4. Ratify `/ops/self-upgrade` with complete state scenarios, typed intent
   evidence, state-oracle sources, and validation receipt handling.
5. Run natural-entry findability, task, responsive, and manual accessibility
   validation.

Purpose findings ship advisory while BI-232BA634 leaves the shared sweep
non-reproducible. Blocking activation requires an explicit later flip backed by
two same-SHA reproducible runs; the typed net-new-contract guard from
Deliverable 1 is source-local and does not wait for browser sweep stability.

### Deliverable 3 - Reproducible enforcement activation

**Backlog:** BI-B6935E5B
**Depends on:** Deliverable 2, BI-232BA634
**Independently shippable:** yes

1. Prove two same-SHA purpose sweeps produce byte-identical blocking evidence.
2. Add an activation fixture that fails on a deliberate oracle/DOM mismatch.
3. Flip only proven deterministic Purpose Contract checks from advisory to
   blocking.
4. Record the activation evidence and rollback boundary independently from the
   evaluator implementation.

### Deliverable 4 - Five AI Workforce lens adoption

**Backlog:** BI-F2278856
**Depends on:** Deliverable 2, BI-97CD9E4B, BI-C1943813
**Independently shippable:** yes

When the shallow Coworkers, Work, Decisions, Setup, and Health lenses exist,
declare and ratify each lens in the same PR that creates its user-facing route.
Each lens gets natural-entry findability and task evidence across the required
responsive/accessibility matrix plus an explicit return-context contract. This
plan does not fabricate declarations for routes that do not yet exist.

### Downstream rollout - all-route review

BI-1B6E3B8B consumes the shipped evaluator and decomposes the remaining routes
into route-family cohorts. It is outside this plan's implementation scope and
must not claim generic-sweep coverage for contextual routes. BI-557A6D4E
supplies reviewed family-intent briefs before family defaults can reduce
route-specific authoring.

## Self-Upgrade pilot contract

- Primary user: platform operator responsible for keeping the install current.
- Triggering need: an update is available, running, completed, or needs
  recovery.
- Job: understand current update state and take the one safe next action.
- Parent area: Delivery.
- Natural entry: the operator starts from Delivery > Track & release,
  not a supplied `/ops/self-upgrade` URL.
- Discovery cue: `Self-Upgrade` or the ratified plain-language equivalent in
  one stable navigation layer.
- Expected path: Delivery -> Track & release -> Self-upgrade -> state-appropriate
  action; help/search is not required.
- Success outcome: the install reaches the intended version and returns a
  healthy, operable portal, or the operator reaches a truthful recovery path.
- Essential: current state, impact on work, safe next action, and immediate
  failure/recovery status.
- Deferred: release detail, history, local-change ledger, raw logs, technical
  diagnostics, and minority-use controls.
- Completion signal: installed version plus healthy runtime state.
- Recovery: the governed rollback/recovery control and its owning help route.
- Safety contract: consequential action with reversibility, confirmation,
  authority, no-action consequence, and recovery posture.

Required state scenarios:

| State | Primary experience | Prohibited experience | Completion/recovery |
| --- | --- | --- | --- |
| `update-available` | One governed update command | Competing technical controls as peers | Start acknowledged, then transition to running |
| `queued-or-running` | Informational wait/status; no command required | Duplicate update start | Progress/heartbeat plus honest reconnect expectation |
| `current` | Informational no-action state when status is available and no newer target exists | Disabled or misleading update command | Current version plus healthy runtime |
| `failed-recoverable` | One governed recovery or retry action | Raw logs as the first answer | Recovery state and owning diagnostic disclosure |
| `blocked` | Status unavailable, or a pending target with one truthful blocker resolution route | Generic “try again” without cause | Reach the owning prerequisite/recovery surface |

The Self-Upgrade state oracle is `getSelfUpgradeStatus()` in
`apps/web/lib/actions/promotions.ts`, which composes the canonical
`SelfUpgradeRun` store, deployed/target version lineage, upgrade configuration,
quiescence, cooldown, blackout, and job-engine health. The route-owned pure
scenario resolver consumes that read model; the evaluator obtains the backing
state through a fixture/API adapter separate from the rendered DOM. The
`OwnerReleaseCard` marker is therefore compared with, never used as, the
source of truth.

Unrecognized rendered states fail structural conformance. Live task validation
must cover every state the fixture can safely create and record explicit
evidence for states that require a controlled fault fixture. It must not demand
a button when the correct primary experience is "no action needed."

## Refactoring allocation

Approximately 20% of implementation effort is reserved for convergence:

- extract one pure route-policy assembly function used by shell and purpose
  generators;
- centralize shared route registry I/O and deterministic serialization;
- make evaluator finding composition data-driven where existing repeated
  object construction would otherwise be duplicated;
- keep report/league-table types shared between the sweep and audit consumer.

This allocation is bounded to modules touched by the feature. It does not
authorize unrelated visual or navigation refactors.

## Verification

### Source-local

- Unit tests for valid and invalid discriminated contracts.
- Every non-redirect manifest page appears exactly once in generated purposes.
- Generated output is byte-stable and `--check` fails on stale output.
- Shell and purpose generators share route-policy derivation.
- Draft rows cannot claim intent, review, or validation; ratified rows cannot
  omit state, non-empty typed intent evidence, task protocol, safety, or AI
  fields that apply.
- Exact draft-route identities cannot grow; ratified routes cannot revert.
- Evaluator fixtures cover command, informational, consequential, AI-mediated,
  unknown/wrong-state, independent oracle/DOM mismatch, first-viewport, missing
  evidence, prohibited action, disclosure relationship, completion,
  correction, and recovery cases. Every blocking check proves it detects a
  known-bad fixture.
- Validation receipts fail currentness when the artifact cannot resolve or the
  route, contract hash, fixture version, interaction fingerprint, or relevant
  dependency fingerprint differs. Source SHA changes alone do not invalidate
  unchanged interaction evidence.
- Runtime parsing rejects representative-user receipts without cohort and
  attestation fields and benchmark receipts without sample, baseline,
  distribution, repeatability, and comparison fields.
- Report and league-table fixtures show ratification coverage and findings.
- Portal-survey fixtures preserve intent, structural, and each validation
  evidence class as independent values.
- Existing UX-budget and route-shell tests remain green.

### Exact-SHA gate

- Governed `local-integration-ci` lease.
- Freshness preflight, exhaustive affected tests, typecheck, production build,
  and generated-file guards.
- Record branch, exact SHA, lease, resolved dependencies, and evidence id.

### Live acceptance

After governed deployment, start from the operator's natural home without
supplying the destination URL. The task protocol records:

- realistic task prompt, persona/experience level, fixture, start state, and
  completion oracle;
- false-success condition and valid alternate completion paths;
- unassisted completion, time to first correct action, total time, wrong turns,
  backtracks, dead ends, errors, retries, help/search use, abandonment, and
  recovery;
- post-task ease and confidence rating plus evidence IDs and baseline/threshold;
- intent-ratified and structurally-conformant verdicts plus explicit validation
  evidence classes separately.

Exercise every reachable Self-Upgrade state with the same completion oracle.
Record these runs as `automated-functional` or `expert-evaluation` unless a
representative participant actually performs the task. Treat single-run
timings as observations; a `benchmark` receipt requires the declared sample,
baseline, and repeatability threshold.
For each deferred region, verify a cohort/frequency rationale, state trigger,
descriptive disclosure label, canonical primitive, keyboard/AT relationship,
and collapsed/expanded task behavior. Current state, consequence, eligibility,
primary action, and recovery may never be hidden as secondary detail.

Responsive task parity matrix:

- desktop pointer;
- desktop keyboard only;
- `390x844` touch portrait;
- mobile landscape;
- 320 CSS-pixel equivalent / 400% zoom reflow.

All variants must reach the same outcome with no missing state/action,
two-dimensional scrolling, overlap, obscured controls, or target smaller than
the DPF 44px minimum, except an explicitly documented content exception.

Manual WCAG 2.2 AA evidence covers complete keyboard operation, logical focus
order, visible/unobscured focus, names/roles/values, headings/landmarks,
contrast, text spacing, status announcements, error identification/correction,
reduced motion, reflow, and screen-reader sampling for the consequential flow.
Axe remains necessary supporting evidence, never the accessibility verdict.

The task also checks sibling/family consistency: navigation location/order,
canonical terminology, action placement, state language, feedback primitive,
disclosure pattern, breadcrumb/return context, and empty/error structure.
Deviations require an evidence-backed rationale.

The five-lens live matrix runs under BI-F2278856 after those routes exist.

## Risks and rollback

- **False authority from generated text:** keep intent `draft` until reviewed;
  never infer ratification.
- **Parallel registry drift:** generator consumes the canonical manifest and
  shared route-policy builder; a parity test rejects missing/extra routes.
- **Legacy-route noise blocks unrelated work:** unratified existing routes are
  advisory coverage debt; exact identity ratcheting prevents backsliding while
  net-new routes start ratified.
- **Dynamic/contextual false failures:** preserve explicit fixture exclusions
  and require each exclusion to name an owner, rationale, and remediation
  deadline before the owning cohort can close.
- **Overfitted Self-Upgrade checks:** evaluator checks semantic markers and
  state contracts, not exact prose snapshots.
- **Structural false confidence:** reports label DOM conformance separately
  from findability and task validation; no aggregate "pass" erases a missing
  evidence class.
- **Stale task evidence:** receipts record source SHA as provenance plus fixture,
  contract, interaction, and relevant-dependency fingerprints. A source SHA
  change triggers comparison rather than fleet-wide invalidation; material
  interaction or dependency changes expire consequential/AI validation until
  rerun.
- **Sweep nondeterminism:** purpose findings remain advisory until two same-SHA
  runs prove reproducibility and BI-232BA634 is resolved; activation is a
  reviewed flip, not an incidental code path.
- **Report bloat:** extend existing JSON/report/league table and cap console
  detail; no new UI dashboard.

Rollback follows the independent delivery boundaries:

| Deliverable | Rollback action | Preserved substrate |
| --- | --- | --- |
| Registry and identity ratchet | Remove only after every evaluator and route contract consumer is removed; revert the Purpose generator, generated registry, and source-local guard together. Keep the generic shared route-policy and registry I/O refactor because the route-shell generator also owns it. | Canonical route manifest, route-shell registry, shared generator substrate, and volume/ARIA ratchets |
| Evaluator and Self-Upgrade pilot | Remove purpose findings, markers, and task-receipt projection from the composed evaluator | Typed registry, deterministic generator, and net-new route identity guard |
| Enforcement activation | Downgrade the activated checks to advisory and retain their evidence, fixtures, and evaluator output | Registry, evaluator, Self-Upgrade contract, and reproducibility history |
| Five-lens adoption | Revert each new shallow lens route and its co-located contract independently, preserving the underlying canonical coworker/work/decision/setup/health read models | Registry, evaluator, and unrelated routes |

A faulty contract edit rolls back to its last-known-good source through normal
version control. A faulty first ratification cannot silently become draft; it
uses an `intent-quarantined` source with owner-approved incident and review
references until corrected. Quarantine remains visible coverage debt and never
counts as ratified usability evidence.

No migration or persistent runtime state is involved in the Purpose Contract
program itself.

## UX fit review

- Decision: fits-with-guardrails
- Owning area: Platform
- Route family: all canonical routes; pilot `/ops/self-upgrade`
- Primary persona: route-specific; pilot is the platform operator
- Navigation layer touched: none
- Reuse/convergence: route manifest, route audience, shell policy, UX sweep,
  audit report, and league table
- Source truth: canonical route manifest plus reviewed intent overrides
- Empty/failure behavior: explicit contract states and recovery
- AI boundary: evaluation only; no prompt send
- Required guardrails: no parallel route registry, no fabricated ratification,
  no dashboard, and no blocking legacy debt without a ratified contract
- Evidence before merge: deterministic generation, evaluator fixtures,
  exact-SHA gate, and desktop/mobile pilot acceptance
- Captured in: this plan

## Backlog coverage

**Receipt:** `cms6lzjbn0et901l2wlu2868l`
**Decision:** decomposed

| Deliverable key | Backlog item | Depends on |
| --- | --- | --- |
| `purpose-contract-registry` | BI-B4A4C76E | none |
| `purpose-evaluator-self-upgrade` | BI-D27323A0 | `purpose-contract-registry` |
| `purpose-enforcement-activation` | BI-B6935E5B | `purpose-evaluator-self-upgrade`; operationally also BI-232BA634 |
| `ai-workforce-five-lens-purpose-adoption` | BI-F2278856 | `purpose-evaluator-self-upgrade`; operationally also BI-97CD9E4B and BI-C1943813 |

The registry, evaluator pilot, activation, and lens adoption have separate
verification and rollback boundaries. The five-lens slice remains independent
because it creates the user-facing routes; declaring contracts for absent
routes would fabricate intent and violate the canonical route manifest.
