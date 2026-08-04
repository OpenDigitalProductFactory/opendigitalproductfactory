// packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs
//
// Closed allowlist for Local-CI-Override / push-time skipReason (BI-563F6AB6).
// Shared by pr:health, pre-push-gate, and PreToolUse pregate-evidence-guard so
// free-text "unit tests only" cannot green-wash a skipped sandbox run.

/**
 * Format accepted: `<code>` or `<code>: <detail>` (also `—` / `-` separators).
 * Codes are the only machine-checked part; detail is audit prose.
 */
export const LOCAL_CI_OVERRIDE_REASON_CODES = Object.freeze([
  "docs-adjacent",
  "delete-or-tag-only",
  "operator-emergency",
  "external-contribution-no-install",
  "install-bootstrap-recovery",
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
