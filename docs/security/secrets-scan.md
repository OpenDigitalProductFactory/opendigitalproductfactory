# Secrets scan — pre-PR gate (gitleaks)

Companion to the [CodeQL inflow gate](README.md). gitleaks runs on every
pull request against `main` and on pushes to `main`, blocking the PR if
it detects a secret in the diff.

## Why gitleaks (and not Semgrep)

The previous workflow used Semgrep, but its richer rule registry requires
signing up for the semgrep.dev AppSec Platform — a third-party account
DPF should not require. Demo PRs #1061 and #1066 also showed that
Semgrep's unauthenticated community ruleset missed hardcoded AWS keys
(`AKIAIOSFODNN7EXAMPLE`), `Math.random()` for security tokens, and
`eval()`. gitleaks is purpose-built for secret detection, MIT-licensed,
ships its rules in-binary, and runs with no external accounts.

For non-secret code patterns (logic bugs, taint flow, framework
anti-patterns), the coverage story is:

| Tool | Scope | Trigger |
|---|---|---|
| **gitleaks** (this workflow) | Hardcoded credentials, tokens, keys | Every PR |
| **CodeQL** ([`codeql.yml`](../../.github/workflows/codeql.yml)) | Code patterns, dataflow, framework rules | Every PR |
| **CodeQL inflow gate** ([`security-inflow-gate.yml`](../../.github/workflows/security-inflow-gate.yml)) | Diff vs baseline (blocks NEW alerts) | After CodeQL completes |
| **Per-domain audit scripts** (`audit-*.yml`) | Routing invariants, coworker grants, etc. | Every PR |

## What gitleaks catches

In-binary ruleset covers ~150 known secret formats including:

- AWS access keys + secret keys
- GitHub tokens (PAT, fine-grained, GitHub Apps)
- GCP service account keys
- Azure storage keys, connection strings
- Stripe / Twilio / Slack / Sendgrid / Mailgun API keys
- Private keys (PEM, OpenSSH, PGP)
- Generic high-entropy strings flagged in token/secret/key/password contexts

Full rule list: <https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml>.

## Run locally

```bash
# Install (macOS / Linux via brew):
brew install gitleaks

# Or grab the binary from a release tag:
#   https://github.com/gitleaks/gitleaks/releases

# Scan the current branch's diff against main:
gitleaks detect \
  --source=. \
  --log-opts="$(git merge-base HEAD origin/main)..HEAD" \
  --redact \
  --verbose
```

Exit code is 1 if a secret was detected, 0 if clean.

## Suppressing a finding

If a finding is a true false positive (test fixture, example value in
docs, etc.), the canonical suppression is an in-line comment on the line
of the detection:

```ts
const exampleKey = "AKIAIOSFODNN7EXAMPLE"; // gitleaks:allow — AWS docs canonical example, not a real credential
```

Required form:

- `gitleaks:allow` token
- An em-dash `—` followed by a one-line justification

Suppressions without a justification fail review.

For repo-wide rule exceptions (e.g. "ignore the entire `tests/fixtures/`
directory because it's deliberate test data"), drop a `.gitleaksignore`
file at the repo root with paths or fingerprints. Each entry needs a
comment justifying it.

## Dismissing in GitHub Code Scanning

For findings surfaced via SARIF upload to the Code Scanning UI:

1. Open the alert in **Security → Code scanning**.
2. Dismiss with one of: `false positive`, `won't fix`, `used in tests`.
3. **Required:** add a justification comment citing a kernel principle
   from [`docs/founder-kernel/wiki/principles/`](../founder-kernel/wiki/principles/),
   a tracked BI/Epic, or the PR that explains why the value is safe.

A reviewer for the next PR in the affected area is expected to verify
the dismissal makes sense. Dismissals without justification are
reverted.

## If gitleaks flags a real secret

The leak is already in git history at that point. Rotation is required:

1. Rotate the credential at the upstream provider **immediately**. The
   commit is in git history forever; treat the secret as compromised.
2. Push a follow-up commit removing the literal value (replace with
   `process.env.VAR` or similar).
3. Re-run gitleaks to confirm the gate clears.
4. Do NOT rewrite git history (force-push) to "hide" the original
   commit. The leak already happened; obscuring it makes incident
   forensics harder and tells nobody it occurred.

## Expected runtime

PR diff scans finish in seconds. Full-tree scans on `push` to main
typically take under 30 seconds.

## Workflow guarantees

`.github/workflows/secrets-scan.yml`:

- Runs on `pull_request` to `main` and `push` to `main`.
- Diff-scans on PRs (commit range from PR base..head); full-tree scans
  on push and manual dispatch.
- Skips Dependabot PRs (covered by the post-merge `push` trigger).
- Uploads SARIF to GitHub Code Scanning so findings appear inline on
  the PR Files tab and Security tab.
- Blocks merge on any detected secret.
- Pins the gitleaks version (`GITLEAKS_VERSION` env in the workflow);
  Dependabot/Renovate tracks bumps via plain-text version updates if
  configured, or by editing the workflow directly.
