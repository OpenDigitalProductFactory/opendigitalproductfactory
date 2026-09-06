---
title: Shared Change Reviewer Control
status: binding
date: 2026-07-27
owner: platform
reviewed_by: codex-desktop
backlog:
  - BI-67E23B70
  - BI-DED7D653
  - BI-1B83AA84
  - BI-877EEA34
  - BI-BD3F687C
relates:
  - docs/superpowers/specs/2026-05-30-development-process-spine-design.md
  - docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
  - docs/superpowers/specs/2026-06-19-unified-build-studio-tracking-all-surfaces-design.md
  - docs/superpowers/specs/2026-07-12-verified-finding-review-design.md
---

# Shared Change Reviewer Control

## Decision

DPF will use one native, surface-neutral semantic change-review control before
software is first published. Build Studio, Codex, Claude, Grok, Antigravity,
and future delivery surfaces will produce the same review envelope, receive the
same review result, and record the same fresh evidence receipt.

The independent reviewer is the governed `change-reviewer` coworker. It is
read-only: it can inspect source, code graph, architecture, plans, backlog
context, and the registry, but cannot edit code, advance builds, publish
releases, or waive findings.

Its canonical persona is `prompts/specialist/change-reviewer.prompt.md`. The
persona must mirror the registry's identity, delegates, value stream, HITL
tier, and read-only grant envelope; the coworker-persona audit is the blocking
conformance control for that contract.

GitHub review remains an independent post-publication oracle. It is not
replaced by this control.

Kernel decision `DI-ACD01178FC30` recommended this shared native control with
high confidence over procedural guidance, full deliberation on every change,
or a vendor-local reviewer.

## Problem

The process spine already converges work tracking, evidence, handoff, tests,
merged-code verification, DCO, and PR health across delivery surfaces.
Semantic review does not have equivalent timing:

- Build Studio runs semantic task reviews through
  `apps/web/lib/integrate/build-reviewers.ts`.
- External delivery flows run deterministic gates, then publish the branch.
- `apps/web/lib/deliberation/external-review-activation.ts` contains a pure
  activation policy but no production caller.
- Critical-finding verification exists in
  `apps/web/lib/build/verified-finding-review.ts`, but is opt-in and scoped to
  plan review.
- `scripts/pr-readiness.mjs` validates an already-pushed branch and therefore
  cannot be the before-first-publication semantic control.

The result is avoidable push/PR churn: GitHub is often the first independent
semantic reviewer.

## Existing substrate

This design extends existing models and contracts:

| Need | Canonical substrate |
|---|---|
| Semantic review prompt/result | `apps/web/lib/integrate/build-reviewers.ts` |
| Risk-aware activation | `apps/web/lib/deliberation/external-review-activation.ts` |
| Critical-finding verification | `apps/web/lib/build/verified-finding-review.ts` |
| Cross-surface evidence | `ExternalEvidenceRecord` |
| Human-legible timeline | `WorkCapsuleActivity` |
| Build Studio review transition | Build orchestrator/reviewer branches |
| External deterministic gate | `pnpm pregate` |
| Final pushed-branch readiness | `pnpm pr:ready` |

No new finding-shaped Prisma model is allowed. The review result is an
evidence payload, and its summary is projected onto the existing Work Capsule
timeline.

## Contract

### Change review envelope

The stable input carries:

- Work Capsule id and author principal/surface;
- base commit and head commit/tree identity;
- deterministic diff digest;
- changed files and summarized diff;
- risk/sensitivity classification;
- acceptance criteria and relevant plan/spec references;
- executed test evidence;
- code-graph context and related-test context;
- review policy version.

The authoritative external review runs against a committed local tree. An
optional uncommitted advisory may run earlier, but it cannot produce a fresh
publication receipt because its input is not immutable.

### Review result

The result preserves the existing Build Studio review semantics:

- verdict;
- summary;
- findings with severity, file/location, evidence, and remediation;
- specialist-routing requests;
- independent-verification verdicts for critical findings;
- reviewer identity/model/policy versions;
- duration and usage metadata.

### Review receipt

The receipt is recorded through existing Work Capsule evidence/activity and is
fresh only when all of these still match:

- capsule id;
- base commit;
- head commit/tree;
- diff digest;
- policy version;
- reviewer contract version;
- required specialist set.

A material code change, rebase, policy change, reviewer-contract change, or
specialist-policy change makes the receipt stale.

## Activation policy

- Documentation-only and mechanically low-risk changes may receive an evidenced
  policy auto-pass.
- Normal runtime code requires one independent Change Reviewer pass.
- High-risk architecture, migration, authentication, authorization, security,
  deployment, or workflow changes require Change Reviewer plus relevant
  specialists/deliberation.
- Review/fix/re-review automation is bounded to two loops. Remaining blocking
  findings require explicit disposition rather than an infinite model loop.

The existing `decideExternalReviewActivation` policy becomes the shared
starting point; it is not copied into each client.

## Surface flows

### External delivery surfaces

1. Create a stable local commit.
2. Invoke the shared review operation.
3. Fix or disposition findings.
4. Re-review after material changes.
5. Record a fresh Work Capsule receipt.
6. Run `pregate`.
7. Publish the branch and run `pr:ready`.
8. Open the regular ready-for-review PR.

The git hook never invokes a model. It only validates the local receipt or a
versioned policy exemption, so the hook remains fast and deterministic.

### Build Studio

Build Studio may retain task-level reviews, but the assembled change must pass
the same shared contract before verification/promotion. Its result is recorded
with the same evidence shape, so governance approves evidence rather than the
surface that produced it.

## Outcome learning

The control will compare:

- findings fixed before first publication;
- findings uniquely discovered by GitHub or CI;
- false positives and downgraded critical findings;
- corrective pushes per PR;
- time to first useful signal;
- review cost per accepted finding.

Shadow-mode evidence calibrates enforcement thresholds. Guessed precision
thresholds are not a substitute for measured performance.

## Refactoring allocation

Approximately 20 percent of delivery capacity is reserved for consolidation:

- extract shared review types/prompt parsing from Build Studio-specific code;
- wire the existing activation policy rather than create another policy;
- generalize verified-finding review rather than create a code-only verifier;
- keep `pregate`, semantic review, and `pr:ready` as honestly named, distinct
  lifecycle stages;
- reuse Work Capsule evidence/activity rather than create a review table.
- make coworker seeding preserve the live lifecycle stage so a definition
  deploy cannot bypass certification or undo an explicit promotion.

## UX

The default operator view remains quiet:

- Review complete;
- issues fixed or dispositioned;
- ready to publish.

Engineer detail may reveal findings, evidence, reviewer identity, freshness
keys, specialists, and costs. No separate dashboard is required for the first
slice; the Work Capsule/Build timeline is the canonical surface.

### UX fit decision

- Decision: fits with guardrails.
- Owning area and route family: Build Studio, using the existing
  `/build/work` Work Capsule control/timeline surface.
- Primary persona: contributor or platform operator deciding whether a change
  is ready to publish.
- Navigation: no global, section, or local navigation is added.
- Persona boundary: `/build` remains owned by the authoring Software Engineer;
  the more-specific `/build/work` route is owned by the independent Change
  Reviewer.
- Reuse: existing Work Capsule timeline and portal context; no new dashboard,
  tab, card family, or reporting component.
- Source truth: Work Capsule activity/evidence and the immutable change-review
  receipt.
- Empty/failure behavior: the coworker states which evidence is missing or
  stale and names the next recovery action; it does not fabricate a verdict.
- AI boundary: review actions use the existing coworker launcher/confirmation
  behavior.
- Evidence before merge: route resolution tests, sensitivity agreement,
  lifecycle conformance, and browser verification of `/build` versus
  `/build/work`.

## Rollout

1. Establish and define the Change Reviewer coworker.
2. Land the shared contract and receipt in non-blocking shadow mode.
3. Wire external and Build Studio transitions.
4. Calibrate precision and specialist policy from real outcomes.
5. Enforce receipt freshness for applicable runtime changes.
6. Promote the coworker only after behavioral certification passes.

### Enforcement and learning contract

- `pass` and `fail` are completed semantic decisions; `inconclusive` is an
  execution classification for capacity, transport, or protocol failure.
- Inconclusive reviews may pause publication in enforce mode because fresh
  evidence is absent, but they never create a critical semantic finding and are
  excluded from quality-rate denominators.
- The pre-push control reads an exact-tree git-dir sidecar minted from the
  durable receipt. It performs no model, portal, database, or network call.
- Explicit exemptions carry the policy version, capsule/diff identity, evidence
  id, reason, and expiry.
- GitHub/CI correlation reuses `ExternalEvidenceRecord` and Work Capsule
  activity with operation type `semantic-change-review.outcome`; no review table
  or dashboard is introduced.

## Amendment: evidenced failure analysis and recovery readiness

Status: proposed on 2026-09-06; implementation and independent approval pending.
This section supersedes the earlier documentation auto-pass and shadow rollout
for failure-analysis readiness. It extends the same review/evidence contract.

### Objectives and acceptance

**OBJ-FAILURE-001:** Prevent avoidable failures by analysing business consequences
during design and refreshing the analysis against the delivered change.

**OBJ-FAILURE-002:** Require independently challenged, current verification and
accountable disposition before PR publication or promotion on every surface.

**OBJ-FAILURE-003:** Recover review execution without false passes, false code
findings, duplicate execution, or technical approval requests to business owners.

**OBJ-FAILURE-004:** Learn from escaped failures through existing outcome evidence.

| Acceptance criterion | Objective links | Observable result |
| --- | --- | --- |
| AC-FAILURE-001 | OBJ-FAILURE-001 | Every change, including docs/config/process/tests, identifies workflows, affected people, invariants, authority/data boundaries, and a versioned design analysis; a final-diff refresh identifies eliminated opportunities and remaining failures. |
| AC-FAILURE-002 | OBJ-FAILURE-001, OBJ-FAILURE-002 | Each credible failure names trigger/assumption, business/user effect, severity/exposure, prevention or elimination, containment, detection, recovery/compensation, evidence and accountable remaining-risk disposition. |
| AC-FAILURE-003 | OBJ-FAILURE-002 | Empty checkboxes, blanket zero-risk assurances, plausible narratives without verified material evidence, unknown dispositions and stale receipts cannot satisfy server delivery or authoritative PR/merge readiness. |
| AC-FAILURE-004 | OBJ-FAILURE-002 | Evidence resolves in the current Workroom and repository against the final immutable change and current policy; expected and observed results are recorded, and unrun checks remain unverified. |
| AC-FAILURE-005 | OBJ-FAILURE-001, OBJ-FAILURE-002 | An independent existing reviewer challenges omissions and justified low-impact applicability; grants, principal independence, explicit approval policy and accountable risk acceptance remain enforced. |
| AC-FAILURE-006 | OBJ-FAILURE-003 | Missing evidence, changed diff, stale receipt, reviewer outage, denial, retry/replay and lost response have regression coverage; infrastructure remains inconclusive and has bounded same-identity recovery. |
| AC-FAILURE-007 | OBJ-FAILURE-003 | A valid internal review recovery packet reaches its independent coworker without owner technical approval; mismatched binding, insufficient grants, explicit always-approval and genuine business-risk decisions preserve their boundary. |
| AC-FAILURE-008 | OBJ-FAILURE-004 | Existing outcome evidence records escaped failure counts and links incident/scenario follow-up; unavailable observations remain unknown rather than zero. |

### Design grounding and ownership

Reviewed source: `apps/web/lib/change-review/semantic-change-review.ts`,
`semantic-change-review-operation.ts`, `semantic-review-enforcement.ts`,
`semantic-review-single-flight.ts`, and the `change-review-pack.ts` MCP adapter;
`apps/web/lib/work-management/policy-envelope.ts` and the Workroom transition
in `apps/web/lib/work-capsules/work-capsule-store.ts`; the existing initiative
review binding described in the backlog-and-planning runbook; and
`scripts/lib/semantic-review-gate.mjs` plus `scripts/semantic-review-policy.json`.
The companion process specification remains
[Resilient Concurrent Development Process](2026-08-15-resilient-concurrent-development-process.md).

The per-work-kind evidence initiative owns which regression, typecheck, docs,
behavior-preservation and UX evidence a kind of work owes. This amendment owns
failure-scenario completeness, mitigation-to-evidence relationships, final-change
freshness, and independent challenge. Both extend the existing evidence decision;
neither creates a second evidence engine. Peer-owned coordination records remain
read-only; confirm the interface with their accountable owner through the existing
coordination plane. Install-local identifiers belong only in that plane.

### Evidence contract

Store the analysis in the existing immutable review receipt/evidence payload,
with its versioned design reference and final-change binding. No new table,
reviewer role, mutable approval store or client-owned guarantee is introduced.
Use one pure validation contract from the shared review operation, server
delivery/promotion evaluator and authoritative PR check. Adapters resolve trusted
evidence and identity; prose or caller-supplied success flags do not establish them.

The payload records affected workflows/people, invariants and boundaries; design
artifact reference; final diff identity; eliminated opportunities with rationale;
remaining scenarios; and justified applicability for failure families. Each
scenario has a stable local key, trigger, effect, severity/exposure, prevention,
containment, detection, recovery, verification references and accountable risk
disposition. A mitigation reference resolves to existing verification evidence
with expected/observed behavior and execution status for this change. Accepted
material risk additionally resolves to an existing authority decision covering
that risk; naming an owner is not acceptance. Repair-required risks block.

Consider input/permission errors, identity/tenant/peer mix-ups, slow/unavailable
dependencies, credential expiry, retries/duplicates, races/stale responses,
partial writes, restart/cancellation, paging/capacity, version skew, migration,
backfill and rollback. Consider common-cause combinations. Applicability is an
explained judgment, not a requirement to add speculative code for every family.
A spelling correction may carry one evidenced scope disposition. A workflow or
gate change needs scenarios and negative-path verification. Neither receives a
pass merely because fields are nonempty. Independent semantic review assesses
adequacy and searches for omitted scenarios against the actual artifact.

### Enforcement and recovery

Require analysis before independent review can mint a publication receipt.
Bind analysis and resolved evidence digest into the existing review identity and
single-flight key, alongside base/head/diff, policy and reviewer versions.
Changing analysis, verification, policy or diff invalidates reuse. A design-stage
receipt cannot authorize final-code publication. Resolve repository head and
evidence ownership server-side; do not trust an external client's supplied hash.

Wire this same decision into Workroom review/promotion transitions, the assembled
Build Studio promotion path and authoritative PR/merge checks. A local sidecar
or PR-template section is explanatory convenience, never the authority. Required
failure evidence is enforced even where semantic-review rollout remains shadow;
legacy receipts require refresh rather than being grandfathered into readiness.
Deploy the producer and consumers together, bump contract/policy versions, and
exercise existing-install convergence before declaring the gate active.

Missing/stale material evidence means repair the evidence. Transport/capacity or
unreadable reviewer input means inconclusive; retain the same TaskRun/key and
reconcile durable state after a lost response before dispatching again. Reuse
terminal evidence only after complete freshness validation. Keep recovery within
existing bounded attempts; exhaustion routes to the technical delivery authority
with identity, attempts, evidence and next action, not generic owner sign-off.
Denial is not an outage and is never retried around its grants or identity boundary.

Use the existing server-issued initiativeReviewBinding recovery packet unchanged
for routine internal design/plan reviews. Do not ask the business owner to choose
reviewers or validate technical details. Explicit always-approval, real authority
changes and material business-risk acceptance retain their existing decision path.

### Failure analysis of this gate

| Trigger and effect | Eliminated/prevented opportunity | Containment, detection and recovery | Evidence and accountable disposition |
| --- | --- | --- | --- |
| Missing/stale analysis permits a defect that interrupts animal care, donations or volunteer coordination. | One shared predicate eliminates divergent adapter rules; exact identity prevents reuse across changes. | Deny readiness with missing/stale evidence detail; refresh analysis and independently re-review. | Negative omission, stale policy/head/evidence and alternate-surface tests; delivery authority owns unresolved gaps. |
| Reviewer dependency outage blocks a necessary repair; fabricated pass exposes users to unreviewed behavior. | Durable single-flight avoids duplicate requests; completed evidence is checked before reuse. | Inconclusive execution, bounded retry and durable readback after lost response; technical coordinator handles exhaustion. | Outage, restart, retry and lost-response tests; no semantic verdict is claimed until review completes. |
| Wrong tenant, peer, principal or forged risk acceptance releases an unauthorized change. | Existing scope/grant intersection and independent receipt writer remain authoritative. | Deny exact mismatch, retain audit reason, route a concrete authority decision only where needed. | Binding/grant/independence and accepted-risk provenance tests; governance authority owns disposition. |
| Valid internal recovery is misrouted to a nontechnical owner, delaying service repairs. | Reuse validated review binding rather than infer permission from prose or generic HITL tier. | Existing TaskRun envelope states internal recovery or actual approval boundary. | Valid-packet bypass and explicit always-approval/mismatch regressions; technical coordinator owns recovery. |
| Duplicate/lost persistence response or policy upgrade produces misleading readiness. | Idempotent execution and immutable evidence references eliminate blind replay. | Reconcile durable receipt and candidate identity, reject old schema/policy, retry boundedly. | Replay, partial-write, version-skew and response-loss tests; no rollback claim for external effects. |

Rollback of software does not retract published code, undo external effects or
restore destructive migrations. Emergency exceptions use existing accountable
promotion authority and explicit scope/expiry; they must not masquerade as passed
failure evidence. Unknown failure modes remain possible after a valid review.

### Research & Benchmarking

- [Google SRE NALSD](https://sre.google/workbook/non-abstract-design/): adopt
  iterative design around concrete business constraints and failure domains;
  reject copying Google's resource scale into every small DPF change.
- [SLSA verification summaries](https://slsa.dev/spec/v1.2/verification_summary):
  adopt artifact, verifier and policy binding; do not claim SLSA certification or
  create another attestation database from this analogy.
- [OPA decision logs](https://www.openpolicyagent.org/docs/management-decision-logs):
  adopt traceable decisions with input and policy revision; reuse DPF evidence
  storage rather than add OPA or an independent audit transport.

### Verification, UX and operating limits

Verification maps AC-FAILURE-001/002/003 to contract negative tests and independent
review; AC-FAILURE-004 to trusted evidence resolution/freshness tests;
AC-FAILURE-005/007 to real grant and bound-review routing tests;
AC-FAILURE-006 to single-flight fault tests; AC-FAILURE-008 to outcome persistence
and missing-observation tests. Exercise Workroom and PR readiness with missing,
current and then stale evidence on the governed nonproduction verification path.
Record exact commands and observed results after implementation; this table is
a test plan, not evidence of a pass.

Reuse the Workroom timeline: default copy names what is missing and the recovery
action; technical detail expands to scenario/evidence/owner links. No navigation
or dashboard is added. Verify quiet internal routing and concrete authority
escalation against the running app. Reserve approximately 20 percent of this
delivery for consolidating shared validation and adapter decisions.

Bound payload and resolved-evidence counts, fail visibly on truncation, and avoid
scanning all Workroom history per transition. Scale with a bounded receipt lookup
per candidate and a linear scenario pass; portfolio-wide aggregation remains in
the existing outcome pipeline. Resource/concurrency work owns higher throughput.
An incident links escaped failure evidence and a scenario follow-up through the
same outcome record; no fixed checklist proves exhaustive foresight.

## Non-goals

- Replacing GitHub review.
- Calling a blocking model from a git hook.
- Running full multi-agent deliberation for every trivial change.
- Creating a new finding table.
- Making the authoring Software Engineer its own independent reviewer.
- Treating a vendor reviewer as the canonical DPF evidence contract.
