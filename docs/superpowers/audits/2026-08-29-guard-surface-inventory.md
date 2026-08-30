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
| KEEP AS-IS | 52 | cited defect, self-tested, under a second |
| KEEP + CITE DEFECT | 15 | keep, but record the defect class in the header |
| KEEP + ADD TEST | 14 | keep, but prove the guard itself with a sibling test |
| SAMPLE-OR-DEFER | 9 | over 1s: cheap in the parallel cloud, dear on the serial host |
| MOVE-TO-CLOUD | 4 | over 3s and network-bound: does not belong on the push path |
| RETIRE-OR-WIRE | 1 | reachable from no stage at all |

**81 of 95 stay exactly as they are. No guard is recommended for deletion.**

## Inventory

A trailing `+` on the date marks a guard added in the last six weeks.

| guard (`check-…`) | added | provenance | cost | runs in | preflight | self-test | edits | recommendation |
| --- | --- | --- | ---: | --- | :-: | :-: | ---: | --- |
| `agent-capability-integrity` | 2026-08-21 + | b64f3fa807 | 46ms | audit-agent-capability-integrity.yml | — | **no** | 2 | KEEP + ADD TEST |
| `application-boundaries` | 2026-08-01 + | 2afbe6c5d5 | 189ms | source | yes | yes | 2 | KEEP AS-IS |
| `archetype-completeness` | 2026-07-22 + | 666835d026 | 63ms | source | yes | yes | 1 | KEEP + CITE DEFECT |
| `build-namespace` | 2026-06-25 | 7bb12d2681 | 484ms | source | yes | **no** | 2 | KEEP + ADD TEST |
| `build-script-policy` | 2026-08-08 + | 1ffb0546fc | 41ms | source | yes | yes | 2 | KEEP + CITE DEFECT |
| `build-studio-surface-budget` | 2026-08-21 + | 11300f1541 | 63ms | source | yes | yes | 1 | KEEP AS-IS |
| `bundle-boundaries` | 2026-06-06 | 0dfd9a1b37 | 1557ms | source | yes | yes | 4 | SAMPLE-OR-DEFER |
| `capability-compose-profiles` | 2026-07-18 + | 1c157563a8 | 57ms | source | yes | yes | 1 | KEEP + CITE DEFECT |
| `capability-consumers` | 2026-07-24 + | 3a32dc729e | 112ms | source | yes | yes | 1 | KEEP AS-IS |
| `ci-policy-test-inventory` | 2026-08-09 + | 53b2abe0d6 | 57ms | source | yes | **no** | 1 | KEEP + ADD TEST |
| `compose-env-contract` | 2026-07-18 + | b5cb1bbec3 | 43ms | source | yes | yes | 2 | KEEP + CITE DEFECT |
| `compose-resource-budgets` | 2026-08-09 + | eeeb1edfee | 46ms | source | yes | yes | 1 | KEEP AS-IS |
| `context-economy` | 2026-07-30 + | 503228688a | 158ms | source | yes | yes | 2 | KEEP AS-IS |
| `data-impact` | 2026-07-18 + | d5658d6898 | 149ms | pull-request | yes | yes | 2 | KEEP + CITE DEFECT |
| `design-grounding-decision` | 2026-07-13 | bd59eba7c6 | 1225ms | pull-request | yes | yes | 4 | SAMPLE-OR-DEFER |
| `diagram-dependency-pins` | 2026-07-12 | 1597e4675f | 42ms | source | yes | **no** | 3 | KEEP + ADD TEST |
| `doc-anchor-existence` | 2026-08-18 + | 1622c0b5fd | 154ms | source | yes | yes | 3 | KEEP AS-IS |
| `doc-links` | 2026-07-17 | d99c636e84 | 81ms | source | yes | yes | 1 | KEEP + CITE DEFECT |
| `doc-reference-integrity` | 2026-07-12 | 8ba5f21921 | 203ms | source | yes | yes | 1 | KEEP AS-IS |
| `docker-patch-context` | 2026-08-15 + | 16485659ed | 49ms | source | yes | yes | 1 | KEEP + CITE DEFECT |
| `dockerfile-copied-script-imports` | 2026-08-27 + | BI-9B490215 | 51ms | source | yes | yes | 1 | KEEP AS-IS |
| `docs-impact` | 2026-07-17 | 0e1c68dbae | 150ms | pull-request | yes | yes | 4 | KEEP + CITE DEFECT |
| `edge-node-image-bom` | 2026-08-04 + | cf9429b984 | 54ms | ci.yml (edge-footprint-bom) | — | **no** | 1 | KEEP + ADD TEST |
| `endpoint-classification` | 2026-08-18 + | 707a12488e | 59ms | source | yes | yes | 2 | KEEP AS-IS |
| `finding-substrate` | 2026-07-16 | b3a207b145 | 50ms | source | yes | yes | 2 | KEEP + CITE DEFECT |
| `fk-index-coverage` | 2026-08-17 + | 2b20a05b55 | 63ms | source | yes | yes | 2 | KEEP AS-IS |
| `golden-decisions` | 2026-06-20 | 64240bba67 | 68ms | pull-request | — | yes | 3 | KEEP AS-IS |
| `governed-teardown-contract` | 2026-08-22 + | 91d2b1fef7 | 67ms | source | yes | yes | 2 | KEEP AS-IS |
| `guards` | 2026-07-09 | 7b6ce8a133 | 27948ms | source | yes | yes | 3 | MOVE-TO-CLOUD |
| `instruction-plane-rule-coverage` | 2026-07-31 + | 68adf3df9d | 570ms | source | yes | yes | 4 | KEEP AS-IS |
| `instruction-plane-size` | 2026-07-24 + | 0d45e8806c | 50ms | source | yes | yes | 5 | KEEP AS-IS |
| `label-association` | 2026-08-21 + | 7400e140cf | 130ms | source | yes | **no** | 1 | KEEP + ADD TEST |
| `live-blocker-references` | 2026-08-23 + | 4219a6ef70 | 157ms | source | yes | yes | 1 | KEEP AS-IS |
| `mcp-tool-pack` | 2026-06-26 | 9f0d77d50a | 46ms | source | yes | **no** | 2 | KEEP + ADD TEST |
| `merge-queue-churn` | 2026-06-23 | 869eed53da | 8967ms | merge-queue-churn-watch.yml | — | yes | 1 | MOVE-TO-CLOUD |
| `missing-ci-dispatch` | 2026-08-04 + | 3575436e19 | 634ms | watch-missing-ci-dispatch.yml | — | yes | 1 | KEEP + CITE DEFECT |
| `mobile-jest-pin` | 2026-05-23 | f728213421 | 43ms | source | yes | **no** | 2 | KEEP + ADD TEST |
| `module-size` | 2026-06-26 | 9f0d77d50a | 811ms | source | yes | yes | 7 | KEEP AS-IS |
| `n-minus-one-caller-honesty` | 2026-07-19 + | b7dc0abf32 | 303ms | source | yes | yes | 1 | KEEP AS-IS |
| `no-adhoc-mcp-protocol-versions` | 2026-08-18 + | 8d488b42eb | 46ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-ambient-host-tests` | 2026-08-23 + | d7096d23a1 | 507ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-bare-working-write` | 2026-05-20 | d36f543dd1 | 308ms | guard-loop (auto) | — | yes | 5 | KEEP AS-IS |
| `no-dialog-in-transition` | 2026-07-06 | b5ce8ea20b | 582ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-expired-baseline-budgets` | 2026-08-18 + | 1622c0b5fd | 52ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-governed-surface-without-mcp-tool` | 2026-08-09 + | 0ddf07377e | 50ms | guard-loop (auto) | — | yes | 1 | KEEP + CITE DEFECT |
| `no-hand-rolled-loading` | 2026-07-18 + | 5a19d5148a | 343ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-local-action-result` | 2026-08-17 + | 350779bf13 | 460ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-auth-guard` | 2026-07-08 | e2a279c1e8 | 69ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-local-backup-helper` | 2026-07-09 | 177d41fb74 | 413ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-client-credentials` | 2026-07-10 | 0a5fce2c40 | 929ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-isrecord` | 2026-07-08 | 3944fd42aa | 415ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-local-liveness-literal` | 2026-07-10 | 0999f4308a | 387ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-oauth-refresh` | 2026-07-10 | d41b35498c | 956ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-local-status-color` | 2026-07-10 | 89d73a3a3e | 499ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-merge-readiness-policy-drift` | 2026-07-26 + | e94ee5024d | 53ms | guard-loop (auto) | — | yes | 1 | KEEP + CITE DEFECT |
| `no-monolith-schema` | 2026-08-18 + | 5285d63521 | 416ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-nanoid-import` | 2026-07-10 | fd886a494b | 1675ms | guard-loop (auto) | — | yes | 2 | SAMPLE-OR-DEFER |
| `no-native-dialogs` | 2026-06-16 | 9452525090 | 715ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-new-closed-set-strings` | 2026-08-17 + | 2b20a05b55 | 105ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-new-notactive-conventions` | 2026-08-19 + | c0757500e7 | 59ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-new-resource-clone-models` | 2026-08-19 + | c0757500e7 | 49ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-postgres-initdb-host-mount` | 2026-07-16 | ab70ee690b | 43ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-private-identity` | 2026-07-17 | f7f8a47861 | 1295ms | guard-loop (auto) | — | yes | 2 | SAMPLE-OR-DEFER |
| `no-provider-local-connector-lifecycle` | 2026-07-18 + | bcd764353e | 4472ms | guard-loop (auto) | — | yes | 2 | MOVE-TO-CLOUD |
| `no-raw-error-message` | 2026-07-08 | d8c7851768 | 718ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-raw-event-source` | 2026-06-20 | e745ce72d6 | 582ms | guard-loop (auto) | — | **no** | 1 | KEEP + ADD TEST |
| `no-raw-route-error` | 2026-07-10 | 89d73a3a3e | 112ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-retired-lib-namespaces` | 2026-08-19 + | da09d69896 | 43ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-retired-superpowers-skills` | 2026-07-17 | a8abf406bc | 199ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-substrate-regression` | 2026-07-17 | 738b56a74b | 765ms | guard-loop (auto) | — | yes | 1 | KEEP + CITE DEFECT |
| `no-suitability-object-shorthand` | 2026-07-22 + | 6d568e6d53 | 48ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-system-user-sentinel` | 2026-06-14 | 361f26d674 | 378ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-twin-artifact-drift` | 2026-08-23 + | b704a4c7ce | 61ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-type-reexport-in-use-server` | 2026-07-10 | a2193c7778 | 517ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `no-unhonored-grant-growth` | 2026-08-23 + | f7fdb64d04 | 52ms | guard-loop (auto) | — | yes | 2 | KEEP AS-IS |
| `no-unresolved-prometheus-targets` | 2026-08-23 + | d087bf7f07 | 48ms | guard-loop (auto) | — | yes | 1 | KEEP AS-IS |
| `obligation-cadence-coverage` | 2026-08-22 + | 0d9f5bea09 | 46ms | NOWHERE | — | **no** | 1 | RETIRE-OR-WIRE |
| `override-comments` | 2026-07-22 + | a3cb1db2e3 | 41ms | source | yes | yes | 4 | KEEP AS-IS |
| `package-boundaries` | 2026-06-25 | 803bdb5230 | 50ms | source | yes | **no** | 1 | KEEP + ADD TEST |
| `plan-backlog-coverage` | 2026-07-20 + | 12fbdeb751 | 219ms | pull-request | yes | yes | 1 | KEEP + CITE DEFECT |
| `published-image-freshness` | 2026-08-16 + | 7e5f97aa03 | 3891ms | published-image-freshness.yml | — | **no** | 1 | MOVE-TO-CLOUD |
| `reporting-composition` | 2026-07-07 | a20608643d | 231ms | source | yes | yes | 2 | KEEP AS-IS |
| `retention-enrollment` | 2026-08-17 + | 2b20a05b55 | 54ms | source | yes | yes | 2 | KEEP AS-IS |
| `retired-substrate` | 2026-08-01 + | ad562045f1 | 111ms | source | yes | yes | 1 | KEEP + CITE DEFECT |
| `seed-fit-decision` | 2026-07-11 | e46ed0bf82 | 1160ms | pull-request | — | yes | 1 | SAMPLE-OR-DEFER |
| `spec-plan-doc` | 2026-06-18 | 9ffc1a9bc7 | 1118ms | pull-request | yes | **no** | 5 | SAMPLE-OR-DEFER |
| `spec-status-frontmatter` | 2026-08-18 + | 1622c0b5fd | 297ms | source | yes | yes | 1 | KEEP AS-IS |
| `stewardship-scope` | 2026-07-23 + | 0965445005 | 54ms | source | yes | yes | 2 | KEEP AS-IS |
| `style-drift` | 2026-06-25 | fae62a282d | 1446ms | source | yes | yes | 5 | SAMPLE-OR-DEFER |
| `test-clock-bombs` | 2026-08-06 + | 4d896354c7 | 1032ms | source | yes | yes | 1 | SAMPLE-OR-DEFER |
| `test-cwd-independence` | 2026-08-23 + | bc4d95e62a | 506ms | source | yes | yes | 2 | KEEP AS-IS |
| `tool-surface` | 2026-07-31 + | 5c6a0cac21 | 155ms | source | yes | yes | 2 | KEEP AS-IS |
| `ux-fit-decision` | 2026-06-15 | 53e0b77c83 | 1163ms | pull-request | yes | yes | 8 | SAMPLE-OR-DEFER |
| `ux-primitive-adoption` | 2026-08-17 + | 350779bf13 | 403ms | source | yes | yes | 1 | KEEP AS-IS |
| `work-unit-conformance` | 2026-08-14 + | dca9682731 | 850ms | source | yes | yes | 1 | KEEP AS-IS |

## Reproducing this

Time every guard individually, dump the preflight plan, and read any guard's add date:

~~~
node scripts/pregate-preflight.mjs --plan
node scripts/pregate-preflight.mjs
git log --diff-filter=A --format=%ad --date=short -1 -- scripts/check-<name>.mjs
~~~

