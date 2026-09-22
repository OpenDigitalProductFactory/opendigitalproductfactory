// packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs
//
// Closed allowlist for Local-CI-Override / push-time skipReason (BI-563F6AB6).
// Shared by pr:health, pre-push-gate, and PreToolUse pregate-evidence-guard so
// free-text "unit tests only" cannot green-wash a skipped sandbox run.

/**
 * Format accepted: `<code>` or `<code>: <detail>` (also `—` / `-` separators).
 * Codes are the only machine-checked part; detail is audit prose.
 */
/**
 * BI-02E5F2A1 (DI-FC5699629694): the one code the pre-push hook accepts ONLY
 * when it has itself captured machine evidence that the gate's infrastructure
 * failed — a re-attempted local-CI lease claim that came back unauthorized,
 * unreachable or server-errored. Prose in the reason is never that evidence,
 * and the record it produces is gate-UNRUN, never a pass.
 */
export const GATE_INFRASTRUCTURE_UNAVAILABLE_CODE = "gate-infrastructure-unavailable";

/** Failure classes the probe may record as infrastructure evidence. */
export const GATE_INFRASTRUCTURE_FAILURE_KINDS = Object.freeze([
  "credential-rejected",
  "transport-unreachable",
  "server-error",
]);

export const LOCAL_CI_OVERRIDE_REASON_CODES = Object.freeze([
  "docs-adjacent",
  "delete-or-tag-only",
  "operator-emergency",
  "external-contribution-no-install",
  "install-bootstrap-recovery",
  GATE_INFRASTRUCTURE_UNAVAILABLE_CODE,
]);

const LOCAL_CI_OVERRIDE_CODE_SET = new Set(LOCAL_CI_OVERRIDE_REASON_CODES);

/**
 * @param {string | null | undefined} value
 * @returns {{ ok: true, code: string, detail: string } | { ok: false, reason: string }}
 */
export function classifyLocalCiOverride(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return {
      ok: false,
      reason:
        "empty Local-CI-Override — use a closed reason code " +
        `(one of: ${LOCAL_CI_OVERRIDE_REASON_CODES.join(", ")})`,
    };
  }
  const match = raw.match(/^([a-z0-9-]+)(?:\s*[:—\-]\s*(.*))?$/i);
  if (!match) {
    return {
      ok: false,
      reason:
        `Local-CI-Override must start with a closed reason code ` +
        `(got ${JSON.stringify(raw)}); allowed: ${LOCAL_CI_OVERRIDE_REASON_CODES.join(", ")}`,
    };
  }
  const code = match[1].toLowerCase();
  const detail = (match[2] ?? "").trim();
  if (!LOCAL_CI_OVERRIDE_CODE_SET.has(code)) {
    return {
      ok: false,
      reason:
        `Local-CI-Override code ${JSON.stringify(code)} is not allowlisted — ` +
        `allowed: ${LOCAL_CI_OVERRIDE_REASON_CODES.join(", ")}. ` +
        `Free-text alone (e.g. "unit tests only") is not an override.`,
    };
  }
  return { ok: true, code, detail };
}

/**
 * Is a recorded `gate-infrastructure-unavailable` skip backed by the machine
 * evidence the hook's probe writes? A record carrying the code without a
 * captured failure response is a prose override wearing the wrong code, and
 * every reader (pr:health, the PreToolUse guard) treats it as a blocker.
 *
 * @param {unknown} evidence — the `infrastructureEvidence` field of a gate record
 * @returns {{ ok: true, kind: string, message: string } | { ok: false, reason: string }}
 */
export function classifyGateInfrastructureEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") {
    return {
      ok: false,
      reason:
        `${GATE_INFRASTRUCTURE_UNAVAILABLE_CODE} requires machine-captured evidence ` +
        "(the hook's re-attempted lease claim and its failure response); the record carries none — " +
        "prose in the reason is not evidence",
    };
  }
  const kind = typeof evidence.kind === "string" ? evidence.kind : "";
  const message = typeof evidence.message === "string" ? evidence.message.trim() : "";
  if (!GATE_INFRASTRUCTURE_FAILURE_KINDS.includes(kind)) {
    return {
      ok: false,
      reason:
        `${GATE_INFRASTRUCTURE_UNAVAILABLE_CODE} evidence kind ${JSON.stringify(kind)} is not a ` +
        `recognised infrastructure failure (one of: ${GATE_INFRASTRUCTURE_FAILURE_KINDS.join(", ")})`,
    };
  }
  if (evidence.tool !== "claim_nonprod_environment_lease" || !message) {
    return {
      ok: false,
      reason:
        `${GATE_INFRASTRUCTURE_UNAVAILABLE_CODE} evidence must name the re-attempted lease claim ` +
        "and carry its failure response",
    };
  }
  return { ok: true, kind, message };
}
