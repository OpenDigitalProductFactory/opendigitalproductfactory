---
title: "Dev Container Setup"
area: contributing
order: 2
---

## Dev Container Setup (VS Code)

For developers who want a fully containerized development environment. Everything runs inside Docker — no local Node.js or pnpm required.

### Prerequisites

| Tool | Version |
| ---- | ------- |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | 4.40+ |
| [VS Code](https://code.visualstudio.com/) | Latest |
| [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) | Latest |

### First-Time Setup

1. Clone the repo and ensure the production stack is running (`docker compose up -d`)
2. Open the repo folder in VS Code
3. Press `F1` and select **Dev Containers: Reopen in Container**
4. Wait for the dev databases to start, migrations to run, and sanitized data to populate

The dev server starts automatically on port 3001. Open `http://localhost:3001` in your browser. Production remains on port 3000.

Before starting the Contributor preview, set `CONTRIBUTOR_PREVIEW_PASSWORD` in
the repository `.env` to a development-only password of at least 12 characters.
Do not reuse `ADMIN_PASSWORD` or another live credential.

Login: `preview-admin@dpf.test` / the value of
`CONTRIBUTOR_PREVIEW_PASSWORD` in `.env`.

### What the Dev Container Provides

- An isolated PostgreSQL database (separate from production), including vector and graph storage
- Sanitized copy of production data (PII obfuscated, credentials replaced)
- Shared LLM inference via Docker Model Runner (no duplication)
- Pre-installed extensions: ESLint, Prisma, Tailwind CSS, Prettier
- Hot-reload Next.js dev server

### Important Notes

- Build Studio and VS Code should be treated as complementary interfaces, not separate source trees
- Production promotion still belongs to the portal's governed workflow
- The sanitized clone runs on first startup — production must be running as the data source
- Contributor database readiness verifies both PostgreSQL connectivity and pgvector availability before migrations start. If `dev-postgres` remains unhealthy, inspect its health output and recreate that contributor-only service from the checked-in `pgvector/pgvector:pg16` image; do not bypass `dev-init` or edit an applied migration.
- Migration deploy for the preview runs through a disposable-only converge wrapper (`packages/db/scripts/dev-preview-migrate-deploy.mjs`). The known `20260605060000_hive_contributions_surface` drift remains independently allowlisted: before marking it applied, the wrapper verifies every owned schema effect, including required column types, nullability, declared defaults, ledger primary key and original indexes. Additive effects from later immutable migrations are permitted.
- The separate `20261114130000_relation_drift_repair` recovery restores missing migration-owned graph reference rows only when both immutable SQL files match their reviewed hashes, the earlier registry migration has matching completed history, the registry shape matches, and the only active failed migration has the exact matching checksum and known missing `PART_OF`/`DEPENDS_ON` foreign-key error. Restoration rechecks this proof under a transaction lock, uses the original registry migration's missing-only insert, and verifies every expected key before committing. Existing labels, statuses and custom rows are retained. Prisma then marks the failed attempt **rolled back** and actually reruns migration deploy once; this migration is never marked applied. A second failure stops the attempt. Wrong destination, source/history/schema mismatch or unrelated failure remains **`blocked_sandbox_drift`**; retain the evidence and use the governed recovery path rather than editing history or deleting the volume.
- **Disposable recovery (contributor preview only):** when logs say `blocked_sandbox_drift` and name volume `dpf_dev_pgdata`, recreate that volume and re-run the dev profile. Never delete live portal volumes (`dpf_pgdata` / production Postgres). Example:

  ```bash
  docker compose --profile dev stop dev-portal dev-init dev-postgres
  docker volume rm dpf_dev_pgdata
  docker compose --profile dev up -d
  ```

- The clone resets the disposable development application tables before copying. Restricted provider, credential, token, and connection records are not copied; production-derived search/vector values are omitted rather than carrying source terms or embeddings into the preview.
- The preview copies production's data, never its identity. After copying, the clone removes production's installation identity (installation id and signing key), its operating intent and environment declaration, its estate identity, and every federation link, outbox record and delivery job. The preview therefore never presents itself to a paired installation as production, and it starts with no federation links of its own.
- Every copied workforce password remains invalid. After sanitization, the clone provisions only `preview-admin@dpf.test` from the separate development-only `CONTRIBUTOR_PREVIEW_PASSWORD`; production hashes and passwords are never reused. Authorization memberships are omitted with their restricted platform roles, so the preview cannot retain dangling role references.
- Additive source-schema differences are expected during concurrent development. Source-only columns or tables are left out of the preview, destination-only columns use their migrated defaults, and a shared column with an incompatible type stops the clone with a precise error instead of risking a corrupt preview.
- Before copying, the clone verifies the live source's critical identity indexes and their heap semantics. A message naming `InventoryEntity_entityKey_key` or `PlatformIssueReport_dedupeKey_open_key` is a **source-integrity stop**: the live source must be repaired through a forward migration before preview can proceed. Recreating the disposable preview volume cannot repair that source condition.
- Clone publication is fail-safe: if any table cannot be copied or sanitized, the development application tables are cleared again while Prisma migration history and the installed migration-owned graph dictionary are retained. Both reset and source COPY exclude that dictionary, so an empty or older source cannot erase its installed reference rows. The Contributor preview will not start against a partially copied relational dataset. Correct the reported source/tooling error and use the governed development initialization path to retry. Deploy or revert the coupled reset/COPY policy together; a source rollback that restores dictionary deletion holds preview work instead of deleting restored rows or changing history.

### Related

- [Developer Setup](developer-setup.md) — native pnpm + Docker sidecars alternative
- [Development Workspace](../development-workspace.md) — how Build Studio, VS Code, and production promotion fit together
