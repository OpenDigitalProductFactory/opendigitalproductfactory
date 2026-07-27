---
title: CI duplicate-execution refactor
date: 2026-07-27
status: active
backlog: BI-4DB73C5E
epic: EP-0DFF753B
spec: docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md
coverage_receipt: cms3quvuy0lb301p5ilijw2qz
---

# CI duplicate-execution refactor

## Outcome

Remove measured CI duplication without changing the applicable quality
contract. Each viable refactor lands through its own child BI and PR because
policy-guard aggregation, TypeScript proof reuse, production-build artifact
reuse, and test-shard balancing have independent evidence and rollback
boundaries. CodeQL parity was evaluated first and rejected: the two scans use
the same engine but deliver different security and code-quality products.

The existing stable aggregate checks remain the merge authority. Unknown,
missing, stale, mismatched, or corrupt evidence runs the original exhaustive
path.

## Evidence baseline

The first exhaustive calibration run (`30246348937`, main
`8825312b26231394d22f01059565c51b8f4e7f51`) established:

- web coverage: 59.34% statements / 60.75% lines;
- database coverage: 66.05% statements / 67.40% lines;
- web coverage: 530,694 ms; database coverage: 35,637 ms;
- production build: 278,551 ms;
- the cold-cache samples were net-negative, so broad cache restore keys remain
  prohibited.

PR #3671 (`332545998438bc8e5cc986b6c8e38598ec0a6762`) provides a current
execution baseline:

- main CI: 34.8 runner-minutes; 268-second longest job;
- 38 startup-heavy source/policy jobs: 10.3 runner-minutes;
- standalone typecheck: 189 seconds; production build: 268 seconds;
- four web test shards: 175, 190, 190, and 175 seconds;
- repository CodeQL Advanced security scan: about 10.9 runner-minutes;
- GitHub Code Quality scan: about 7.9 runner-minutes;
- UX route sweep: 1,071 seconds, including a separate 216-second portal build.

The live repository settings and GitHub documentation corrected the initial
CodeQL interpretation:

- repository security scanning is already in **Advanced setup**, using
  `.github/workflows/codeql.yml` and the `security-extended` suite;
- the dynamic runs labeled `Code Quality: ...` are the separate GitHub Code
  Quality product, enabled for Go, JavaScript/TypeScript, and Python;
- Code Quality produces maintainability/reliability findings, repository
  scores, PR bot comments and autofixes, and optional quality rules. Those
  outputs are not emitted by the advanced security workflow;
- GitHub identifies Code Quality runs by their run label even though their
  workflow name is also `CodeQL`.

Therefore the matching language databases are not evidence of duplicate
coverage. GitHub does not expose a supported contract for moving the managed
Code Quality query/result product into the advanced security workflow.
Disabling either scan would weaken the applicable contract, so
`BI-A6642373` is a verified no-consolidation outcome rather than a code change.

## Architecture and prior-design reconciliation

- Preserve `Merge Readiness` and `Unit Tests` as stable aggregates.
- Preserve exhaustive `merge_group` execution.
- Reuse the exact-tree planner and digest from `BI-A4EC0EA6`; do not introduce
  another change classifier or artifact identity.
- Preserve the exact-key Turbopack cache contract. Build artifacts use content
  checksums and tree/toolchain identity, not prefix restore keys.
- The production build proves web TypeScript only. Non-web workspace
  typechecks remain explicit.
- Guard consolidation preserves a named result and actionable failure output
  for every former job.
- Duration-weighted test assignment must account for every discovered test
  exactly once and fail closed on stale inventory.
- GitHub-hosted analysis and artifacts remain GitHub-native; they do not
  fabricate DPF `ToolExecutionReceipt` rows.

## Backlog coverage

Decision: `decomposed`.
Coverage receipt: `cms3quvuy0lb301p5ilijw2qz`.

| Deliverable | Backlog item | Depends on | Independently shippable |
| --- | --- | --- | --- |
| Evaluate CodeQL scan parity | `BI-A6642373` | none | verified distinct coverage; no delivery |
| Aggregate startup-heavy policy guards | `BI-0580AFD3` | none | yes |
| Reuse production-build web TypeScript proof | `BI-FE4C70DD` | `BI-2F60FDCE` observations | yes |
| Reuse production build in UX route sweep | `BI-959F4F38` | coordinates with `BI-9585E580` | yes |
| Duration-balance Vitest shards | `BI-5232B1DA` | `BI-2F60FDCE` observations | yes |

## Delivery order

1. **CodeQL parity (`BI-A6642373`).** Complete as a no-consolidation decision:
   retain Advanced security scanning and GitHub Code Quality because their
   outputs are not substitutable.
2. **Policy guards (`BI-0580AFD3`).** Exact-tree parity was 34/34 on PR #3675
   run `30309641352` (31.7 seconds source, 3.3 seconds pull-request). The
   versioned profiles passed blocking proof on PR #3678 run `30313483522`;
   the 34 standalone legacy definitions and aggregate dependencies are removed.
3. **TypeScript proof (`BI-FE4C70DD`).** Add parity fixtures, split non-web
   typecheck from web proof, and make stable `Typecheck` consume the exact-tree
   production-build result.
4. **Build artifact (`BI-959F4F38`).** Publish checksummed build output and
   reuse it in PR/merge-group UX; retain fail-safe rebuild and manual
   calibration paths.
5. **Shard balancing (`BI-5232B1DA`).** Generate and validate a
   duration-weighted manifest, then compare measured shard spread.

Each implementation phase gets a separate exact-SHA local gate, PR, GitHub
timing record, and rollback. The parent `BI-4DB73C5E` closes when the CodeQL
evaluation is recorded and the four viable implementation children meet their
acceptance criteria.

## Completion criteria

- The CodeQL evaluation BI is closed with its live-settings and product-contract
  evidence; every implementation child is done through the governed merge
  queue.
- Build and TypeScript work execute once per exact tree where parity is proved.
- Advanced CodeQL security coverage and GitHub Code Quality coverage both
  remain enabled until GitHub offers an evidence-backed single-run equivalent.
- Policy results remain individually visible and merge-blocking.
- Test inventory remains exhaustive and shard duration is measurement-based.
- Before/after critical path and runner-minutes are recorded for every child.
- No broad or unvalidated cache fallback is introduced.
- Documentation impact is contributor/operations only; UI and schema changes
  are not applicable.

## Standards references

- [About GitHub Code Quality](https://docs.github.com/en/code-security/concepts/about-code-quality)
- [CodeQL-powered analysis for Code Quality](https://docs.github.com/en/code-security/reference/code-quality/codeql-detection)
- [CodeQL query suites](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-query-suites)
