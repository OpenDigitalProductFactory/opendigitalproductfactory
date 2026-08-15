# Batch 10 — Runtime-Evidence Backlog Reconciliation

## Goal

Reconcile ten live reliability BacklogItems whose intake symptoms have been superseded by landed fixes, duplicate detection, or current canonical-runtime behavior. This is the tenth ten-item batch overall and the final batch in the current 50-item campaign.

The batch is intentionally evidence-shaped: it does not reimplement historical failure hypotheses that no longer reproduce. It publishes the validity ledger, verifies the existing fixes as a coherent runtime-reliability concern, deploys that ledger to this installation, and closes only the items whose completion evidence is fresh and proportional.

## Live backlog scope

1. `BI-PIR-dcf1651a` — tool-discovery route crash
2. `BI-PIR-50aca64b` — AI overview route crash
3. `BI-PIR-3f83acc1` — duplicate AI overview crash report
4. `BI-PIR-63f82a8c` — demand route missing-column crash
5. `BI-PIR-d4bf1b61` — repeated `admin_query_db` no-progress loop
6. `BI-254F31A5` — Node 26 local-CI incompatibility
7. `BI-214AA1C8` — Edge-runtime import diagnostics
8. `BI-78C88741` — UX route sweep authentication flake
9. `BI-8477003D` — Coo name-clear race
10. `BI-90970BE2` — sanitized-clone role integrity

## Validity and supersession audit

| BacklogItem | Disposition | Current evidence |
|---|---|---|
| BI-PIR-dcf1651a | verified-existing / superseded | The authenticated `/platform/tools/discovery` route is populated and does not crash. Current source resolves roster identity through the canonical identity helper, with focused roster regressions passing. |
| BI-PIR-50aca64b | verified-existing / superseded | The authenticated `/platform/ai/overview` route loads without a crash. The historical digest has one occurrence and no recent portal-log recurrence. |
| BI-PIR-3f83acc1 | duplicate / superseded | Two reports for digest `1268942627` were created about 20 ms apart on 2026-07-21. Current issue triage folds repeat crash digests into an existing item, and the dedicated dedupe regression passes. |
| BI-PIR-63f82a8c | verified-existing / superseded | The authenticated `/ops/demand` route loads. Its read model now fails soft when an older installation lacks an additive column, and the missing-column regression passes. |
| BI-PIR-d4bf1b61 | verified-existing / superseded | Runtime issue analysis now detects repeated same-tool no-progress loops and emits a governed finding instead of allowing unbounded repetition; focused regressions pass. |
| BI-254F31A5 | verified-existing | The exact-tree local-CI sandbox gate ran under Node 26 and passed. Host web-service storage is deliberately disabled in that harness, preventing the historical incompatibility. |
| BI-214AA1C8 | verified-existing | The current exact-tree production gate and CI complete without Edge-runtime import diagnostics. Existing boundary checks cover the affected import class. |
| BI-78C88741 | verified-existing | Twelve consecutive `ux-route-sweep.yml` runs succeeded across multiple branches before this PR, exceeding the requested five-run/two-branch stability threshold. |
| BI-8477003D | verified-existing | The Coo regression now waits for the persisted `name: null` state before asserting, removing the race; the focused suite passes. |
| BI-90970BE2 | verified-existing | Sanitized-clone classification excludes both `PlatformRole` and `UserGroup`, preserving role integrity, with the dedicated clone suite passing. |

The live `PlatformIssueReport` rows for the crash digests are single-occurrence historical records; the two same-digest AI overview reports are a historical race duplicate. A 24-hour portal-log search found no matching digest or message recurrence. Because the progressively disclosed MCP registry could not refresh the required raw issue/lease schemas in this session, those two read-only validity checks used the canonical PostgreSQL database as an explicit fallback; no runtime state was modified through the database.

## Work deliberately preserved

This reconciliation is not a broad “close old incidents” sweep. Live evidence shows `claim_nonprod_environment_lease` still has meaningful contention/failure traffic (229 failures among 865 calls in the inspected 24-hour window), so `BI-86587483` remains valid and open. Windows crossing items `BI-BE8F8B32`, `BI-B1324C32`, `BI-0C6F0F38`, and `BI-1C44C146` also remain outside this batch because their platform-specific defects still require implementation evidence.

That separation is the supersession guard: only non-recurring, already-fixed outcomes enter this PR; active reliability work remains visible in the live backlog.

## Governed scope decision

WWMD consultation `DI-2498AA4589EF` recommended `publish_reconciliation_and_close` with high confidence, composite `8.617`, margin `6.577`, strong structured coverage, no commandment conflict, and autonomy eligibility. The strongest contributors were Propose–Acknowledge–Reassign and Ship Real Functionality. The selected path is therefore to publish, merge, deploy, revalidate, and close these ten evidence-backed outcomes rather than reimplement stale hypotheses or defer without a durable trail.

## Verification already completed

- Authenticated canonical-runtime exercise of `/platform/tools/discovery`, `/platform/ai/overview`, and `/ops/demand`.
- Focused web suites: 53 tests for demand fail-soft behavior, crash triage, runtime issue analysis, and Coo state persistence.
- Focused roster suites: 49 tests for canonical agent/roster identity behavior.
- Focused database suite: 34 sanitized-clone tests.
- Focused scripts suites: 52 local-CI integration and sandbox-freshness tests.
- Total focused verification: 188 passing tests.
- Twelve consecutive successful UX route sweeps across multiple branches.
- Exact-tree local-CI and production gates completed without the historical Node 26 or Edge-runtime failures.

## Completion gates

1. Generate and verify the documentation index so this ledger is discoverable through the platform documentation substrate.
2. Merge current `origin/main` after Batch 9 lands, then run source-local policy and documentation checks against the exact Batch 10 tree.
3. Obtain an independent semantic review receipt for the stable commit.
4. Push, open a ready PR, pass `pnpm pr:health`, and merge through the queue.
5. Deploy only through `/ops/self-upgrade`; verify that the canonical runtime serves the exact merge SHA.
6. Re-exercise the three affected routes and retrieve this plan through the live documentation/search surface.
7. Record server-resolved execution evidence per item and transition all ten to `done` using verified-existing or documentation completion classes.

## Documentation impact

This plan is the durable operator-facing validity and supersession ledger. It does not change a public API, route, schema, prompt, migration, or user workflow. The documentation-index generator and freshness check run in this PR; the generated artifact remains unchanged because implementation plans are not indexed as documentation pages.

## Non-goals

- Rewriting already-landed fixes solely to produce new diffs.
- Closing active nonprod lease contention or Windows crossing items.
- Treating a historical issue report as proof of current recurrence.
- Editing runtime issue or backlog state through direct SQL.
- Bypassing the canonical runtime or `/ops/self-upgrade` for validation.

## Backlog coverage

Coverage receipt `cmsserao101sp01pn2r7oxzfa` records a decomposed mapping from umbrella `BI-PIR-dcf1651a` to all ten live items above. Each item has an independently shippable evidence disposition; the duplicate AI overview report depends on the primary AI overview reconciliation, while deployment and canonical-runtime checks are shared completion dependencies.
