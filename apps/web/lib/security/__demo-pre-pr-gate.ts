/**
 * DO NOT MERGE — pre-PR Semgrep gate acceptance demonstration.
 *
 * First version of this file used patterns like eval(payload) where the
 * input was just a function parameter. Semgrep's standard rulesets did not
 * catch any of them because their taint rules require recognised SOURCES
 * (req.body, process.env, URL, etc.) — a bare `string` parameter isn't a
 * source. That's a meaningful finding: the gate does NOT catch arbitrary
 * sink usage without an upstream taint source.
 *
 * This revision uses patterns Semgrep catches without taint flow:
 *
 *   1. Hardcoded AWS-style credential → p/secrets, pure pattern match.
 *   2. Math.random() for security token → p/security-audit, pure pattern.
 *   3. (Optional) eval() with a Next.js route req.body source → taint flow.
 *
 * Expected outcome: Semgrep Scan check FAILS with at least 2 ERROR/WARNING
 * findings. Captured for the spec definition-of-done writeup. Branch closed
 * without merging.
 */

// 1. Hardcoded AWS access key — universally caught by p/secrets ruleset.
// Format matches AWS's documented example key from their docs.
export const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
export const AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

// 2. Math.random() generating a security-sensitive token — caught by
// javascript.lang.security.audit.math-random-security.
export function makeSessionToken(): string {
  return Math.random().toString(36).slice(2);
}

export function makePasswordResetToken(): string {
  // Even more obviously security-sensitive.
  return `reset-${Math.random()}-${Math.random()}`;
}

// 3. eval() with a string source labeled as user input (no real taint
// source available in a non-route file, but the literal name helps some
// rules pattern-match without flow analysis).
export function unsafeEval(userSubmittedExpression: string): unknown {
  // eslint-disable-next-line no-eval
  return eval(userSubmittedExpression);
}
