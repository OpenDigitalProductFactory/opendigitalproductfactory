# Gate cost inventory — November 2026

**Status:** read-only analysis, 2026-11-03. Evidence for the "governance proportional to risk" cleanup under
BI-CF5ECBF6. Nothing here changes a gate; every recommendation is the operator's decision.

**Method.** Source at `origin/main` `5e66f364dbcf`. GitHub branch protection, rulesets and Actions run history from
2026-10-04 to 2026-11-03 (2,922 `ci.yml` runs, 244 failed runs' logs classified, job timings sampled from 100 runs).
Production Postgres read inside `BEGIN READ ONLY … ROLLBACK` (`TokenUsage`, `AgentBudgetEvent`, `BacklogItem`,
`BacklogItemActivity`, `ExternalEvidenceRecord`). `git log` since 2026-08-01 (2,817 commits). Failure counts are
lower bounds, because the runs API shows only each run's latest attempt. "Not measured" means not measured. Nothing
was estimated silently.

## Summary for Mark

- **Only four checks stop a PR merging on GitHub:** DCO sign-off, Merge Readiness, UX Route Budget Sweep and Failure
  Readiness. Merge Readiness is a bundle of 22 jobs, about 90 policy guards among them.
- **Behind those, a change also has to pass:**
  - about 150 local guards before it may be pushed;
  - git hooks;
  - backlog "readiness" receipts before work may even start.
- **Roughly one guard in three protects something that can actually hurt you:** a broken install, lost data, a
  security hole or a failed upgrade. The other two thirds check tidiness, wording, file size or that a form was
  filled in. They all block in the same way.
- **Today the system stopped:**
  - Failure Readiness started enforcing at 05:28 UTC. Its AI reviewer gets 200,000 tokens a day; demand is about
    450,000.
  - Since 06:17 UTC three PRs have merged, against a normal pace of about 28 a day. Thirty PRs are waiting, almost
    all of them green on everything else.
  - That gate caught nothing in the 30 days before today, because until today it passed automatically.
- **The tidiness guards get waved through:**
  - **Prose lint:** its allowance list was raised in 115 of the 137 commits that touched it.
  - **File-size limit:** raised in 109 of 128.
  - **Paperwork trailers:** about half of all commits carry a "this doesn't apply" line just to satisfy them.
  - A guard that is routinely waved through costs time and catches little.
- **Recommendation:**
  - Keep blocking on production, data, security and legal checks.
  - Make the tidiness and paperwork checks warnings, or have the robot fix them automatically.
  - Retire two that do nothing.
  - Before anything stays blocking, make sure it has enough capacity and an emergency exit.
- **One deadline:** 17 allowance lists expire on 16 November. If nobody acts, every change will be blocked from that
  day.

## 1. What can block a change, and what it costs

### 1.1 Required GitHub checks (branch protection on `main`)

- `strict: false` and `enforce_admins: true`.
- Merge-queue ruleset `main-merge-queue`: squash, ALLGREEN, up to 5 entries, 60-minute check timeout,
  **no bypass actors**.
- The required list lives in `config/merge-readiness-policy.json`. The only break-glass is an admin editing it.

| Check | Protects | Risk class | Fail mode | Auto-fixable | Production emergency path | 30-day cost / frequency | Value evidence |
|---|---|---|---|---|---|---|---|
| **DCO** | Signed-off commits (legal provenance) | Legal / compliance | Fail-closed | Yes (amend with `-s`) | None needed | PR side not measurable (app status). The merge-queue shim `dco-merge-group.yml` is 961/961 green: a pass-through. | Keep. **Hardening gap:** the required context has `app_id: null`, so any check named `DCO` satisfies it. |
| **Merge Readiness** (`ci.yml`, aggregates 22 jobs; `skipped` counts as pass) | Typecheck, unit tests, production build, ~90 policy guards, image pins | Mixed (§1.2) | Fail-closed | Depends on the failing leaf | Only governed PR-body decision trailers for specific guards | PR: 1,185 runs, **14.8 % failed**, 120 branches with ≥1 failure, median 11.2 min (p90 14.4), ~77 job-min per run. Queue: 961 runs, 8.1 % failed, median 10.1 min, ~61 job-min. Every merged PR pays at least one PR run plus one queue run. | Real catches: 10-07 Turbopack duplicate-asset build break (run 37664452066), 10-14 integration conflicts in the queue (38618863139), commercial-catalog assertion. |
| **UX Route Budget Sweep** (required directly **and** inside Merge Readiness) | Route render completeness + frozen word/shell budgets | Quality signal (the seed-invariant step is data integrity) | Fail-closed | Partly: `update_baseline=true` dispatch, then a reviewed splice | Reviewed baseline update only | CI critical path, 12.6 min median (p90 14.3). 59 PR failures across 34 branches; **50 were budget regressions**, real vs noise not determined. Baseline file changed in 113 commits since 08-01. | One real seed defect caught (47 agents without grants, run 38839673537). |
| **Failure Readiness** (`failure-readiness.yml`) | A fresh (≤ 60 min) `dpf/failure-readiness` success status from the platform reviewer | Assurance, applied equally to production-integrity and quality changes | Fail-closed since #6843 (11-03 05:28Z); before that, "unconfigured" passed | No. Needs a reviewer run, then a manual re-run (#6868 open). | **None audited.** The exemption tool refuses on production, and break-fix still needs the review. Admin context edit is the only route (BI-7C1B2687). | 0 failures in the 29 days before 11-03. Since then: 54 PR + 4 queue failures, **30 open PRs blocked now**, 3 merged since 06:17Z (#6851, #6852, #6861). Reviewer cap 200k tokens/day vs ~450–480k demand (≈28–30 PRs × ~16k). Cap crossed 18:34Z; 14 `rejected` budget events followed. | 2 published "failed" verdicts on 11-03 (#6847, #6859); no defect-catch record exists. Earlier version was "red on 30 of the last 30 merged PRs" (#5521 comment). |

**Not blocking, though their names suggest they are:**
- CodeQL, secrets scan, the migration and schema guards, the `audit-*` workflows and Policy Guards Recheck are all
  informational.
- `security-inflow-gate.yml` is **dead**. It listens for a workflow named `CodeQL`, but that workflow is now
  `CodeQL Advanced`; its last run was 2026-09-03.
- `self-upgrade-acceptance` failed on all 31 of its scheduled runs and blocks nothing.

**Unexplained anomaly.** #6842, #6843, #6844 and #6846 merged through the queue on 11-03 although Failure Readiness
concluded `failure` on their queue runs. The org audit log was not readable, so the cause was not determined.

### 1.2 Jobs inside Merge Readiness

Durations are PR median / p90 in minutes. Failures are failed PR runs [branches] / failed queue runs.

| Job | Protects | Risk | Duration | Failures | Auto-fix |
|---|---|---|---|---|---|
| Typecheck, Typecheck (web tests) | Compile correctness | Quality (correctness) | 2.0 / 2.5; 1.6 / 2.6 | 7 [7] / 0; 4 [4] / 5 | No |
| Typecheck TS6 reference | Forward-compat signal | Advisory (continue-on-error) | 8.4 / 9.0 | cannot fail | n/a |
| Policy Guards (source), 79 guards | See appendix | Mixed | 6.2 / 9.1 | 46 [40] / 44 | Often (derived-artifact regen, module-size `--update`) |
| Policy Guards (workspace) | FPAW + prose lint | Quality | 1.1 / 1.7 | 0 / 0 | Baseline |
| Policy Guards (PR), 9 manifest/trailer gates | See §1.4 | Mostly quality; Hidden Unicode = security | 1.1 / 4.4 | 39 [37] / skipped in queue | Mostly a trailer |
| Unit tests (web ×4, packages) | Behaviour | Quality; migrations = data integrity | 4.0–6.4 / 4.5–7.3 | 40 [35] / 25 | No. One flake: `room-review-ingestion.test.ts` timed out on 14 unrelated branches. |
| Production Build | Shippable image | Production integrity | 6.4 / 7.2 | 3 / 2 | No |
| UX Route Sweep Runtime | §1.1 | Quality | 12.6 / 14.3 | 59 [34] / 8 | Partly |
| Dockerfile Node version, compose image pins, edge BOM | Runtime parity, supply chain | Production integrity / security | <1 | 0 / 0 | Mechanical |
| ADP integration, toolchain bootstrap smoke, routing contract, docs publication | Integration quality | Quality | 0.9–1.7 | ≤3 | No |

**Leading failure causes in Merge Readiness:**
- **UX budget regressions:** 50 PR runs.
- **Derived Artifact Registry staleness:** stale generated files, fixable by one regenerate command. 22 queue runs
  alone plus 10 combined with module size, including a **41-failure merge-queue cascade on 10-08 01:49–03:50Z**.
- **Module-size cap:** 21 queue runs.
- **PR trailer gates:** 39 runs.
- **Floating Node version (EBADENGINE):** 7 runs, 5 of them on 11-03 (#6862, #6859, #6869, #6870, #6877), PR #6865.
  This is runner drift, not a PR defect.
- **Provider-quota verification step:** 5 failures.
- **Unclassified:** 24 runs.

### 1.3 Local gates before push

| Gate | Protects | Risk | Fail mode | Auto-fix | Emergency path | Cost | Value / friction evidence |
|---|---|---|---|---|---|---|---|
| Host preflight (`pregate-preflight.mjs`): 85 of the 90 registry entries, 162 commands; 57 on a docs-only diff | Catches CI guard failures before taking the local-CI lease | 28 production-integrity, 51 quality, 5 gate self-tests, 1 mixed (classification from guard headers) | All fail-closed; only "host can't run it" degrades to WARN | 32 entries print a one-command fix; only 4 are pure regeneration | `DPF_SKIP_PREGATE_PREFLIGHT_REASON` (recorded) | ~51–95 s documented (at 52 entries; now 85). Local telemetry 10-28→11-03: 76,629 guard results, 262 refusals, **36 runner-hours**. | Only **2** guards declare an owner and catch class (`scripts/guard-declarations.json`). Refusal classifications: 59 "caught", 97 unresolved, 1 overridden; "caught" pairs events and is not causal. |
| Repo Guard Loop (`check-guards.mjs`), 58 `check-no-*` guards | Architecture ratchets | 16 production-integrity, 38 quality, 4 machinery | Fail-closed | 13 have `--update` | Global preflight skip | **17 guards run twice per preflight**; local CI runs the loop a third time | Duplicate execution |
| Local CI (`gate-worktree.mjs` → `local-ci-runner.mjs`) | Merged-tree typecheck, tests and guards on a leased sandbox | Correctness | Fail-closed; infrastructure exits are recorded separately | No | Allowlisted override codes in `pre-push-gate` (6 of 85 slot records on this host; 27 commits carry `Local-CI-Override`) | ~13–15 min per run on **one shared slot**; queue wait p90 ~17.5 min (2026-08-29 latency spec). Guards are ~10 % of slot time. 17 % of commits exist only to satisfy a gate. | Latency spec: branches with 9+ commits take 27 h to reach a PR vs 0.35 h for 1-commit branches |
| pre-commit hook | Migration immutability, secrets (gitleaks), private identity, schema regression, migration safety, decision baseline, scoped typecheck; auto-regenerates Prisma client and derived artifacts | Mostly production integrity / security | Fail-closed | Auto-regenerates | Per-check skip env vars; `--no-verify` | Scoped typecheck up to ~10 min uncached | Secrets/identity scans have cited incidents |
| pre-push hook | DCO, gate PASS record bound to HEAD | Legal + correctness | Fail-closed | DCO amend | Allowlisted override reasons | Seconds (trusts the PASS record) | Added after #4172/#4173/#4189 shipped red |
| Agent PreToolUse hooks (`.claude/settings.json`): workroom claim, root clone, lease, pregate evidence, UX-fit / design-grounding / spec-plan-doc prechecks | Process coordination | Quality / coordination | Deny; fail open on IO error | n/a | Per-hook `DPF_ALLOW_*` env | Not measured | **Workroom-claim guard:** ~9 false-deny fixes since 08-27 and no recorded catch. It refused read-only `git fetch` / `git merge-base` during this research. Its header says deny is "OFF by default", but the code denies by default. |

### 1.4 Mandatory manifests and trailers (Policy Guards (PR), so they block via Merge Readiness)

Local refusal counts are 375 runs each, 2026-10-28→11-03 (`ExternalEvidenceRecord`). Trailer prevalence is across
2,817 commits since 08-01.

| Gate | Protects | Risk | Escape | Auto-fix | Refusals (caught/unresolved) | Prevalence / evidence |
|---|---|---|---|---|---|---|
| Data-Impact manifest | Data governance, retention, sensitivity | **Production integrity / data** | Expiring exception file | Generated manifest; content needs judgement | 4 (0/1) | Commit bodies credit it with a real catch |
| Convergence-Impact trailer | Existing installs converge on upgrade | **Production integrity** | `not-reachable` mode | Text | 5 (1/2) | 716 commits |
| UX-Fit manifest | UX regression / cognitive load | Quality | **None** | Partly (sweep numbers) | 4 (1/2) | Duplicates the UX sweep |
| Design Grounding | Reuse of existing design | Quality | `trivial` / `no-contract-change` | Text | 20 (4/14) | **46 %** of commits; the guard-retirement ratchet already reports 0 caught in 90 days (BI-7D688E49) |
| Docs Impact | User-guide currency | Quality | Trailer | Text / regenerate | **30** (8/13) | **56 %** of commits |
| Spec/Plan/Doc, Plan Coverage, Seed-Fit | Traceability | Quality | Trailer | Partly | 2 / 3 | Spec-plan-doc median **16.4 s per run**, 6,681 s in total; the slowest guard |

### 1.5 Backlog-claim readiness (initiative-readiness, enforced at `claim_backlog_item_for_work`)

- **What it requires, by shape:**
  - Break-fix: classification, authorization, capsule identity, then a post-implementation review (PIR) within 48 h.
  - Small: research.
  - Medium: research and an item-body baseline.
  - Large: the full profile of design, spec approval, plan, plan review, coverage and traceability.
  - Xlarge: refused (decomposition required).
- **What it protects:** design quality and traceability, which is a quality signal; capsule identity is provenance.
- **Fail mode:** fail-closed.
- **Production emergency path:** `declare_break_fix`, used twice ever. It does **not** bypass the PR checks.

| Measure (30 days) | Value |
|---|---|
| Implementation-readiness decisions | 96,081; 63 % not allowed (340 items). Inflated by re-evaluation, so distinct items is the meaningful number. |
| Not-allowed by shape | large 60,162 vs 760 allowed; medium 87 vs 27,920; small 100 vs 6,976 |
| Top unmet codes (items) | PLAN_REQUIRED 154, CANONICAL_DESIGN 160, SPEC_APPROVAL 160, OBJECTIVE_BASELINE 192, RESEARCH_REQUIRED 191 |
| Churn since 08-01 | `initiative-readiness/` 156 commits, **130 of them `fix:`**; `governed-work-claim.ts` 25 (21 `fix:`) |
| Human-visible refusals | Not measured (system re-projections are indistinguishable) |

### 1.6 Token caps (`apps/web/lib/inference/budget-gate.ts`, `packages/db/data/agent_registry.json`)

- **The reviewer cap:** the change reviewer has `daily_limit: 200000`, `per_task_limit: 50000`, set on 2026-07-27
  (#3647).
  - **Sizing:** 65 of 87 registry agents share the 200k figure. Nothing in the repo compares it with PR volume.
  - **What counts:** the gate sums all providers, including local and subscription tokens that cost nothing. On
    11-03 the cap tripped on $0.02 of spend.
  - **Fail mode:** fail-closed (`InferenceError("billing")`), which turns Failure Readiness red until 00:00 UTC.
  - **Emergency path:** wait for the reset, or redeploy the registry.
- **Fix in flight:** PR #6869 (BI-F3B6713F), still **open** with red checks of its own. The BI is already marked
  `done`.
- **Data gap:** `AgentBudgetEvent` has rows only from 2026-11-02 23:15Z, so earlier cap hits are not measured.
- **The reviewer's share of spend:** 19.3 M of 147.2 M tokens over 30 days (13 %), $17.79 of $125.13.

## 2. Ranked recommendations

Order: unblock flow first, then the largest recurring cost per unit of risk. "Keep" means keep fail-closed.

1. **Failure Readiness: advisory until it has capacity, then blocking only for risky changes.**
   - **Evidence:**
     - 30 PRs are blocked now, and 3 have merged since enforcement against ~28 a day.
     - The cap covers about 42 % of demand.
     - There is no audited production emergency path.
     - There is zero catch history before 11-03.
     - A success status does not re-trigger the check.
   - **Do:**
     - Land #6869 (cap counts paid spend only) and #6868 (re-run on status).
     - Size the cap from trailing-week demand.
     - Add BI-7C1B2687's break-fix path.
     - Make the check blocking only where the diff touches production-integrity surfaces. The data-impact,
       convergence, migration and security guard inputs already classify these.
2. **Expiring baselines: act before 2026-11-16.**
   - **Evidence:** 17 ratchet baselines expire on that date, and `check-no-expired-baseline-budgets` will then fail
     every change.
   - **Do:** renew the baselines, or turn expiry into a warning plus an owner task.
3. **Auto-fix derived artifacts in CI and the merge queue instead of failing.**
   - **Evidence:**
     - The 41-failure queue cascade on 10-08.
     - Derived Artifact Registry is the top source-guard failure in the queue.
     - The fix is a single regenerate command that pre-commit already runs.
   - **Do:** a bot commit on the PR, or regenerate in the merge group.
4. **Demote the ratchets that are re-grown routinely: prose lint, module size, UX route budget.**
   - **Evidence:**
     - Prose-lint baseline grew in 115 of 137 commits.
     - Module-size baseline grew in 109 of 128.
     - The UX baseline file changed in 113 commits; 50 PR failures came from budget regressions; the sweep is the
       12–13-minute CI critical path and is required twice.
   - **Do:**
     - Report the deltas as a PR comment instead of failing.
     - Keep the UX *completeness* and seed-invariant steps blocking.
5. **Demote the attestation trailers (Design Grounding, Docs Impact, Spec/Plan/Doc, Seed-Fit, UX-Fit) to advisory.**
   Keep Data-Impact and Convergence-Impact blocking.
   - **Evidence:**
     - The trailers appear on 46–56 % of commits.
     - Design Grounding has 0 catches in 90 days by the platform's own retirement ratchet.
     - Spec/Plan/Doc is the slowest local guard.
     - UX-Fit has no escape path.
6. **Pin CI toolchains (Node) and classify infrastructure failures as "unrun", not as a red product check.**
   - **Evidence:** EBADENGINE failures on 11-01 and 11-03 (#6865), the provider-quota step failures, and the flaky
     `room-review-ingestion.test.ts` timeouts across 14 branches.
   - **Do:** quarantine that test.
7. **Stop false denials from the workroom-claim hook.**
   - **Evidence:**
     - ~9 false-deny fixes and no recorded catch.
     - It refuses read-only git commands.
     - The header and the code disagree on the default.
   - **Do:** allow read-only commands, and either make it advisory or fix its documented default.
8. **Remove duplicate and dead gates.**
   - **Evidence:**
     - 17 loop guards run twice per preflight and a third time in local CI.
     - UX sweep is required both directly and inside Merge Readiness.
     - `security-inflow-gate.yml` never fires.
     - The `self-upgrade-acceptance` schedule fails 31/31 runs.
   - **Do:**
     - Dedupe the repeated guard runs.
     - Repair or retire `security-inflow-gate.yml`.
     - Fix or retire the `self-upgrade-acceptance` schedule.
9. **Every blocking gate declares its owner, catch class, capacity and emergency path (BI-CF5ECBF6).**
   - **Evidence:** 2 of ~150 guards declare a catch class, and defect-catch data otherwise does not exist.
   - **Do:**
     - Make this declaration the admission rule for any gate to stay blocking.
     - Add the daily blocked-PR count.
10. **Keep blocking:**
    - DCO (but pin the required context to the DCO app);
    - typecheck, unit tests and production build;
    - Data-Impact and Convergence-Impact;
    - migration immutability and safety, secrets and private-identity scans, Hidden Unicode, SBOM, compose/Dockerfile
      pins;
    - the merge queue.
    These protect production, data, security or legal provenance, and their failures are mostly real.
11. **Readiness for large items: keep, but measure.**
    - **Evidence:**
      - 130 `fix:` commits in the readiness module show high maintenance cost.
      - Refusals concentrate in the large shape, where design review is the point.
      - Human-visible refusals are not measured.
    - **Do:** record real claim attempts separately from re-projections before deciding.
12. **Investigate** the four 11-03 queue merges that went through with Failure Readiness red.

## 3. Not measured

- PR-side DCO history.
- Billed Actions minutes. Job-minutes above are sampled sums.
- Failures cleared by re-runs.
- Whether the 50 UX budget failures were real.
- Reviewer cap hits before 2026-11-02.
- Hours each PR spent blocked.
- Re-reviews per PR.
- Defects caught by Failure Readiness.
- Human-visible readiness refusals.
- The "~600-line fix needing 5 local-CI runs" anecdote: no commit names it.

## Appendix A. Every policy guard

Risk class: **P** = production integrity / security / data loss; **Q** = quality signal; **M** = tests of the gate
machinery. The class is judged from each guard's header comment. Every row is fail-closed locally (preflight skip
`DPF_SKIP_PREGATE_PREFLIGHT_REASON`) and in CI via Merge Readiness (no skip). "Touch / loosen" counts commits since
2026-08-01 that touched the guard, and the subset whose subject matches loosen/fix keywords: a heuristic friction
signal.

### A.1 Policy-guard registry (`scripts/lib/ci-policy-guards.mjs`, 90 entries)

| # | Guard | Protects | Risk | Local fail mode | Mechanical fix | Touch / loosen commits since 08-01 |
|---|---|---|---|---|---|---|
| 1 | `repo-guard-loop` (source) | Runs all 58 scripts/check-no-*.mjs ratchets (+ self-tests) and compose capability profiles | mixed (see loop table) | fail-closed | per loop guard | 36 / 3 |
| 2 | `gate-executor-liveness` (source) | Self-tests of the local-CI gate/lease/resume machinery (one conformance test kept host-side) | M | fail-closed | none | 26 / 2 |
| 3 | `host-port-range-guard` (source) | Host port range self-test (self-test only) | M | NOT run locally (self-test-only entry; … | none | 1 / 0 |
| 4 | `guard-conformance-marks` (source) | Repo-reading guard tests must be marked conformanceTest so preflight keeps them | M | fail-closed | none (add mark) | 2 / 0 |
| 5 | `guard-diff-honesty` (source) | Guards must not treat a failed git diff as 'nothing changed'; one git/MCP/argv runner; no raw control bytes | M | fail-closed | none | 19 / 0 |
| 6 | `xff-single-reader` (source) | Only clientAddressKey may read X-Forwarded-For (client-spoofable) | P (security) | fail-closed | none | 1 / 0 |
| 7 | `shell-guard-shim-contract` (source) | Shell guard shim contract (self-test only) | M | NOT run locally (self-test-only entry; … | none | 2 / 1 |
| 8 | `release-compose-pins` (source) | Release compose images are pinned | P (release integrity) | fail-closed | none | 2 / 0 |
| 9 | `release-asset-contract` (source) | Installer/PKI/TLS/MCP-env release assets ship in image; installer contracts | P (install/upgrade integrity, TLS/PKI) | fail-closed | none | 36 / 3 |
| 10 | `prisma-runtime-traps` (source) | Prisma NOT-contains on nullable col drops NULL rows; @map'd enum spelled by member | P (data correctness) | fail-closed | none | 1 / 0 |
| 11 | `db-commandment-coverage` (source) | never-wipe-db commandment covers all destructive spellings (self-test only) | P (data-loss) | NOT run locally (self-test-only entry; … | none | 1 / 1 |
| 12 | `installer-help-contract` (source) | Documented installer flags exist (a missing -Help ran a full install) | P (install safety) | fail-closed | none | 2 / 0 |
| 13 | `installer-skip-visibility` (source) | Installer optional steps never skip silently | P (install integrity) | fail-closed | none | 4 / 1 |
| 14 | `installer-state-contract` (source) | Installer state/lock/recovery-kit/secret-isolation contracts (AUTH_SECRET not in sandbox, keys not rotated) | P (security + install integrity) | fail-closed | none | 35 / 1 |
| 15 | `fresh-install-reliability` (source) | PowerShell compose chain, installer image identity, salvage sweep | P (install integrity) | fail-closed | none | 4 / 0 |
| 16 | `governed-teardown-guard` (source) | Governed teardown contract (no ungoverned destructive teardown) | P (data-loss) | fail-closed | none | 2 / 0 |
| 17 | `published-image-freshness` (source) | Release image identity/promote source identity contracts | P (release integrity) | fail-closed | none | 13 / 1 |
| 18 | `docs-link-integrity` (source) | Doc index fresh, doc links resolve, diagrams rendered | Q | fail-closed | regenerate: node scripts/gen-doc-index.mjs; node scripts/re… | 5 / 0 |
| 19 | `derived-artifact-registry` (source) | Every registered derived artifact is fresh vs its sources | Q (runtime-bundled artifacts can break main, e.g. PR #3284) | fail-closed | regenerate: commands printed by derived-artifacts-gate (pre… | 13 / 2 |
| 20 | `pr-health-test` (source) | CI workflow/coverage/evidence config conformance; policy-test inventory; authoring cost dims | M | fail-closed | none | 167 / 26 |
| 21 | `mobile-jest-pin-guard` (source) | apps/mobile unified jest/react pins | Q | fail-closed | none | 2 / 1 |
| 22 | `diagram-dependency-pin-guard` (source) | Diagram tool dependency pins | Q | fail-closed | none | 3 / 1 |
| 23 | `override-provenance-guard` (source) | pnpm overrides carry advisory provenance; build-script allowlist; Docker COPY/script imports resolve; queue f… | P (supply chain + image build) | fail-closed | none | 28 / 2 |
| 24 | `bundle-boundary-guard` (source) | Docker-only bundling failures caught statically | P (build breaks image) | fail-closed | none | 1 / 0 |
| 25 | `application-boundary-guard` (source) | apps/web/lib context dependency DAG; job engine behind facade | Q | fail-closed | baseline: --write-baseline | 5 / 1 |
| 26 | `label-association-guard` (source) | <label> tied to control (a11y) | Q | fail-closed | baseline: --update | 1 / 1 |
| 27 | `style-drift-guard` (source) | No hardcoded colors/tokens (theme-aware styling) | Q | fail-closed | baseline: --update | 2 / 2 |
| 28 | `reporting-composition-guard` (source) | Reporting UI composes report-kit | Q | fail-closed | baseline: --update | 1 / 1 |
| 29 | `platform-composition-single-home` (source) | Platform composition has one home | Q | fail-closed | none | 3 / 0 |
| 30 | `compose-env-contract-guard` (source) | Compose env vars resolvable on all installs (#3262 fleet self-upgrade break) | P (upgrade integrity) | fail-closed | none | 1 / 0 |
| 31 | `compose-bind-posture-guard` (source) | Host-published ports bind loopback (kernel decision) | P (security) | fail-closed | none | 2 / 0 |
| 32 | `compose-resource-budgets-guard` (source) | Always-on services declare resource limits | P (host stability) | fail-closed | none (edit compose/config) | 3 / 2 |
| 33 | `compose-init-reaping-guard` (source) | Containers needing init run with init (zombie leak) | P (host stability) | fail-closed | none | 1 / 0 |
| 34 | `n-minus-one-caller-honesty` (source) | Self-upgrade promoter N-1 caller compatibility | P (upgrade integrity) | fail-closed | none | 4 / 0 |
| 35 | `no-unreachable-room-links` (source) | Room links reachable by construction | Q | fail-closed | baseline: --update | 3 / 0 |
| 36 | `module-size-guard` (source) | New .ts/.tsx <=800 LOC (hard 1000); baselined files may only shrink | Q | fail-closed | baseline: --update (re-baselines growth too) | 3 / 2 |
| 37 | `employment-event-writers` (source) | Every EmploymentEvent write actuates | P (business data correctness) | fail-closed | none | 1 / 0 |
| 38 | `actuator-inputs-writable` (source) | Actuator-required facts are operator-settable | Q | fail-closed | none | 1 / 0 |
| 39 | `fk-index-coverage-guard` (source) | No new FK without leading index / no new unbacked *Id column | Q (perf/data-model hygiene) | fail-closed | baseline: --update (shrink); growth needs owned decision | 2 / 1 |
| 40 | `ux-primitive-adoption-guard` (source) | UX primitives adopted; no local formatters | Q | fail-closed | baseline: --update | 3 / 3 |
| 41 | `build-studio-surface-guard` (source) | Build Studio UI surface budget | Q | fail-closed | baseline: --update | 1 / 1 |
| 42 | `doc-anchor-existence` (source) | BI/EP/DI ids cited in changed docs exist (reads MCP) | Q | fail-closed | baseline: --update | 11 / 3 |
| 43 | `live-blocker-references` (source) | Closed backlog ids not cited as live blockers in runtime text | Q | fail-closed | baseline: --update | 4 / 1 |
| 44 | `spec-status-frontmatter` (source) | Spec/plan status+supersession frontmatter convention | Q | fail-closed | baseline: --update | 3 / 2 |
| 45 | `test-clock-bomb-guard` (source) | Tests do not pin dates that will expire | Q (test reliability) | fail-closed | none | 3 / 0 |
| 46 | `client-server-boundary-guard` (source) | 'use client' never imports server-only/@dpf/db | P (build/runtime break) | fail-closed | none | 3 / 1 |
| 47 | `no-url-pathname-fs-guard` (source) | No fs path from URL.pathname (Windows break) | Q (cross-platform) | fail-closed | none | 2 / 0 |
| 48 | `work-unit-conformance-guard` (source) | New carriers adapt into WorkUnit | Q | fail-closed | none | 3 / 0 |
| 49 | `instruction-plane-guard` (source) | AGENTS.md / instruction plane size ratchet | Q | fail-closed | baseline: --update | 2 / 0 |
| 50 | `instruction-plane-rule-coverage` (source) | Instruction-plane rules keep coverage | Q | fail-closed | baseline: --update | 2 / 0 |
| 51 | `context-economy-guard` (source) | Runtime context budget | Q | fail-closed | baseline: --update | 3 / 0 |
| 52 | `tool-surface-guard` (source) | MCP tool surface budget | Q | fail-closed | baseline: --update | 7 / 0 |
| 53 | `self-task-cadence-parity` (source) | Skill cadence equals registry cron | Q | fail-closed | none | 1 / 0 |
| 54 | `skill-pack-category` (source) | Skill category closed set | Q | fail-closed | none | 1 / 0 |
| 55 | `archetype-completeness-guard` (source) | Archetype provisioning completeness | Q | fail-closed | baseline: --update | 0 / 0 |
| 56 | `stewardship-scope-guard` (source) | New Prisma model declares stewardship | Q | fail-closed | baseline: --update | 2 / 0 |
| 57 | `capability-consumer-guard` (source) | Declared capabilities have consumers | Q | fail-closed | baseline: --update | 0 / 0 |
| 58 | `skill-capability-key-guard` (source) | Skill capability keys valid (permission gate) | P (authorization) | fail-closed | none | 1 / 0 |
| 59 | `endpoint-classification-guard` (source) | Endpoints classified for edge reachability | P (security exposure) | fail-closed | baseline: --update | 2 / 0 |
| 60 | `finding-substrate-guard` (source) | No seventh finding table | Q | fail-closed | none | 2 / 0 |
| 61 | `docs-staleness-detector` (source) | Docs staleness detector (self-test only) | Q | NOT run locally (self-test-only entry; … | none | 0 / 0 |
| 62 | `retired-substrate-guard` (source) | No references to retired graph/vector services | Q | fail-closed | none | 1 / 1 |
| 63 | `mcp-tool-pack-guard` (source) | mcp-tools.ts inline switch cases only shrink | Q | fail-closed | baseline: --update | 1 / 0 |
| 64 | `local-slugify-guard` (source) | One slugify | Q | fail-closed | none | 1 / 1 |
| 65 | `local-markdown-renderer-guard` (source) | One markdown renderer (raw HTML off) | P (XSS posture) / Q | fail-closed | none | 1 / 1 |
| 66 | `hidden-unicode-instruction-files-guard` (source) | No hidden Unicode in agent instruction files (prompt injection) | P (security) | fail-closed | none | 2 / 0 |
| 67 | `local-canonical-json-guard` (source) | One canonical JSON (feeds hashes/signatures) | Q (P-adjacent) | fail-closed | none | 2 / 1 |
| 68 | `toolchain-version-guard` (source) | dpf-platform pack version single home | Q | fail-closed | regenerate: node scripts/sync-toolchain-version.mjs | 1 / 0 |
| 69 | `package-boundary-guard` (source) | Shared contract packages don't depend on server persistence; no @dpf/types copies | Q | fail-closed | none | 1 / 0 |
| 70 | `test-cwd-independence-guard` (source) | Tests don't resolve paths from cwd | Q | fail-closed | none | 2 / 2 |
| 71 | `build-studio-namespace-guard` (source) | Build Studio namespace frozen | Q | fail-closed | none | 1 / 1 |
| 72 | `sbom-divergence-guard` (source) | SBOM duplicate drift baseline; one lockfile parser | Q (supply-chain hygiene) | fail-closed | baseline: --update-baseline (human judgment, never auto-sta… | 11 / 3 |
| 73 | `new-dependency-gate` (source) | New dependencies must be allowlisted | P (supply chain) | fail-closed | allowlist: --update-allowlist | 2 / 1 |
| 74 | `singleton-safety-guard` (source) | Dual-package hazard for singleton packages | P (runtime correctness) | fail-closed | baseline: --update-baseline | 0 / 0 |
| 75 | `model-metadata-tags` (source) | Every Prisma model carries @dpf metadata | Q | fail-closed | baseline: --update | 1 / 0 |
| 76 | `doc-reference-integrity` (source) | Doc references resolve | Q | fail-closed | baseline: --update | 0 / 0 |
| 77 | `rendered-backlog-pointers` (source) | Rendered backlog ids name real items | Q | fail-closed | none | 1 / 0 |
| 78 | `unattributable-deferral` (source) | Deferred BIs carry reason/trigger/owner | Q | fail-closed | none | 3 / 0 |
| 79 | `janitor-tests` (source) | Git hook env scrub, hook convergence, worktree freshness self-tests; janitor --help | M | fail-closed | none | 119 / 13 |
| 80 | `fpaw-standard-guard` (workspace) | FPAW standard (tsx; header not parsed) | Q (unverified) | fail-closed | unverified | 2 / 0 |
| 81 | `prose-lint-guard` (workspace) | UI copy vocabulary/readability/sentence length/text mass ratchet | Q | fail-closed | baseline: tsx scripts/check-prose-lint.ts --update | 3 / 2 |
| 82 | `ux-fit-gate` (pull-request) | UI-route change carries measured UX evidence manifest (route budget baseline) | Q | fail-closed; reads commit range (+PR bo… | none (needs measured manifest) | 6 / 2 |
| 83 | `hidden-unicode-commit-text-guard` (pull-request) | No hidden Unicode in commit messages/PR text | P (security) | fail-closed; reads commit range (+PR bo… | none (reword commit) | 1 / 0 |
| 84 | `docs-impact-gate` (pull-request) | User-facing route change touches its user-guide page, or carries Docs-Impact-Decision | Q (process attestation) | fail-closed; reads commit range (+PR bo… | regenerate manifest: node scripts/gen-doc-impact.mjs; else … | 21 / 5 |
| 85 | `seed-fit-gate` (pull-request) | Kernel principle/seed change carries Seed-Fit decision | Q (process attestation) | fail-closed; reads commit range (+PR bo… | trailer | 4 / 2 |
| 86 | `spec-plan-doc-gate` (pull-request) | Substantial change carries spec/plan/doc or attestation; plan backlog coverage | Q (process attestation) | fail-closed; reads commit range (+PR bo… | trailer/doc | 67 / 7 |
| 87 | `data-impact-gate` (pull-request) | Persistent-surface change carries DataImpactManifest or exception | P-adjacent (data governance) | fail-closed; reads commit range (+PR bo… | none (author manifest) | 4 / 2 |
| 88 | `convergence-impact-gate` (pull-request) | Change declares how existing installs converge | P-adjacent (upgrade integrity) via attestation | fail-closed; reads commit range (+PR bo… | trailer | 3 / 0 |
| 89 | `design-grounding-gate` (pull-request) | UX/workflow change cites grounding spec+code, or no-contract-change(reason>=20ch) | Q (process attestation) | fail-closed; reads commit range (+PR bo… | trailer | 3 / 1 |
| 90 | `decision-baseline` (pull-request) | Kernel decision baseline margins (merges origin/main) — CI-only, NOT in preflight | Q (governance) | NOT run locally by preflight (CI-only; … | --write-tree | 7 / 0 |

### A.2 Repo Guard Loop members (`scripts/check-guards.mjs`, 58 `check-no-*` guards; all fail-closed)

| # | Guard | Protects | Risk | Mechanical fix | Touch / loosen |
|---|---|---|---|---|---|
| 1 | `check-no-adhoc-mcp-protocol-versions` | MCP protocol revisions from one module | Q | none | 1 / 0 |
| 2 | `check-no-ambient-host-tests` | Unit tests independent of host state | Q | baseline: --update (ambient-host-test-baseline.tx… | 2 / 0 |
| 3 | `check-no-bare-working-write` | TaskRun 'working' writes via heartbeat helper | Q | none | 6 / 0 |
| 4 | `check-no-dialog-in-transition` | No dialog helper inside React transition | Q | none | 0 / 0 |
| 5 | `check-no-direct-git-spawn` | One git runner in scripts | M | none | 2 / 0 |
| 6 | `check-no-direct-job-engine-import` | Job engine behind facade | Q | none | 1 / 0 |
| 7 | `check-no-expired-baseline-budgets` | Every ratchet baseline has owner+unexpired expiry — expired baseline fails ALL changes | Q (repo-wide time bomb) | none | 3 / 3 |
| 8 | `check-no-governed-surface-without-mcp-tool` | Governed surfaces have MCP tool (header absent) | Q | none | 1 / 0 |
| 9 | `check-no-hand-rolled-argv` | One argv parser in scripts | M | none | 4 / 0 |
| 10 | `check-no-hand-rolled-loading` | No hand-rolled loading indicators | Q | baseline: --update (hand-rolled-loading-baseline.… | 0 / 0 |
| 11 | `check-no-hand-rolled-mcp-jsonrpc` | One MCP JSON-RPC client | M | none | 1 / 0 |
| 12 | `check-no-local-action-result` | One ActionResult shape | Q | baseline: --update (local-action-result-baseline.… | 2 / 1 |
| 13 | `check-no-local-auth-guard` | No local requireAuth reimplementations | P (authz) | none | 0 / 0 |
| 14 | `check-no-local-backup-helper` | No local backup runner helpers | P-adjacent (backup integrity) | none | 2 / 2 |
| 15 | `check-no-local-canonical-json` | One canonical JSON | Q | none | 2 / 1 |
| 16 | `check-no-local-client-credentials` | No hand-rolled OAuth client_credentials | P (security) | none | 1 / 1 |
| 17 | `check-no-local-dpf-type-redeclaration` | No copies of @dpf/types | Q | none | 1 / 0 |
| 18 | `check-no-local-formatters` | No local date/money formatters | Q | none | 2 / 2 |
| 19 | `check-no-local-isrecord` | No local isRecord | Q | none | 3 / 1 |
| 20 | `check-no-local-liveness-literal` | No hardcoded liveness set | Q | none | 1 / 1 |
| 21 | `check-no-local-lockfile-parser` | One lockfile parser | Q | none | 1 / 0 |
| 22 | `check-no-local-markdown-renderer` | One markdown renderer | P/Q (XSS posture) | none | 1 / 1 |
| 23 | `check-no-local-oauth-refresh` | No hand-rolled OAuth refresh | P (security) | none | 1 / 1 |
| 24 | `check-no-local-slugify` | One slugify | Q | none | 1 / 1 |
| 25 | `check-no-local-status-color` | Status colors via registry | Q | none | 2 / 1 |
| 26 | `check-no-manual-vm-cache-drop` | No manual VM page-cache drop recipes | P (host stability) | none | 1 / 0 |
| 27 | `check-no-mapped-enum-database-value` | @map'd enum spelled by member | P (runtime break) | none | 1 / 0 |
| 28 | `check-no-merge-readiness-policy-drift` | Merge-readiness policy drift (header absent) | M | none | 0 / 0 |
| 29 | `check-no-monolith-schema` | Prisma schema only in domain folder | Q | none | 1 / 0 |
| 30 | `check-no-nanoid-import` | No nanoid import | Q | none | 1 / 1 |
| 31 | `check-no-native-dialogs` | No window.confirm/alert/prompt | Q | none | 0 / 0 |
| 32 | `check-no-new-closed-set-strings` | Closed-set strings are enums | Q | baseline: --update (closed-set-strings-baseline.j… | 2 / 1 |
| 33 | `check-no-new-notactive-conventions` | One 'not active' convention | Q | baseline: --update (notactive-conventions-baselin… | 1 / 0 |
| 34 | `check-no-new-resource-clone-models` | No new resource-clone models | Q | baseline: --update (resource-clone-models-baselin… | 1 / 0 |
| 35 | `check-no-postgres-initdb-host-mount` | No initdb host bind mounts | P (data/upgrade) | none | 0 / 0 |
| 36 | `check-no-private-identity` | No real customer/person identity in OSS repo (also pre-commit) | P (privacy/legal) | baseline: --update (private-identity-baseline.txt) | 2 / 0 |
| 37 | `check-no-provider-local-connector-lifecycle` | Provider connector lifecycle centralized (header absent) | Q | none | 3 / 0 |
| 38 | `check-no-raw-control-bytes` | No raw C0 control bytes in source | Q | none | 1 / 0 |
| 39 | `check-no-raw-error-message` | Use getErrorMessage | Q | none | 0 / 0 |
| 40 | `check-no-raw-event-source` | No raw EventSource (HTTP/1.1 connection cap) | Q | none | 0 / 0 |
| 41 | `check-no-raw-route-error` | No raw route error JSON | Q | baseline: --update (route-error-baseline.txt) | 0 / 0 |
| 42 | `check-no-retired-lib-namespaces` | No retired lib namespaces | Q | none | 1 / 0 |
| 43 | `check-no-retired-superpowers-skills` | No retired superpowers: refs | Q | baseline: --update (superpowers-skill-baseline.tx… | 0 / 0 |
| 44 | `check-no-server-imports-in-client` | Client never imports server modules | P (build/runtime break) | none | 2 / 1 |
| 45 | `check-no-substrate-regression` | Substrate regression (header absent) | Q | none | 1 / 0 |
| 46 | `check-no-suitability-object-shorthand` | Turbopack minifier shorthand trap | P (prod-only runtime break) | none | 0 / 0 |
| 47 | `check-no-system-user-sentinel` | No 'system' user FK sentinel | P (FK failure) | none | 1 / 0 |
| 48 | `check-no-twin-artifact-drift` | Twin artifacts change together (bash/ps1 etc.) | Q/P-adjacent | none | 1 / 0 |
| 49 | `check-no-type-reexport-in-use-server` | No type re-export from 'use server' | P (runtime break) | none | 0 / 0 |
| 50 | `check-no-unattributable-deferral` | Deferred items attributable | Q | none | 3 / 0 |
| 51 | `check-no-unclassified-compose-services` | Compose services declare recreate-class | P (upgrade integrity) | none | 1 / 0 |
| 52 | `check-no-unguarded-not-contains` | Prisma NOT contains null-safe | P (data correctness) | none | 1 / 0 |
| 53 | `check-no-unhonored-grant-growth` | Grant keys honored by tools | P-adjacent (authz) | baseline: --update (unhonored-grant-baseline.txt) | 5 / 1 |
| 54 | `check-no-unlocalized-ui` | Localization ratchet (jsx copy, locale literals, physical direction, $ prefix) | Q | baseline: --update (unlocalized-ui-baseline.txt) | 1 / 1 |
| 55 | `check-no-unreachable-room-links` | Room links reachable | Q | baseline: --update (room-addressing-baseline.json) | 3 / 0 |
| 56 | `check-no-unresolved-prometheus-targets` | Prometheus targets resolve | Q | none | 2 / 1 |
| 57 | `check-no-url-pathname-fs` | No URL.pathname fs paths | Q | none | 2 / 0 |
| 58 | `check-no-web-import-cycle-growth` | Web import cycles don't grow | Q | baseline: --update (web-import-cycle-baseline.jso… | 2 / 1 |
