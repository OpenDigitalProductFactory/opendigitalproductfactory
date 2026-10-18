# Bind local-CI classification to the requested worktree

**Backlog item:** BI-A254A94C
**Workroom:** WC-C5A99EFD
**Delivery shape:** delivery-small@1.0.0
**Source base:** 2ea911341e05001319afbb52ac401ffcdc259967

## Problem and existing architecture

The existing derived-artifact classifier is the single exemption policy.
At the source base, scripts/gate-worktree.mjs:1724 calls
sandboxDecisionForHead without the already-resolved candidate worktree.
Its Git reads and derived-artifact commands default to the module repository.
On protected main, the module checkout has an empty diff, so a separate
candidate can exit successfully without the required lease admission.
On a code-bearing contributor branch the same defect can hide itself.

Observed reproduction before production edits: the existing AC-DW-01
resume contract test fails with exit 0 instead of 81 and a docs-only message.
The test uses a local stub HTTP server, never the canonical MCP or database.
A real lease failure is not the cause: no claim is reached in that failure.

Reuse scripts/derived-artifacts-gate.mjs, the current registry, and the
existing pre-admission decision in gate-worktree. The original August 4
agent-local-CI enforcement design and build-gate runbook remain authoritative.
No new classifier, exemption, environment flag, lease lifecycle or credential.

## Ordered atomic fix

1. CANDIDATE-RED: add real temporary Git-repository tests for a code candidate,
   a documentation candidate and unavailable Git identity while the module
   repository differs. Check artifact commands against the candidate directory.
   Make lease/resume fixtures declare their actual code-bearing candidate;
   retain explicit documentation-only fixtures as exemption controls.
2. CANDIDATE-BIND: allow the existing classifier to receive a worktree directory.
   Bind both merge-base/diff reads and derived-artifact command cwd to it.
   Pass gate-worktree's resolved worktree and configured Git invocation.
   Preserve null/unknown as requiring the normal gate, never an exemption.
3. CANDIDATE-VERIFY: run related Node classifier, resume and lease contracts,
   affected guards and source typechecks where required. Review independently,
   publish with normal DCO/protected CI, then verify the containing install.

## Acceptance and verification

- AC-1 / CONTRACT-CANDIDATE: candidate code reaches the normal admission path
  even when the module repository has an empty or documentation-only diff.
- AC-2 / CONTRACT-DOCS: an actually exempt candidate takes no sandbox slot,
  including when the module repository itself has code changes.
- AC-3 / CONTRACT-FAIL-CLOSED: missing merge base or failed Git read cannot
  create an exemption; stale artifacts require admission. Toolchain-unavailable
  artifact checks keep the existing unrun classification, never a passing check.
- AC-4 / CONTRACT-ARTIFACT: registry checks run in the candidate worktree;
  unchanged resume/finalization bypass rules remain unchanged.
- AC-5 / VERIFY-REGRESSION: meaningful failing then passing behavior tests,
  including existing cancellation and lease paths, precede publication.

## Backlog coverage

- Decision: atomic
- Parent: BI-A254A94C
- Receipt: cmvd44r4008py01lun1tmhaq4 (immutable design 76024c7201b; initial implementation admission IRD-37ADC7A9460D; lease-fixture scope claimed after normal owner release)
- Rationale: candidate selection, fixture regression and documentation are one correction of the existing admission predicate; no phase is independently shippable.
- Dependencies: none

## Delivery boundaries

Local stub tests are source evidence, not native lease or runtime acceptance.
No headless NULL-actor local-CI request before the qualified 6478-containing
install, and no credential, grant, SQL or runtime-asset fallback. Existing
bounded DEV recovery publication must report skipped gates as unrun.
