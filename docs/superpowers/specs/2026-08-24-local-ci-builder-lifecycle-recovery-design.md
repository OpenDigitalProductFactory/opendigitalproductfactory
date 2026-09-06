# Local-CI Builder Lifecycle Recovery Design

- **Status:** ready for implementation
- **Date:** 2026-08-24
- **Backlog item:** `BI-B131F357`
- **Workroom:** `WC-DD1EF64C`
- **WWMD decision:** `DI-308054F94780` (`bounded-transition`)
- **Extends:** `docs/superpowers/specs/2026-08-10-buildkit-session-lifecycle-design.md`
- **Process target:** `docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md`

## Problem

The currently enforced Windows pregate runs its Docker production build after
typecheck and the exhaustive test suite. The bounded Buildx builder can remain
registered after its backing BuildKit container is removed. In that state,
`docker buildx inspect` succeeds, `docker inspect <container>` reports that the
object does not exist, and local-CI stops at `builder-preflight` only after the
expensive checks have finished.

The resulting record is also misleading. It classifies every builder-preflight
failure as `blocked_control_plane_starvation`, and `pregate:status` tells the
operator to run the same command again even when the failure is deterministic.
The production-build receipt additionally carries a historical backlog-item ID
that is not a valid contract for future installs.

## Decision

Use a bounded transition:

1. Harden the builder lifecycle required by the gate that exists today.
2. Run a non-building builder preflight before expensive code verification.
3. Recover exactly one known-safe stale-registration state automatically.
4. Record a specific failure class and a truthful next action.
5. Treat the local-Docker gate as compatibility infrastructure, not the target
   process. Moving heavy verification to the cloud remains a separate governed
   delivery concern.

This preserves the current safety boundary while avoiding further investment in
local Docker as the long-term verification architecture.

## Objectives

**OBJ-LCBLR-001:** Restore the governed bounded builder automatically when its
Buildx registration survives deletion of the expected BuildKit container,
without broadening the repair to unknown Docker failures or resource drift.

**OBJ-LCBLR-002:** Discover a non-recoverable builder lifecycle problem before
typecheck and the exhaustive test suite consume the shared local-CI slot.

**OBJ-LCBLR-003:** Preserve exact-tree build evidence while recording a stable,
specific lifecycle failure and a truthful operator action when automatic
recovery is exhausted.

**OBJ-LCBLR-004:** Remove historical backlog-item identifiers from reusable
runtime receipts and keep the local-Docker change explicitly transitional.

## Lifecycle state machine

The preflight observes the Buildx registration and its expected container:

| Observed state | Meaning | Action |
|---|---|---|
| Buildx registration absent | No managed builder exists | Create it with the governed policy, then inspect and validate it |
| Registration and container present; driver and resource policy match | Healthy managed builder | Reuse it |
| Registration present; expected container is missing | Stale Buildx metadata | Remove that named registration once, recreate it, then inspect and validate it |
| Registration present; container inspection fails for any other reason | Host inspection failure | Fail closed; do not mutate |
| Driver, container identity, memory, CPU, or policy differs | Resource drift | Fail closed; do not resize or replace silently |
| Recreate or post-recovery inspection fails | Recovery exhausted | Fail closed with deterministic repair guidance |

The automatic recovery is intentionally narrow. It may remove only the exact
managed builder name supplied by the slot policy, and only after the container
inspection has been classified as a missing-object result. It gets one attempt.
Unknown Docker errors and resource drift are never converted into destructive
repair.

## Fail-fast placement

For the transitional `docker-build` strategy, the local integration plan adds a
builder-preflight command after sandbox convergence and generated-client setup,
but before typecheck and exhaustive tests. The command may create or recover the
bounded builder and validate its resource policy; it does not build an image.

The production-build command repeats the same idempotent preflight before use.
That second check closes the time-of-check/time-of-use gap. A passed preflight is
not reusable build evidence and does not weaken exact-tree build receipts.

Non-Docker build strategies do not run this preflight.

## Evidence and operator guidance

Builder-preflight failures retain the existing database-compatible terminal
status until the status taxonomy is migrated, but add stable metadata:

- `failureClass: "builder-lifecycle"`
- `failureFingerprint`: a stable lifecycle reason such as
  `builder-container-missing-after-recovery`, `builder-inspection-failed`, or
  `builder-resource-drift`
- `recoveryAction`: concise operator guidance
- `retryable`: whether an unchanged rerun can reasonably help

`pregate:status` reads the production-build receipt embedded in local-CI
metadata. For a non-retryable builder-lifecycle failure it reports `BLOCKED` and
prints the recorded recovery action. It must not print the generic rerun command.
`BLOCKED` remains a nonzero verdict and cannot be reconciled above a valid `PASS`
for the same HEAD.

Transient queue/lease failures retain their existing retry guidance.

## Receipt provenance

Runtime receipts describe a reusable contract, not the backlog item that happened
to introduce it. The bounded-build and integration receipts use stable contract
identifiers instead of historical `BI-*` values. Backlog provenance remains in
the implementation plan, commits, Workroom evidence, and PR.

## Safety properties

- No image build begins unless the managed builder matches the governed resource
  policy.
- Automatic repair cannot target an arbitrary builder name.
- Resource drift never triggers silent deletion or replacement.
- Recovery is bounded to one remove/recreate attempt.
- Builder readiness is checked before expensive tests and again immediately
  before the build.
- Status output never recommends an unchanged rerun for a recorded non-retryable
  lifecycle failure.
- Existing exact-tree build receipt reuse remains unchanged.

## Verification

Unit tests prove lifecycle classification, recovery command sequencing, the
one-attempt bound, drift fail-closed behavior, fail-fast command placement,
receipt provenance, and status reconciliation/guidance. Targeted script tests,
repository guards, typecheck, and the exact-tree gate remain required before
handoff.

## Acceptance mapping

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-LCBLR-001 | OBJ-LCBLR-001 | A missing expected BuildKit container behind the configured managed Buildx registration triggers exactly one remove-and-recreate attempt, followed by governed policy validation. |
| AC-LCBLR-002 | OBJ-LCBLR-001 | Generic container inspection failure and driver, identity, memory, CPU, or policy drift fail closed without deleting or resizing the builder. |
| AC-LCBLR-003 | OBJ-LCBLR-002 | The Docker strategy runs a non-building builder preflight before typecheck and exhaustive tests; non-Docker strategies do not. |
| AC-LCBLR-004 | OBJ-LCBLR-002, OBJ-LCBLR-003 | The production build repeats the idempotent preflight immediately before use and exact-tree passed-build receipt reuse remains unchanged. |
| AC-LCBLR-005 | OBJ-LCBLR-003 | Recovery exhaustion records `failureClass`, `failureFingerprint`, `recoveryAction`, and `retryable` fields without introducing a new database status. |
| AC-LCBLR-006 | OBJ-LCBLR-003 | `pregate:status` renders a non-retryable lifecycle blocker with its recorded action and does not recommend an unchanged pregate rerun; an exact-HEAD pass still wins slot reconciliation. |
| AC-LCBLR-007 | OBJ-LCBLR-004 | Bounded-build and integration receipts use stable contract identifiers rather than historical `BI-*` values, and the change does not move heavy verification back into the long-term local process. |

## Out of scope

- Replacing the local Docker production build with the Stage 2/Stage 4 process
  described by the resilient-development specification.
- Adding a new database status enum or persistent model.
- General Docker Desktop repair or deletion of unknown builders/containers.
- Treating a local builder repair as proof that product code passed.
