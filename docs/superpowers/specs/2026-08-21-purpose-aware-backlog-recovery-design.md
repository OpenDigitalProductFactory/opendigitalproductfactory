---
status: active
---

# Purpose-Aware Backlog Recovery

- **Date:** 2026-08-21
- **Backlog item:** `BI-4A833B6D`
- **Program:** `EP-1FABA22D` / `BI-34667080`
- **Scope:** platform-development coordination recovery after a replacement install
- **Source program design:** `docs/superpowers/specs/2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md`
- **Decision:** `DI-78024D57939D` — explicit recovery bundle

## 1. Outcome

1. **OBJ-PABR-001:** A replacement platform-development install can reconstruct the purpose-aware installation epic and its original backlog graph from reviewed repository evidence without manual re-entry.
2. **OBJ-PABR-002:** PostgreSQL remains the only current-state backlog authority; recovery never turns the repository bundle into a second mutable backlog or an automatic customer seed.
3. **OBJ-PABR-003:** Reconciliation is safe to preview and repeat: it creates missing records atomically and leaves every existing record unchanged.
4. **OBJ-PABR-004:** The recovered graph retains the stable identifiers, lifecycle state, dependencies, scope, and P0 completion provenance needed to resume the program.

This design preserves coordination state. It does not implement the purpose-aware onboarding product, replace whole-install backup and restore, or make platform roadmap work part of a customer installation.

## 2. Existing substrate

The recovery path reuses the canonical `Epic`, `BacklogItem`, and `BacklogItemActivity` models. The repository contributes an immutable input artifact plus a parser and operator command; normal backlog changes continue through MCP and PostgreSQL.

The committed bundle contains one epic, the umbrella item, and seven original delivery slices. It excludes claims, internal row IDs, credentials, organization/customer data, and the recovery BI itself. Automatic seed entry points do not import it.

DPF's canonical deployment contract still owns full lifecycle backup and restore. This narrower path exists because restoring a whole database would also restore unrelated install-local state, while losing this program would force manual reconstruction.

## 3. Recovery contract

The versioned JSON document uses closed keys and semantic `EP-*` / `BI-*` identifiers. Validation happens before writes and rejects unsupported versions, duplicate identifiers, unresolved bundled dependencies, invalid lifecycle combinations, and sensitive or install-local keys.

The operator command is dry-run by default. `--apply` opens one database transaction and processes records in dependency order:

1. create the epic when missing;
2. create missing items under that epic;
3. create preserved activities only for newly created items;
4. commit only after the whole graph succeeds.

An existing epic or item is skipped wholesale. Recovery never updates its title, body, status, dependencies, evidence, claim, or timestamps. This is intentionally narrower than a declarative merge because live progress outranks the recovery snapshot.

## 4. Authority and data architecture

- **Live authority:** PostgreSQL `Epic`, `BacklogItem`, and `BacklogItemActivity` rows.
- **Recovery evidence:** reviewed, version-controlled JSON outside automatic seed namespaces.
- **Writer:** the explicit operator CLI using the existing Prisma transaction boundary.
- **Identity:** semantic IDs are portable; database relation IDs are resolved on the target install.
- **No new schema:** no table, enum, migration, or parallel status projection is introduced.

The design follows `architecture-over-shortcuts` and `single-source-of-truth`: recovery restores canonical rows instead of teaching runtime readers to consult Git. It follows the deployment lifecycle contract by keeping full PostgreSQL backup/restore as the whole-install mechanism and documenting this bundle as selective coordination recovery.

## 5. Scale, security, and privacy

The first bundle is bounded to one epic, eight items, and three preserved P0 activities. Parsing, validation, preview, and reconciliation are linear in the number of bundled records. A recovery bundle is an intentionally reviewed program-sized artifact; whole-install or fleet-scale recovery remains the backup subsystem's job.

Strict parsing rejects unknown and sensitive key names recursively. The CLI prints stable IDs and action counts, never credentials or connection strings. The committed text is platform roadmap material already represented in public repository documents and contains no customer or organization data.

## 6. Research and benchmarking

- [PostgreSQL `pg_restore`](https://www.postgresql.org/docs/current/app-pgrestore.html) supports selective archive restore, but table-level restoration is too coarse for an eight-item coordination graph and risks coupling recovery to internal row identities. DPF retains PostgreSQL logical restore for whole-install recovery.
- [Kubernetes declarative object management](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/) separates source-controlled configuration from live object state and offers a preview before apply. DPF adopts the reviewed-artifact and dry-run ideas, but rejects field merge and pruning here: an existing live backlog record always wins and recovery never deletes.
- DPF's `packages/db/scripts/export-backlog.ts` and `packages/db/scripts/seed-backlog-reconciliation.ts` provide local portability and idempotent-reconciliation precedent. This design factors the reusable validation/reconciliation policy into `packages/db/src/backlog-recovery-bundle.ts` instead of adding another seed path.

## 7. Failure and rollback

- Invalid input fails before the transaction.
- A write failure rolls back the entire bundle.
- Re-running after success reports skips and performs no writes.
- Removing the command and bundle rolls back the repository capability; already restored canonical backlog rows remain governed live data.
- An operator who needs unrelated install state uses the normal PostgreSQL backup/restore path, not this command.

## 8. Acceptance mapping

| Acceptance ID | Objective IDs | Required evidence | Design section |
|---|---|---|---|
| AC-PABR-001 | OBJ-PABR-001, OBJ-PABR-004 | The committed bundle contains `EP-1FABA22D`, `BI-34667080`, all seven delivery slices, and P0 PR #4334 provenance | §§2–3 |
| AC-PABR-002 | OBJ-PABR-002 | Recovery is outside automatic seed paths and PostgreSQL remains the documented live authority | §§2, 4 |
| AC-PABR-003 | OBJ-PABR-003 | Dry run performs no writes; first apply is atomic; second apply creates nothing | §§3, 7 |
| AC-PABR-004 | OBJ-PABR-003, OBJ-PABR-004 | Existing rows are skipped without status or evidence regression | §3 |
| AC-PABR-005 | OBJ-PABR-001, OBJ-PABR-004 | Operator documentation names the explicit post-install preview and apply commands | §§1, 3 |
| AC-PABR-006 | OBJ-PABR-002, OBJ-PABR-003 | Validation rejects unsupported, ambiguous, secret-bearing, and install-local input before writes | §§3, 5 |

## 9. Review boundary

This repository artifact becomes the canonical scope baseline only after an independent design reviewer records a governed `spec-approval` receipt against its immutable blob. The implementation plan must then record live backlog coverage against the same subject. A Markdown statement of approval or coverage is not a receipt.
