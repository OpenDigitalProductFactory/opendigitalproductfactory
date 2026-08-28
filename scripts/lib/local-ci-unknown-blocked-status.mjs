// scripts/lib/local-ci-unknown-blocked-status.mjs
//
// BI-BC57E1AC — the local-CI client ships blocked_* statuses ahead of the
// deployed portal. record_local_integration_result rejects an unknown status
// with invalid_status and the run records nothing. The only prior compatibility
// fallback was blocked_sandbox_drift; blocked_child_signal_death fell in the
// hole and dropped 25,553 green tests with no evidence row.
//
// Any blocked_* rejected as invalid_status is re-recorded as failed with an
// infrastructure marker so the two load-bearing facts survive: the run produced
// no product evidence, and the reason was infrastructure. Expanding the portal
// enum is a separate item (BI-C59AC8AF / BI-E2366B3B).

/**
 * True when the portal refused a blocked_* status it has not learned yet.
 * A successful write, a non-invalid_status error, or a non-blocked outcome
 * must not take this path.
 */
export function shouldFallbackUnknownBlockedStatus({
  outcomeStatus,
  evidenceSuccess,
  evidenceError,
} = {}) {
  if (evidenceSuccess === true) return false;
  if (evidenceError !== "invalid_status") return false;
  return typeof outcomeStatus === "string" && outcomeStatus.startsWith("blocked_");
}

/**
 * Rewrite a rejected blocked_* evidence payload as a failed record that still
 * names the infrastructure cause. The original summary is preserved after the
 * marker so a later reader can see what happened.
 */
export function fallbackUnknownBlockedEvidence(evidenceArgs, outcomeStatus) {
  const summary = String(evidenceArgs?.summary ?? "");
  return {
    ...evidenceArgs,
    status: "failed",
    summary: `[${outcomeStatus} — not product evidence] ${summary}`.trim(),
  };
}
