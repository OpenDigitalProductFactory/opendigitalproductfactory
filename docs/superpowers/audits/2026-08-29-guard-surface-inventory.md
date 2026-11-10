# Guard inventory — all 95 pre-merge guards, measured

Measured 2026-08-29 against `main` @ 97b32d3 on host 192.168.0.152.
Companion to `docs/superpowers/specs/2026-08-29-change-delivery-latency-tiering-design.md` (EP-ABB3AC9D).

## Method

Each guard was executed once, individually, against a clean tree, with a 180s timeout
and `NODE_OPTIONS=--max-old-space-size=8192`. All 95 exited 0.
Stage membership was resolved by importing `POLICY_GUARD_PROFILES` and
`buildPreflightPlan()` and matching command strings. `check-no-*` guards are
discovered dynamically by `scripts/check-guards.mjs` rather than registered by name.
Provenance is the first `BI-*` reference in the guard's first 4000 bytes when that
item resolves in the live backlog, and otherwise the commit that added the guard.
**87 of the 88 distinct BI ids cited across guard headers do not resolve**: the live
backlog's oldest row is dated 2026-08-22 and the guards date from 2026-05-20, so every
pre-reset citation is unrecoverable from the substrate. The add-commit is durable, so
it is cited instead — 69 guards cite a BI that no longer resolves and 25 cite none at all.
Edits counts commits touching the file since it was added.

## What each guard buys

The brief asked, per guard, what defect motivated it and whether that class
has recurred. The live backlog cannot answer it: 87 of 88 cited BI ids predate
the 2026-08-22 reset. Git can. Two independent signals, over 7,105 commits on
main:

- **mentions** — commits whose message names the guard file. When a guard blocks
  a change, the commit that unblocks it tends to name it.
- **baseline** — commits touching the guard's ratchet baseline or allowlist.
  Each one is the guard forcing a recorded change. A baseline with a single
  commit was created and never touched again.

**83 of 95 guards have firing evidence. 12 have none.** A guard with no trace is
not proven inert — it may have fired and been fixed without being named — so
"no trace" is reported as absence of evidence, never as evidence of absence.

The cost/benefit conclusion is narrow: exactly **one** guard is both untraced and
costs over a second, and exactly **one** is wired into no stage at all. The other
93 either earn their cost or are too cheap to be worth removing.

## Totals

| measure | value |
| --- | --- |
| Guards | 95 (plus 88 companion `.test.mjs`) |
| Added since 2026-07-18 | 55 — the surface grew 40 to 95 |
| **All 95, serial** | **76.3s** |
| of which `check-guards.mjs` (nested loop over 37 ratchets and their self-tests) | 27.9s |
| **The 55 recent guards** | **17.9s** |
| Per-guard cost | median 155ms, p75 517ms, p90 1160ms |
| Under 200ms | 52 of 95, 3.9s in total |
| Cite no motivating BI | 25 |
| Cite a BI that no longer resolves | 69 of 70 |
| Have no self-test | 17 |
| Never modified since added | 53 |
| Run in the host preflight | 50 |

For comparison, the median local-CI slot hold is 776s and the p90 queue wait is 1053s.
**The entire guard surface is 9.8% of one slot hold**, and the six weeks of new guards
account for 17.9 seconds of it.

## Recommendation summary

| recommendation | count | meaning |
| --- | ---: | --- |
| KEEP AS-IS | 57 | cited defect, self-tested, under a second |
| KEEP + CITE DEFECT | 0 | keep, but record the defect class in the header |
| KEEP + ADD TEST | 14 | keep, but prove the guard itself with a sibling test |
| SAMPLE-OR-DEFER | 0 | over 1s: cheap in the parallel cloud, dear on the serial host |
| MOVE-TO-CLOUD | 4 | over 3s and network-bound: does not belong on the push path |
| RETIRE-OR-WIRE | 1 | reachable from no stage at all |

**81 of 95 stay exactly as they are. No guard is recommended for deletion.**

## Inventory

A trailing `+` on the date marks a guard added in the last six weeks.

| guard (`check-…`) | added | provenance | **fires** | cost | runs in | preflight | self-test | edits | recommendation |
| --- | --- | --- | --- | ---: | --- | :-: | :-: | ---: | --- |
| `agent-capability-integrity` | 2026-08-21 + | b64f3fa807 | 1 commit | 46ms | audit-agent-capability-integrity.yml | — | **no** | 2 | KEEP + ADD TEST |
| `application-boundaries` | 2026-08-01 + | 2afbe6c5d5 | 2 commits | 189ms | source | yes | yes | 2 | KEEP AS-IS |
| `archetype-completeness` | 2026-07-22 + | 666835d026 | 3 commits | 63ms | source | yes | yes | 1 | KEEP AS-IS |
| `build-namespace` | 2026-06-25 | 7bb12d2681 | 3 commits | 484ms | source | yes | **no** | 2 | KEEP + ADD TEST |
| `build-script-policy` | 2026-08-08 + | 1ffb0546fc | 2 commits | 41ms | source | yes | yes | 2 | KEEP AS-IS |
| `build-studio-surface-budget` | 2026-08-21 + | 11300f1541 | 2 commits | 63ms | source | yes | yes | 1 | KEEP AS-IS |
| `bundle-boundaries` | 2026-06-06 | 0dfd9a1b37 | 4 commits | 1557ms | source | yes | yes | 4 | KEEP, TIER |
| `capability-compose-profiles` | 2026-07-18 + | 1c157563a8 | no trace | 57ms | source | yes | yes | 1 | KEEP, WATCH |
| `capability-consumers` | 2026-07-24 + | 3a32dc729e | 1 commit | 112ms | source | yes | yes | 1 | KEEP AS-IS |
| `ci-policy-test-inventory` | 2026-08-09 + | 53b2abe0d6 | 3 commits, baseline 14x | 57ms | source | yes | **no** | 1 | KEEP + ADD TEST |
| `compose-env-contract` | 2026-07-18 + | b5cb1bbec3 | 1 commit | 43ms | source | yes | yes | 2 | KEEP AS-IS |
| `compose-resource-budgets` | 2026-08-09 + | eeeb1edfee | no trace | 46ms | source | yes | yes | 1 | KEEP, WATCH |
| `context-economy` | 2026-07-30 + | 503228688a | 2 commits | 158ms | source | yes | yes | 2 | KEEP AS-IS |
| `data-impact` | 2026-07-18 + | d5658d6898 | 2 commits | 149ms | pull-request | yes | yes | 2 | KEEP AS-IS |
| `design-grounding-decision` | 2026-07-13 | bd59eba7c6 | 1 commit | 1225ms | pull-request | yes | yes | 4 | KEEP, TIER |
| `diagram-dependency-pins` | 2026-07-12 | 1597e4675f | 2 commits | 42ms | source | yes | **no** | 3 | KEEP + ADD TEST |
| `doc-anchor-existence` | 2026-08-18 + | 1622c0b5fd | 6 commits | 154ms | source | yes | yes | 3 | KEEP AS-IS |
| `doc-links` | 2026-07-17 | d99c636e84 | 6 commits | 81ms | source | yes | yes | 1 | KEEP AS-IS |
| `doc-reference-integrity` | 2026-07-12 | 8ba5f21921 | 5 commits | 203ms | source | yes | yes | 1 | KEEP AS-IS |
| `docker-patch-context` | 2026-08-15 + | 16485659ed | 2 commits | 49ms | source | yes | yes | 1 | KEEP AS-IS |
| `dockerfile-copied-script-imports` | 2026-08-27 + | BI-9B490215 | 1 commit | 51ms | source | yes | yes | 1 | KEEP AS-IS |
| `docs-impact` | 2026-07-17 | 0e1c68dbae | 6 commits | 150ms | pull-request | yes | yes | 4 | KEEP AS-IS |
| `edge-node-image-bom` | 2026-08-04 + | cf9429b984 | 1 commit | 54ms | ci.yml (edge-footprint-bom) | — | **no** | 1 | KEEP + ADD TEST |
| `endpoint-classification` | 2026-08-18 + | 707a12488e | 2 commits | 59ms | source | yes | yes | 2 | KEEP AS-IS |
| `finding-substrate` | 2026-07-16 | b3a207b145 | 2 commits | 50ms | source | yes | yes | 2 | KEEP AS-IS |
| `fk-index-coverage` | 2026-08-17 + | 2b20a05b55 | 2 commits | 63ms | source | yes | yes | 2 | KEEP AS-IS |
| `golden-decisions` | 2026-06-20 | 64240bba67 | 3 commits | 68ms | pull-request | — | yes | 3 | KEEP AS-IS |
| `governed-teardown-contract` | 2026-08-22 + | 91d2b1fef7 | no trace | 67ms | source | yes | yes | 2 | KEEP, WATCH |
| `guards` | 2026-07-09 | 7b6ce8a133 | 19 commits | 27948ms | source | yes | yes | 3 | MOVE-TO-CLOUD |
| `instruction-plane-rule-coverage` | 2026-07-31 + | 68adf3df9d | 2 commits, baseline 5x | 570ms | source | yes | yes | 4 | KEEP AS-IS |
| `instruction-plane-size` | 2026-07-24 + | 0d45e8806c | 5 commits, baseline 17x | 50ms | source | yes | yes | 5 | KEEP AS-IS |
| `label-association` | 2026-08-21 + | 7400e140cf | 1 commit | 130ms | source | yes | **no** | 1 | KEEP + ADD TEST |
| `live-blocker-references` | 2026-08-23 + | 4219a6ef70 | 2 commits | 157ms | source | yes | yes | 1 | KEEP AS-IS |
| `mcp-tool-pack` | 2026-06-26 | 9f0d77d50a | 2 commits | 46ms | source | yes | **no** | 2 | KEEP + ADD TEST |
| `merge-queue-churn` | 2026-06-23 | 869eed53da | 2 commits | 8967ms | merge-queue-churn-watch.yml | — | yes | 1 | MOVE-TO-CLOUD |
| `missing-ci-dispatch` | 2026-08-04 + | 3575436e19 | no trace | 634ms | watch-missing-ci-dispatch.yml | — | yes | 1 | KEEP, WATCH |
| `mobile-jest-pin` | 2026-05-23 | f728213421 | 3 commits | 43ms | source | yes | **no** | 2 | KEEP + ADD TEST |
| `module-size` | 2026-06-26 | 9f0d77d50a | 28 commits, baseline 248x | 811ms | source | yes | yes | 7 | KEEP AS-IS |
| `n-minus-one-caller-honesty` | 2026-07-19 + | b7dc0abf32 | 1 commit | 303ms | source | yes | yes | 1 | KEEP AS-IS |
| `no-adhoc-mcp-protocol-versions` | 2026-08-18 + | 8d488b42eb | 1 commit | 46ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-ambient-host-tests` | 2026-08-23 + | d7096d23a1 | 1 commit | 507ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-bare-working-write` | 2026-05-20 | d36f543dd1 | 2 commits | 308ms | guard-loop (auto) | — | yes | 5 | KEEP AS-IS |
| `no-dialog-in-transition` | 2026-07-06 | b5ce8ea20b | 1 commit | 582ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-expired-baseline-budgets` | 2026-08-18 + | 1622c0b5fd | 3 commits | 52ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-governed-surface-without-mcp-tool` | 2026-08-09 + | 0ddf07377e | no trace | 50ms | guard-loop (auto) | — | yes | 1 | KEEP, WATCH |
| `no-hand-rolled-loading` | 2026-07-18 + | 5a19d5148a | 3 commits, baseline 3x | 343ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-local-action-result` | 2026-08-17 + | 350779bf13 | 1 commit | 460ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-auth-guard` | 2026-07-08 | e2a279c1e8 | 1 commit | 69ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-local-backup-helper` | 2026-07-09 | 177d41fb74 | 1 commit | 413ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-client-credentials` | 2026-07-10 | 0a5fce2c40 | 1 commit | 929ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-isrecord` | 2026-07-08 | 3944fd42aa | 4 commits | 415ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-local-liveness-literal` | 2026-07-10 | 0999f4308a | 1 commit | 387ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-oauth-refresh` | 2026-07-10 | d41b35498c | 1 commit | 956ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-status-color` | 2026-07-10 | 89d73a3a3e | 1 commit | 499ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-merge-readiness-policy-drift` | 2026-07-26 + | e94ee5024d | no trace | 53ms | guard-loop (auto) | — | yes | 1 | KEEP, WATCH |
| `no-monolith-schema` | 2026-08-18 + | 5285d63521 | 1 commit | 416ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-nanoid-import` | 2026-07-10 | fd886a494b | 2 commits | 1675ms | guard-loop (auto) | — | yes | 2 | KEEP, TIER |
| `no-native-dialogs` | 2026-06-16 | 9452525090 | 3 commits | 715ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-new-closed-set-strings` | 2026-08-17 + | 2b20a05b55 | 2 commits | 105ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-new-notactive-conventions` | 2026-08-19 + | c0757500e7 | 1 commit | 59ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-new-resource-clone-models` | 2026-08-19 + | c0757500e7 | 1 commit | 49ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-postgres-initdb-host-mount` | 2026-07-16 | ab70ee690b | 1 commit | 43ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-private-identity` | 2026-07-17 | f7f8a47861 | 4 commits | 1295ms | guard-loop (auto) | — | yes | 2 | KEEP, TIER |
| `no-provider-local-connector-lifecycle` | 2026-07-18 + | bcd764353e | 3 commits | 4472ms | guard-loop (auto) | — | yes | 2 | MOVE-TO-CLOUD |
| `no-raw-error-message` | 2026-07-08 | d8c7851768 | 8 commits | 718ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-raw-event-source` | 2026-06-20 | e745ce72d6 | 2 commits | 582ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-raw-route-error` | 2026-07-10 | 89d73a3a3e | 6 commits, baseline 5x | 112ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-retired-lib-namespaces` | 2026-08-19 + | da09d69896 | 1 commit | 43ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-retired-superpowers-skills` | 2026-07-17 | a8abf406bc | 1 commit | 199ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-substrate-regression` | 2026-07-17 | 738b56a74b | 1 commit | 765ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-suitability-object-shorthand` | 2026-07-22 + | 6d568e6d53 | 1 commit | 48ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-system-user-sentinel` | 2026-06-14 | 361f26d674 | 1 commit | 378ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-twin-artifact-drift` | 2026-08-23 + | b704a4c7ce | no trace | 61ms | guard-loop (auto) | — | yes | 1 | KEEP, WATCH |
| `no-type-reexport-in-use-server` | 2026-07-10 | a2193c7778 | 2 commits | 517ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-unhonored-grant-growth` | 2026-08-23 + | f7fdb64d04 | 1 commit | 52ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-unresolved-prometheus-targets` | 2026-08-23 + | d087bf7f07 | 1 commit | 48ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `obligation-cadence-coverage` | 2026-08-22 + | 0d9f5bea09 | no trace | 46ms | NOWHERE | — | **no** | 1 | RETIRE-OR-WIRE |
| `override-comments` | 2026-07-22 + | a3cb1db2e3 | 3 commits | 41ms | source | yes | yes | 4 | KEEP AS-IS |
| `package-boundaries` | 2026-06-25 | 803bdb5230 | 1 commit | 50ms | source | yes | **no** | 1 | KEEP + ADD TEST |
| `plan-backlog-coverage` | 2026-07-20 + | 12fbdeb751 | 2 commits | 219ms | pull-request | yes | yes | 1 | KEEP AS-IS |
| `published-image-freshness` | 2026-08-16 + | 7e5f97aa03 | 1 commit | 3891ms | published-image-freshness.yml | — | **no** | 1 | MOVE-TO-CLOUD |
| `reporting-composition` | 2026-07-07 | a20608643d | no trace | 231ms | source | yes | yes | 2 | KEEP, WATCH |
| `retention-enrollment` | 2026-08-17 + | 2b20a05b55 | 2 commits | 54ms | source | yes | yes | 2 | KEEP AS-IS |
| `retired-substrate` | 2026-08-01 + | ad562045f1 | 2 commits | 111ms | source | yes | yes | 1 | KEEP AS-IS |
| `seed-fit-decision` | 2026-07-11 | e46ed0bf82 | no trace | 1160ms | pull-request | — | yes | 1 | SAMPLE-OR-RETIRE |
| `spec-plan-doc` | 2026-06-18 | 9ffc1a9bc7 | 2 commits | 1118ms | pull-request | yes | **no** | 5 | KEEP, TIER |
| `spec-status-frontmatter` | 2026-08-18 + | 1622c0b5fd | 4 commits, baseline 2x | 297ms | source | yes | yes | 1 | KEEP AS-IS |
| `stewardship-scope` | 2026-07-23 + | 0965445005 | 2 commits, baseline 3x | 54ms | source | yes | yes | 2 | KEEP AS-IS |
| `style-drift` | 2026-06-25 | fae62a282d | 10 commits | 1446ms | source | yes | yes | 5 | KEEP, TIER |
| `test-clock-bombs` | 2026-08-06 + | 4d896354c7 | 1 commit | 1032ms | source | yes | yes | 1 | KEEP, TIER |
| `test-cwd-independence` | 2026-08-23 + | bc4d95e62a | no trace | 506ms | source | yes | yes | 2 | KEEP, WATCH |
| `tool-surface` | 2026-07-31 + | 5c6a0cac21 | 2 commits | 155ms | source | yes | yes | 2 | KEEP AS-IS |
| `ux-fit-decision` | 2026-06-15 | 53e0b77c83 | 10 commits | 1163ms | pull-request | yes | yes | 8 | KEEP, TIER |
| `ux-primitive-adoption` | 2026-08-17 + | 350779bf13 | 4 commits | 403ms | source | yes | yes | 1 | KEEP AS-IS |
| `work-unit-conformance` | 2026-08-14 + | dca9682731 | no trace | 850ms | source | yes | yes | 1 | KEEP, WATCH |

## End-to-end timeline, by change shape

Measured 2026-09-02 over the 45 most recent merged PRs, joined to the real
`local-integration-ci` leases that gated their branches. Median minutes.

| shape | n | first commit to PR open | gate wait | gate hold | PR open to merged | **total** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| docs | 6 | 0.8 | — | — | 21.1 | **22.9** |
| source | 37 | 12.5 | 73.9 | 20.0 | 25.9 | **43.8** |
| schema | 2 | — | — | — | 21.9 | **36.7** |

p90 total: docs 0.6h, source 2.3h, schema 0.6h.

Two caveats the numbers do not carry on their own. Only 5 of the 45 branches had
lease rows on this host, so the gate columns are a small sample, and they are
sums across attempts rather than per-attempt figures — a branch that gated three
times contributes all three waits. And 4 of those 5 branches needed more than one
lease attempt, which is the retry churn this epic exists to remove.

Against the stated service level — docs under 20 minutes, source under 40 — docs
misses by 3 minutes and source by 4. Both are close; neither is met.

## Host memory during a gate stage

The reserve that decides whether a second slot may admit was, until 2026-08-30, a
number with no evidence behind it. The evidence existed: every vitest stage
receipt carries roughly fifty host samples with free memory. `scripts/local-ci-host-stage-calibration.mjs`
reads them.

Across 90 receipts:

| | minimum free memory while a stage ran |
| --- | --- |
| p10 | 4.39 GiB |
| p50 | 15.47 GiB |
| worst observed | **0.28 GiB** |

The host genuinely exhausts itself during some runs. That is the finding that
matters, because it means the reserve must **not** simply be shrunk to raise the
two-slot fit rate — shrinking it admits a second stage onto precisely the runs
whose free memory later collapses.

Split by coverage mode, the affected-test change is already doing that work:

| stage | runs | p10 free | p50 free |
| --- | ---: | ---: | ---: |
| `exhaustive-vitest` | 83 | 4.39 GiB | 15.47 GiB |
| `affected-vitest` | 7 | **7.62 GiB** | **21.60 GiB** |

An affected run leaves 74% more headroom at p10. The second slot becomes
reachable as the fleet converts to affected runs, without touching the reserve.

## Reproducing this

Time every guard individually, dump the preflight plan, and read any guard's add date:

~~~
node scripts/pregate-preflight.mjs --plan
node scripts/pregate-preflight.mjs
git log --diff-filter=A --format=%ad --date=short -1 -- scripts/check-<name>.mjs
~~~

