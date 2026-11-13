# Repository security and issue intake: implementation plan

**Design:** [2026-11-13-repository-security-intake-grouping-design.md](../specs/2026-11-13-repository-security-intake-grouping-design.md) · **Umbrella:** BI-C67E5CCB

## Deliverables

| Key | Backlog item | Independently shippable | Depends on |
| --- | --- | --- | --- |
| D1 | BI-C67E5CCB: security intake (CodeQL + secret scanning readers, grouping, priority, resolution) | yes | none |
| D2 | BI-6B28699D: issue exclusions (#4389, local outward filings) and reply-on-done drafts | yes | none |

D1 lands first on branch `feat/security-intake-grouping`. D2 gets its own branch and Workroom afterwards.

## D1 phases (TDD: each test is written failing first)

### Phase 1: readers

- `apps/web/lib/ecosystem/code-scanning-reader.ts` and `secret-scanning-reader.ts`, each with a `.test.ts`. The tests cover: a paginated happy path; 403 → `{ok:false}` naming the missing permission; a malformed alert → `{ok:false}`; a truncated page cap → `{ok:false}`; a foreign Link host refused; the secret reader never returns the `secret` field (AC-5, AC-7).
- The shared pager stays in each reader for now. Extracting it is a follow-up only if a fourth reader appears.

### Phase 2: grouping and priority

- `apps/web/lib/ecosystem/security-finding-groups.ts`, a pure module with a test. It covers the Dependabot group per (ecosystem, package) across manifests, the CodeQL group per rule, secrets one per alert, the priority tier table, the title/body, a fingerprint that is stable under alert reordering, and a changed fingerprint on a new alert (AC-2, AC-3).
- `inbound-issue-triage.ts`: `InboundSourceKind` gains `dependabot-package | code-scanning-rule | secret-scanning-alert`. `toBacklogIngestInput` passes `priority` and uses `source: automated-detection` and `workType: bug` for all three. `mapDependabotAlerts` is removed (AC-6).

### Phase 3: lifecycle

- `apps/web/lib/ecosystem/security-finding-lifecycle.ts`, with injected store functions and a test. It covers: absent → evidence + awaiting-acceptance; an active build → evidence only; present on awaiting-acceptance → open + regression; present on done → regression counted, no status write; a priority tier change → update + activity; an unchanged tier → no write; an incomplete surface → no writes at all (AC-4, AC-5).

### Phase 4: runner and reporting

- `inbound-triage-runner.ts`: read the three surfaces independently, with `sourceErrors` per surface, then call the lifecycle with the set of complete surfaces.
- `ecosystem-inbound-triage.ts` `summarizeScan`: a per-surface count line plus closed/reopened/regression counts (AC-1).
- Update the existing runner and queue tests.

### Phase 5: docs

- The catalog `purpose` text in `catalog-ecosystem.ts` names the three surfaces.
- The user guide section on the inbound triage job, if one exists (search `docs/user-guide`).

## Verification

- Unit: `pnpm --filter web vitest run lib/ecosystem lib/queue/functions/ecosystem-inbound-triage`.
- Typecheck: the web package typecheck.
- Live, after landing and `request_self_upgrade`: trigger `ecosystem/inbound-issue-triage.requested`, then read `ScheduledJob.lastRunSummary` and the backlog items ordered by priority. This is the runtime evidence. A worktree run is not.
- Post-live one-off: retire the legacy per-alert Dependabot items as duplicates of their package groups (AC-6).

## Traceability

| Requirement | Contract | Flow | Verification |
| --- | --- | --- | --- |
| AC-1, AC-5 | readers return `RepositoryAlertRead`-style results | runner → sourceErrors | reader tests, runner test, live summary |
| AC-2, AC-3, AC-7 | `groupSecurityFindings` | runner → ingest | groups test |
| AC-4 | `reconcileSecurityLifecycle` | runner → acceptance sweep | lifecycle test, live run |
| AC-6 | no per-alert origin | runner | triage test, post-live retire |
