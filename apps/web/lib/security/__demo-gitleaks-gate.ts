/**
 * DO NOT MERGE — definition-of-done acceptance demo for the gitleaks gate.
 *
 * Single canonical AWS-format access key pair. If the gitleaks workflow
 * (PR #1069) is wired correctly, the Secrets Scan check on this PR will
 * FAIL with an `aws-access-token` finding (and the secret-key value
 * matching the AWS secret-access-key pattern), blocking merge.
 *
 * Will be closed without merging once the result is captured.
 */

export const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
export const AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
