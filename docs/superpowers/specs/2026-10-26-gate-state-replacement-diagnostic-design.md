---
status: draft
backlog: BI-B3DEC077
---

# Qualify Windows gate-state replacement under a controlled handle

**Backlog item:** BI-B3DEC077

**Workroom:** WC-7036EB63

**Source:** chore/gate-state-replacement-diagnostic at base f607ddab1bf0b74cc4c0280f6a3526e8a2561c38.

**Admission:** IRD-2D88039C1CB6 allows design with delivery-small@1.0.0, effective Small/low. Test implementation and execution require their own allowed transition.

## Objective and acceptance

**OBJ-DIAG-1:** Establish the behavior of the existing Windows atomic gate-state writer under one deliberately controlled destination-handle obstruction, without attributing the original incident or changing production behavior.

The following criteria reproduce the live item's acceptance contract.

| ID | Objectives | Acceptance criterion |
| --- | --- | --- |
| AC-D1 | OBJ-DIAG-1 | A test uses the real exported writer and isolated temporary files, proves helper acquisition before the first replacement, and records actual code/syscall without fabricating EPERM. |
| AC-D2 | OBJ-DIAG-1 | The controlled held-handle attempt retains the complete original ADMITTED JSON, creates no false PASS, and leaves no replacement temporary file. |
| AC-D3 | OBJ-DIAG-1 | After confirmed closure, one identical replacement yields complete RUNNING JSON; helper lifetime and cleanup are bounded even on assertion failure. |
| AC-D4 | OBJ-DIAG-1 | The result states only controlled sensitivity (or failure to establish it), preserves the original incident as unattributed, and records that original cancellation, native gate, readiness and acceptance were not exercised. |

## Evidence and reuse

AC02 / BI-11458908 / WC-D8C2180C retains the original source, failed-run ownership and publication hold. Its source 4333fad810440277626cec79913954b1c94d939c encountered EPERM while replacing an already written ADMITTED record with RUNNING, before command construction. Cancellation was not exercised. The retained record subsequently reported blocked_wrapper_exited with gatePassed=false, no evidence record, and one successful fixture-lease recovery.

The [shared writer](../../../scripts/lib/local-ci-gate-state.mjs) at this worktree's base has the same blob, f74e1b0c1b41be4cdc8b6a1b25ec946cd7f45618. It closes its own unique temporary descriptor before one renameSync, removes that temporary file on error, and rethrows. The [existing tests](../../../scripts/lib/local-ci-gate-state.test.mjs) already exercise the exported writer with isolated temporary files. Reuse that seam; no production fault-injection hook is necessary.

The accepted read-only proposal is ac02-running-state-diagnostic-20261027.json, SHA256 b4ccb0673da11626cdc0be0e1d1c71404ca5de55e6385f7e53ddf9c87852e2a5, recorded in WC-454E1BF6 sequence287. That room stores the diagnostic evidence only and supplies no implementation authority to this item.

Prior coverage was checked in the source corpus, EP-LOCALCI-ADMITS and live backlog. BI-DD7BFA75 concerns foreign-slot selection; BI-FFCFCCE0 preserves terminal PASS; BI-C5ED24D9 is a delivered child-termination timing repair. None implements this controlled replacement experiment. BI-26EB2F63 and BI-E96C5778 retain their separate review/fence scope and baselines.

[Microsoft FileShare documentation](https://learn.microsoft.com/dotnet/api/system.io.fileshare) defines the delete-sharing flag. [libuv's Windows filesystem source](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c) includes delete sharing in ordinary open mode. These sources justify a deliberately non-delete-sharing helper; they do not identify the original holder or prove that the Node polling reader caused the incident.

## Scope and classification

This is a test-only qualification chore, Small, with no established production defect or selected repair. Exact edit scope is this document and scripts/lib/local-ci-gate-state.test.mjs. Both are claimed in WC-7036EB63. The returned change-impact contract is resolved, with no additional testImpact or guardObligations, and requires the normal documentation index and publication checks.

No production writer, cancellation fixture, runtime, database, permissions, policy, retry loop or task state is changed. Do not take over AC02's occupied branch. A separate helper file, if later justified, requires a scope/impact update before editing; prefer a small inline helper within the existing test file.

The explicit user allocation remains approximately20% relevant refactoring. Apply it to a bounded owned-helper/fixture lifecycle within this test, avoiding duplicated waits, process cleanup and state assertions. Do not broaden this into unrelated test-suite cleanup. Funding ownership remains unresolved; installation class and admin authority do not decide it.

## Ordered experiment

1. **Establish admission and test environment.** Bind this item's own canonical design and coverage, resolve the research-definition mismatch below, and obtain actual implementation admission. Use the managed dependency probe. Inspect the actual Windows host and available PowerShell executable before running. An unsupported/non-Windows host is unrun/skipped, never positive Windows proof.

2. **Create the isolated baseline.** Extend the existing shared-writer test suite. Allocate one owned temporary directory and write a complete ADMITTED record through writeLocalCiGateState. Retain the exact bytes and parsed record, including gatePassed=false and empty evidence ID. Prepare the complete RUNNING input once and reuse it unchanged in both attempts.

3. **Acquire a controlled obstruction.** Spawn a hidden PowerShell helper using a literal argument array and windowsHide. It opens only the owned destination for reading with FileShare.ReadWrite, deliberately omitting Delete. Require an explicit acquisition acknowledgment before the first replacement. Keep the handle open until the test requests release or the helper's finite lifetime expires. Its terminal record must distinguish explicit release from watchdog expiry or early exit. Acquisition acknowledgment alone does not establish that the handle remained held through replacement. No external process inspection, termination, grant change or runtime access is needed.

4. **Observe one held-handle replacement.** Invoke the actual writer once. Capture and report the real error code, syscall and fixture-relative paths. Require an error from the replacement boundary, not an unrelated setup failure; never hardcode an invented EPERM result. If replacement succeeds unexpectedly, report that controlled sensitivity was not established. Verify the exact original ADMITTED bytes remain, gatePassed remains false, evidence remains empty, and no temporary file from the failed replacement remains.

5. **Remove the controlled obstruction and repeat once.** Request release after the first attempt, require acknowledgment after disposal of the helper's handle, and await its clean exit. Positive qualification requires closure caused by that explicit release; watchdog expiry or early exit before it makes qualification inconclusive regardless of the first error. Invoke the identical RUNNING input once. Require complete RUNNING JSON with the intended fields and no false PASS. Failure after confirmed closure means the selected obstruction was insufficient to explain this controlled case; retain the actual failure.

6. **Bound every exit path.** The helper has its own finite watchdog and closes the handle in finally. The test has bounded acquisition/release waits and an overall timeout. On assertion failure, its finally requests release and waits; if needed it terminates only the child it owns, then verifies exit before cleaning only its resolved fixture directory. The helper has no descendant worker tree. Preserve enough structured diagnostics in test output to distinguish startup, acquisition, replacement, closure and cleanup failures.

The reference contract is controlled-destination-handle-replacement. The flow is admitted-held-replacement-closed-replacement. Verification references are windows-paired-writer-qualification and bounded-owned-helper-cleanup.

## Interpretation and verification

This experiment is one atomic deliverable, controlled-windows-state-replacement, mapped only to BI-B3DEC077. Its acquisition, held attempt, closure and released attempt cannot ship as independent evidence: each is required to distinguish the controlled conditions. AC-D1 through AC-D4 are the requirement references. A native coverage receipt binds the immutable version of this document and the exact current edit scope; Markdown is not that receipt.

The experiment may be green with an expected first-attempt failure and successful second attempt; that is controlled behavior qualification, not a production RED-to-GREEN repair. Report the complete paired observations. Neither outcome identifies the original holder, establishes a retry policy, validates cancellation or proves historical readiness48407. No unchanged original cancellation fixture is rerun.

After admission, run the affected shared-writer suite on Windows and preserve counts, actual error, source SHA, tree and command. Exercise helper failure/timeout cleanup meaningfully. Run applicable source checks, documentation/index checks and normal preflight/publication obligations for the actual diff. Any canonical runtime gate remains subject to its normal lease; this fixture does not mint canonical gate evidence. Use signed commits, ready PR and protected merge queue. Read final PR health and source delivery separately from runtime acceptance.

Rollback removes this isolated test through normal protected source delivery. Production behavior remains unchanged.

## Research-definition disposition required

Current source maps chore to the fix profile, while binding Small leaves a research requirement. Fix research guidance asks for a confirmed defect and failing-then-passing reproduction. This qualification has neither, and its purpose is to produce bounded observations without presupposing a defect.

Source inspection and the historical failure are available research inputs. They are not a passing qualification result or experimental exclusion of the original causes. Do not exploit a permissive receipt schema to record a false passing research gate, reclassify the work to avoid its requirements, or borrow another item's baseline. Seek the supported governed disposition of this mismatch and retain the exact issuer response if it cannot express qualification-only work.

Design capture, scope and impact are recorded. Implementation admission, the controlled experiment, product repair, canonical runtime verification and original cancellation acceptance are **UNRUN**.
