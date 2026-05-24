# Semgrep — pre-PR security scan

Companion to the [CodeQL inflow gate](README.md). Semgrep runs on every pull
request against `main` and on pushes to `main`, blocking the PR if it
introduces patterns the standard rulesets flag at ERROR or WARNING severity.

## Why two scanners

CodeQL and Semgrep cover overlapping but non-identical territory:

| | CodeQL | Semgrep |
|---|---|---|
| Trigger timing | Post-merge analytical (via the inflow gate diff) | Pre-merge syntactic |
| Strength | Cross-procedural taint, framework-aware data flow | Fast pattern matching, large ruleset ecosystem |
| Sanitiser model | Custom data-extension packs only | Inline `# nosemgrep` + rule-level metadata |
| Custom rules | CodeQL packs (more work to author) | YAML rules in `.github/semgrep/` |

Keep both. Findings that one tool misses, the other often catches.

## Rulesets in use

The workflow (`.github/workflows/security-scan.yml`) runs Semgrep with the
following Semgrep Registry rulesets:

- `p/security-audit` — language-agnostic security baseline
- `p/typescript` — TS-specific patterns
- `p/javascript` — JS-specific patterns
- `p/nextjs` — Next.js-specific patterns (App Router, server actions, etc.)
- `p/owasp-top-ten` — OWASP Top 10 coverage
- `p/github-actions` — workflow injection, action pinning, secret handling
- `p/secrets` — hard-coded credential detection

DPF-specific custom rules live in `.github/semgrep/*.yml` (empty in v1 — added
only when burn-down evidence shows the standard rulesets miss a pattern we care
about, per the "verify substrate before proposing new" principle).

## Run locally

```bash
# Install once
pip install semgrep

# Scan the current branch's diff against main
semgrep scan \
  --config=p/security-audit \
  --config=p/typescript \
  --config=p/javascript \
  --config=p/nextjs \
  --config=p/owasp-top-ten \
  --config=p/github-actions \
  --config=p/secrets \
  --severity=ERROR \
  --severity=WARNING \
  --baseline-commit="$(git merge-base HEAD origin/main)" \
  --error
```

For a fast smoke test, `semgrep --config=auto .` uses Semgrep's recommended
config but skips the explicit ruleset list above.

## Suppressing a finding

If a finding is a true false positive (and you can defend that to a reviewer):

```ts
// nosemgrep: javascript.lang.security.audit.code-string-concat-eval.code-string-concat-eval — JSON template literal, no user input
const out = `{"ok":${flag}}`;
```

Required form:
- `nosemgrep:` prefix
- Full rule ID (the part after the last `.` in Semgrep's output is enough, but
  the full ID is unambiguous and what reviewers expect)
- An em-dash or `—` followed by a one-line justification

Suppressions without a justification fail review. Suppressions covering a
range of code (block-level) belong in `.github/semgrep/` as a targeted rule
exclusion with a `metadata.justification:` field, not inline.

## Dismissing a finding in GitHub Code Scanning

For findings that surface in the Code Scanning UI (after SARIF upload), the
dismissal flow is:

1. Open the alert in GitHub Code Scanning (`Security > Code scanning`).
2. Dismiss with one of: `false positive`, `won't fix`, `used in tests`.
3. **Required:** add a justification comment citing either a kernel principle
   from [`docs/founder-kernel/wiki/principles/`](../founder-kernel/wiki/principles/),
   a tracked BI/Epic, or a PR that explains why the pattern is safe in this
   codebase.

The reviewer for the next PR in the affected area is expected to verify the
dismissal makes sense. Dismissals without justification are reverted.

## Adding a custom DPF rule

Drop a YAML file under `.github/semgrep/dpf-*.yml`. The workflow does not yet
load this directory — when the first rule is authored, the workflow's
`semgrep scan` invocation must add `--config=.github/semgrep/`.

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
        as a sanitiser; Semgrep should too.
    patterns:
      # ... pattern definitions
```

## Expected runtime

A diff scan of a typical PR completes in well under a minute. Full-tree scans
(post-merge push to main) take 2–4 minutes. If a PR scan takes longer than
~3 minutes, it usually means `--baseline-commit` didn't resolve correctly and
the scan is running full-tree — check the workflow log for the resolved
baseline SHA.

## Workflow guarantees

The workflow at `.github/workflows/security-scan.yml`:

- Runs on `pull_request` to `main` (not `pull_request_target` — DPF lacks an
  external fork-PR flow today; adding it requires explicit trust-boundary
  review).
- Uploads SARIF to GitHub Code Scanning so findings appear inline on the PR
  Files tab and in the Security tab.
- Skips on Dependabot PRs (those are covered by the post-merge `push` trigger).
- Blocks merge on any ERROR or WARNING finding introduced by the PR.
- Filters out INFO findings entirely in v1; see the workflow's header comment
  for the upgrade path when block/comment split is needed.
