# Shift-left security + test gating rollout — 2026-05-24

Captures the journey from "CodeQL caught 100+ alerts post-merge over 2 days"
to "gates fire on every PR before review." Five PRs, one OSS pivot in the
middle, ~half a day of work end-to-end.

## What motivated this

A 2-day CodeQL burn-down absorbed 100+ alerts that landed on `main` BEFORE
anyone noticed. Net effort:

- 22 PRs to close the alerts — half were rebases/retries.
- ~80 real fixes, ~22 false-positive dismissals.
- Dominant categories: `js/log-injection` (77 sites), `js/request-forgery`
  (6 criticals), `js/tainted-format-string` (14), `js/polynomial-redos`
  (7), `actions/missing-workflow-permissions` (17).

Same pattern at the test layer: PR #1037 silently bumped `apps/mobile` to
jest 30, broke every mobile test, blocked every open PR for hours.
PR #1053 reverted.

**Root cause in both cases:** detection happened AFTER merge to `main`.
The fix is pre-PR gating.

## Original plan (3 PRs)

1. **Semgrep** pre-PR security scan workflow.
2. **Pre-PR unit test gate** workflow.
3. **Tighten** the existing CodeQL inflow gate from CRITICAL/HIGH to
   include MEDIUM, reset baseline to 0.

## What actually shipped (5 PRs)

The plan changed twice during execution. Both changes were the result of
substrate verification before writing code.

### #1058 — Semgrep workflow (merged)

Shipped the original PR 1 design largely as written, with one repo-style
deviation (tag-pinning instead of SHA-pinning to match existing
workflows; flagged in PR description).

### #1059 — Docs + mobile jest-pin guard (merged) — RESCOPED

When I read [`ci.yml`](../../.github/workflows/ci.yml) I found the
pre-PR test gate **already existed** — root `pnpm test` runs vitest
(web + db) and jest (mobile) on every PR as a binding merge gate, 5,980
tests at 0 failures.

A second `test-gate.yml` workflow would have duplicated CI cost without
adding signal. Real value was:

- Documentation at [`docs/testing/pre-pr-gate.md`](../testing/pre-pr-gate.md)
  so contributors discover the existing gate.
- A small CI guard at
  [`scripts/check-mobile-jest-pin.mjs`](../../scripts/check-mobile-jest-pin.mjs)
  asserting `apps/mobile` stays on jest `^29.x` to prevent silent
  Dependabot bumps re-triggering the PR #1037 incident.

Rescoped after surfacing the finding to Mark and getting explicit
confirmation. Cleanest version of the work.

### #1060 — Inflow gate to MEDIUM + baseline reset (merged) — REDISCOVERED ZERO

Spec said "reset baseline to 0 alerts." Stored baseline.json had 70
entries. I was about to choose "snapshot 70 + parallel burn-down epic"
when a direct API query showed `code-scanning/alerts?state=open` returned
**0 alerts** — the burn-down PRs (#1056, #1057, #1048, #1031, #1028) had
closed everything but the baseline file refresh hadn't happened. Resetting
to 0 became the literally-correct answer, no separate burn-down work
needed.

Also bumped `FAIL_SEVERITIES` default from `critical,high` to
`critical,high,medium` — at 0 baseline the marginal cost of MEDIUM
coverage is zero.

### #1064 — Forward-fix: Semgrep coverage gap (merged) → reverted

The acceptance demo on closed PR #1061 revealed that the merged Semgrep
workflow only loaded **148 of 713 community rules** and missed obvious
patterns (canonical AWS example keys, `Math.random()` for tokens,
`eval()`). Decisive log line from the run:

> `(need more rules? semgrep login for additional free Semgrep Registry rules)`

The unauthenticated Semgrep community registry is significantly limited.
The fuller ruleset requires `SEMGREP_APP_TOKEN` from semgrep.dev (free
for OSS but a third-party account).

PR #1064 switched the workflow from `semgrep scan --config=p/...` to
`semgrep ci` so it would consume the token gracefully. Merged. Then Mark
flagged that signing up for a third-party SaaS isn't appropriate for
DPF's posture.

### #1069 — Replace Semgrep with gitleaks (merged) — OSS PIVOT

Reframed the gap honestly:

1. **CodeQL already runs pre-merge** in this repo via
   [`codeql.yml`](../../.github/workflows/codeql.yml). The "shift-left for
   code patterns" gap I'd been framing was smaller than I claimed —
   CodeQL plus the now-tightened inflow gate covers most of it.
2. The remaining real gap was **secrets detection** — the AWS-key class
   the demos kept testing. gitleaks (MIT, no accounts, ships rules
   in-binary) is purpose-built for that.

Workflow at [`.github/workflows/secrets-scan.yml`](../../.github/workflows/secrets-scan.yml)
installs gitleaks 8.30.1 from the GitHub release tarball directly
(avoiding the `gitleaks/gitleaks-action` wrapper's org-licensing
carve-out), diff-scans the PR commit range, uploads SARIF to GitHub
Code Scanning, blocks merge on any finding.

Verified end-to-end via closed acceptance PR #1071:

```
Finding:  ... FAKE_GITHUB_PAT = "REDACTED";
RuleID:   github-pat
2 commits scanned.
leaks found: 1
```

Secret value redacted in logs (`--redact` working). Workflow exited 1.
Merge blocked. Definition of done.

## Final coverage map

| Layer | Tool | Trigger | File |
|---|---|---|---|
| Pre-PR secrets | gitleaks 8.30.1 | Every PR + push to main | `.github/workflows/secrets-scan.yml` |
| Pre-PR code patterns | CodeQL | Every PR | `.github/workflows/codeql.yml` |
| Post-PR alert diff | check-inflow-gate.mjs | After CodeQL completes, MEDIUM floor | `.github/workflows/security-inflow-gate.yml` |
| Baseline | (empty after burn-down) | n/a | `docs/security/codeql-baseline.json` |
| Pre-PR tests | `pnpm test` (vitest + jest) | Every PR | `ci.yml` Unit Tests job |
| Mobile jest pin | check-mobile-jest-pin.mjs | Every PR | `ci.yml` Mobile Jest Pin Guard |

Zero third-party accounts. Everything ships with the repo.

## Acceptance test attempts

| # | PR | What was tested | Outcome | Lesson |
|---|---|---|---|---|
| 1 | #1061 v1 | `eval(payload)`, `console.warn(\`...\${userInput}\`)`, `fetch(userControlledUrl)` against Semgrep | 0 findings | Taint rules need recognized sources (`req.body`, etc.); bare `string` params don't trip |
| 2 | #1061 v2 | Hardcoded AWS keys, `Math.random()` tokens, `eval()` | 0 findings | Semgrep community ruleset is thin |
| 3 | #1061 v3 | Same, no severity filter | 0 findings | Confirmed thin ruleset, not a filter issue |
| 4 | #1066 | Hardcoded AWS keys against `semgrep ci` | 0 findings | Token not yet set; graceful-degradation path active |
| 5 | #1071 v1 | `AKIAIOSFODNN7EXAMPLE` against gitleaks | 0 findings | That value is on gitleaks' default allowlist (correct — it's AWS's own doc example) |
| 6 | **#1071 v2** | **Synthetic GitHub PAT against gitleaks** | **1 finding, merge blocked** | **Definition of done.** |

Each "0 findings" iteration produced real signal about what the gate
covers vs doesn't — not wasted work.

## Lessons captured

### Kernel principles reinforced

- **Verify substrate before proposing new substrate.** Three of the five
  PRs changed scope after I read the existing files (`ci.yml` already
  ran tests; main had 0 alerts; CodeQL already ran pre-merge). Original
  spec was directionally right but factually stale on each point.
- **Evidence before diagnosis.** The Semgrep coverage gap was
  diagnosable from a single log line (`148 of 713 community rules`),
  not from speculation. Each fix iteration moved closer to that line.
- **Structural verification is not functional verification.** Workflow
  YAML parsing OK + CI green ≠ gate works. The acceptance demos forced
  me to find that out before claiming done.
- **Never ask the user to run commands.** When SEMGREP_APP_TOKEN was
  needed, the right move was to prepare the workflow change and tell
  Mark exactly what to click — not to gate the work on him doing setup
  blind.

### New observations worth filing

- **gitleaks default allowlist includes well-known documentation
  example values** (`AKIAIOSFODNN7EXAMPLE`, etc.). This is correct
  behavior but trips up acceptance tests that reach for canonical
  example strings.
- **Semgrep CLI severity filter is legacy-only on v1.163.** Accepts
  INFO/WARNING/ERROR; modern rules use CRITICAL/HIGH/MEDIUM/LOW in
  metadata. Mismatch silently filters out rules.
- **`semgrep/semgrep-action` and `gitleaks/gitleaks-action` both have
  organization-licensing wrinkles.** Installing the CLI directly from
  the official release tarball is the OSS-safe pattern.

## Forward work (not in scope of this rollout)

- A `.gitleaksignore` file at repo root may be needed if real
  documentation/test fixtures trip the gate. Add fingerprints as they
  surface, with a comment justifying each.
- DPF-specific custom rules could live at `.github/semgrep/` if we ever
  add Semgrep back; or as gitleaks custom rules via `--config=` for
  patterns gitleaks' default config misses. None needed today.
- The mobile jest pin guard could be generalized to a "test-runner
  version drift" guard covering vitest if the `packageExtensions`
  workaround in PR #1055 ever proves insufficient. Currently not
  needed.

## PR index

- [#1058](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1058) — Semgrep pre-PR scan workflow (later replaced)
- [#1059](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1059) — Test gate docs + mobile jest-pin guard
- [#1060](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1060) — Tighten inflow gate to MEDIUM + reset baseline to 0
- [#1061](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1061) — Semgrep acceptance demo (closed)
- [#1064](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1064) — Forward-fix Semgrep coverage (later superseded)
- [#1066](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1066) — `semgrep ci` acceptance demo (closed)
- [#1069](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1069) — Replace Semgrep with gitleaks
- [#1071](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1071) — gitleaks acceptance demo (closed)
