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
