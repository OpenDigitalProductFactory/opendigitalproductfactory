/**
 * DO NOT MERGE — pre-PR Semgrep gate acceptance demonstration.
 *
 * This file deliberately introduces patterns from the categories burned
 * down in the 2026-05 sweep, to verify the new Semgrep gate (workflow
 * .github/workflows/security-scan.yml, merged in PR #1058) catches them
 * at pre-merge time instead of post-merge CodeQL.
 *
 * Categories represented:
 *   1. js/log-injection — the dominant category (77 sites closed in PR #1056).
 *      Tests whether Semgrep's standard rulesets cover the gap CodeQL flagged.
 *      If they don't, the contingency is a custom rule at
 *      .github/semgrep/dpf-patterns.yml per the spec.
 *   2. Code injection via eval() — universally caught by Semgrep's
 *      p/security-audit and p/javascript rulesets. Acts as a control:
 *      if THIS doesn't trip, the workflow itself is broken.
 *   3. SSRF — js/request-forgery (6 critical alerts closed in earlier
 *      burn-down). Tests p/owasp-top-ten + p/nextjs coverage.
 *
 * Expected outcome
 *   semgrep job FAILS on this PR with one or more ERROR/WARNING findings.
 *
 * Result will be recorded in the spec definition-of-done writeup, and this
 * branch will be closed without merging.
 */

export function demoLogInjection(userInput: string): void {
  // js/log-injection — interpolated user value into log sink.
  console.warn(`Received request from user: ${userInput}`);
  console.error(`Failure for input: ${userInput}`);
}

export function demoCodeInjection(payload: string): unknown {
  // Universal Semgrep catch — eval of non-literal.
  // eslint-disable-next-line no-eval
  return eval(payload);
}

export async function demoSsrf(targetUrl: string): Promise<Response> {
  // js/request-forgery — fetch a URL derived from user input with no
  // allowlist or scheme/host validation.
  return fetch(targetUrl);
}
