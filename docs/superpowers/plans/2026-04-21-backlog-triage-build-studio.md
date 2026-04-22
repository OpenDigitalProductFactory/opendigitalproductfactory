# Backlog → Triage → Build Studio Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-04-21-backlog-triage-build-studio-design.md` (Revised Draft — the second same-day draft that supersedes the first).

**Goal:** Make Backlog the single intake for new development. Triage is a required gate with a decided outcome (`build` | `runbook` | `coworker-task` | `defer` | `duplicate` | `discard`). `BacklogItem` holds both a single `activeBuildId` and a `featureBuilds[]` history collection. Ship closes the originator and auto-closes its Epic if empty. Abandon returns the item to `triaging` while preserving the abandoned `FeatureBuild` row for history.

**Architecture:** Additive `BacklogItem` fields (`triageOutcome`, `effortSize`, `proposedOutcome`, `activeBuildId @unique`, `duplicateOfId`, `resolution`, `abandonReason`, `stalenessDetectedAt`); `FeatureBuild` gains required `originatingBacklogItemId` (many-to-one, NOT unique) plus `abandonedAt` / `abandonReason`; three new MCP tools (`triage_backlog_item`, `promote_to_build_studio`, `size_backlog_item`) under two new grant categories (`backlog_triage`, `build_promote`); two new Inngest events (`build/feature-build.phase-changed`, `build/feature-build.abandoned`) with a `backlog/originator.sync` handler; `pg_advisory_xact_lock` transaction wrapping capacity check + build creation + activeBuildId write; rename `ops-coordinator` → `scrum-master` across all touchpoints. Observability reuses `ToolExecution` — no new audit table.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL 16, Inngest, pnpm workspaces, Vitest, TypeScript.

## Commit Discipline

- One concern per commit. Each task ends with a `git commit` of exactly the files changed in that task.
- **Use `git commit --only <paths>`** — another Claude session may have staged files in parallel (per memory `git_commit_only_for_concurrent_sessions`).
- Main-branch workflow per `AGENTS.md`: commit directly to `main`, no feature branches.
- **Every enum change lands in one commit** that touches BOTH `apps/web/lib/explore/backlog.ts` (union types / `as const` arrays) AND `apps/web/lib/mcp-tools.ts` (tool schema `enum:` arrays). CLAUDE.md "Strongly-Typed String Enums — MANDATORY COMPLIANCE" — enforced by test added in Task 1.
- Push after each commit: `git push` — local-only commits are invisible to CI.

## Working Environment

- Run Prisma commands via `pnpm --filter @dpf/db exec prisma …` — never `npx prisma` (CLAUDE.md).
- Migration files: `packages/db/prisma/migrations/<timestamp>_<name>/migration.sql`.
- Run tests from repo root: `pnpm --filter web test <path>` (unit) or `pnpm --filter web exec vitest <path>`.
- Typecheck: `pnpm --filter web typecheck`.
- Production build gate: `pnpm --filter web build`.
- The portal container auto-runs `prisma migrate deploy` on boot. For dev DB iteration: `docker compose restart portal-init` replays migrations.

## Testing Patterns (two flavors)

**Flavor A — Mocked Prisma** (default for unit tests). Pattern from `apps/web/lib/integrate/code-graph-refresh.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    featureBuild: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    platformDevConfig: { findUnique: vi.fn() },
    sandboxSlot: { count: vi.fn() },
  },
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: vi.fn() },
}));

import { prisma } from "@dpf/db";

beforeEach(() => vi.clearAllMocks());
```

Use for: `triage.test.ts`, `triage-dor.test.ts`, `size-backlog-item` tests, route-handler tests with simple Prisma interactions.

**Flavor B — Real DB integration tests** (required for concurrency, reconciler, DB-constraint verification). Plain Prisma client against the live dev Docker `dpf-postgres-1`. Per-test unique prefix for cleanup:

```ts
import { afterEach } from "vitest";
import { prisma } from "@dpf/db";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const BI_TEST_PREFIX = `BI-TEST-${RUN_ID}`;
const BUILD_TEST_PREFIX = `BUILD-TEST-${RUN_ID}`;

afterEach(async () => {
  await prisma.featureBuild.deleteMany({ where: { buildId: { startsWith: BUILD_TEST_PREFIX } } });
  await prisma.backlogItem.deleteMany({ where: { itemId: { startsWith: BI_TEST_PREFIX } } });
});
```

When a test drives `promoteToBuildStudio` (which generates `BUILD-<timestamp>` by default), pass a `testBuildIdPrefix` option or clean up by `originatingBacklogItemId` to avoid leaks.

Run integration tests: `DATABASE_URL="$(docker exec dpf-portal-1 printenv DATABASE_URL)" pnpm --filter web exec vitest run <path>`.

Use Flavor B for: `promote-to-build.concurrency.test.ts`, `backlog-build-link-reconcile.test.ts`, `backlog-triage-stale-scan.test.ts`, `originator-sync` handler tests, and the invariants test (CHECK-constraint enforcement).

---

## Phase 1: Canonical Enums (no schema changes yet)

### Task 1: Enum parity test

**Files:**
- Create: `apps/web/lib/backlog-enums.test.ts`
- Modify: `apps/web/lib/explore/backlog.ts` (add constants alongside existing `EPIC_STATUSES`)

**Harness:** Flavor A is not needed — this is a pure compile-time/schema-literal comparison.

- [ ] **Step 1: Write the failing test** that imports `BACKLOG_TRIAGE_OUTCOMES`, `BACKLOG_SOURCE_VALUES`, `BACKLOG_EFFORT_SIZES` (don't exist yet) and diffs each against the `enum:` array on the corresponding `mcp-tools.ts` tool schema field:

  ```ts
  import { describe, it, expect } from "vitest";
  import {
    BACKLOG_TRIAGE_OUTCOMES,
    BACKLOG_SOURCE_VALUES,
    BACKLOG_EFFORT_SIZES,
  } from "@/lib/explore/backlog";
  import { MCP_TOOLS } from "@/lib/mcp-tools";

  function toolInputEnum(toolName: string, field: string): readonly string[] {
    const tool = MCP_TOOLS.find((t) => t.name === toolName);
    const prop = (tool?.inputSchema as any)?.properties?.[field];
    return (prop?.enum ?? []) as readonly string[];
  }

  describe("backlog enum parity", () => {
    it("triageOutcome enum matches across backlog.ts and mcp-tools.ts", () => {
      expect(toolInputEnum("triage_backlog_item", "outcome")).toEqual([...BACKLOG_TRIAGE_OUTCOMES]);
    });
    it("source enum matches across backlog.ts and mcp-tools.ts", () => {
      expect(toolInputEnum("create_backlog_item", "source")).toEqual([...BACKLOG_SOURCE_VALUES]);
    });
    it("effortSize enum matches across backlog.ts and mcp-tools.ts", () => {
      expect(toolInputEnum("size_backlog_item", "size")).toEqual([...BACKLOG_EFFORT_SIZES]);
      expect(toolInputEnum("triage_backlog_item", "effortSize")).toEqual([...BACKLOG_EFFORT_SIZES]);
    });
  });
  ```
- [ ] **Step 2: Run test to verify it fails.** `pnpm --filter web exec vitest run apps/web/lib/backlog-enums.test.ts`.
- [ ] **Step 3: Add constants in `apps/web/lib/explore/backlog.ts`** alongside `EPIC_STATUSES`:

  ```ts
  export const BACKLOG_TRIAGE_OUTCOMES = [
    "build", "runbook", "coworker-task", "defer", "duplicate", "discard",
  ] as const;
  export type BacklogTriageOutcome = (typeof BACKLOG_TRIAGE_OUTCOMES)[number];

  export const BACKLOG_SOURCE_VALUES = [
    "feature-gap", "bug", "tool-gap", "skill-gap", "doc-gap",
    "user-request", "automated-detection",
  ] as const;
  export type BacklogSource = (typeof BACKLOG_SOURCE_VALUES)[number];

  export const BACKLOG_EFFORT_SIZES = ["small", "medium", "large", "xlarge"] as const;
  export type BacklogEffortSize = (typeof BACKLOG_EFFORT_SIZES)[number];
  ```
- [ ] **Step 4: Run again** — expect failure on tool-schema diff (tool enum arrays don't exist yet; Task 2 handles).
- [ ] **Step 5: Commit** the constants: `git commit --only apps/web/lib/explore/backlog.ts apps/web/lib/backlog-enums.test.ts` — message: `feat(backlog): add triage/source/effort enum constants`. Push.

### Task 2: Tool schema enum stubs

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add three stubbed tool definitions** to the `MCP_TOOLS` array (handlers land in Phase 4; enums must be correct now for Task 1's test):

  ```ts
  {
    name: "triage_backlog_item",
    description: "Decide the outcome for a backlog item in triaging status.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        outcome: { type: "string", enum: ["build", "runbook", "coworker-task", "defer", "duplicate", "discard"] },
        rationale: { type: "string" },
        effortSize: { type: "string", enum: ["small", "medium", "large", "xlarge"] },
        duplicateOfId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["itemId", "outcome", "rationale"],
    },
  },
  {
    name: "promote_to_build_studio",
    description: "Create a FeatureBuild from a backlog item with outcome=build.",
    inputSchema: { type: "object", properties: { itemId: { type: "string" } }, required: ["itemId"] },
  },
  {
    name: "size_backlog_item",
    description: "Assign effortSize to a backlog item.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        size: { type: "string", enum: ["small", "medium", "large", "xlarge"] },
      },
      required: ["itemId", "size"],
    },
  },
  ```
  Also update the existing `create_backlog_item` entry: add `source` to `properties` with the 7-value enum and to `required`; add optional `proposedOutcome` with the triage-outcome enum.
- [ ] **Step 2: Run parity test** — should pass now.
- [ ] **Step 3: Typecheck.** `pnpm --filter web typecheck`.
- [ ] **Step 4: Commit.** `git commit --only apps/web/lib/mcp-tools.ts` — message: `feat(mcp-tools): add triage/promote/size stubs with enums`. Push.

---

## Phase 2: Schema migration (additive, reversible)

### Task 3a: PlatformDevConfig singleton upsert

**Files:**
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1:** Grep seed.ts for `platformDevConfig`. If an upsert exists, add `maxConcurrentBuilds: 4` to both `create` and `update` objects — actually set it only on `create` so admin-set values aren't stomped; leave `update: {}` alone.
- [ ] **Step 2:** If no upsert exists, add one:

  ```ts
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    create: { /* existing defaults */, maxConcurrentBuilds: 4 },
    update: {},
  });
  ```
- [ ] **Step 3:** Re-seed. Verify: `docker exec dpf-postgres-1 psql -U dpf -d dpf -c 'SELECT "maxConcurrentBuilds" FROM "PlatformDevConfig";'`. Expect 4.
- [ ] **Step 4: Commit.** `git commit --only packages/db/src/seed.ts` — message: `feat(db): seed PlatformDevConfig.maxConcurrentBuilds default`. Push.

### Task 3: Prisma schema — additive

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (models `BacklogItem`, `FeatureBuild`, `PlatformDevConfig`)

- [ ] **Step 1: Add to `BacklogItem`:**

  ```prisma
  triageOutcome         String?
  effortSize            String?
  proposedOutcome       String?
  activeBuildId         String?      @unique
  duplicateOfId         String?
  resolution            String?
  abandonReason         String?
  stalenessDetectedAt   DateTime?

  activeBuild    FeatureBuild?  @relation("BacklogItemActiveBuild",  fields: [activeBuildId], references: [id])
  featureBuilds  FeatureBuild[] @relation("BacklogItemOriginator")
  duplicateOf    BacklogItem?   @relation("BacklogItemDuplicates", fields: [duplicateOfId], references: [id])
  duplicates     BacklogItem[]  @relation("BacklogItemDuplicates")
  ```
  Note: two distinct relations between `BacklogItem` and `FeatureBuild`: `BacklogItemActiveBuild` (single current build; FK on BacklogItem) and `BacklogItemOriginator` (history; FK on FeatureBuild). Both must have named `@relation` identifiers to disambiguate.
- [ ] **Step 2: Add to `FeatureBuild`:**

  ```prisma
  originatingBacklogItemId String?       // Phase 3 flips to NOT NULL
  abandonedAt              DateTime?
  abandonReason            String?

  originator           BacklogItem?  @relation("BacklogItemOriginator", fields: [originatingBacklogItemId], references: [id])
  activeForBacklogItem BacklogItem?  @relation("BacklogItemActiveBuild")
  ```
- [ ] **Step 3: Add to `PlatformDevConfig`:**

  ```prisma
  maxConcurrentBuilds Int @default(4)
  ```
- [ ] **Step 4: Generate the migration** (create-only, review before apply). `pnpm --filter @dpf/db exec prisma migrate dev --name backlog_triage_schema --create-only`.
- [ ] **Step 5: Review** the generated SQL. All new columns nullable; `@unique` index on `BacklogItem.activeBuildId`; `FeatureBuild.originatingBacklogItemId` is NOT `@unique` (many builds can originate from one item).
- [ ] **Step 6: Apply.** `pnpm --filter @dpf/db exec prisma migrate dev`.
- [ ] **Step 7: Typecheck.** Fix any Prisma client type errors.
- [ ] **Step 8: Commit.** `git commit --only packages/db/prisma/schema.prisma packages/db/prisma/migrations/` — message: `feat(db): backlog triage schema — activeBuildId, originatingBacklogItemId, abandonedAt, maxConcurrentBuilds`. Push.

### Task 4: Backfill migration (idempotent)

**Files:**
- Create: `packages/db/prisma/migrations/<next-ts>_backlog_triage_backfill/migration.sql`

- [ ] **Step 1: Generate empty migration.** `pnpm --filter @dpf/db exec prisma migrate dev --name backlog_triage_backfill --create-only`.
- [ ] **Step 2: Edit the SQL.**

  ```sql
  -- Backfill 1: synthetic BacklogItem originator for any FeatureBuild without one.
  DO $$
  DECLARE
    fb RECORD;
    new_bi_id TEXT;
    new_bi_item_id TEXT;
    bi_type TEXT;
    bi_status TEXT;
    bi_outcome TEXT;
  BEGIN
    FOR fb IN SELECT id, title, description, phase, "digitalProductId", "updatedAt"
              FROM "FeatureBuild" WHERE "originatingBacklogItemId" IS NULL LOOP
      new_bi_id       := 'cm' || substr(md5(fb.id || random()::text), 1, 23);
      new_bi_item_id  := 'BI-' || upper(substr(md5(fb.id), 1, 8));
      bi_type         := CASE WHEN fb."digitalProductId" IS NOT NULL THEN 'product' ELSE 'portfolio' END;
      bi_status       := CASE WHEN fb.phase IN ('ship', 'complete') THEN 'done' ELSE 'in-progress' END;
      bi_outcome      := 'build';

      INSERT INTO "BacklogItem" (
        id, "itemId", title, status, type, body, source, "triageOutcome",
        "activeBuildId", "completedAt", "createdAt", "updatedAt"
      ) VALUES (
        new_bi_id, new_bi_item_id, fb.title, bi_status, bi_type,
        COALESCE(fb.description, fb.title), 'user-request', bi_outcome,
        CASE WHEN bi_status = 'in-progress' THEN fb.id ELSE NULL END,
        CASE WHEN bi_status = 'done' THEN fb."updatedAt" ELSE NULL END,
        NOW(), NOW()
      );

      UPDATE "FeatureBuild" SET "originatingBacklogItemId" = new_bi_id WHERE id = fb.id;
    END LOOP;
  END $$;

  -- Backfill 2: existing open items with no outcome → triaging.
  UPDATE "BacklogItem"
     SET status = 'triaging'
   WHERE status = 'open' AND "triageOutcome" IS NULL;

  -- Backfill 3: lossy default — source NULL becomes 'user-request'.
  UPDATE "BacklogItem" SET source = 'user-request' WHERE source IS NULL;
  ```
- [ ] **Step 3: Apply.** `pnpm --filter @dpf/db exec prisma migrate dev`. On the dev DB, `FeatureBuild` is empty — backfill 1 touches 0 rows. Backfills 2 and 3 touch whatever's in the DB.
- [ ] **Step 4: Sanity-query.**

  ```sh
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c \
    "SELECT status, COUNT(*) FROM \"BacklogItem\" GROUP BY status;"
  ```
  Expect `triaging` rows and no pre-Phase-3 invariant violations.
- [ ] **Step 5: Commit.** `git commit --only packages/db/prisma/migrations/` — message: `feat(db): backfill synthetic originators + move open items to triaging`. Push.

---

## Phase 3: Enforce invariants (point-of-no-return)

### Task 5: Enforcement migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<next-ts>_backlog_triage_enforce/migration.sql`

- [ ] **Step 1: Flip schema fields to required.**
  - `BacklogItem.source String?` → `BacklogItem.source String`
  - `FeatureBuild.originatingBacklogItemId String?` → `FeatureBuild.originatingBacklogItemId String`
  - `FeatureBuild.originator BacklogItem? @relation(...)` → `BacklogItem @relation(...)`
- [ ] **Step 2: Generate migration.** `pnpm --filter @dpf/db exec prisma migrate dev --name backlog_triage_enforce --create-only`.
- [ ] **Step 3: Edit SQL.** Prepend RAISE EXCEPTION gates BEFORE any ALTER, and append CHECK constraints after:

  ```sql
  DO $$ BEGIN
    IF (SELECT COUNT(*) FROM "FeatureBuild" WHERE "originatingBacklogItemId" IS NULL) > 0 THEN
      RAISE EXCEPTION 'Phase 3 aborted: FeatureBuild rows without originatingBacklogItemId remain';
    END IF;
    IF (SELECT COUNT(*) FROM "BacklogItem" WHERE "source" IS NULL) > 0 THEN
      RAISE EXCEPTION 'Phase 3 aborted: BacklogItem rows without source remain';
    END IF;
    IF (SELECT COUNT(*) FROM "BacklogItem" WHERE "status" != 'triaging' AND "triageOutcome" IS NULL) > 0 THEN
      RAISE EXCEPTION 'Phase 3 aborted: non-triaging BacklogItem rows without triageOutcome remain';
    END IF;
  END $$;

  -- NOT NULL flips (Prisma-generated ALTERs go here)

  ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_triage_required"
    CHECK (status = 'triaging' OR "triageOutcome" IS NOT NULL);
  ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_duplicate_requires_target"
    CHECK ("triageOutcome" != 'duplicate' OR "duplicateOfId" IS NOT NULL);
  ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_discard_requires_resolution"
    CHECK ("triageOutcome" != 'discard' OR "resolution" IS NOT NULL);
  ```
- [ ] **Step 4: Apply.** If it fails with a `RAISE EXCEPTION`, go back and complete the Task 4 backfill before retrying.
- [ ] **Step 5: Commit.** `git commit --only packages/db/prisma/schema.prisma packages/db/prisma/migrations/` — message: `feat(db): enforce backlog triage invariants — NOT NULL + CHECK constraints`. Push.

---

## Phase 4: Grant categories + tool handlers

### Task 6a: Grant categories

**Files:**
- Modify: `apps/web/lib/tak/agent-grants.ts` (add `backlog_triage` and `build_promote` to `TOOL_TO_GRANTS`)
- Modify: `apps/web/lib/tak/agent-grants.test.ts` (assert the new categories and mappings)

- [ ] **Step 1: Write failing test** in `agent-grants.test.ts` asserting:
  - `triage_backlog_item` maps to `backlog_triage`
  - `size_backlog_item` maps to `backlog_triage`
  - `promote_to_build_studio` maps to `build_promote`
- [ ] **Step 2: Update `TOOL_TO_GRANTS`** to add the mappings.
- [ ] **Step 3: Update seeded grant holders** (in `packages/db/src/seed.ts`'s grants section):
  - `scrum-master` (still named `ops-coordinator` until Task 24) gets `backlog_triage` and `build_promote`.
  - `build-specialist` gets `build_promote`.
  - Do NOT grant to other coworkers.
- [ ] **Step 4: Run test.** `pnpm --filter web exec vitest run apps/web/lib/tak/agent-grants.test.ts`. Pass.
- [ ] **Step 5: Commit.** Message: `feat(grants): add backlog_triage and build_promote categories`. Push.

### Task 6b: `triage.ts` — happy path

**Files:**
- Create: `apps/web/lib/triage.test.ts`
- Create: `apps/web/lib/triage.ts`

**Harness:** Flavor A.

- [ ] **Step 1: Write failing happy-path test** using `vi.mock("@dpf/db", ...)`:

  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest";

  vi.mock("@dpf/db", () => ({
    prisma: {
      backlogItem: { findUnique: vi.fn(), update: vi.fn() },
    },
  }));

  import { prisma } from "@dpf/db";
  import { triageBacklogItem } from "./triage";

  beforeEach(() => vi.clearAllMocks());

  describe("triageBacklogItem", () => {
    it("commits outcome=build, moves to open, records effortSize", async () => {
      vi.mocked(prisma.backlogItem.findUnique).mockResolvedValue({
        id: "cmx", itemId: "BI-TEST0001", status: "triaging", triageOutcome: null, effortSize: null,
      } as never);
      vi.mocked(prisma.backlogItem.update).mockResolvedValue({} as never);

      const result = await triageBacklogItem({
        itemId: "BI-TEST0001", outcome: "build", rationale: "needs code fix", effortSize: "medium",
      });

      expect(result.ok).toBe(true);
      expect(prisma.backlogItem.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "cmx" },
        data: expect.objectContaining({ status: "open", triageOutcome: "build", effortSize: "medium" }),
      }));
    });
  });
  ```
- [ ] **Step 2: Run** — fails on import.
- [ ] **Step 3: Implement `triage.ts`:**

  ```ts
  import { prisma } from "@dpf/db";
  import type { BacklogTriageOutcome, BacklogEffortSize } from "./explore/backlog";

  type TriageInput = {
    itemId: string;
    outcome: BacklogTriageOutcome;
    rationale: string;
    effortSize?: BacklogEffortSize;
    duplicateOfId?: string;
    reason?: string;
  };

  export async function triageBacklogItem(input: TriageInput) {
    if (input.outcome === "duplicate" && !input.duplicateOfId) {
      return { ok: false as const, error: "DUPLICATE_REQUIRES_TARGET" };
    }
    if ((input.outcome === "discard" || input.outcome === "defer") && !input.reason) {
      return { ok: false as const, error: "REASON_REQUIRED" };
    }

    const item = await prisma.backlogItem.findUnique({ where: { itemId: input.itemId } });
    if (!item) return { ok: false as const, error: "NOT_FOUND" };
    if (item.status !== "triaging") return { ok: false as const, error: "NOT_IN_TRIAGING" };

    const nextStatus =
      input.outcome === "duplicate" ? "done" :
      input.outcome === "discard"   ? "done" :
      input.outcome === "defer"     ? "deferred" :
      "open";

    await prisma.backlogItem.update({
      where: { id: item.id },
      data: {
        status: nextStatus,
        triageOutcome: input.outcome,
        effortSize: input.effortSize ?? item.effortSize,
        duplicateOfId: input.outcome === "duplicate" ? input.duplicateOfId : null,
        resolution:
          input.outcome === "discard"   ? `won't fix: ${input.reason}` :
          input.outcome === "duplicate" ? `duplicate of ${input.duplicateOfId}` :
          null,
        completedAt: nextStatus === "done" ? new Date() : null,
      },
    });
    return { ok: true as const };
  }
  ```
- [ ] **Step 4: Pass test.**
- [ ] **Step 5: Add one test per outcome** (`runbook`, `coworker-task`, `defer`, `duplicate`, `discard`) — each verifies the right status + field set.
- [ ] **Step 6: Add negative tests:** item not in `triaging`, `duplicate` without `duplicateOfId`, `discard` without `reason`, `defer` without `reason`.
- [ ] **Step 7: Commit.** `git commit --only apps/web/lib/triage.ts apps/web/lib/triage.test.ts` — message: `feat(triage): add triageBacklogItem decision function`. Push.

### Task 7: Wire `triage_backlog_item` MCP handler

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (or the handler dispatch file — grep for existing `create_backlog_item` handler)
- Modify: the corresponding handler test file

- [ ] **Step 1: Find the `create_backlog_item` case.** `rg "case \"create_backlog_item\"" apps/web/lib`.
- [ ] **Step 2: Write failing handler test** asserting a `triage_backlog_item` tool call hits `triageBacklogItem()` and returns `{ success: true, msg: "Triaged BI-XYZ → build" }`.
- [ ] **Step 3: Add `case "triage_backlog_item"`** that validates input, calls `triageBacklogItem()`, returns `{ success, msg }` shape.
- [ ] **Step 4: Pass test. Typecheck. Commit.** Message: `feat(mcp-tools): wire triage_backlog_item handler`.

---

## Phase 5: DoR capacity check + promote tool

### Task 8: `canAutoPromoteToBuild` unit tests

**Files:**
- Create: `apps/web/lib/triage-dor.test.ts`
- Create: `apps/web/lib/triage-dor.ts`

**Harness:** Flavor A. Mock `prisma.featureBuild.count`, `prisma.platformDevConfig.findUnique`, `prisma.sandboxSlot.count`, `prisma.epic.count`.

- [ ] **Step 1: Write failing tests** (eight cases per spec §6.3 + §6.4):
  - not sized → `reasons` contains `"not sized"`
  - xlarge → `reasons` contains `"xlarge — must be split before promote"`
  - **bootstrap path: zero open epics** and item has no epic → `{ ok: true, reasons: [] }` when capacity fine (epic alignment is advisory)
  - **post-bootstrap: one or more open epics** and item has no epic → `reasons` contains `"not aligned to an open Epic"`
  - Epic status = `done` and other open epics exist → `"not aligned to an open Epic"`
  - at capacity (maxConcurrentBuilds=4, inFlight=4) → `"at capacity: 4/4"`
  - **sandbox capacity tighter**: maxConcurrentBuilds=4 but availableSandboxSlots=2, inFlight=2 → `"at capacity: 2/2"` (effective cap wins)
  - `capacity-only` mode bypasses sizing + epic alignment; capacity is still checked
  - happy path (medium, epic aligned, 2/4 inflight, 4 slots) → `{ ok: true, reasons: [] }`
- [ ] **Step 2: Run** — fails on import.
- [ ] **Step 3: Implement** `canAutoPromoteToBuild(item, mode)` per spec §6.3–§6.4. Read `maxConcurrentBuilds` from `PlatformDevConfig`. Read `availableSandboxSlots` from `SandboxSlot` (count where `status = 'available'`). Effective cap = `min(maxConcurrentBuilds, availableSandboxSlots)`. Count in-flight: `FeatureBuild` where `phase NOT IN ('ship', 'complete') AND abandonedAt IS NULL`. Bootstrap rule: if `Epic.count({ status: 'open' }) === 0`, skip alignment check and include a `bootstrap-skipped-epic-alignment` entry in a returned `notes[]` array so the caller can surface it in the rationale.
- [ ] **Step 4: All tests pass.**
- [ ] **Step 5: Commit.** Message: `feat(triage): Definition of Ready with sandbox-aware capacity + bootstrap rule`.

### Task 9: `promote_to_build_studio` with advisory lock

**Files:**
- Create: `apps/web/lib/promote-to-build.ts`
- Create: `apps/web/lib/promote-to-build.test.ts`

**Harness:** Flavor B (real DB). The advisory lock and transaction semantics don't work against mocks.

- [ ] **Step 1: Write failing happy-path test** under Flavor B harness. Create a `triaging` BacklogItem, triage it to `build` (use `triageBacklogItem`), assign a sized+aligned state, confirm no inflight builds. Call `promoteToBuildStudio({ itemId })`. Assert: returns `{ ok: true, buildId }`; `BacklogItem.activeBuildId` set; `FeatureBuild.originatingBacklogItemId` points at the item; item status = `in-progress`.
- [ ] **Step 2: Implement** per spec §6.4:

  ```ts
  export async function promoteToBuildStudio({
    itemId,
    mode = "full",
    testBuildIdPrefix,
  }: { itemId: string; mode?: "full" | "capacity-only"; testBuildIdPrefix?: string }) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('promote-to-build-studio'))`);

      const item = await tx.backlogItem.findUniqueOrThrow({
        where: { itemId }, include: { epic: true },
      });
      if (item.status !== "open" || item.triageOutcome !== "build") {
        return { ok: false as const, error: "NOT_READY_FOR_PROMOTE" };
      }
      if (item.activeBuildId != null) {
        return { ok: false as const, error: "ALREADY_HAS_ACTIVE_BUILD" };
      }

      const dor = await canAutoPromoteToBuild(item, mode, tx);
      if (!dor.ok) return { ok: false as const, error: "DOR_FAILED", reasons: dor.reasons };

      const buildId = `${testBuildIdPrefix ?? "BUILD"}-${Date.now().toString(36).toUpperCase()}`;
      const build = await tx.featureBuild.create({
        data: {
          buildId,
          title: item.title,
          description: item.body ?? "",
          brief: { title: item.title, body: item.body },
          phase: "ideate",
          createdById: "system", // TODO: thread through actor
          originatingBacklogItemId: item.id,
        },
      });
      await tx.backlogItem.update({
        where: { id: item.id },
        data: { activeBuildId: build.id, status: "in-progress" },
      });
      return { ok: true as const, buildId: build.buildId, featureBuildId: build.id };
    });
  }
  ```
- [ ] **Step 3: Test passes.**
- [ ] **Step 4: Commit.** Message: `feat(promote): promoteToBuildStudio with advisory-lock transaction`. Push.

### Task 10: Concurrency test

**Files:**
- Create: `apps/web/lib/promote-to-build.concurrency.test.ts`

**Harness:** Flavor B. Required to verify advisory lock.

- [ ] **Step 1: Write test.** Set `maxConcurrentBuilds=2`, create one in-flight build, create two ready-to-promote items. `Promise.all([promoteToBuildStudio({itemId:A}), promoteToBuildStudio({itemId:B})])`. Assert exactly one returns `{ok:true}` and the other returns `{ok:false, error:"DOR_FAILED", reasons: ["at capacity: 2/2"]}`.
- [ ] **Step 2: Run.** If the lock isn't held properly, both may succeed — debug.
- [ ] **Step 3: Commit.** Message: `test(promote): concurrency test verifies advisory lock serializes promotes`. Push.

### Task 11: Wire `promote_to_build_studio` MCP handler

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` / handler dispatch.

- [ ] **Step 1: Write failing handler test** (Flavor A mocking `promoteToBuildStudio`) asserting the tool returns `{ success: true, msg, buildId, navigateUrl }`.
- [ ] **Step 2: Add `case "promote_to_build_studio"` handler.**
- [ ] **Step 3: Test, commit.** Message: `feat(mcp-tools): wire promote_to_build_studio handler`.

### Task 12: Wire `size_backlog_item` MCP handler

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` / handler dispatch.
- Modify: `apps/web/lib/triage.ts` (add `setEffortSize(itemId, size)` helper)

- [ ] **Step 1: Write failing handler test** (Flavor A).
- [ ] **Step 2: Add helper + case.**
- [ ] **Step 3: Test, commit.** Message: `feat(mcp-tools): wire size_backlog_item handler`.

---

## Phase 6: Inngest events + originator-sync reconciler

### Task 13: Emit Inngest phase-changed event

**Files:**
- Modify: `apps/web/lib/build-flow-state.ts`

- [ ] **Step 1:** Find the phase-change call site. `rg "phase:change" apps/web/lib/build-flow-state.ts -n`.
- [ ] **Step 2:** Immediately after the in-memory `agentEventBus.emit`, add an Inngest send:

  ```ts
  await inngest.send({
    name: "build/feature-build.phase-changed",
    data: {
      buildId: build.buildId,
      featureBuildId: build.id,
      originatingBacklogItemId: build.originatingBacklogItemId,
      fromPhase,
      toPhase: next,
      at: new Date().toISOString(),
    },
  });
  ```
- [ ] **Step 3:** Typecheck. Run existing `build-flow-state` tests.
- [ ] **Step 4: Commit.** Message: `feat(build): emit Inngest phase-changed event on phase transition`.

### Task 14: `backlog/originator.sync` handler

**Files:**
- Create: `apps/web/lib/queue/functions/backlog-originator-sync.ts`
- Create: `apps/web/lib/queue/functions/backlog-originator-sync.test.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`

**Harness:** Flavor B (real DB).

- [ ] **Step 1: Failing test A — ship closes originator.** Create item+build linked via `activeBuildId` + `originatingBacklogItemId`, build at `phase=review`. Emit phase-changed event with `toPhase=ship`. Run handler. Assert: BacklogItem `status=done`, `completedAt` set, `resolution` populated from build summary, `activeBuildId` cleared.
- [ ] **Step 1b: Failing test B — complete also closes originator.** Same setup; `toPhase=complete`. Assert same.
- [ ] **Step 1c: Failing test C — abandon returns to triage.** Emit `build/feature-build.abandoned` with `originatingBacklogItemId` + `abandonReason`. Assert: BacklogItem `status=triaging`, `triageOutcome=null`, `activeBuildId=null`, `abandonReason` populated. `FeatureBuild.abandonedAt` is set (by the endpoint in Task 17, not the handler — the handler just reacts). The FeatureBuild row is preserved for history.
- [ ] **Step 1d: Failing test D — ship auto-closes empty Epic.** Ship event on a build whose originator is the last `in-progress/open` item in an Epic. Assert: Epic `status=done`.
- [ ] **Step 2: Implement handler.**

  ```ts
  import { inngest } from "@/lib/queue/inngest-client";
  import { prisma } from "@dpf/db";

  export const backlogOriginatorSync = inngest.createFunction(
    { id: "backlog-originator-sync", name: "Backlog Originator Sync" },
    [
      { event: "build/feature-build.phase-changed" },
      { event: "build/feature-build.abandoned" },
    ],
    async ({ event, step }) => {
      const backlogItemId = event.data.originatingBacklogItemId as string | undefined;
      if (!backlogItemId) return { skipped: "no originatingBacklogItemId" };

      if (
        event.name === "build/feature-build.phase-changed" &&
        (event.data.toPhase === "ship" || event.data.toPhase === "complete")
      ) {
        await step.run("close-originator", async () => {
          const item = await prisma.backlogItem.findUnique({ where: { id: backlogItemId } });
          if (!item || item.status === "done") return;
          const build = await prisma.featureBuild.findUniqueOrThrow({
            where: { id: event.data.featureBuildId as string },
          });
          await prisma.backlogItem.update({
            where: { id: backlogItemId },
            data: {
              status: "done",
              completedAt: new Date(),
              resolution: `shipped via ${build.buildId}: ${build.diffSummary ?? "no summary"}`,
              activeBuildId: null,
            },
          });

          // Epic auto-close (spec invariant 10)
          if (item.epicId) {
            const remaining = await prisma.backlogItem.count({
              where: { epicId: item.epicId, status: { notIn: ["done", "deferred"] } },
            });
            if (remaining === 0) {
              await prisma.epic.update({
                where: { id: item.epicId },
                data: { status: "done", completedAt: new Date() },
              });
            }
          }
        });
      }

      if (event.name === "build/feature-build.abandoned") {
        await step.run("return-to-triage", async () => {
          await prisma.backlogItem.update({
            where: { id: backlogItemId },
            data: {
              status: "triaging",
              triageOutcome: null,
              activeBuildId: null,
              abandonReason: event.data.abandonReason as string,
            },
          });
        });
      }

      return { handled: event.name };
    },
  );
  ```
- [ ] **Step 3: Register** in `apps/web/lib/queue/functions/index.ts`.
- [ ] **Step 4: All tests pass.**
- [ ] **Step 5: Commit.** Message: `feat(queue): backlog originator-sync handler with epic auto-close`.

---

## Phase 7: Reconciler for pointer drift

### Task 15: Bidirectional drift reconciler

**Files:**
- Create: `apps/web/lib/queue/functions/backlog-build-link-reconcile.ts`
- Create: `apps/web/lib/queue/functions/backlog-build-link-reconcile.test.ts`

**Harness:** Flavor B.

- [ ] **Step 1: Failing test.** Create a `BacklogItem` with `activeBuildId` pointing to a FeatureBuild that doesn't exist (or whose `originatingBacklogItemId` points elsewhere). Run reconciler. Assert: `PortfolioQualityIssue` row created with `issueType="backlog_build_link_drift"`, severity `warn`, details including both IDs.
- [ ] **Step 2: Implement** per spec §13.2 of the original (reused). Drift conditions:
  - `BacklogItem.activeBuildId` set but FeatureBuild missing, or FeatureBuild's `originatingBacklogItemId` doesn't match this item's id. (This captures legitimate separation of "currently active" vs "originated here"; if they differ deliberately in the future, refine.)
  - FeatureBuild with `abandonedAt IS NULL AND phase NOT IN ('ship','complete')` whose originator's `activeBuildId` is null or points elsewhere.
- [ ] **Step 3:** No auto-repair — just log the PortfolioQualityIssue. Schedule: boot + nightly at 02:30 UTC.
- [ ] **Step 4: Register, test, commit.** Message: `feat(queue): reconciler for backlog↔build link drift`.

---

## Phase 8: Staleness job

### Task 16: Nightly staleness scan

**Files:**
- Create: `apps/web/lib/queue/functions/backlog-triage-stale-scan.ts`
- Create: `apps/web/lib/queue/functions/backlog-triage-stale-scan.test.ts`

**Harness:** Flavor B.

- [ ] **Step 1: Failing test** — create an `in-progress` BacklogItem linked via `activeBuildId` to a FeatureBuild with `updatedAt` 8 days ago, `phase=build`, `abandonedAt IS NULL`. Run scan. Assert `BacklogItem.stalenessDetectedAt` set.
- [ ] **Step 2: Idempotency test** — running scan twice doesn't re-stamp `stalenessDetectedAt`.
- [ ] **Step 3: Implement.** Cron `0 2 * * *`. Query: `status='in-progress' AND activeBuildId IS NOT NULL AND (via join) featureBuild.phase NOT IN ('ship','complete') AND featureBuild.abandonedAt IS NULL AND featureBuild.updatedAt < now - 7 days`. Set `stalenessDetectedAt = now()` where currently null.
- [ ] **Step 4: Register, test, commit.** Message: `feat(queue): nightly staleness scan for in-progress builds`.

---

## Phase 9: Build Studio abandon action

### Task 17: `POST /api/build/[buildId]/abandon`

**Files:**
- Create: `apps/web/app/api/build/[buildId]/abandon/route.ts`
- Create: `apps/web/app/api/build/[buildId]/abandon/route.test.ts`

- [ ] **Step 1: Failing test.** POST with `abandonReason` to a non-terminal build. Assert `FeatureBuild.abandonedAt` set, `abandonReason` stored, Inngest event `build/feature-build.abandoned` emitted with `originatingBacklogItemId` + `abandonReason`. 200 response. Second test: POST on `phase=ship` → 400.
- [ ] **Step 2: Implement** with owner auth (match existing `/api/build/[buildId]`), validate `abandonReason` length (1–500).
- [ ] **Step 3: Test, commit.** Message: `feat(build): POST /abandon endpoint emits Inngest abandoned event`.

### Task 18: Abandon button UI

**Files:**
- Modify: Build Studio controls (grep `d:\DPF\apps\web\app\(shell)\build` for controls component)

- [ ] **Step 1: Find controls.** `rg "FeatureBuild|phase" apps/web/app/\(shell\)/build -l`.
- [ ] **Step 2: Add "Abandon build" button** visible when `phase ∉ {ship, complete}` AND `abandonedAt IS NULL`. Click → modal with required reason textarea (1–500 chars). Submit → POST `/api/build/[buildId]/abandon`. On success, navigate to `/ops`.
- [ ] **Step 3: Theme discipline** — no hardcoded colors. Use `var(--dpf-...)` tokens per `docs/platform-usability-standards.md`. Any `<select>`/`<option>` elements must carry explicit theme classes.
- [ ] **Step 4: Manual smoke in dev container browser.**
- [ ] **Step 5: Commit.** Message: `feat(build): abandon UI action with theme-aware reason modal`.

---

## Phase 10: Admin form for `maxConcurrentBuilds`

### Task 19: Add field to PlatformDevelopmentForm

**Files:**
- Modify: `apps/web/components/admin/PlatformDevelopmentForm.tsx`
- Modify: corresponding server action

- [ ] **Step 1: Add `<label>Maximum concurrent feature builds</label><input type="number" min={1} max={20}>`** bound to `maxConcurrentBuilds`. Helper text: "Investment capacity ceiling. Items in the ready queue wait for a slot to free up."
- [ ] **Step 2:** Server action persists the field.
- [ ] **Step 3: Theme discipline** — no hardcoded colors; use DPF theme tokens.
- [ ] **Step 4: Commit.** Message: `feat(admin): expose maxConcurrentBuilds config`.

---

## Phase 11: `/ops` triage UI

### Task 20a: Server action `commitTriage`

**Files:**
- Create: `apps/web/lib/actions/triage.ts`
- Create: `apps/web/lib/actions/triage.test.ts`

**Harness:** Flavor A (mock `triageBacklogItem` + Next's `revalidatePath`).

- [ ] **Step 1: Failing test** — `commitTriage({itemId, outcome, rationale, effortSize?})` calls `triageBacklogItem` with the input and returns `{ok}`. On ok, also calls `revalidatePath("/ops")`.
- [ ] **Step 2: Implement** as Next server action (`"use server"`).
- [ ] **Step 3: Test, commit.** Message: `feat(actions): commitTriage server action`.

### Task 20b: `TriageRow` — outcome picker

**Files:**
- Create: `apps/web/components/ops/TriageRow.tsx`
- Create: `apps/web/components/ops/TriageRow.test.tsx`

- [ ] **Step 1: Component test** (React Testing Library): renders 6 outcome buttons; clicking `build` reveals effort-size dropdown; `proposedOutcome` prop highlights matching button with a ring. Theme test: no raw hex/rgb in the rendered markup.
- [ ] **Step 2: Implement** — outcome buttons + effort-size dropdown. Use CSS variables (`var(--dpf-accent)`, etc.).
- [ ] **Step 3: Commit.** Message: `feat(ops): TriageRow outcome picker with theme tokens`.

### Task 20c: `TriageRow` — conditional fields (duplicate + reason)

- [ ] **Step 1:** Extend component test: selecting `duplicate` reveals canonical-item picker; `defer`/`discard` reveals reason textarea.
- [ ] **Step 2:** Implement. Add a `searchBacklogItems(query)` server action backing the duplicate picker.
- [ ] **Step 3: Commit.** Message: `feat(ops): TriageRow duplicate picker and reason field`.

### Task 20d: `TriageRow` — commit wiring

- [ ] **Step 1:** Component test: clicking "Commit triage" calls `commitTriage` with assembled input.
- [ ] **Step 2:** Add rationale textarea (required) + commit button. Disable commit until valid.
- [ ] **Step 3: Commit.** Message: `feat(ops): TriageRow commit wiring`.

### Task 20e: `TriageSection` container

**Files:**
- Create: `apps/web/components/ops/TriageSection.tsx`

- [ ] **Step 1:** Test: renders collapsible "Triage (N)" header; hides section when empty; renders one `TriageRow` per item.
- [ ] **Step 2:** Implement with theme tokens.
- [ ] **Step 3: Commit.** Message: `feat(ops): TriageSection container`.

### Task 20f: Integrate into BacklogPanel

**Files:**
- Modify: `apps/web/components/ops/BacklogPanel.tsx`

- [ ] **Step 1:** Add `TriageSection` above main list. Filter items to `status=triaging` for the section; main list shows the rest.
- [ ] **Step 2:** Manual browser smoke: create triaging item, triage from UI, verify outcome commit.
- [ ] **Step 3: Commit.** Message: `feat(ops): integrate TriageSection into BacklogPanel`.

---

## Phase 12: `BacklogItemRow` — Send to Build Studio

### Task 21

**Files:**
- Modify: `apps/web/components/ops/BacklogItemRow.tsx`
- Create: `apps/web/lib/actions/promote-backlog.ts`

- [ ] **Step 1:** Add button render-gate: `status=open AND triageOutcome=build AND activeBuildId IS NULL`. States per spec §6.9:
  | State | Label |
  |---|---|
  | DoR passes | `Send to Build Studio →` |
  | not sized | Disabled: `Size first` |
  | not aligned to open Epic (and epics exist) | Disabled: `Attach to an open Epic` |
  | xlarge | Disabled: `Too large — split first` |
  | at capacity | Disabled: `At capacity (N/M)` |
  | has activeBuild | Disabled: `Already building` |
- [ ] **Step 2:** Server action `promoteBacklog(itemId)` wraps `promoteToBuildStudio`. A read-only DoR preview (used for button state) calls `canAutoPromoteToBuild` outside the transaction.
- [ ] **Step 3:** Click → navigate to `/build/[buildId]` on success.
- [ ] **Step 4:** Theme tokens for disabled states.
- [ ] **Step 5:** Smoke-test all states.
- [ ] **Step 6: Commit.** Message: `feat(ops): Send to Build Studio button with DoR-driven states`.

---

## Phase 13: `/build` brief auto-creates BacklogItem

### Task 22

**Files:**
- Modify: the server action / API route handling brief submission (grep for `createFeatureBuild` / `startFeatureBuild`)

- [ ] **Step 1:** When a brief arrives WITHOUT a `backlogItemId`:
  1. Call the shared item-creation path with `source=user-request, status=open, triageOutcome=build, proposedOutcome=build` in one INSERT.
  2. Call `promoteToBuildStudio({ itemId, mode: "capacity-only" })`.
  3. On ok: return `{ buildId }`.
  4. On `DOR_FAILED (capacity)`: return structured error with queue position for the UI to display.
- [ ] **Step 2: Integration test** (Flavor B): submit brief, assert BacklogItem + FeatureBuild both exist and are linked via `activeBuildId` and `originatingBacklogItemId`.
- [ ] **Step 3: Commit.** Message: `feat(build): auto-create backlog item from brief submission`.

---

## Phase 14: Rename `ops-coordinator` → `scrum-master`

All touchpoints land in one atomic commit.

### Task 23

**Known touchpoints (grep-verified; `rg "ops-coordinator" -l | grep -v docs/superpowers/` gives this list):**
- `packages/db/src/seed.ts`
- `packages/db/src/seed-skills.ts`
- `packages/db/scripts/archive-persona-agents.ts`
- `apps/web/lib/tak/agent-routing.ts` (`ROUTE_AGENT_MAP` line 200, `CANNED_RESPONSES` ~line 654)
- `apps/web/lib/tak/agent-grants.ts`
- `apps/web/lib/tak/route-context-map.ts`
- `apps/web/lib/agent-routing.ts` (AGENT_NAME_MAP; display name stays "Scrum Master")
- `apps/web/lib/actions/build.ts`
- `apps/web/components/workspace/CalendarAgentScheduler.tsx`
- `apps/web/components/agent/AgentMessageBubble.test.tsx`
- `prompts/route-persona/ops-coordinator.prompt.md` → rename to `scrum-master.prompt.md`
- `skills/ops/create-item.skill.md`, `skills/ops/epic-progress.skill.md` (assignTo arrays)
- `e2e/ep-inf-012-routing-test.spec.ts`
- Create: `packages/db/prisma/migrations/<next-ts>_rename_ops_coordinator/migration.sql`

**Exclusion:** `docs/superpowers/specs/**` and `docs/superpowers/plans/**` keep the old name where historical.

- [ ] **Step 1: Verify list.** `rg "ops-coordinator" -l | grep -v docs/superpowers/` — must match the list above. If anything new surfaces, add it before proceeding.
- [ ] **Step 2: Create migration.**

  ```sql
  UPDATE "Agent" SET "agentId" = 'scrum-master' WHERE "agentId" = 'ops-coordinator';
  UPDATE "AgentGrant" SET "agentId" = 'scrum-master' WHERE "agentId" = 'ops-coordinator';
  UPDATE "SkillAssignment" SET "agentId" = 'scrum-master' WHERE "agentId" = 'ops-coordinator';
  -- Grep schema.prisma for other tables with agentId column and add UPDATEs as needed
  ```
- [ ] **Step 3: Replace** `ops-coordinator` → `scrum-master` in every code/config file listed. Display name `"Scrum Master"` in seed.ts:909 already correct.
- [ ] **Step 4: Rename prompt file.** `git mv prompts/route-persona/ops-coordinator.prompt.md prompts/route-persona/scrum-master.prompt.md`.
- [ ] **Step 5: Verify.** `rg "ops-coordinator" -l | grep -v docs/superpowers/` must return zero hits.
- [ ] **Step 6: Apply migration.** `pnpm --filter @dpf/db exec prisma migrate dev`.
- [ ] **Step 7: Re-seed.** First check: `cat packages/db/package.json | grep -A 2 '"scripts"'`. Run the configured seed script.
- [ ] **Step 8: Browser smoke.** `/ops` loads; coworker label reads "Scrum Master".
- [ ] **Step 9: Typecheck + tests.**
- [ ] **Step 10: Commit.** `git commit --only <every file>` — message: `refactor(agents): rename ops-coordinator to scrum-master`. Push.

### Task 24: Scrum Master prompt rewrite

**Files:**
- Modify: `prompts/route-persona/scrum-master.prompt.md` (just renamed)

- [ ] **Step 1: Rewrite** the system prompt around named disciplines (spec §11.2 original + §6.8 revised):
  - Mission: own the triage gate; every item leaves `triaging` with a decided outcome.
  - Triage verbs: propose outcome + rationale in one response, then call `triage_backlog_item` — do not loop on `query_backlog`.
  - Sizing discipline: if triaging to `build` and `effortSize` is null, ask the user; do not guess.
  - Capacity honesty: when DoR fails at capacity, name the blocking builds and queue position.
  - Bootstrap awareness: when zero open epics exist, mention this explicitly in the rationale and proceed without epic alignment.
  - Escalation: advise the user to click "Report" (the UI Send-to-Upstream button) for items that should go upstream; do not try to auto-escalate.
- [ ] **Step 2: Re-seed prompts.** First check: `cat packages/db/package.json | grep seed-prompts`, or grep for `seed-prompts` under `packages/db/`. If no dedicated prompt-seed script exists, check `apps/web/lib/tak/prompt-loader.ts` — it may load from filesystem on boot, making re-seed unnecessary.
- [ ] **Step 3: Smoke test.** In `/ops`, invoke the coworker ("triage anything pending?"); confirm it calls `triage_backlog_item` instead of looping on `query_backlog`.
- [ ] **Step 4: Commit.** Message: `feat(prompts): scrum-master prompt focused on triage verbs`.

---

## Phase 15: E2E happy-path test

### Task 25: Full triage → ship round-trip

**Files:**
- Create: `tests/e2e/backlog-triage-to-ship.spec.ts`

- [ ] **Step 1:** Browser-use e2e script:
  1. Navigate to `/ops`. Create a portfolio BacklogItem (title, `source=feature-gap`). Item lands in `triaging`.
  2. In triage section, pick `outcome=build`, `effortSize=small`, commit.
  3. Click "Send to Build Studio".
  4. Navigate Build Studio phases to `ship` (AI calls mocked — see Step 2).
  5. Return to `/ops`. Assert originator is `status=done` and its Epic (if any) auto-closed.
- [ ] **Step 2: AI mocking** — reuse the existing build-specialist mock harness if one exists (`rg -l "build-specialist.*mock" apps/web`). If none, this test becomes a manual run instead of CI, and the task closes with that caveat documented inline.
- [ ] **Step 3: Commit.** Message: `test(e2e): triage → ship round-trip for backlog → build`.

---

## Phase 16: Final verification

### Task 26a: Invariants test suite (spec §7)

**Files:**
- Create: `apps/web/lib/backlog-invariants.test.ts`

**Harness:** Flavor B (real DB) — CHECK constraints and NOT NULL only exercise with real PostgreSQL.

One `it()` per invariant from spec §7.

- [ ] **Step 1: Write test blocks** for invariants 1–10:
  1. New BacklogItem without explicit status+triageOutcome defaults to `triaging`.
  2. Updating to `status=open` with `triageOutcome=NULL` throws (CHECK).
  3. `triageOutcome=duplicate` without `duplicateOfId` throws.
  4. `triageOutcome=discard` without `resolution` throws.
  5. `promoteToBuildStudio` on `xlarge` returns `DOR_FAILED` with `"xlarge — must be split before promote"`.
  6. Cannot set `activeBuildId` when one is already non-null on the same item.
  7. Creating a `FeatureBuild` without `originatingBacklogItemId` throws (NOT NULL).
  8. Ship event clears `activeBuildId` and sets `status=done` (integration test via originator-sync handler).
  9. Abandon event clears `activeBuildId`, returns to `triaging`, and preserves the `FeatureBuild` row (integration via handler).
  10. Ship closing the last active item in an Epic marks that Epic `done` (integration via handler).
- [ ] **Step 2:** Tests pass.
- [ ] **Step 3: Commit.** Message: `test(backlog): invariant sweep against spec §7`.

### Task 26: Full test sweep

- [ ] **Step 1:** Run unit tests: `pnpm --filter web exec vitest run apps/web/lib/backlog-enums.test.ts apps/web/lib/triage.test.ts apps/web/lib/triage-dor.test.ts apps/web/lib/promote-to-build.test.ts apps/web/lib/promote-to-build.concurrency.test.ts apps/web/lib/backlog-invariants.test.ts`.
- [ ] **Step 2:** Run queue/integration tests.
- [ ] **Step 3:** Run the e2e happy-path.
- [ ] **Step 4:** Typecheck: `pnpm --filter web typecheck`.
- [ ] **Step 5:** Production build: `pnpm --filter web build`.
- [ ] **Step 6:** Manual sanity: triage a live item, send to Build Studio, abandon, confirm `triaging` return.
- [ ] **Step 7:** DB check:

  ```sh
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c \
    "SELECT status, \"triageOutcome\", COUNT(*) FROM \"BacklogItem\" GROUP BY status, \"triageOutcome\" ORDER BY status;"
  ```
  Every non-triaging row must have a non-null `triageOutcome`.
- [ ] **Step 8:** If green, no additional commit — cumulative result of Tasks 1–26a is the final state.

---

## Out of Scope (per spec §4)

- `Goal` / `Objective` top-level model.
- Release bundling or cross-build scheduling.
- Automatic dequeue-and-promote workers.
- Separate `/ops/triage` route.
- `product-owner` coworker.
- Wiring `escalateToUpstreamIssue` as an MCP tool.
- `split_backlog_item` tool (deferred to v1.1).

## Review Gates

- **After Phase 2** (additive applied): manually verify triage migration moved items cleanly.
- **After Phase 3** (point of no return): CI must be green.
- **After Phase 6** (events + reconciler): end-to-end smoke before touching UI.
- **After Phase 14** (rename): browse `/ops` once; confirm no drift.
