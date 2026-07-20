# Sanitized-clone transaction scaling

**Backlog item:** BI-CD96EDD2  
**Epic:** EP-5410E8EA  
**Work capsule:** WC-CC21ABCD  
**Branch:** `codex/sanitized-clone-timeout`

## Outcome

Contributor sanitized clones must copy arbitrarily large confidential tables without depending on Prisma's five-second default interactive-transaction timeout. Inserts remain trigger-suppressed, bounded, and fail-safe: any failed chunk still causes the existing destination-wide reset before the preview can start.

## Evidence and substrate

- The governed BI-7430E579 preview run reached `insertRowsWithReplicationDisabled` after the geographic repair and failed with Prisma `P2028` at 5,001 ms.
- The same run reported `ContributorInventorySnapshot` at 165,323 confidential rows. The current implementation issues one insert per row inside one interactive transaction, so a table's transaction duration grows without bound with row count.
- `runWithDestinationCleanup` already owns publication safety and resets all 521 destination application tables after any clone failure. This change must preserve that behavior.
- The required session-local `session_replication_role=replica` posture is already correct; each new chunk transaction must set it before inserting.

## TDD plan

1. Add a failing unit test that requires confidential inserts to be split into deterministic chunks.
2. Require every chunk to open an interactive transaction with explicit bounded `maxWait` and `timeout` options and to set `session_replication_role` before row inserts.
3. Implement the smallest reusable transaction policy around the existing insert path; do not change sensitivity classification, obfuscation, native-column omission, or destination cleanup.
4. Run the targeted sanitized-clone suite, the full DB suite/typecheck, and an exact-SHA merged-code pregate.
5. Re-run the governed isolated Contributor preview and prove pgvector readiness, all migrations, sanitized clone completion, and `:3001/api/health`.

## Documentation impact

- This is an internal clone scalability correction. The implementation plan and PR evidence are the required contributor documentation.
- No user-guide workflow, public positioning, route map, AI-coworker behavior, schema, migration, or platform-support watchlist entry changes.

## Backlog coverage

- Decision: atomic
- Parent: `BI-CD96EDD2`
- Bounded sanitized-clone transaction policy, chunking, regression contract, and live-sized proof -> `BI-CD96EDD2`
- Dependencies: none
- Receipt: `cmrt8mgt600ww01mu0ehanupx`
- Rationale: The transaction policy, chunking implementation, regression contract, and live-sized clone proof form one inseparable correction to a single sanitized-clone write path; none is independently useful or safe to ship without the others.

The live MCP surface does not yet expose `record_plan_backlog_coverage`, so this receipt was written through the governed `record_execution_evidence` path with the equivalent atomic decision, deliverable mapping, dependency graph, and rationale after live verification of the parent BI.

## Completion evidence

- [x] TDD red reproduced the missing exported bounded-insert contract.
- [x] Targeted sanitized-clone suite passes (25/25); DB TypeScript typecheck passes.
- [x] Governed live-sized clone passed the former failure point and copied the 165,323-row `ContributorInventorySnapshot` without `P2028`.
- [x] Exact-SHA merged-code pregate passes at `044e123d325e1ddec211ace02d1671bd5fd2343d`.
- [ ] PR health is terminal/passing with zero unresolved review threads.

The same clone then failed later on five source-side duplicate `DigitalProduct.productId` groups while the corresponding unique index reports valid/ready/live. The fail-safe reset again cleared all 521 destination application tables. That separate fleet-data repair is tracked by `BI-BCF8A8D5`; this BI does not mask it in clone logic.
