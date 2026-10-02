---
title: Build Studio large-lane independent reviews — routing the owed receipts to reviewer coworkers
status: draft
review-history: design-spec and architecture-review passed at 85cc9b34 (2026-10-02); spec-approval re-requested on this revision
date: 2026-10-02
backlog: BI-926A7E90
epic: EP-984E4124
decision: DI-22C924C64147
---

# Build Studio large-lane independent reviews

## Problem

A Build Studio build whose delivery shape is `large`, or is raised to `large` by
sensitivity, owes the large-shape readiness receipts before it may enter the
build phase: canonical design, spec approval, architecture review, objective
baseline, artifact author, plan review, plan coverage and traceability. On the
live install on 2026-10-02 (main `4dcfc224a`), 51 of 120 plan-phase builds owe
that set and every one of them is refused at plan→build with the same sentence,
"no canonical design document is pinned for this work".

Nothing on the platform can request those reviews for a Build Studio build:

- Build Studio records no `record_initiative_design_review` receipt itself (no
  writer under `apps/web/lib/build` or `apps/web/lib/mcp/build-*`).
- The server reviewer dispatcher (`dispatchOwedIndependentReviews`,
  BI-A835D300) only considers items in `awaiting-acceptance` and routes the
  completion decision (`server-reviewer-dispatch.ts:111,128`).
- The reviewer recovery (`resolveInitiativeReviewerRecovery`) binds a reviewer
  to a repository artifact (path + provider blob id at a commit) and requires a
  dispatch context (repository, branch, immutable head). A Build Studio design
  is a `BuildArtifactRevision` of `FeatureBuild.designDoc`, and a Build Studio
  room records no branch head, so the recovery escalates with
  `dispatch-context-required` or `no-canonical-artifact` instead of routing.

The receipt side already understands Build Studio: `record_initiative_evidence`
and the baseline repository accept `artifactRef.kind: feature-build-revision`
(`baseline-repository.ts:315`), and the ideate research receipt binds to that
revision today. Only the routing half is missing.

## Decision

WWMD DI-22C924C64147 (principle_decide, high stakes, margin 7.1, autonomy
eligible) chose to widen the server dispatcher to the pre-build gates over
having Build Studio mint its own receipts (the executing surface approving
itself) or recalibrating the sensitivity raise (weakens a safety classifier
without evidence and does nothing for declared-large work).

## Research & Benchmarking

Checked 2026-10-02. Design comparisons, not security evaluations.

| Reference | Pattern | DPF disposition |
|---|---|---|
| **Kubernetes Enhancement Proposals (KEPs)** — a KEP is a file in the repository; a feature cannot graduate without an approved KEP, and approval is recorded by named owners in the file's metadata (kubernetes/enhancements, `keps/README.md`). | Design is an immutable repository artifact; approval is a receipt by an accountable, independent owner. | **Absorb** the receipt-on-artifact shape; DPF already has it for external claims. **Reject** forcing Build Studio to author a repository spec before any review: the design revision is already immutable and digest-bound. |
| **Rust RFC process** — an RFC is merged as a document before implementation; "final comment period" is a bounded review window run by the owning team (rust-lang/rfcs, README). | Bounded independent review before implementation, by a team other than the author. | **Adopt** the bounded window: one request per gate per cooldown, the same `REVIEW_DISPATCH_COOLDOWN_MS` the dispatcher uses today. |
| **Gerrit change-ref review** — each patchset is a distinct immutable ref; reviewers vote on an exact ref, never on a branch tip (gerritreview.com documentation, "Patch sets"). | Review binds to an immutable identity. | **Adopt**, already DPF's rule for `repo-blob-at-commit`; this design extends the same rule to `feature-build-revision` (revision id + value digest). |

## Design

### 1. A Build Studio design revision is a bindable canonical artifact

`InitiativeRecoveryCanonicalArtifact` gains a second resolved shape:

```ts
| { resolved: true; kind: "feature-build-revision"; revisionId: string; valueDigest: string; buildId: string }
```

`requestCoworkerPacket` carries it in `initiativeReviewBinding.artifactRef`
exactly as the receipt writer expects (`{ kind: "feature-build-revision",
revisionId }`), and the review objective tells the reviewer to read the
revision through the immutable reader `read_build_artifact_revision`
(new, read-only, returns the revision's value and digest; refuses a revision
whose digest does not match the binding). `requiredToolNames` lists the writer
and that reader, mirroring `read_source_at_version` for repository artifacts.

The plan artifact for `plan-review` is the accepted `buildPlan` revision of the
same build, bound the same way.

### 2. A Build Studio room carries a dispatch context

`InitiativeRecoveryDispatchContext` is `{ workroomId, repositoryFullName,
branchName, headSha }`. For a Build Studio room: the room's `capsuleId`, the
platform repository, the build branch `build/<buildId>`, and the sandbox head
of that branch when one exists, else the design revision's digest as the
immutable identity the packet is keyed on. The request key therefore changes
when the design changes, and a stale request is refused by the lane as today.

### 3. The dispatcher considers Build Studio builds in plan

`loadCandidates` adds a second source: rooms with `executorKind =
"build-studio"` whose linked build is in `plan`, whose item is `open` or
`in-progress`, and whose latest implementation-target readiness decision is
`input-required` with at least one routable unmet code. For those candidates
`owedRoutes` uses `decisions.implementation` and
`resolveInitiativeReviewerRecovery` with the canonical artifact from §1 and the
dispatch context from §2. Everything downstream is unchanged: cooldown,
idempotent request keys, `request_coworker` on the author's connection, the
room-recorded outcome, and the per-call limit.

### 4. Author connection

The lane sends on the author's standing OAuth connection for (user, assistant).
The operator holds live connections for `AGT-EXT-CLAUDE` and `AGT-EXT-CODEX`
only. For a Build Studio room the assistant is the admitted Build Studio
coworker (`AGT-WS-BUILD`, BI-00588B51). `findStandingConnection` is widened to
accept, for a Build Studio room, any live connection of the room's requesting
user whose token admits `request_coworker`; the room still records which
connection carried the request. No grant is widened: the reviewer coworker's
own grants and the user's capabilities still intersect at execution.

### 5. What stays a human decision

A reviewer that fails the design, an accepted or deferred residual risk, and a
build whose shape is `xlarge` still escalate to the owner. This design routes
requests; it approves nothing.

## Acceptance

- AC-1: a large-shape Build Studio build in plan receives routed requests for
  design-spec, spec-approval, architecture-review and plan-review within one
  dispatcher cycle, each recorded on its room with the request key.
- AC-2: the reviewer coworker can read the bound revision through
  `read_build_artifact_revision` and the resulting receipt binds to the same
  revision id; the readiness decision then clears `CANONICAL_DESIGN_REQUIRED`,
  `SPEC_APPROVAL_REQUIRED`, `ARTIFACT_AUTHOR_REQUIRED` and
  `OBJECTIVE_BASELINE_REQUIRED` from that receipt.
- AC-3: the existing awaiting-acceptance behaviour of the dispatcher is
  unchanged; its tests pass as written.
- AC-4: a request for a design that changed since the last request has a new
  request key; a repeat inside the cooldown is recorded `cooling-down`.
- AC-5: live proof on the install: one previously blocked large build crosses
  plan→build with no human click.

## Delivery sequence

| # | Deliverable | Shape |
|---|---|---|
| 1 | `read_build_artifact_revision` immutable reader and the `feature-build-revision` binding in the recovery packet | small |
| 2 | Build Studio dispatch context on the room | small |
| 3 | Dispatcher candidates for builds in plan, implementation-target routing | medium |
| 4 | Connection selection for Build Studio rooms | small |
| 5 | Live proof and the Annex update in `docs/architecture/failure-analysis-and-recovery.md` | small |

## Out of scope

- The prose-keyword sensitivity raise (schema, governance, permission, outbound,
  database, external) and whether it over-fires. Measured on 2026-10-02: about
  20 of 120 plan builds raised. A separate calibration item with evidence.
- The oversized-design loop: an autopilot "keep monolithic" override that the
  design review's size gate still refuses (FB-F963CF71, FB-2B2BD011,
  FB-323A2BE7). Separate defect.
