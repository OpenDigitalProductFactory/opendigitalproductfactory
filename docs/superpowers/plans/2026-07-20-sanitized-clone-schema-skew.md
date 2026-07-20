# Sanitized clone additive schema-skew tolerance

**Backlog item:** `BI-080670E4`  
**Epic:** `EP-5410E8EA`  
**Work capsule:** `WC-970F331F`  
**Branch:** `codex/sanitized-clone-schema-skew`

## Outcome

Contributor preview can clone a live installation whose source schema contains additive columns that have not yet reached the destination branch. Public and internal tables stream only the compatible, non-generated columns shared by source and destination; incompatible shared column types fail closed with a precise error. The destination-wide reset, restricted/confidential classifications, trigger suppression, and bounded-memory behavior remain intact.

## Evidence and substrate

- A governed preview run against current `main` reproduced the defect on `DecisionInteraction.gateKey`: the live source had two additive columns from an in-flight branch, while the migrated destination did not.
- `copyTableVerbatim` currently pipes a source `pg_dump --data-only` into destination `psql`. The dump owns its source column list, so the destination rejects source-ahead columns before the fail-safe cleanup resets all 521 application tables.
- Both databases already expose authoritative column names, types, ordinal position, and generated-column posture through `information_schema.columns`.
- The existing child-process pipeline is the correct bounded-memory boundary. Replacing `pg_dump` with paired `psql COPY ... FORMAT binary` processes preserves streaming while allowing an explicit, catalog-derived shared column list.
- The full rerun also proved that the restricted `VectorEmbedding` model's `@@map("vector_embedding")` physical name bypassed the model-keyed classification and reached the confidential fallback. Physical-name resolution must preserve the restricted no-copy decision; inserting a redacted null vector is both meaningless and rejected by the non-null column.

## TDD implementation

1. Add failing pure-contract tests for source-ahead and destination-ahead additive columns, generated-column exclusion, catalog identifier quoting, type-drift rejection, and source/destination COPY command arguments.
2. Read both catalogs, resolve shared insertable columns in source order for both verbatim and obfuscated paths, and reject an empty or type-incompatible projection.
3. Stream binary COPY from the source query into destination COPY using argument arrays only; retain destination `session_replication_role=replica` and bounded child stderr.
4. Keep confidential/audit rows on their existing typed obfuscation path and restricted tables skipped, including Prisma models with mapped physical table names.
5. Run focused tests, DB typecheck, documentation/data-impact gates, exact-SHA merged-code pregate, and a governed full clone where the source contains the two extra `DecisionInteraction` columns.

## Backlog coverage

- Decision: atomic
- Parent: `BI-080670E4`
- Shared-column resolution, streaming COPY, fail-closed type checks, regression tests, exact gate, and full source-ahead preview proof -> `BI-080670E4`
- Dependencies: none
- Downstream: blocks final acceptance of `BI-7430E579` and authenticated UX proof for `BI-ADEF2982`
- Receipt: `cmrtl4tcg01a701lpmor4diz8`
- Rationale: resolving columns without changing the streaming transport would still fail on additive skew; changing transport without catalog/type guards could silently corrupt data. They form one clone-compatibility invariant.

The deployed MCP surface does not expose `record_plan_backlog_coverage`, so the receipt uses the governed `record_execution_evidence` compatibility path with the same atomic decision, mapping, dependencies, and rationale.

## Architecture and documentation impact

- No Prisma schema, migration, route, user workflow, provider behavior, or production data changes.
- Update the Contributor preview architecture spec and setup guide because the supported source/destination skew contract is operator-relevant.
- The source database remains read-only. The destination is disposable and retains the existing reset-before-copy and reset-on-failure guarantees.

## Completion evidence

- [x] Red unit tests reproduced the missing compatibility contract; the first real rerun additionally proved the confidential `DecisionInteraction` path needed the same projection before destination cleanup ran.
- [x] Focused clone tests pass (31/31) and DB typecheck passes.
- [x] Exact-SHA merged-code pregate passes against current `origin/main` with sandbox freshness, migrations, full web tests, and production build green.
- [x] Under lease `NPEL-ECC53AEB66`, all 521 source tables completed and `:3001/api/health` returned HTTP 200 while the source had two additional `DecisionInteraction` columns, the destination had zero, and all 182 decision rows cloned. Restricted `vector_embedding` correctly remained empty.
- [ ] PR health is terminal/passing and the merge queue lands the repair.
