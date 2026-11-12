---
status: active
date: 2026-11-11
backlog: BI-5B80D52F
---

# Keep unreadable PR evidence out of READY

BI-5B80D52F; WC-4227FD80. This small fix repairs the existing CLI observation
boundary, following the [PR Health contract](../../testing/pr-health.md).

## Reproduction and research

On commit `4a2dbd9e00701b66e20cd92d3edf869c818c2afa`,
`scripts/pr-health.mjs` accepts any failed checks command's stdout, interprets
empty or malformed check output as an empty successful list, and catches review
thread failures as an empty list. It reads only the first 100 review threads.

Actual CLI probes used temporary Node preload fixtures that intercept only
`gh` execution. No GitHub request, credential or tracked source edit occurred.
Eight intended UNREADABLE/3 cases returned false READY/0: checks transport,
malformed JSON, empty output; threads transport, GraphQL errors, malformed JSON,
null pull request and incomplete pagination. Valid empty JSON returned READY/0;
JSON-bearing nonzero failed-check output returned FAILED/1. Evidence:
cmwcrugsv3kux0emfzec51f0f. The existing pure harness passed 50 tests before edits
(cmwcrxg0t3m0d0emfgdmrhwwe); those tests do not cover this CLI I/O defect.

The source graph is available but links no tests to this script. The existing
Node harness is the test home. Inspect its verdict, attestation and wait controls
alongside CLI probes rather than replacing its existing coverage.

Rejected: treating absent output as success; requiring a nonzero check count;
manufacturing status checks or weakening queue policy. Chosen: validate complete
structured observations and preserve genuine failed/pending check responses.

Installed `gh pr checks --help` documents buckets pass/fail/pending/skipping/
cancel and pending exit 8. `gh api --help` documents native GraphQL pagination
using `$endCursor`, pageInfo and `--paginate --slurp`. Reuse that supported
pagination instead of adding another client or silently ignoring later pages.

## Objective and acceptance

OBJ-READABLE: a contributor receives READY only from successfully observed
checks and complete review-thread evidence, while real PR verdicts retain
their documented meaning.

| Acceptance | Statement |
| --- | --- |
| AC-1 | Transport, missing/invalid JSON, GraphQL errors and incomplete observations return UNREADABLE/3, including wait mode. |
| AC-2 | A valid observed empty check/thread result can still be READY; JSON-bearing genuine failed and pending check responses preserve FAILED/1 and WAITING/75. |
| AC-3 | All returned review-thread pages are validated; an unresolved thread after the first page blocks readiness. Partial/error pages cannot become an empty successful result. |
| AC-4 | Existing merged, conflict, draft, attestation, failure precedence and bounded wait contracts remain intact. |
| AC-5 | Meaningful CLI regression tests fail before the fix and pass afterward; normal source checks, independent review and protected publication remain required. |

## Contract and flow

C-OBSERVATION: a successful observation is a valid checks array with supported
buckets and a complete, error-free review-thread page collection with explicit
resolution states. Nonzero checks output is usable only for its documented
failed/pending outcome, never as a transport-error fallback.

F-READ: existing gh invocation → strict structured validation → existing
evaluatePrHealth/report. An unavailable required observation reaches the
existing UNREADABLE exit path. ETA history stays best-effort and does not grant
readiness. No new service, status publisher, permission or merge authority.

Authoritative GitHub metadata saying MERGED is terminal, not a READY assertion:
return its existing exit0 without unnecessary check/thread reads and explicitly
report those observations as not read, rather than fabricated zero counts.
Independent client review of ffe62 found this AC-4 compatibility edge; retain its
finding and add merged-with-unreadable checks/threads regressions before repair.

## Ordered fix and verification

1. V-RED: extend the existing Node harness with real CLI/subprocess fixtures for
   the eight observed failures, malformed rows/unknown buckets, failed/pending
   nonzero output, complete empty results, later-page unresolved threads and
   wait-mode read failure. Confirm the intended failures on unchanged source.
2. Repair the existing gh/check/thread boundaries with strict validation and
   supported native pagination. Preserve pure verdict logic and all normal
   attestation, publication and merge protections.
3. V-GREEN: run the complete existing/added Node harness, affected caller guards
   and proportional gate context. Update the PR Health guide with observation
   requirements and accurately describe the new controlled CLI fixtures.
4. V-DELIVERY: freeze a signed clean commit; normal canonical checks, first
   independent review for that identity and protected PR/queue. Validate the
   delivered CLI against controlled fixtures and actual read-only PR evidence;
   record unavailable network/runtime checks as unrun.

## Coverage and boundaries

Two separately tracked deliverables share this verification delivery:

| Key | Backlog | Contract and verification |
| --- | --- | --- |
| observation | BI-5B80D52F | C-OBSERVATION, F-READ, V-RED, V-GREEN, V-DELIVERY; strict readable evidence and native pagination. |
| fixture-paths | BI-D96C01CC | Native absolute/canonical fixture paths; real caller tests retain all qualification controls. |

The caller suite found two independent baseline failures, both reproduced with
unchanged `4a2dbd9e` production source: a literal `D:/repo` fixture is not absolute
on macOS; the actual source Vitest 5.0.5 root resolves `/var` to `/private/var`
while the supplied absolute test filter does not. The latter reports no tests;
the same real fixture using a canonical path executed one test successfully.
Neither is attributed to the observation repair.

Ordered fixture repair, before changing those files: preserve the baseline
failures; use a host-native absolute synthetic root in
`scripts/pr-readiness.test.mjs` and `realpathSync` on the created temporary
directory in `scripts/published-correction.test.mjs`; rerun the exact failures
and full caller suite. Preserve the path-with-space, actual runner, old-report
negative control, report identity and cleanup assertions. No production guard
is relaxed. Normal path claims for both files succeeded; no owner override.

The fixture deliverable is independently shippable and does not depend on the
observation parser. It is batched to restore this delivery's affected
verification, with its own BI and evidence. Formal decomposed coverage and
research receipts remain pending immutable source publication. This design
does not itself admit implementation or replace the recorded outage procedure.

No schema, production data, provider, credential, network, grant or branch
protection change. The active install transition held initial path enrollment;
source stayed untouched until its terminal failure and a normal claim succeeded.
Current host transport failures remain separate from this parser defect.

Strict validation may reveal unreadable results that previously appeared ready.
That is an honest missing observation, not a product test failure or authority
to bypass checks. Preserve errors and resume normal reads after recovery.
Revert only through ordinary signed protected delivery if needed.
