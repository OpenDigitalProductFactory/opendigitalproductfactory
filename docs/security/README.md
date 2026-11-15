# Security findings — how they are caught and tracked

## The loops

1. **Pre-PR secrets scan** ([secrets-scan.md](secrets-scan.md)). gitleaks
   on every PR diff and every push to `main`. Blocks merge on any
   hardcoded credential. OSS-only — no third-party accounts.

2. **CodeQL on every PR** ([codeql-advanced-setup.md](codeql-advanced-setup.md)).
   `.github/workflows/codeql.yml` ("CodeQL Advanced") analyses each pull
   request and annotates new findings on the PR.

3. **Repository security intake** (BI-C67E5CCB). The commissioned
   `ecosystem-inbound-issue-triage` job reads open CodeQL, Dependabot and
   secret-scanning alerts every 4 hours and keeps one backlog item per
   vulnerable package, CodeQL rule or leaked secret, prioritised by
   severity. A finding GitHub no longer reports open moves its item to
   awaiting acceptance. See the
   [operations guide](../user-guide/operations/index.md#security-findings-from-github).

## Retired: the CodeQL inflow gate

`security-inflow-gate.yml` diffed a PR's CodeQL alerts against
`codeql-baseline.json`. It listened for a workflow named `CodeQL`; after that
workflow became `CodeQL Advanced` it never ran again (last run 2026-09-03),
and it was never a required check. It was retired with its scripts and the
empty baseline under BI-8ED87FD9 (decision DI-2A35E70B3993): new findings
are visible on the PR through CodeQL and tracked to resolution through the
security intake. Any future blocking security check needs the gate contract
from BI-8FE563CD (owner, capacity, catch rate, failure mode, review date).

## Trust-boundary paths

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

Workflows touching `pull_request_target` or `workflow_run` triggers are
trust-boundary code (BI-5940955C, BI-860603DA): they must never check out
and execute a PR's head.

Enforcement requires branch protection's "Require review from Code Owners"
to be enabled. With one maintainer, CODEOWNERS today is documentation
plus a hard signal for the bot reviewer (BI-860603DA) to look up which
files need that signal. Branch-protection enforcement adds the second
maintainer requirement when the team grows.
