---
status: active
---

# Required agent toolchain merge verification

Backlog: BI-A689AB68
Profile: fix. Implementation owner: BI-A689AB68, Workroom WC-584738F2.

## Problem and reproduction

On origin/main 631012db62307fa334ca0d0109e78f339050fba5, the required
Merge Readiness aggregate in `.github/workflows/ci.yml` does not depend on
`agent-toolchain-bootstrap-smoke.yml`. That workflow has path-filtered PR/push
triggers and no merge-group or callable trigger. The existing policy audit and
four policy tests pass while an assertion that the aggregate includes
`agent-toolchain-bootstrap` fails. Historical PR #6596 merged with a failing
POSIX adapter smoke. Its Python tests passed; the smoke failure was a separate
readiness expectation, not proof it detected the TOML duplicate-key defect.

## Objectives

- OBJ-TC-1: Deployment-critical toolchain checks determine required merge readiness.
- OBJ-TC-2: Preserve one implementation of those checks and safe merge-queue execution.

## Acceptance criteria

- AC-TC-1: Required CI calls the existing toolchain workflow and includes its result in Merge Readiness for pull requests and merge groups.
- AC-TC-2: A failed or cancelled toolchain dependency makes the aggregate fail; an intentionally skipped docs-only call stays merge-safe.
- AC-TC-3: The local policy guard rejects removal, redirection or conditional suppression of this dependency and rejects a non-callable toolchain workflow.
- AC-TC-4: Existing POSIX bootstrap and stock macOS Python suites run unchanged through the shared workflow, without duplicate standalone PR/push runs.

## Ordered repair and verification

1. Add a regression against the actual workflows and negative mutations for
   omitted dependency, wrong callable target, missing callable trigger, and
   failure/cancellation propagation. Run it red on the named base.
2. Make the existing toolchain workflow reusable, retaining manual dispatch for
   diagnosis; call it from CI when existing change classification says heavy.
   Non-PR events already fail safe to heavy, including merge groups. Do not
   short-circuit it with exact-tree receipt reuse: the checks really execute.
3. Extend the existing merge-readiness manifest/guard with the callable workflow
   identity and call-job identity. Do not create a second CI policy store.
4. Run local policy tests/audit, relevant Python regressions, diff and YAML
   checks, governed shared gate, and protected CI on the final immutable head.
5. Publish a DCO-signed PR, merge through the protected queue, and record the
   actual required aggregate/toolchain results. No runtime deployment is needed
   for a repository workflow policy to take effect.

This is one atomic fix: workflow reuse and the required dependency must ship
with their invariant guard. No grant changes, branch-protection weakening or
production mutations are included. The separately reported Failure Readiness
protection discrepancy remains a distinct ownership/reconciliation question.

## Existing architecture and alternatives

Reuse GitHub's local reusable workflow and the current `evaluateDependencyResults`
implementation. Copying smoke steps into CI duplicates their maintenance; making
a path-filtered check independently required can leave unrelated PRs pending.
The parent CI already runs without workflow-level path filters and on merge_group.
The heavy decision is derived by the existing evidence planner; toolchain scripts,
packages and workflow changes are not documentation-only.

## Delivery boundary

The original TOML repair is PR #6623. Its release delivery and installed updater
verification are tracked separately from this CI authority repair. Passing this
policy check alone does not establish client functionality or guard hook trust.
