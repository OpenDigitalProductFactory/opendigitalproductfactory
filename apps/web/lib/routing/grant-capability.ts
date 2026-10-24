// apps/web/lib/routing/grant-capability.ts
// Whether a coworker's grant implies it needs a WRITE-capability MCP session
// token. Lives apart from cli-adapter so the rule can be read, tested and
// corrected without opening a 900-line adapter.

/**
 * Whether holding this grant means a coworker needs a WRITE-capability session
 * token.
 *
 * BI-69BBC446: this used to be an allowlist of write verbs, and `_review` was
 * not on it. That silently disabled every independent review gate on the
 * platform. A reviewer holding `initiative_design_review` was classified
 * read-only, minted a `read` JWT, then correctly reported its own authority as
 * "observer" and declined to record the receipt it had been dispatched to
 * record. Nothing errored. The gate simply never passed, on any install, for
 * any initiative. Auditing the catalog found 39 grants in the same position —
 * `_propose`, `_publish`, `build_phase_advance`, `entitlement_provision`,
 * `escalation_trigger`, `incident_respond` and more.
 *
 * So the default is inverted: a grant is side-effecting unless it is
 * recognisably read-only. That is the safe direction, because the scope in this
 * token cannot widen actual access — the MCP route still gates every call on
 * user capability and agent grants. An over-broad token is unused; an
 * under-broad one breaks the write with no error anywhere.
 *
 * The authoritative answer would be each tool's own `requiredCapability`, but
 * grants map to tools sparsely (`honored_by_tools` is largely empty), so this
 * stands in for it.
 */
export function isSideEffectingGrant(grant: string): boolean {
  return !READ_ONLY_GRANT_SUFFIX.test(grant);
}

/**
 * Verbs that only read. Everything else is treated as side-effecting, so this
 * list is the one that must stay accurate — adding a verb here suppresses a
 * write token, which is the failure mode BI-69BBC446 was.
 */
export const READ_ONLY_GRANT_SUFFIX =
  /_(read|list|view|search|query|inspect|export|status|check|lookup|trace|analyze|audit)$/;
