/**
 * DO NOT MERGE — definition-of-done acceptance demo for the Semgrep gate.
 *
 * Verifies that after PR #1064 wired `semgrep ci` to consume
 * SEMGREP_APP_TOKEN, the gate now catches obvious bad patterns the
 * unauthenticated community ruleset missed.
 *
 * Single-pattern test: a canonical AWS-format access key pair. If the
 * SEMGREP_APP_TOKEN secret is correctly set on the repo, p/secrets +
 * the platform secrets ruleset should flag both lines as blocking
 * findings. If it doesn't, the secret is missing or scoped wrong.
 *
 * Branch will be closed without merging once the result is captured.
 */

export const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
export const AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
