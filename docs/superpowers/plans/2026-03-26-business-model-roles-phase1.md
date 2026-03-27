# Business Model Roles — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Get the BusinessModel data layer live: tables migrated, 8 built-in models seeded, EP-BIZ-ROLES epic registered.
**Architecture:** All code already exists in the repo (schema models, registry JSON, seedBusinessModels() function, seed script). This plan is pure execution — the only missing artifact is the Prisma migration file and its application to the database.
**Tech Stack:** Prisma 7.x, PostgreSQL 16, pnpm workspaces, tsx

---

## Pre-flight checks

```bash
# Confirm postgres is healthy
docker ps --filter name=dpf-postgres --format "{{.Status}}"
# Expected: Up ... (healthy)

# Confirm schema models exist but tables do not
docker exec dpf-postgres-1 psql -U dpf -d dpf -c "\dt" | grep -i Business
# Expected: no BusinessModel row (BusinessProfile is different)

# Confirm registry has the right shape
cd h:/opendigitalproductfactory
node -e "const d = JSON.parse(require('fs').readFileSync('packages/db/data/business_model_registry.json','utf8')); console.log('models:', d.business_models.length, 'roles:', d.business_models.reduce((a,m)=>a+m.roles.length,0))"
# Expected: models: 8 roles: 32
```

---

## Task 1: Register EP-BIZ-ROLES epic and 18 backlog items

**Files:**
- Run: `packages/db/scripts/seed-biz-roles-epic.ts`

- [ ] **Step 1: Run the seed script**
  ```bash
  cd h:/opendigitalproductfactory
  pnpm --filter @dpf/db exec tsx scripts/seed-biz-roles-epic.ts
  ```
  Expected output:
  ```
  Portfolios found: [ 'manufacturing_and_delivery', 'for_employees', 'foundational', 'products_and_services_sold' ]
    Created epic: Business Model Roles (EP-BIZ-ROLES)
    Linked to portfolio: manufacturing_and_delivery
    Linked to portfolio: for_employees
    Linked to portfolio: products_and_services_sold
    Created 18 backlog items
  Done.
  ```

- [ ] **Step 2: Verify in database**
  ```bash
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c \
    "SELECT \"epicId\", title, status FROM \"Epic\" WHERE \"epicId\" = 'EP-BIZ-ROLES';"
  ```
  Expected: one row with status `open`.

- [ ] **Step 3: Commit**
  *(No files changed — epic lives in DB)*

---

## Task 2: Create and apply the Prisma migration

**Files:**
- Create: `packages/db/prisma/migrations/YYYYMMDDHHMMSS_add_business_model_roles/migration.sql` (auto-generated)

- [ ] **Step 1: Generate the migration**
  ```bash
  cd h:/opendigitalproductfactory
  pnpm --filter @dpf/db exec prisma migrate dev --name add-business-model-roles
  ```
  Prisma will detect the four new models (BusinessModel, BusinessModelRole, ProductBusinessModel, BusinessModelRoleAssignment) plus the two new relations on User and DigitalProduct, and generate a migration SQL file.

  Expected output (last lines):
  ```
  The following migration(s) have been applied:
    migrations/
      └─ YYYYMMDDHHMMSS_add_business_model_roles/
           └─ migration.sql
  Your database is now in sync with your schema.
  ```

  > **If Prisma prompts about drift:** The database has had data changes (restore scripts) that Prisma didn't track. Type `y` to continue — the migration only adds new tables and columns.

- [ ] **Step 2: Verify tables exist**
  ```bash
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c "\dt" | grep -i "business"
  ```
  Expected output (four rows):
  ```
   public | BusinessModel                | table | dpf
   public | BusinessModelRole            | table | dpf
   public | BusinessModelRoleAssignment  | table | dpf
   public | ProductBusinessModel         | table | dpf
  ```

- [ ] **Step 3: Commit the migration file**
  ```bash
  cd h:/opendigitalproductfactory
  git add packages/db/prisma/migrations/
  git commit -m "feat(db): add BusinessModel role tables migration"
  ```

---

## Task 3: Seed the 8 built-in business models and 32 roles

**Files:**
- Run: `packages/db/src/seed.ts` (seedBusinessModels already wired at line 945)

- [ ] **Step 1: Run the full seed**
  ```bash
  cd h:/opendigitalproductfactory
  pnpm --filter @dpf/db exec tsx src/seed.ts
  ```
  The seed is fully idempotent — safe to re-run. Look for:
  ```
  Seeded 8 business models with 32 roles
  ```

- [ ] **Step 2: Verify data**
  ```bash
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c \
    "SELECT \"modelId\", name, \"isBuiltIn\", (SELECT COUNT(*) FROM \"BusinessModelRole\" r WHERE r.\"businessModelId\" = m.id) AS role_count FROM \"BusinessModel\" m ORDER BY \"modelId\";"
  ```
  Expected: 8 rows, each with `isBuiltIn = t` and `role_count = 4`.

---

## Task 4: Verify build passes

- [ ] **Step 1: Run the build**
  ```bash
  cd h:/opendigitalproductfactory
  npm run build
  ```
  Expected: `✓ Compiled successfully` with no type errors related to BusinessModel.

  > **If build fails on Prisma client types:** Run `pnpm --filter @dpf/db exec prisma generate` first, then retry the build.

- [ ] **Step 2: Commit if any generated files changed**
  ```bash
  git add packages/db/generated/
  git commit -m "chore(db): regenerate Prisma client for business model roles"
  ```

---

## Done criteria

| Check | Command | Expected |
|---|---|---|
| Epic in DB | `SELECT "epicId" FROM "Epic" WHERE "epicId" = 'EP-BIZ-ROLES'` | 1 row |
| Backlog items | `SELECT COUNT(*) FROM "BacklogItem" WHERE "itemId" LIKE 'EP-BIZ-ROLES%'` | 18 |
| Tables exist | `\dt` in psql | 4 new BusinessModel* tables |
| Models seeded | `SELECT COUNT(*) FROM "BusinessModel"` | 8 |
| Roles seeded | `SELECT COUNT(*) FROM "BusinessModelRole"` | 32 |
| Build passes | `npm run build` | exit 0 |
