# Prisma 5.22.0 → 7.x Upgrade Design

**Date:** 2026-03-18
**Status:** Draft
**Approach:** Direct jump (5 → 7)

## Context

The project pins Prisma at 5.22.0 (`prisma` CLI + `@prisma/client`) in `packages/db/package.json`. A globally cached Prisma 7.5.0 caused a runtime failure because `prisma generate` picked up v7 semantics against a v5 schema. The project should use the latest Prisma everywhere — both locally and globally — to eliminate version skew.

Prisma 7 is a major rewrite: new generator provider, driver-adapter–based client, and a `prisma.config.ts` file replacing schema-level connection config. Prisma 6 introduced minor breaking changes (Buffer → Uint8Array for Bytes fields, NotFoundError removal) but these do not affect this project — no Bytes fields, no NotFoundError catch blocks, no `$use()` middleware.

## Scope

- Upgrade `prisma` and `@prisma/client` from 5.22.0 to ^7.5.0
- Add `@prisma/adapter-pg`, `pg`, and `dotenv` dependencies
- Create `prisma.config.ts`
- Update schema generator and datasource blocks
- Update client instantiation to use driver adapter
- Fix all scripts/tests that call `new PrismaClient()` directly (9 files)
- Remove all `--schema` flags from shell scripts and PowerShell scripts
- Replace `prisma db seed` calls with direct `tsx` invocation
- Update Dockerfile to copy `prisma.config.ts` in Stage 2
- Update `pnpm-workspace.yaml` allowBuilds
- Update SQL file comment headers with correct v7 commands

## Out of Scope

- PostgreSQL version upgrade (already on 16, well supported)
- Schema model changes
- Migration squashing or reset
- Prisma Accelerate or Pulse adoption

## Verification Criteria

- `prisma generate` succeeds with v7 and produces a valid client
- `prisma migrate deploy` applies all 46 existing migrations without error
- `prisma studio` launches and connects
- The web app starts and the workspace page loads without the `prisma.policy.count` TypeError
- Docker build completes (stages 2, 3, and 4)
- Docker init container runs migrations and seed successfully
- All standalone scripts execute without import errors
- `scripts/fresh-install.ps1` runs `prisma db execute` without `--schema` errors
- `scripts/restore-full-db.sh` runs without `--schema` or `prisma db seed` errors

## Design

### 1. Schema Changes

**File:** `packages/db/prisma/schema.prisma`

Before:
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../generated/client"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

After:
```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/client"
}

datasource db {
  provider = "postgresql"
}
```

- Generator provider: `"prisma-client-js"` → `"prisma-client"` (new Rust-free client)
- Datasource: remove `url` line (moves to `prisma.config.ts`)

### 2. New prisma.config.ts

**File:** `packages/db/prisma.config.ts` (new)

```typescript
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrate: {
    schema: "prisma/schema.prisma",
  },
});
```

This file tells the Prisma CLI where to find the schema and how to run migrations. The `DATABASE_URL` environment variable is consumed by the driver adapter at runtime, not by the schema.

Note: `dotenv` must be added as a dependency (see Section 4) so that `import "dotenv/config"` works during `postinstall` → `prisma generate`.

### 3. Client Instantiation

**File:** `packages/db/src/client.ts`

Before:
```typescript
import { PrismaClient } from "../generated/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

After:
```typescript
import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

The `PrismaPg` adapter replaces the built-in Rust query engine with a pure JS/TS PostgreSQL driver.

### 4. Dependency Changes

**File:** `packages/db/package.json`

| Package | Old | New | Section |
|---------|-----|-----|---------|
| `@prisma/client` | `5.22.0` | `^7.5.0` | dependencies |
| `@prisma/adapter-pg` | — | `^7.5.0` | dependencies (new) |
| `pg` | — | `^8.13.0` | dependencies (new) |
| `dotenv` | — | `^16.4.0` | dependencies (new) |
| `prisma` | `5.22.0` | `^7.5.0` | devDependencies |
| `@types/pg` | — | `^8.11.0` | devDependencies (new) |

### 5. Fix All `new PrismaClient()` Call Sites

In Prisma 7, `new PrismaClient()` without an `adapter` argument fails at runtime. Every file that instantiates its own client must switch to the shared singleton.

**Files under `packages/db/` — change to `import { prisma } from "../src/client"` (or appropriate relative path):**

| File | Current Import |
|------|---------------|
| `scripts/archive-persona-agents.ts` | `from "@prisma/client"` |
| `scripts/seed-endpoint-manifests.ts` | `from "@prisma/client"` |
| `scripts/migrate-capability-tiers.ts` | `from "@prisma/client"` |
| `scripts/seed-service-endpoints.ts` | `from "../generated/client"` |
| `scripts/init-neo4j.ts` | `from "../generated/client"` |
| `src/seed-platform-product.ts` | `from "../generated/client"` |
| `src/discovery-attribution-model.test.ts` | `from "../generated/client"` |

**Root-level scripts — change to `import { prisma } from "../packages/db/src/client"`:**

| File | Current Import |
|------|---------------|
| `scripts/show-backlog.ts` | `from "../packages/db/generated/client"` |
| `scripts/detect-hardware.ts` | `from "../packages/db/generated/client"` |

Note: `detect-hardware.ts` runs inside the Docker init container (`docker-entrypoint.sh` line 19), so this is a production-critical fix.

### 6. Docker Entrypoint

**File:** `docker-entrypoint.sh`

Before:
```bash
cd /app
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
```

After:
```bash
cd /app/packages/db
npx prisma migrate deploy
```

The `--schema` flag is removed in Prisma 7. The schema path is now defined in `prisma.config.ts`, which is resolved from `packages/db/`.

### 7. Dockerfile

**File:** `Dockerfile`

Stage 2 (`deps`) must copy `prisma.config.ts` so that the `postinstall` → `prisma generate` step can find it:

```dockerfile
# Add after the existing schema.prisma COPY line:
COPY packages/db/prisma.config.ts ./packages/db/
```

Stages 3 and 4 use `COPY . .` so they already pick up the file.

### 8. Remove `--schema` Flag from All Scripts

Prisma 7 removes the `--schema` flag from all CLI commands. The schema path comes from `prisma.config.ts`.

**`scripts/restore-full-db.sh` (3 executable occurrences):**

Before:
```bash
npx prisma db execute --file "$SCRIPT_DIR/db-export-epics-backlog.sql" --schema prisma/schema.prisma
npx prisma db execute --file "$SCRIPT_DIR/db-export-runtime-state.sql" --schema prisma/schema.prisma
npx prisma db execute --file "$sql_file" --schema prisma/schema.prisma
```

After (ensure cwd is `packages/db`):
```bash
npx prisma db execute --file "$SCRIPT_DIR/db-export-epics-backlog.sql"
npx prisma db execute --file "$SCRIPT_DIR/db-export-runtime-state.sql"
npx prisma db execute --file "$sql_file"
```

**`scripts/restore-full-db.sh` — replace `prisma db seed`:**

Before:
```bash
npx prisma db seed
```

After:
```bash
npx tsx src/seed.ts
```

`prisma db seed` was removed in Prisma 7.

**`scripts/fresh-install.ps1` (1 occurrence, line 333):**

Before:
```powershell
pnpm --filter @dpf/db exec prisma db execute --file "../../$sql" --schema prisma/schema.prisma 2>$null
```

After:
```powershell
pnpm --filter @dpf/db exec prisma db execute --file "../../$sql" 2>$null
```

### 9. Update SQL Comment Headers

These SQL files have comment-only `--schema` references that become misleading. Update the run instructions:

- `scripts/seed-crm-epic.sql`
- `scripts/seed-hr-epic.sql`
- `scripts/seed-sbom-epic.sql`
- `scripts/seed-vision-epics.sql`
- `scripts/seed-calendaring-epic.sql`
- `scripts/update-selfdev-epic-runtime-registration.sql`
- `scripts/update-finance-epic.sql`
- `scripts/update-calendar-epic.sql`

Change pattern:
```sql
-- Before:
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/<file>.sql --schema prisma/schema.prisma

-- After:
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/<file>.sql
```

### 10. Update pnpm-workspace.yaml

**File:** `pnpm-workspace.yaml`

Prisma 7 replaces the Rust query engine with a pure JS client. The `@prisma/engines` package may no longer exist in the dependency tree. Update `allowBuilds`:

Before:
```yaml
allowBuilds:
  '@prisma/client': true
  '@prisma/engines': true
```

After (verify post-install whether `@prisma/engines` is still present; if not, remove):
```yaml
allowBuilds:
  '@prisma/client': true
```

### 11. No Changes Required

- **Logging API** — `log` option in PrismaClient constructor is unchanged in v7
- **121 files importing via `@dpf/db`** — they import the singleton from `packages/db/src/index.ts`, no changes needed
- **Type re-exports** in `packages/db/src/index.ts` — `Prisma` and `PrismaClient` types still export from the generated client
- **46 existing migrations** — remain valid; `prisma migrate deploy` applies them unchanged
- **Main seed script** — `src/seed.ts` already imports from `./client.js` (the singleton), no changes needed

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Generated client types change shape | Low | 121 consumer files use standard CRUD — API surface is stable |
| Migration replay fails on v7 | Very low | Migrations are SQL files; the engine just applies them |
| `@prisma/adapter-pg` connection pooling differs | Low | PrismaPg uses `pg` Pool internally; same connection semantics |
| Docker build fails at Stage 2 | Medium | Mitigated by adding `COPY prisma.config.ts` line |
| `postinstall` fails without dotenv | Medium | Mitigated by adding `dotenv` as dependency |
| Root-level scripts fail in Docker | High if missed | `detect-hardware.ts` runs in init container — covered in Section 5 |
