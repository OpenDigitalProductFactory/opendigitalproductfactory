# Semgrep — pre-PR security scan

Companion to the [CodeQL inflow gate](README.md). Semgrep runs on every pull
request against `main` and on pushes to `main`, blocking the PR if it
introduces patterns Semgrep flags as blocking (rule metadata–driven).

## Why two scanners

CodeQL and Semgrep cover overlapping but non-identical territory:

| | CodeQL | Semgrep |
|---|---|---|
| Trigger timing | Post-merge analytical (via the inflow gate diff) | Pre-merge syntactic |
| Strength | Cross-procedural taint, framework-aware data flow | Fast pattern matching, large ruleset ecosystem |
| Sanitiser model | Custom data-extension packs only | Inline `// nosemgrep` + rule-level metadata |
| Custom rules | CodeQL packs (more work to author) | YAML rules in `.github/semgrep/` |

Keep both. Findings that one tool misses, the other often catches.

## Activating the full ruleset (one-time setup)

Without an `SEMGREP_APP_TOKEN` repo secret, `semgrep ci` runs against the
unauthenticated community registry, which loads only ~150 of ~700 rules for
TypeScript and misses common patterns (verified in demo PR #1061: hardcoded
AWS keys, `Math.random()` for tokens, and `eval()` all went undetected).

To unlock the full registry (free for open-source projects):

1. Sign in at https://semgrep.dev with the GitHub account that owns the
   repo.
2. Create a project pointing at
   `OpenDigitalProductFactory/opendigitalproductfactory`.
3. **Settings → Tokens** → generate a CI token, copy the value.
4. In the GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret**.
   - Name: `SEMGREP_APP_TOKEN`
   - Value: the token from step 3.
5. Next PR's Semgrep Scan check picks up the secret automatically; no
   workflow change needed.

The workflow degrades gracefully if the secret is absent — scans still
run, just with the limited community ruleset.

## What `semgrep ci` runs

The workflow at `.github/workflows/security-scan.yml` invokes:

```bash
semgrep ci --sarif-output=semgrep.sarif
```

With `SEMGREP_APP_TOKEN` set, this:

- Pulls the full Semgrep Registry (security-audit, language packs, OWASP,
  secrets, GitHub Actions, framework-specific) plus any custom policies
  configured at https://semgrep.dev for this project.
- Diffs against `SEMGREP_BASELINE_REF` (set to `origin/<base_ref>` on PRs)
  so only PR-introduced findings surface.
- Honors rule metadata for block-vs-audit decisions. Default-blocking
  rules block; audit-mode rules surface as warnings without failing the
  build.

DPF-specific custom rules live in `.github/semgrep/*.yml` (empty today —
populated when the platform ruleset misses a DPF-specific pattern).

## Telemetry

The workflow sets `SEMGREP_SEND_METRICS=off` to suppress anonymous CLI
usage stats. With `SEMGREP_APP_TOKEN` set, scan findings are still reported
to the Semgrep AppSec Platform dashboard — that's the point of the token.
This is metadata about *findings*, not source code; the source itself
never leaves the runner.

## Run locally

```bash
# Install once
pip install semgrep

# Authenticate (uses the same token machinery as CI; one-time)
semgrep login

# Scan the current branch's diff against main
SEMGREP_BASELINE_REF=$(git merge-base HEAD origin/main) semgrep ci
```

Without `semgrep login`, the local scan runs with the same limited
community ruleset CI does without the token.

## Suppressing a finding

If a finding is a true false positive (and you can defend that to a
reviewer):

```ts
// nosemgrep: javascript.lang.security.audit.code-string-concat-eval.code-string-concat-eval — JSON template literal, no user input
const out = `{"ok":${flag}}`;
```

Required form:

- `nosemgrep:` prefix
- Full rule ID (the part after the last `.` in Semgrep's output is enough,
  but the full ID is unambiguous and what reviewers expect)
- An em-dash `—` followed by a one-line justification

Suppressions without a justification fail review. Suppressions covering a
range of code (block-level) belong in `.github/semgrep/` as a targeted
rule exclusion with a `metadata.justification:` field, not inline.

## Dismissing a finding in GitHub Code Scanning

For findings surfaced via SARIF upload to the Code Scanning UI:

1. Open the alert in **Security → Code scanning**.
2. Dismiss with one of: `false positive`, `won't fix`, `used in tests`.
3. **Required:** add a justification comment citing either a kernel
   principle from [`docs/founder-kernel/wiki/principles/`](../founder-kernel/wiki/principles/),
   a tracked BI/Epic, or a PR that explains why the pattern is safe in
   this codebase.

The reviewer for the next PR in the affected area is expected to verify
the dismissal makes sense. Dismissals without justification are reverted.

## Adding a custom DPF rule

Drop a YAML file under `.github/semgrep/dpf-*.yml`. `semgrep ci`
auto-discovers `.semgrep.yml` files in the repo when `SEMGREP_RULES_FILE`
is unset, but custom rules in a directory require an explicit
`--config=.github/semgrep/` flag. When the first rule lands, update the
workflow's `semgrep ci` invocation accordingly.

Rule template:

```yaml
rules:
  - id: dpf-no-bare-console-log-user-input
    message: |
      console.log with interpolated user input is a log-injection sink.
      Use safe-log.ts or JSON.stringify(value) around the user value.
    severity: ERROR
    languages: [javascript, typescript]
    metadata:
      category: security
      owasp: A09:2021 — Security Logging and Monitoring Failures
      justification: |
        Closed 77 such alerts in PR #1056. CodeQL recognises JSON.stringify
        as a sanitiser; Semgrep doesn't recognise wrapper helpers either,
        so this rule fills the gap directly.
    patterns:
      # ... pattern definitions
```

## Expected runtime

A diff scan of a typical PR completes in well under a minute. Full-tree
scans (post-merge push to main) take 2–4 minutes. If a PR scan takes
longer than ~3 minutes, it usually means `SEMGREP_BASELINE_REF` didn't
resolve correctly and the scan is running full-tree — check the workflow
log for the resolved baseline ref.

## Workflow guarantees

`.github/workflows/security-scan.yml`:

- Runs on `pull_request` to `main` (not `pull_request_target` — DPF has
  no external fork-PR flow today).
- Uploads SARIF to GitHub Code Scanning so findings appear inline on the
  PR Files tab and in the Security tab.
- Skips on Dependabot PRs (those are covered by the post-merge `push`
  trigger).
- Degrades gracefully if `SEMGREP_APP_TOKEN` is absent — still scans, but
  against the limited community ruleset.
