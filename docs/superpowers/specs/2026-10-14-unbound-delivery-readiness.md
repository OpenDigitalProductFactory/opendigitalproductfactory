---
status: active
backlog: BI-0ACB97B5
---

# Unbound delivery readiness

Owner-scoped investment delivery depends on served verification. The governed preview of commit 558d02840208c72a6e81e6a1a6bbe6d40bd37e6b refused before runtime start. Its lease was released. A read through the same configured headless credential showed all 22 tools present, token-granted and callable, with `agentGranted: null` and no denial reason. The server deliberately reports null for unbound credentials; the shared client parser currently requires a boolean.

This repair stays in the existing shared discovery reader used by bootstrap, contributor readiness and preview. Null means the coworker layer is not applicable, never that a grant was issued. Each tool must still have exactly one row, server presence, token permission and explicit server callability. Explicit coworker denial, missing/undefined/malformed evidence, role or clearance refusal and duplicate rows remain refusals. Server authorization, credentials, scope and grants remain unchanged.

Implement after the active immutable gate finishes. Write failing regressions in the existing bootstrap and preview consumer tests, then accept exactly true or null for the coworker field while requiring explicit callability. Exercise both bound success and unbound RPC-envelope success, token/server/callability denials, inconsistent explicit coworker denial, missing and duplicate evidence. Run the preview consumer, bootstrap readiness and web contributor-readiness checks. Commit with DCO, obtain independent review, then rerun canonical CI and the admitted preview. Never use a synthesized discovery response to start a runtime.

Acceptance requires an executed served verification on the admitted source commit. A parser test does not establish runtime readiness or feature delivery. This is a bounded delivery prerequisite under BI-0ACB97B5 / WC-B5D4B788, not a new authorization system.

The same preview boundary compares the server's forward-slash worktree spelling with native `realpath()` output. On Windows these can identify the same checkout but compare unequal. Resolve a nonempty absolute admitted path through the filesystem before comparing it with the already-canonical worktree. Missing, relative, different and unresolvable paths still refuse before Compose configuration or runtime mutation. Cover equivalent slash spellings and each refusal using temporary filesystem fixtures. Preserve lease, owner, source, branch, URL, purpose, status and expiry checks.

## Retain safe failure diagnostics

Preview NPEL-BD8AD572B1 initialized a sanitized clone but failed before serving. Its last successful heartbeat was at 10:30:03 UTC, its expiry at 10:32:03, and its owned release at 10:32:01. The launcher reported only `preview_operation_failed`; it discarded the operation exit code and lease-supervisor events. Those records do not establish the cause. The canonical upgrade started at 10:33:28, after this release.

Retain the numeric child exit code or termination classification, without command arguments, stdout or stderr. Report only selected lease-failure event types and fixed categories for authority deadline, source binding, transport timeout, connection and invalid response. Arbitrary reasons remain unclassified. Test child stdout/stderr suppression and reason redaction before another admitted preview. This repair changes diagnostics only; source identity, authorization, deadlines, renewal, protected services and owned cleanup stay enforced.

## Consume a queued preview

NPEL-FAF1C8E904 never reached admission. Its durable task updated repeatedly, but its lease heartbeat stayed at 10:43:37 UTC. Reconciliation expired it at 11:12:19 despite a 12:43:35 wait deadline. The existing ten-minute abandoned-waiter rule judged that stale heartbeat. The shell queued branch named a durable task and exited without the consumer already used by local CI and host-resource admission.

On a queued refresh, register that existing resumer and observer rather than changing admission or abandonment policy. Pin worktree, branch, source SHA, provider/session, original lease, task, claim key and wait deadline. Each registered attempt checks clean immutable source before invoking the same preview shell with the same resume lease and task. The shell rechecks the pinned SHA, branch and clean state immediately before claiming. Queued attempts return the shared exit-75 contract; the resume marker prevents a second consumer. Expired waits and changed source stop without new claims or runtime mutation. A standalone claim does not start a preview. Preserve authorization, FIFO, deadlines, cancellation and owned cleanup. Tests must cover registration, recursion prevention, admitted results, expired/disabled waits, secret-safe diagnostics and the real shell's drift refusals, including a branch move at the same SHA and a newly dirty checkout.

Keep these cases in the existing CI-registered preview policy suite. Preflight on fe478c1cc318f6079d8a62db25cdf431281a7b6b passed 83 of 84 checks but refused the separate unregistered queue test file. Move its cases into the registered suite without an inventory exemption or a policy-file ownership override.

## Bound the renewal response budget

Preview NPEL-77B5098CA5 reached 5,186,500 of 6,238,025 telemetry rows before repeated transport timeouts and an authority-deadline fence stopped initialization. The lease was released. Its final successful server heartbeat was 12:13:17 UTC with expiry 12:15:17; audited successful renewal executions took about one second. This proves transport uncertainty followed by deadline termination, not where the response path spent its time.

The preview caller inherited the generic ten-second MCP timeout. Give only renewal a thirty-second response budget. Keep the two-minute lease grant, cadence, uncertainty retry, last acknowledged expiry, safety margin and termination behavior unchanged. Other MCP calls retain their existing timeout. A real loopback server delaying its reply eleven seconds reproduces the old timeout and must pass with the bounded renewal budget. Existing repeated-uncertainty and refusal tests must still prove fencing. Served verification remains outstanding until another admitted preview actually completes initialization.
