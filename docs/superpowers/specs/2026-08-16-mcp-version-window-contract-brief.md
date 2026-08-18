# MCP protocol version window — operator ratification brief

**Status:** draft, operator-ratification-required
**Date:** 2026-08-16 (mechanics landed 2026-08-18)
**Scope:** the `/api/mcp/v1` server transport (what DPF advertises to MCP clients). Outbound MCP client probes to third-party servers (`apps/web/lib/tak/mcp-server-health.ts`) pin their own wire version and are out of scope.
**Origin:** 2026-08-16 architecture pass §3.4-mcp, move #6a (operator-directed); home epic EP-E1F1DB58; W12 of the Simplify & Strengthen program (BI-EE64547B).

## What this brief asks the operator to decide

Two decisions, separable:

1. **Ratify the N/N-1 version-window contract** (§Proposed contract text below) into the [MCP authorization runbook](../../architecture/mcp-tool-authorization-runbook.md), making version retirement a governed procedure instead of an ad-hoc code edit.
2. **Ratify (or defer) the retirement of the grandfathered revisions** — `2024-11-05` and `2025-03-26` — under that contract, after the observability soak described in §Retirement procedure.

Nothing is retired by this brief. The mechanics that make the decision cheap are already landed and guard-enforced:

- `apps/web/lib/mcp/protocol-versions.ts` — the single governed constant: `MCP_VERSION_WINDOW = ["2025-11-25", "2025-06-18"]` (current + one previous) plus `MCP_GRANDFATHERED_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"]` (retirement-flagged, still advertised). Negotiation consumes only their union.
- `scripts/check-no-adhoc-mcp-protocol-versions.mjs` — CI refuses a third window entry, any growth of the grandfathered set, a fallback outside the advertised union, and any protocol-revision literal reappearing on the transport route.

## Current live state (validated against code, 2026-08-18)

The transport advertises **four** revisions (the architecture pass's "three" predates the Grok fix): `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. `FALLBACK_PROTOCOL_VERSION` is `2024-11-05`: a client that requests an unknown — or no — `protocolVersion` at initialize is negotiated down to it. A non-initialize request carrying an unsupported `MCP-Protocol-Version` header is a 400. The Tasks capability is only advertised on `2025-11-25`, so nothing below the window head has Tasks today.

## Proposed contract text for the MCP authorization runbook

> **Protocol version window (N/N-1).** The `/api/mcp/v1` transport supports the newest MCP protocol revision it has adopted plus one previous revision. The window is declared in `apps/web/lib/mcp/protocol-versions.ts` and enforced by `scripts/check-no-adhoc-mcp-protocol-versions.mjs`; the negotiation path consumes no other list. Adopting a new revision shifts the window (the old N becomes N-1; the old N-1 becomes retirement-flagged). Revisions outside the window survive only as explicitly-listed grandfathered entries, each with an open retirement decision; the grandfathered set may only shrink, and only by operator ratification recorded against this runbook. Internal AI-coworker surfaces (the `x-mcp-session` seam) are per-call stateless and always current-revision-capable; the window exists for external clients that have not adopted stateless MCP.

## Retirement procedure (proposed)

1. **Measure.** Add per-revision negotiation observability before any retirement: count `initialize` negotiations and `MCP-Protocol-Version` headers by revision and `callerClient` (the User-Agent product token already derived for the decision ledger). No such metric exists today — this is the one precondition that is not yet built.
2. **Soak.** 30 days of counts on the live install. A revision with zero external negotiations is retirement-safe; nonzero counts name the client to migrate first.
3. **Ratify.** Operator records the decision here (this brief moves to `ratified`); the change shrinks `MCP_GRANDFATHERED_PROTOCOL_VERSIONS` and the guard's `FROZEN_GRANDFATHERED_SET` in the same commit, and moves `FALLBACK_PROTOCOL_VERSION` to the window floor (`2025-06-18`).
4. **Verify.** Run the operator conformance probe (`scripts/mcp-progressive-disclosure-conformance.mjs`) against a nonproduction URL, then watch the transport's 400 rate for a regression window.

## What retiring `2024-11-05` breaks

Enumerated from code and config; no external client in this repo pins `2024-11-05` explicitly — its load-bearing role is the **fallback**:

- **Unknown-version clients.** Any client whose `initialize` omits `protocolVersion` or requests one we do not speak is today negotiated down to `2024-11-05` and proceeds. After retirement the fallback returns `2025-06-18`; a client that genuinely cannot speak it must disconnect (spec behavior). Old MCP SDK builds and minimal generic clients are the population at risk — the soak metric exists to size it.
- **Header-pinned stragglers.** A non-initialize request re-sending `MCP-Protocol-Version: 2024-11-05` becomes a 400 (`unsupported MCP-Protocol-Version`), which surfaces as every call failing after a seemingly-fine connect for a client that hard-codes the header.
- **Known named clients are safe.** Claude Code negotiates `2025-11-25`; Grok Build 1.0.0 negotiates `2025-06-18` and re-sends it as a header (the reason `2025-06-18` is in the window at all); Codex host configs request the full catalog over current revisions. The internal coworker seam (`x-mcp-session`) is version-current by construction.
- **Tasks capability:** unaffected (never advertised below `2025-11-25`).

Retiring `2025-03-26` has the same shape with a smaller blast radius (it was never the fallback); the recommendation is to retire both in one ratification once the soak shows both at zero.

## Recommendation

Adopt the contract text now (decision 1 — it costs nothing and stops ad-hoc drift), build the per-revision negotiation metric, and schedule the retirement decision (decision 2) for the first review after a clean 30-day soak. Retire `2024-11-05` and `2025-03-26` together, moving the fallback to `2025-06-18`.

## Research & benchmarking

The MCP specification (2025-11-25 revision, `docs/Reference/mcp/spec/`) prescribes version negotiation as offer/echo with client disconnect on mismatch, and does not mandate a support horizon — the N/N-1 window is a DPF policy choice matching the posture of the major MCP hosts (Claude Code, Codex, VS Code ship against the newest revision and tolerate one behind). The grandfather-then-ratify pattern follows the platform's own guard-governed retirement precedent (retired-substrate guard; module-size ratchet) rather than a hard cut.
