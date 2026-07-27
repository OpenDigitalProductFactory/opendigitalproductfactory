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
contract. Each refactor lands through its own child BI and PR because CodeQL
ownership, policy-guard aggregation, TypeScript proof reuse, production-build
artifact reuse, and test-shard balancing have independent evidence and
rollback boundaries.

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
- repository Advanced CodeQL: about 10.9 runner-minutes;
- organization-managed CodeQL: about 7.9 runner-minutes;
- UX route sweep: 1,071 seconds, including a separate 216-second portal build.

The CodeQL REST/configuration audit found the repository attached to the
unenforced global `GitHub recommended` configuration with default setup
enabled, while `.github/workflows/codeql.yml` runs the same
JavaScript/TypeScript, Python, and Go analyses plus Actions. Both authorities
posted checks for the same PR head.

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
| One CodeQL authority per language | `BI-A6642373` | none | yes |
| Aggregate startup-heavy policy guards | `BI-0580AFD3` | none | yes |
| Reuse production-build web TypeScript proof | `BI-FE4C70DD` | `BI-2F60FDCE` observations | yes |
| Reuse production build in UX route sweep | `BI-959F4F38` | coordinates with `BI-9585E580` | yes |
| Duration-balance Vitest shards | `BI-5232B1DA` | `BI-2F60FDCE` observations | yes |

## Delivery order

1. **CodeQL authority (`BI-A6642373`).** Remove duplicate language ownership,
   keep Actions/JavaScript-TypeScript/Python/Go coverage, add a configuration
   guard, and record before/after runner-minutes.
2. **Policy guards (`BI-0580AFD3`).** Introduce a versioned guard registry and
   a small profile matrix. Emit named results and make the merge aggregate
   reject missing registry entries.
3. **TypeScript proof (`BI-FE4C70DD`).** Add parity fixtures, split non-web
   typecheck from web proof, and make stable `Typecheck` consume the exact-tree
   production-build result.
4. **Build artifact (`BI-959F4F38`).** Publish checksummed build output and
   reuse it in PR/merge-group UX; retain fail-safe rebuild and manual
   calibration paths.
5. **Shard balancing (`BI-5232B1DA`).** Generate and validate a
   duration-weighted manifest, then compare measured shard spread.

Each phase gets a separate exact-SHA local gate, PR, GitHub timing record, and
rollback. The parent `BI-4DB73C5E` closes only when all five children meet
their acceptance criteria.

## Completion criteria

- Every child BI is done through the governed merge queue.
- Build and TypeScript work execute once per exact tree where parity is proved.
- Each supported CodeQL language has one authoritative scan.
- Policy results remain individually visible and merge-blocking.
- Test inventory remains exhaustive and shard duration is measurement-based.
- Before/after critical path and runner-minutes are recorded for every child.
- No broad or unvalidated cache fallback is introduced.
- Documentation impact is contributor/operations only; UI and schema changes
  are not applicable.
