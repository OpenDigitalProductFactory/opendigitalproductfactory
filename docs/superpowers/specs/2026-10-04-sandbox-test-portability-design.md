---
status: active
---

# Sandbox Git test portability

Backlog: BI-8E7E9B7C. Epic: EP-BAE79FBD.

## Problem and boundary

Seven assertions in four build test files fail on Windows because fixtures mix
native paths with POSIX shell input, invoke Unix setup utilities directly, or
assume Git preserves the Unix null-device spelling. Shared gate evidence
`cmuukm3b31we801n1cdhhl028` and a local 7-fail/53-pass reproduction establish the
defect. This blocks BI-9369DEB5 and the remaining BI-B986A18B OAuth acceptance.

Only test fixtures change. Production sandbox commands, authorization, database
state, leases and release gates remain unchanged. No migration is required.

## Design and implementation sequence

1. Reproduce the four suites on Windows before editing.
2. Run generated POSIX commands with a native child-process working directory
   and a relative `.` workspace. This avoids shell interpretation of native paths.
3. Create directories and set modification times with Node filesystem APIs.
   Age stale locks by thirty minutes relative to the test clock; retain a fresh
   lock and assert removal of each stale root and nested lock.
4. Normalize separators only in the mocked existence predicate. Expect the
   platform's null-device spelling from Git configuration.
5. Rerun all sixty tests, typecheck, and submit the complete candidate to the
   shared gate after its separately owned dependency repair converges.

## Acceptance

| ID | Statement |
| --- | --- |
| AC-1 | All sixty affected tests pass on Windows without skips. |
| AC-2 | Tests still execute actual Git repositories and generated shell commands. |
| AC-3 | Stale locks are removed, fresh locks retained, repository states distinguished, and only the build's own commits reported. |
| AC-4 | The complete candidate receives exact-tree shared verification before publication. |

Unix behavior retains the same shell commands and filesystem outcomes. This is
a fixture repair, not a change to supported sandbox workspace paths. It does not
repair the separate JSDOM dependency mismatch or mark OAuth acceptance complete.

## Verification

The local source checkpoint changed from seven failed and fifty-three passed
to sixty passed. Runtime delivery and the shared gate remain pending. No local
test result substitutes for those obligations.
