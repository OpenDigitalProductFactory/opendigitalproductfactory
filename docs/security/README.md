# Security findings — workflow and baseline

This directory holds the operational substrate for the security inflow gate
introduced by **BI-04701325** (Security & quality findings → Build Studio
intake with full phase rigor).

## The two-loop model

We run three complementary loops:

1. **Pre-PR secrets scan** ([secrets-scan.md](secrets-scan.md)). gitleaks
   on every PR diff and every push to `main`. Blocks merge on any
   hardcoded credential. OSS-only — no third-party accounts.

2. **Inflow gate** (this directory). Per-PR, machine-enforced. Blocks new
   critical/high/medium CodeQL findings from landing on `main` (severity
   floor tightened from critical/high after the 2026-05 burn-down brought
   the baseline to 0 alerts). Implemented by
   `.github/workflows/security-inflow-gate.yml` and the helper scripts in
   `scripts/security/`.

3. **Backlog sweep** (separate work, BI-04701325). Nightly portal job that
   triages existing findings into cluster BIs, runs them through Build
   Studio with regression-test-first rigor, and contributes the fix
   patterns (plus CodeQL rules) back to the hive.

## Files

| File | Purpose |
|---|---|
| `codeql-baseline.json` | Snapshot of CodeQL alerts that pre-existed when the gate landed. PRs are allowed to leave these alone; they're burned down through the BS pipeline. |
| `../../scripts/security/check-inflow-gate.mjs` | The gate script. Fetches current open alerts, diffs against baseline, fails if a new critical/high appears. |
| `../../scripts/security/regenerate-baseline.mjs` | Re-snapshot the baseline. Run after fixing or dismissing alerts. |
| `../../.github/workflows/security-inflow-gate.yml` | Wires the gate to run after every CodeQL completion. |

## What the baseline contains

At inception, the baseline carried every open CodeQL alert (8 criticals,
43 highs, 20 mediums). The 2026-05 burn-down PRs (#1028, #1031, #1048,
#1056, #1057, plus the SSRF/command-injection cluster fixes) closed all
remaining alerts. **The baseline is now empty.**

Each entry (when present) is keyed by GitHub's stable per-finding `number`.
The diff is alert-number based (not count-based) so a PR that closes one
finding and opens a different one is still caught.

Future entries land here only when a maintainer **explicitly** dismisses
a false positive in the GitHub UI with written justification, or when a
finding is accepted as tracked debt with a linked backlog item. The
baseline is not a place to "park" unfixed real findings.

## When you need to regenerate the baseline

After **any** of the following lands on `main`:

1. A PR fixes one or more findings (so they close in CodeQL).
2. A maintainer dismisses a false positive in the GitHub UI with a written
   justification.
3. CodeQL re-numbers alerts (rare, but happens on configuration changes).

Run:

```bash
GH_REPOSITORY=OpenDigitalProductFactory/opendigitalproductfactory \
  GH_TOKEN=$(gh auth token) \
  node scripts/security/regenerate-baseline.mjs
```

Commit the updated `codeql-baseline.json` in the same PR as the fix.

## What this gate is NOT

- **Not a substitute for review.** It catches CodeQL-detectable regressions
  in a known severity floor. It does not see logic bugs, design flaws,
  privilege escalation in business logic, etc. Human + bot review still
  matter.
- **Not a substitute for fixing the backlog.** The whole point is to stop
  the bleeding while the backlog is burned down through Build Studio. If
  the baseline grows over time, the gate has failed its job.
- **Not authorized to dismiss alerts.** It only reads. Dismissals are
  explicit human decisions with audit trails — see the kernel principle
  proposed for "Every security finding gets a regression test before a fix"
  and the dismissal-justification requirement in BI-04701325.

## Why workflow_run trigger (not pull_request)

The gate must run AFTER CodeQL has analyzed the PR's merge commit. If we
triggered directly on `pull_request`, we'd race CodeQL and see stale alerts
(making every PR pass trivially). `workflow_run` fires once CodeQL
completes, ensuring we diff against fresh data.

## Trust-boundary note

The gate workflow runs in the base-repo context with access to
`GITHUB_TOKEN`. It MUST NOT check out the PR's head SHA and execute code
from it — that would let a malicious fork PR tamper with the gate's own
logic. The workflow explicitly omits a `ref:` parameter so checkout pins
to the default branch (which contains the trusted gate script).

This pattern was reinforced by **BI-5940955C** (GitHub Actions code
injection finding in `dco-signoff-dependabot.yml`). Workflows touching
`pull_request_target` or `workflow_run` triggers are trust-boundary code
and are subject to the carve-out described in **BI-860603DA**.

### Trust-boundary paths

The full list of paths that require extra owner review lives in
[`.github/CODEOWNERS`](../../.github/CODEOWNERS). Categories include:

- CI infrastructure (`.github/workflows/`, `.github/CODEOWNERS` itself,
  Dependabot config).
- Security substrate (`scripts/security/`, `docs/security/`) — modifying
  the baselines is exactly how silent security regressions happen.
- Kernel principles (`docs/founder-kernel/wiki/principles/`) and the
  WWMD Decision Perspective Kernel
  (`apps/web/lib/decision-perspective/`) — these propagate to every
  install via the hive update.
- Audit invariants (`apps/web/scripts/audit-*.ts`).

Enforcement requires branch protection's "Require review from Code Owners"
to be enabled. With one maintainer, CODEOWNERS today is documentation
plus a hard signal for the bot reviewer (BI-860603DA) to look up which
files need that signal. Branch-protection enforcement adds the second
maintainer requirement when the team grows.
