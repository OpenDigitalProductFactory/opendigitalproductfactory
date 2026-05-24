/**
 * DO NOT MERGE — definition-of-done acceptance demo for the gitleaks gate.
 *
 * Previous attempt used AKIAIOSFODNN7EXAMPLE — AWS's canonical doc example,
 * which gitleaks default config explicitly allowlists. The allowlist is
 * correct behavior (prevents false positives in docs/fixtures); the demo
 * just picked a bad value.
 *
 * This revision uses a synthetic-but-not-allowlisted AKIA-format string
 * and a synthetic GitHub PAT-format string. Both should match gitleaks'
 * aws-access-token + github-pat rules and trip the gate.
 *
 * Will be closed without merging once captured.
 */

// aws-access-token: regex \b((?:AKIA|ABIA|ACCA)[A-Z0-9]{16})\b
// 16 chars after AKIA, none matching the documented-example allowlist.
export const FAKE_AWS_ACCESS_KEY_ID = "AKIAZZQ9PLMNT4XYRSVB";

// github-pat: prefix `ghp_` + 36 chars of [a-zA-Z0-9].
export const FAKE_GITHUB_PAT = "ghp_aB3kLpQrS5tUvW7xY9zA1bC2dE4fG6hI8jK0";
