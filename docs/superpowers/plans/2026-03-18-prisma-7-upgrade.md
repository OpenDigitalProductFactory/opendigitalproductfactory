# Prisma 5.22.0 → 7.x Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Prisma from 5.22.0 to 7.x across the entire project, eliminating version skew between local and global installations.

**Architecture:** Direct jump from v5 to v7. The upgrade touches the schema header, a new `prisma.config.ts`, driver adapter in the client singleton, all standalone scripts that instantiate their own `PrismaClient`, and shell/PowerShell scripts that use removed CLI flags.

**Tech Stack:** Prisma 7.x, `@prisma/adapter-pg`, `pg`, `dotenv`, PostgreSQL 16

**Spec:** `docs/superpowers/specs/2026-03-18-prisma-7-upgrade-design.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `packages/db/package.json` | Bump versions, add new deps |
| Modify | `packages/db/prisma/schema.prisma` (lines 1-9) | New generator provider, remove datasource url |
| Create | `packages/db/prisma.config.ts` | Prisma CLI config (schema path, migrations) |
| Modify | `packages/db/src/client.ts` | Add PrismaPg adapter |
| Modify | `packages/db/scripts/archive-persona-agents.ts` | Use shared singleton |
| Modify | `packages/db/scripts/seed-endpoint-manifests.ts` | Use shared singleton |
| Modify | `packages/db/scripts/migrate-capability-tiers.ts` | Use shared singleton |
| Modify | `packages/db/scripts/seed-service-endpoints.ts` | Use shared singleton |
| Modify | `packages/db/scripts/init-neo4j.ts` | Use shared singleton |
| Modify | `packages/db/src/seed-platform-product.ts` | Use shared singleton |
| Modify | `packages/db/src/discovery-attribution-model.test.ts` | Use shared singleton |
| Modify | `scripts/detect-hardware.ts` | Use shared singleton |
| Modify | `scripts/show-backlog.ts` | Use shared singleton |
| Modify | `docker-entrypoint.sh` | Remove --schema flag, fix cwd |
| Modify | `Dockerfile` | Copy prisma.config.ts in Stage 2 |
| Modify | `scripts/restore-full-db.sh` | Remove --schema flags, replace prisma db seed |
| Modify | `scripts/fresh-install.ps1` (line 333) | Remove --schema flag |
| Modify | `pnpm-workspace.yaml` | Remove stale @prisma/engines allowBuild |
| Modify | `scripts/seed-crm-epic.sql` (comment line 2) | Update run instructions |
| Modify | `scripts/seed-hr-epic.sql` (comment line 2) | Update run instructions |
| Modify | `scripts/seed-sbom-epic.sql` (comment line 2) | Update run instructions |
| Modify | `scripts/seed-vision-epics.sql` (comment line 2) | Update run instructions |
| Modify | `scripts/seed-calendaring-epic.sql` (comment line 2) | Update run instructions |
| Modify | `scripts/update-selfdev-epic-runtime-registration.sql` (comment line 4) | Update run instructions |
| Modify | `scripts/update-finance-epic.sql` (comment line 3) | Update run instructions |
| Modify | `scripts/update-calendar-epic.sql` (comment line 3) | Update run instructions |

---

### Task 1: Core Upgrade — Dependencies, Schema, Config, Client, Install (Atomic)

> **Important:** These changes must all be applied before running `pnpm install`. Committing intermediate states would create a broken build. Apply all edits, then install, then commit once.

**Files:**
- Modify: `packages/db/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `packages/db/prisma/schema.prisma` (lines 1-9)
- Create: `packages/db/prisma.config.ts`
- Modify: `packages/db/src/client.ts`

- [ ] **Step 1: Bump prisma and @prisma/client, add new deps**

In `packages/db/package.json`, update the dependencies and devDependencies sections:

```json
"dependencies": {
  "@prisma/client": "^7.5.0",
  "@prisma/adapter-pg": "^7.5.0",
  "dotenv": "^16.4.0",
  "neo4j-driver": "^5.27.0",
  "pg": "^8.13.0",
  "xlsx": "^0.18.5"
},
"devDependencies": {
  "@types/pg": "^8.11.0",
  "prisma": "^7.5.0",
  "tsx": "^4.15.0",
  "typescript": "^5.4.0",
  "vitest": "^1.6.0"
}
```

- [ ] **Step 2: Update pnpm-workspace.yaml**

In `pnpm-workspace.yaml`, remove the `@prisma/engines` entry from `allowBuilds` (Prisma 7 replaces the Rust engine entirely):

```yaml
packages:
  - "apps/*"
  - "packages/*"
allowBuilds:
  '@prisma/client': true
  esbuild: true
  prisma: true
```

- [ ] **Step 3: Update the schema header**

In `packages/db/prisma/schema.prisma`, change lines 1-9 from:

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

To:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/client"
}

datasource db {
  provider = "postgresql"
}
```

Two changes: `"prisma-client-js"` → `"prisma-client"` and remove the `url` line.

- [ ] **Step 4: Create prisma.config.ts**

Create `packages/db/prisma.config.ts`:

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

- [ ] **Step 5: Update client.ts with driver adapter**

Replace the full contents of `packages/db/src/client.ts` with:

```typescript
// packages/db/src/client.ts
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

- [ ] **Step 6: Run pnpm install from project root**

```bash
cd h:/OpenDigitalProductFactory && pnpm install
```

Expected: installs new deps and upgrades prisma. The `postinstall` hook runs `prisma generate`.

- [ ] **Step 7: Verify prisma generate succeeded**

```bash
cd h:/OpenDigitalProductFactory/packages/db && npx --no-install prisma generate
```

Expected: `✔ Generated Prisma Client (v7.x.x) to ./generated/client`

- [ ] **Step 8: Verify prisma version**

```bash
cd h:/OpenDigitalProductFactory/packages/db && npx --no-install prisma --version
```

Expected: `prisma: 7.x.x` (not 5.22.0)

- [ ] **Step 9: Commit all core changes together**

```bash
git add packages/db/package.json pnpm-workspace.yaml packages/db/prisma/schema.prisma packages/db/prisma.config.ts packages/db/src/client.ts pnpm-lock.yaml
git commit -m "chore: upgrade prisma 5.22.0 → 7.x with driver adapter and prisma.config.ts"
```

---

### Task 2: Fix Standalone Scripts in packages/db/scripts/

**Files:**
- Modify: `packages/db/scripts/archive-persona-agents.ts`
- Modify: `packages/db/scripts/seed-endpoint-manifests.ts`
- Modify: `packages/db/scripts/migrate-capability-tiers.ts`
- Modify: `packages/db/scripts/seed-service-endpoints.ts`
- Modify: `packages/db/scripts/init-neo4j.ts`

Each of these files creates its own `new PrismaClient()`. They must use the shared singleton from `../src/client` instead.

- [ ] **Step 1: Fix archive-persona-agents.ts**

Replace lines 1-3:

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "../src/client";
```

Remove the `await prisma.$disconnect();` on line 24 (the singleton manages its own lifecycle).

- [ ] **Step 2: Fix seed-endpoint-manifests.ts**

Replace lines 1-3:

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "../src/client";
```

Remove `await prisma.$disconnect();` on line 24.

- [ ] **Step 3: Fix migrate-capability-tiers.ts**

Replace lines 1-3:

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "../src/client";
```

Remove `await prisma.$disconnect();` on line 27.

- [ ] **Step 4: Fix seed-service-endpoints.ts**

Replace lines 1-3:

```typescript
import { PrismaClient } from "../generated/client";

const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "../src/client";
```

Remove `await prisma.$disconnect();` on line 77.

- [ ] **Step 5: Fix init-neo4j.ts**

Replace line 13 and line 24:

```typescript
import { PrismaClient } from "../generated/client";
```
```typescript
const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "../src/client";
```

Remove line 24 (`const prisma = new PrismaClient();`). In the `finally` block (line 103), remove `await prisma.$disconnect();` but keep `await closeNeo4j();`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/archive-persona-agents.ts packages/db/scripts/seed-endpoint-manifests.ts packages/db/scripts/migrate-capability-tiers.ts packages/db/scripts/seed-service-endpoints.ts packages/db/scripts/init-neo4j.ts
git commit -m "chore: prisma 7 — migrate db scripts to shared client singleton"
```

---

### Task 3: Fix Source Files in packages/db/src/

**Files:**
- Modify: `packages/db/src/seed-platform-product.ts`
- Modify: `packages/db/src/discovery-attribution-model.test.ts`

- [ ] **Step 1: Fix seed-platform-product.ts**

Replace lines 5-7:

```typescript
import { PrismaClient } from "../generated/client";

const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "./client";
```

The file has `if (require.main === module)` at line 136 for standalone execution — this still works since the import triggers the singleton which reads `DATABASE_URL` from the environment.

- [ ] **Step 2: Fix discovery-attribution-model.test.ts**

Replace lines 2-4:

```typescript
import { PrismaClient } from "../generated/client";

const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "./client";
```

Remove the `afterAll` block (lines 6-8) that calls `$disconnect()` — the singleton manages its own lifecycle.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/seed-platform-product.ts packages/db/src/discovery-attribution-model.test.ts
git commit -m "chore: prisma 7 — migrate src files to shared client singleton"
```

---

### Task 4: Fix Root-Level Scripts

**Files:**
- Modify: `scripts/detect-hardware.ts`
- Modify: `scripts/show-backlog.ts`

- [ ] **Step 1: Fix detect-hardware.ts**

Replace lines 2-4:

```typescript
import { PrismaClient } from "../packages/db/generated/client";

const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "../packages/db/src/client";
```

Remove `await prisma.$disconnect();` on line 45.

- [ ] **Step 2: Fix show-backlog.ts**

Replace lines 3-5:

```typescript
import { PrismaClient } from "../packages/db/generated/client";

const prisma = new PrismaClient();
```

With:

```typescript
import { prisma } from "../packages/db/src/client";
```

In the final `.finally(() => prisma.$disconnect())` on line 52, remove the `$disconnect` call. Change:

```typescript
main().catch(console.error).finally(() => prisma.$disconnect());
```

To:

```typescript
main().catch(console.error);
```

- [ ] **Step 3: Commit**

```bash
git add scripts/detect-hardware.ts scripts/show-backlog.ts
git commit -m "chore: prisma 7 — migrate root scripts to shared client singleton"
```

---

### Task 5: Update Docker Files

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-entrypoint.sh`

- [ ] **Step 1: Update Dockerfile Stage 2 to copy prisma.config.ts**

In `Dockerfile`, after line 11 (`COPY packages/db/prisma/schema.prisma ./packages/db/prisma/`), add:

```dockerfile
COPY packages/db/prisma.config.ts ./packages/db/
```

- [ ] **Step 2: Update docker-entrypoint.sh**

Replace lines 6-9:

```bash
echo "[1/3] Running database migrations..."
cd /app
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
echo "  ✓ Migrations complete"
```

With:

```bash
echo "[1/3] Running database migrations..."
cd /app/packages/db
npx prisma migrate deploy
echo "  ✓ Migrations complete"
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-entrypoint.sh
git commit -m "chore: prisma 7 — update Docker to use prisma.config.ts, remove --schema"
```

---

### Task 6: Update Shell and PowerShell Scripts

**Files:**
- Modify: `scripts/restore-full-db.sh`
- Modify: `scripts/fresh-install.ps1` (line 333)

- [ ] **Step 1: Fix restore-full-db.sh — replace prisma db seed**

On line 31, replace:

```bash
npx prisma db seed
```

With:

```bash
npx tsx src/seed.ts
```

- [ ] **Step 2: Fix restore-full-db.sh — remove --schema from line 35**

Replace:

```bash
npx prisma db execute --file "$SCRIPT_DIR/db-export-epics-backlog.sql" --schema prisma/schema.prisma
```

With:

```bash
npx prisma db execute --file "$SCRIPT_DIR/db-export-epics-backlog.sql"
```

- [ ] **Step 3: Fix restore-full-db.sh — remove --schema from line 39**

Replace:

```bash
npx prisma db execute --file "$SCRIPT_DIR/db-export-runtime-state.sql" --schema prisma/schema.prisma
```

With:

```bash
npx prisma db execute --file "$SCRIPT_DIR/db-export-runtime-state.sql"
```

- [ ] **Step 4: Fix restore-full-db.sh — remove --schema from line 60**

Replace:

```bash
    npx prisma db execute --file "$sql_file" --schema prisma/schema.prisma || echo "  WARNING: $(basename "$sql_file") had errors (may be expected if already applied)"
```

With:

```bash
    npx prisma db execute --file "$sql_file" || echo "  WARNING: $(basename "$sql_file") had errors (may be expected if already applied)"
```

- [ ] **Step 5: Fix fresh-install.ps1 — remove --schema from line 333**

Replace:

```powershell
            pnpm --filter @dpf/db exec prisma db execute --file "../../$sql" --schema prisma/schema.prisma 2>$null
```

With:

```powershell
            pnpm --filter @dpf/db exec prisma db execute --file "../../$sql" 2>$null
```

- [ ] **Step 6: Commit**

```bash
git add scripts/restore-full-db.sh scripts/fresh-install.ps1
git commit -m "chore: prisma 7 — remove --schema flags and prisma db seed from scripts"
```

---

### Task 7: Update SQL Comment Headers

**Files:**
- Modify: `scripts/seed-crm-epic.sql` (line 2)
- Modify: `scripts/seed-hr-epic.sql` (line 2)
- Modify: `scripts/seed-sbom-epic.sql` (line 2)
- Modify: `scripts/seed-vision-epics.sql` (line 2)
- Modify: `scripts/seed-calendaring-epic.sql` (line 2)
- Modify: `scripts/update-selfdev-epic-runtime-registration.sql` (line 4)
- Modify: `scripts/update-finance-epic.sql` (line 3)
- Modify: `scripts/update-calendar-epic.sql` (line 3)

All of these have comment lines with `--schema prisma/schema.prisma` in their run instructions. Remove the `--schema prisma/schema.prisma` suffix from each.

- [ ] **Step 1: Update seed-crm-epic.sql line 2**

Replace:
```sql
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-crm-epic.sql --schema prisma/schema.prisma
```
With:
```sql
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-crm-epic.sql
```

- [ ] **Step 2: Update seed-hr-epic.sql line 2**

Replace:
```sql
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-hr-epic.sql --schema prisma/schema.prisma
```
With:
```sql
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-hr-epic.sql
```

- [ ] **Step 3: Update seed-sbom-epic.sql line 2**

Replace:
```sql
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-sbom-epic.sql --schema prisma/schema.prisma
```
With:
```sql
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-sbom-epic.sql
```

- [ ] **Step 4: Update seed-vision-epics.sql line 2**

Replace:
```sql
-- Run via: cd packages/db && npx prisma db execute --file ../../scripts/seed-vision-epics.sql --schema prisma/schema.prisma
```
With:
```sql
-- Run via: cd packages/db && npx prisma db execute --file ../../scripts/seed-vision-epics.sql
```

- [ ] **Step 5: Update seed-calendaring-epic.sql line 2**

Replace:
```sql
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-calendaring-epic.sql --schema prisma/schema.prisma
```
With:
```sql
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-calendaring-epic.sql
```

- [ ] **Step 6: Update update-selfdev-epic-runtime-registration.sql line 4**

Replace:
```sql
--   cd packages/db && npx prisma db execute --file ../../scripts/update-selfdev-epic-runtime-registration.sql --schema prisma/schema.prisma
```
With:
```sql
--   cd packages/db && npx prisma db execute --file ../../scripts/update-selfdev-epic-runtime-registration.sql
```

- [ ] **Step 7: Update update-finance-epic.sql line 3**

Replace:
```sql
--   cd packages/db && npx prisma db execute --file ../../scripts/update-finance-epic.sql --schema prisma/schema.prisma
```
With:
```sql
--   cd packages/db && npx prisma db execute --file ../../scripts/update-finance-epic.sql
```

- [ ] **Step 8: Update update-calendar-epic.sql line 3**

Replace:
```sql
--   cd packages/db && npx prisma db execute --file ../../scripts/update-calendar-epic.sql --schema prisma/schema.prisma
```
With:
```sql
--   cd packages/db && npx prisma db execute --file ../../scripts/update-calendar-epic.sql
```

- [ ] **Step 9: Commit**

```bash
git add scripts/seed-crm-epic.sql scripts/seed-hr-epic.sql scripts/seed-sbom-epic.sql scripts/seed-vision-epics.sql scripts/seed-calendaring-epic.sql scripts/update-selfdev-epic-runtime-registration.sql scripts/update-finance-epic.sql scripts/update-calendar-epic.sql
git commit -m "docs: update SQL comment headers — remove deprecated --schema flag"
```

---

### Task 8: Verify the Upgrade

**Files:** None (verification only)

- [ ] **Step 1: Verify prisma generate works**

```bash
cd h:/OpenDigitalProductFactory/packages/db && npx --no-install prisma generate
```

Expected: `✔ Generated Prisma Client (v7.x.x) to ./generated/client`

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd h:/OpenDigitalProductFactory && pnpm --filter @dpf/db typecheck
```

Expected: no type errors

- [ ] **Step 3: Verify web app builds**

```bash
cd h:/OpenDigitalProductFactory && pnpm --filter web build
```

Expected: build succeeds

- [ ] **Step 4: Verify prisma migrate deploy (requires running database)**

```bash
cd h:/OpenDigitalProductFactory/packages/db && npx --no-install prisma migrate deploy
```

Expected: all 46 migrations applied (or already applied) without error

- [ ] **Step 5: Smoke-test a standalone script (requires running database)**

```bash
cd h:/OpenDigitalProductFactory && npx tsx scripts/show-backlog.ts
```

Expected: prints backlog summary without import or adapter errors

- [ ] **Step 6: Verify Docker build**

```bash
cd h:/OpenDigitalProductFactory && docker compose build
```

Expected: all stages (deps, build, init, runner) complete successfully

- [ ] **Step 7: Verify prisma studio connects (requires running database)**

```bash
cd h:/OpenDigitalProductFactory/packages/db && npx --no-install prisma studio
```

Expected: opens browser at localhost:5555 showing all 122 models

- [ ] **Step 8: Final commit if any generated files changed**

```bash
git add packages/db/generated/
git commit -m "chore: regenerate prisma client for v7"
```

**Rollback:** If the upgrade fails at any point, revert all changes with `git checkout .` and `pnpm install` to restore the v5.22.0 state.
