---
title: Shared Change Reviewer Control
status: accepted
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

## Non-goals

- Replacing GitHub review.
- Calling a blocking model from a git hook.
- Running full multi-agent deliberation for every trivial change.
- Creating a new finding table.
- Making the authoring Software Engineer its own independent reviewer.
- Treating a vendor reviewer as the canonical DPF evidence contract.
