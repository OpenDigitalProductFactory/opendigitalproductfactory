# Exact-tree CI receipt foundation

**Backlog:** `BI-9585E580`  
**Work Capsule:** `WC-BB748BBC`  
**Decision:** `DI-CCAB45B2770D`

## Outcome

Land the versioned, fail-closed evidence contract needed to reuse exhaustive
merge-group evidence on an identical post-merge tree. This slice observes and
reports whether reuse would be valid; it does **not** skip any push job.

## Existing design reconciled

- Preserve the accepted lifecycle architecture in
  `docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md`.
- Reuse the current evidence planner digest and exact-tree build receipt rather
  than introducing another change classifier or build provenance contract.
- Keep `Merge Readiness`, `UX Route Budget Sweep`, and DCO as the stable merge
  authority.
- Keep affected-test selection in shadow. Its statistical recall gate is
  separate from deterministic exact-tree identity.
- Retain the recorded activation dependency. This PR prepares and observes the
  receipt boundary without changing which jobs execute.

## Contract

1. A merge-group run may create `ci-evidence.json` only after its aggregate
   merge-readiness policy has accepted every planned dependency.
2. The receipt binds repository, immutable tree, source event/run/attempt,
   planner and merge-policy digests, workflow/toolchain identity, complete gate
   set, result, artifact digests, and a bounded lifetime.
3. A push observer may recommend reuse only for a successful, unexpired
   merge-group receipt whose tree and every identity dimension match the pushed
   checkout.
4. Missing, malformed, incomplete, failed, stale, expired, or mismatched
   evidence returns `exhaustive`; lookup/API failures also return `exhaustive`.
5. The workflow records the shadow verdict and still runs all existing push
   jobs.

## Red-green-refactor sequence

1. Add failing unit tests for valid creation/validation and each fail-closed
   mismatch: tree, repository, event, planner, policy, workflow, toolchain,
   incomplete/failed gate, artifact checksum, lifetime, and malformed receipt.
2. Add failing discovery tests for exact merge-group selection, terminal
   unsuccessful runs, expired artifacts, API failure, and no evidence.
3. Add failing workflow-conformance tests proving:
   - merge-group publishes only after `Merge Readiness`;
   - push runs shadow discovery before heavy work;
   - no heavy job is conditionally skipped by the shadow verdict;
   - the stable aggregate contexts remain intact.
4. Implement one canonical receipt library and a thin create/discover CLI.
5. Wire merge-group publication and push shadow lookup into `ci.yml`.
6. Remove duplicated identity/checksum helpers where the new contract can
   safely reuse existing canonical utilities.
7. Update contributor CI evidence guidance.

## Verification

- Run the focused receipt, discovery, workflow-conformance, evidence-planner,
  build-artifact, and merge-readiness-policy tests.
- Run policy/workflow guards affected by `ci.yml`.
- Run the exact-SHA governed local-CI gate before push.
- Let GitHub execute the branch and merge-group workflows. Record the first
  real push shadow verdict after merge without crediting avoided work yet.

## Documentation, UX, and migration

- Contributor documentation changes because CI now publishes an additional
  auditable artifact and shadow verdict.
- Operator UX is not affected; no portal route or interaction changes.
- Database migration is not applicable; GitHub-native evidence remains outside
  DPF `ToolExecutionReceipt`.

## Rollback

Remove the receipt publication and shadow observer steps. Existing exhaustive
push execution remains unchanged throughout this slice, so rollback does not
alter coverage or branch-protection behavior.
