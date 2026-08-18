// MCP protocol version window — Simplify & Strengthen W12 mechanics
// (BI-EE64547B, §3.4-mcp move #6a; home epic EP-E1F1DB58).
//
// THE single declared home for every protocol revision the `/api/mcp/v1`
// transport advertises. The stated policy (operator-directed, 2026-08-16
// architecture pass) is a **current + one-previous (N/N-1) version window**
// for external clients; revisions outside the window are grandfathered only
// until the operator ratifies their retirement. A guard
// (scripts/check-no-adhoc-mcp-protocol-versions.mjs) asserts the transport's
// advertised set is exactly WINDOW ∪ GRANDFATHERED and that no other module
// declares its own revision list — so adding or removing a revision is always
// an edit to this governed constant, never an ad-hoc route change.
//
// Scope: this module governs what the DPF **server** transport advertises.
// Outbound MCP *client* probes to third-party servers (lib/tak/
// mcp-server-health.ts) pin their own wire version and are not in scope.
//
// Retirement state: `2025-03-26` and `2024-11-05` are OUTSIDE the N/N-1
// window and are flagged for retirement. They remain advertised (and
// `2024-11-05` remains the pre-window fallback) because retirement is
// operator-ratified, not code-initiated — see the decision brief at
// docs/superpowers/specs/2026-08-16-mcp-version-window-contract-brief.md.
// Do NOT drop them here before that ratification is recorded.

/**
 * The N/N-1 policy window: the newest MCP protocol revision the transport
 * speaks, plus one previous. Exactly two entries, newest first — the guard
 * enforces both properties.
 */
export const MCP_VERSION_WINDOW = Object.freeze([
  "2025-11-25",
  "2025-06-18",
] as const);

/**
 * Revisions the transport still speaks OUTSIDE the window, pending
 * operator-ratified retirement. Explicitly listed so a future revision can
 * never silently ride along: this set may only shrink (to empty) as
 * retirements are ratified, never grow.
 */
export const MCP_GRANDFATHERED_PROTOCOL_VERSIONS = Object.freeze([
  "2025-03-26",
  "2024-11-05",
] as const);

/** The newest revision — what new integrations should negotiate. */
export const MCP_CURRENT_PROTOCOL_VERSION = MCP_VERSION_WINDOW[0];

/**
 * Everything the transport advertises today: the window plus the
 * grandfathered set, newest first. This is the ONLY list negotiation may
 * consume. Include every wire revision clients actually send — Grok Build
 * 1.0.0 negotiates `2025-06-18` and re-sends it as `MCP-Protocol-Version`
 * on tools/list; omitting it made initialize fall back but then 400'd
 * subsequent calls.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  ...MCP_VERSION_WINDOW,
  ...MCP_GRANDFATHERED_PROTOCOL_VERSIONS,
] as const);

/**
 * What a client that requests an unknown (or no) version is negotiated down
 * to. Stays the oldest grandfathered revision until the operator ratifies
 * retirement; the ratification brief proposes moving this to the window
 * floor (`MCP_VERSION_WINDOW[1]`) in the same change that retires
 * `2024-11-05`.
 */
export const FALLBACK_PROTOCOL_VERSION = "2024-11-05";
