---
status: active
backlog: BI-0ACB97B5
---

# Unbound delivery readiness

Owner-scoped investment delivery depends on served verification. The governed preview of commit 558d02840208c72a6e81e6a1a6bbe6d40bd37e6b refused before runtime start. Its lease was released. A read through the same configured headless credential showed all 22 tools present, token-granted and callable, with `agentGranted: null` and no denial reason. The server deliberately reports null for unbound credentials; the shared client parser currently requires a boolean.

This repair stays in the existing shared discovery reader used by bootstrap, contributor readiness and preview. Null means the coworker layer is not applicable, never that a grant was issued. Each tool must still have exactly one row, server presence, token permission and explicit server callability. Explicit coworker denial, missing/undefined/malformed evidence, role or clearance refusal and duplicate rows remain refusals. Server authorization, credentials, scope and grants remain unchanged.

Implement after the active immutable gate finishes. Write failing regressions in the existing bootstrap and preview consumer tests, then accept exactly true or null for the coworker field while requiring explicit callability. Exercise both bound success and unbound RPC-envelope success, token/server/callability denials, inconsistent explicit coworker denial, missing and duplicate evidence. Run the preview consumer, bootstrap readiness and web contributor-readiness checks. Commit with DCO, obtain independent review, then rerun canonical CI and the admitted preview. Never use a synthesized discovery response to start a runtime.

Acceptance requires an executed served verification on the admitted source commit. A parser test does not establish runtime readiness or feature delivery. This is a bounded delivery prerequisite under BI-0ACB97B5 / WC-B5D4B788, not a new authorization system.
