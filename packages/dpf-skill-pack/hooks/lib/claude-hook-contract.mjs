// packages/dpf-skill-pack/hooks/lib/claude-hook-contract.mjs
//
// The output contract a Claude Code host enforces on a PreToolUse deny
// (BI-E5C45F61). Observed on Claude Code 2.1.295 in the desktop app 2.31226.1:
// the host validates the hook's JSON, accepts a top-level `decision` only as the
// legacy "approve" | "block", and on any violation DISCARDS the whole output and
// logs a non-blocking error, so the tool call runs. A deny must therefore travel
// only in hookSpecificOutput.permissionDecision.

const LEGACY_TOP_LEVEL_DECISIONS = new Set(["approve", "block"]);

/**
 * Why `stdout` would not deny on a Claude host, or null when it would.
 * @param {string} stdout
 * @returns {string|null}
 */
export function claudeDenyProblem(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return "no output (the guard allowed the probe or exited before deciding)";
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    return "output is not JSON, so the host ignores it";
  }
  if (!out || typeof out !== "object") return "output is not a JSON object";
  if ("decision" in out && !LEGACY_TOP_LEVEL_DECISIONS.has(out.decision)) {
    return `top-level decision "${out.decision}" fails the host's output validation (approve|block only), so the host discards the deny`;
  }
  const specific = out.hookSpecificOutput;
  if (!specific || specific.hookEventName !== "PreToolUse" || specific.permissionDecision !== "deny") {
    return "no hookSpecificOutput.permissionDecision \"deny\" for PreToolUse";
  }
  return null;
}
