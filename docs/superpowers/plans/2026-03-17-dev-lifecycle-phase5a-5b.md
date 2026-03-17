# Development Lifecycle — Phase 5a+5b: Git Integration & Version Tracking

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every approved code change becomes a git commit, every shipped build gets a git tag, and version history is queryable through new data models.

**Architecture:** New `git-utils.ts` module wraps async git operations. The `propose_file_change` handler in `mcp-tools.ts` calls `commitFile()` after writing. `shipBuild()` in `build.ts` calls `createTag()` and creates `ProductVersion` + `ChangePromotion` records. Prisma schema gains 3 new models and 2 field extensions.

**Tech Stack:** Next.js 16, TypeScript strict, Prisma 6, vitest, git CLI via `child_process`.

**Spec:** `docs/superpowers/specs/2026-03-17-development-lifecycle-architecture-design.md` (Sections 2, 3, 7, 8, 10)

---

## Scope

**Phase 5a** — Git utilities module + auto-commit on `propose_file_change` approval + git tagging on `shipBuild()`
**Phase 5b** — `ProductVersion`, `ChangePromotion` models + `shipBuild()` creates version/promotion records + `query_version_history` tool

**NOT in scope:** Codebase manifest (5c), production tools (5d), promotion UI (5e), service offerings (5f), self-registration (5g).

**Deferred to Phase 5d:** `git-utils.ts` will gain `gitShow`, `gitDiffStat`, `gitGrep`, `gitLsTree` when the production tools that consume them are built.
**Deferred to Phase 5c:** `ProductVersion.manifestId` / `manifest` relation and `DigitalProduct.manifests` relation will be added with the `CodebaseManifest` model.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/git-utils.ts` | Async git operations: commit, tag, log, isGitAvailable. Wraps `child_process.exec` with timeouts and path security. |
| `apps/web/lib/git-utils.test.ts` | Tests for git utilities (commit message formatting, path module inference, isGitAvailable) |
| `apps/web/lib/version-tracking.ts` | ProductVersion + ChangePromotion creation logic. Called by `shipBuild()`. |
| `apps/web/lib/version-tracking.test.ts` | Tests for version tracking helpers (promotion ID generation, change count calculation) |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add ProductVersion, ChangePromotion models; extend FeatureBuild (gitCommitHashes), AgentActionProposal (gitCommitHash), DigitalProduct (versions relation) |
| `apps/web/lib/mcp-tools.ts` | Extend `propose_file_change` handler with auto-commit; add `query_version_history` tool definition + handler |
| `apps/web/lib/actions/build.ts` | Extend `shipBuild()` to call createTag, create ProductVersion, create ChangePromotion |

---

## Chunk 1: Prisma Schema Changes

### Task 1: Add new models and extend existing ones

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add ProductVersion model**

Add after the `DigitalProduct` model (after line 415 in schema.prisma):

```prisma
// ─── Version Tracking ────────────────────────────────────────────────────────

model ProductVersion {
  id               String            @id @default(cuid())
  digitalProductId String
  digitalProduct   DigitalProduct    @relation(fields: [digitalProductId], references: [id])
  version          String
  gitTag           String
  gitCommitHash    String
  featureBuildId   String?
  featureBuild     FeatureBuild?     @relation(fields: [featureBuildId], references: [id])
  shippedBy        String
  shippedAt        DateTime          @default(now())
  changeCount      Int               @default(0)
  changeSummary    String?           @db.Text
  promotions       ChangePromotion[]

  @@unique([digitalProductId, version])
  @@index([gitTag])
}

model ChangePromotion {
  id               String         @id @default(cuid())
  promotionId      String         @unique
  productVersionId String
  productVersion   ProductVersion @relation(fields: [productVersionId], references: [id])
  status           String         @default("pending")
  requestedBy      String
  approvedBy       String?
  approvedAt       DateTime?
  rejectedBy       String?
  rejectedAt       DateTime?
  rationale        String?        @db.Text
  deployedAt       DateTime?
  deploymentLog    String?        @db.Text
  rolledBackAt     DateTime?
  rolledBackBy     String?
  rollbackReason   String?        @db.Text
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  @@index([status])
  @@index([productVersionId])
}
```

- [ ] **Step 2: Extend FeatureBuild with gitCommitHashes and productVersions**

In the `FeatureBuild` model (line 1147), add before the closing `}` and after the `@@index([digitalProductId])` line:

```prisma
  gitCommitHashes  String[]        @default([])
  productVersions  ProductVersion[]
```

- [ ] **Step 3: Extend AgentActionProposal with gitCommitHash**

In the `AgentActionProposal` model (line 1054), add before the closing indexes:

```prisma
  gitCommitHash  String?
```

- [ ] **Step 4: Add versions relation to DigitalProduct**

In the `DigitalProduct` model (line 395), add after the `featureBuilds` relation:

```prisma
  versions               ProductVersion[]
```

- [ ] **Step 5: Run Prisma migration**

```bash
cd packages/db && npx prisma migrate dev --name add-version-tracking
```

Expected: Migration created and applied. No errors.

- [ ] **Step 6: Verify schema compiles**

```bash
cd packages/db && npx prisma generate
```

Expected: Client generated successfully.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add ProductVersion, ChangePromotion models and extend FeatureBuild"
```

---

## Chunk 2: Git Utilities Module

### Task 2: Git utilities — core functions

**Files:**
- Create: `apps/web/lib/git-utils.ts`
- Create: `apps/web/lib/git-utils.test.ts`

- [ ] **Step 1: Write failing tests for helper functions**

Create `apps/web/lib/git-utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { inferCommitType, inferModule, formatCommitMessage } from "./git-utils";

describe("inferCommitType", () => {
  it("detects fix from description", () => {
    expect(inferCommitType("fix the null check in router")).toBe("fix");
  });
  it("detects refactor", () => {
    expect(inferCommitType("refactor the agent panel layout")).toBe("refactor");
  });
  it("detects docs", () => {
    expect(inferCommitType("update docs for the API")).toBe("docs");
  });
  it("defaults to feat", () => {
    expect(inferCommitType("add a new button to the toolbar")).toBe("feat");
  });
});

describe("inferModule", () => {
  it("infers web-lib from apps/web/lib path", () => {
    expect(inferModule("apps/web/lib/mcp-tools.ts")).toBe("web-lib");
  });
  it("infers db from packages/db path", () => {
    expect(inferModule("packages/db/prisma/schema.prisma")).toBe("db");
  });
  it("infers web-app from apps/web/app path", () => {
    expect(inferModule("apps/web/app/(protected)/admin/page.tsx")).toBe("web-app");
  });
  it("infers web-components from component path", () => {
    expect(inferModule("apps/web/components/agent/Panel.tsx")).toBe("web-components");
  });
  it("returns root for top-level files", () => {
    expect(inferModule("package.json")).toBe("root");
  });
});

describe("formatCommitMessage", () => {
  it("formats with build ID", () => {
    const msg = formatCommitMessage({
      description: "add tooltip to button",
      filePath: "apps/web/lib/ui.ts",
      buildId: "FB-ABC12345",
      approvedBy: "user-123",
    });
    expect(msg).toContain("feat(web-lib): add tooltip to button");
    expect(msg).toContain("Build: FB-ABC12345");
    expect(msg).toContain("Approved-By: user-123");
    expect(msg).toContain("Change-Type: ai-proposed");
  });
  it("formats standalone (no build)", () => {
    const msg = formatCommitMessage({
      description: "fix typo in readme",
      filePath: "README.md",
      approvedBy: "user-456",
    });
    expect(msg).toContain("fix(root): fix typo in readme");
    expect(msg).toContain("Build: standalone");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter web exec vitest run lib/git-utils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `apps/web/lib/git-utils.ts`:

```typescript
// apps/web/lib/git-utils.ts
// Async git operations for the development lifecycle pipeline.
// Used by mcp-tools.ts (auto-commit on approval) and build.ts (tagging on ship).

import { exec as execCb, execSync } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import { isPathAllowed } from "@/lib/codebase-tools";

const exec = promisify(execCb);
const PROJECT_ROOT = resolve(process.cwd(), "..", "..");
const GIT_TIMEOUT_MS = 10_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMMIT_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\bfix(e[sd])?\b/i, "fix"],
  [/\brefactor/i, "refactor"],
  [/\bdoc(s|ument)?\b/i, "docs"],
  [/\bchore\b/i, "chore"],
];

export function inferCommitType(description: string): string {
  for (const [pattern, type] of COMMIT_TYPE_PATTERNS) {
    if (pattern.test(description)) return type;
  }
  return "feat";
}

export function inferModule(filePath: string): string {
  if (filePath.startsWith("apps/web/lib/")) return "web-lib";
  if (filePath.startsWith("apps/web/app/")) return "web-app";
  if (filePath.startsWith("apps/web/components/")) return "web-components";
  if (filePath.startsWith("apps/web/")) return "web";
  if (filePath.startsWith("packages/db/")) return "db";
  if (filePath.startsWith("packages/")) return "packages";
  if (filePath.startsWith("scripts/")) return "scripts";
  return "root";
}

export function formatCommitMessage(opts: {
  description: string;
  filePath: string;
  buildId?: string;
  approvedBy: string;
  proposalId?: string;
}): string {
  const type = inferCommitType(opts.description);
  const module = inferModule(opts.filePath);
  const subject = `${type}(${module}): ${opts.description}`;
  const trailers = [
    "",
    `Build: ${opts.buildId ?? "standalone"}`,
    `Approved-By: ${opts.approvedBy}`,
    `Change-Type: ai-proposed`,
  ];
  if (opts.proposalId) trailers.push(`Proposal: ${opts.proposalId}`);
  return subject + "\n" + trailers.join("\n");
}

// ─── Git Availability ────────────────────────────────────────────────────────

export function isGitAvailable(): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: PROJECT_ROOT, timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Git Operations ──────────────────────────────────────────────────────────

export async function commitFile(opts: {
  filePath: string;  // Must be project-root-relative (e.g., "apps/web/lib/mcp-tools.ts")
  message: string;
}): Promise<{ hash: string } | { error: string }> {
  if (!isPathAllowed(opts.filePath)) {
    return { error: `Path not allowed for commit: ${opts.filePath}` };
  }
  try {
    await exec(`git add "${opts.filePath}"`, { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
    await exec(`git commit -m ${JSON.stringify(opts.message)}`, { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
    const { stdout } = await exec("git rev-parse HEAD", { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
    return { hash: stdout.trim() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git commit failed" };
  }
}

export async function getCurrentCommitHash(): Promise<string | null> {
  try {
    const { stdout } = await exec("git rev-parse HEAD", { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function createTag(opts: {
  tag: string;
  message: string;
}): Promise<{ ok: true } | { error: string }> {
  try {
    await exec(`git tag -a "${opts.tag}" -m ${JSON.stringify(opts.message)}`, { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Git tag failed" };
  }
}

export async function gitLog(opts?: {
  from?: string;
  to?: string;
  maxCount?: number;
}): Promise<{ commits: Array<{ hash: string; message: string; date: string }> }> {
  try {
    const range = opts?.from && opts?.to ? `${opts.from}..${opts.to}` : "";
    const limit = opts?.maxCount ? `--max-count=${opts.maxCount}` : "--max-count=50";
    const format = '--format={"hash":"%H","message":"%s","date":"%aI"}';
    const { stdout } = await exec(
      `git log ${limit} ${format} ${range}`.trim(),
      { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS },
    );
    const commits = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
    return { commits };
  } catch {
    return { commits: [] };
  }
}

export async function getCommitCount(from: string, to: string = "HEAD"): Promise<number> {
  try {
    const { stdout } = await exec(
      `git rev-list --count ${from}..${to}`,
      { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS },
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export async function getLatestTag(): Promise<string | null> {
  try {
    const { stdout } = await exec(
      "git describe --tags --abbrev=0",
      { cwd: PROJECT_ROOT, timeout: GIT_TIMEOUT_MS },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web exec vitest run lib/git-utils.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/git-utils.ts apps/web/lib/git-utils.test.ts
git commit -m "feat(web-lib): add git-utils module with commit, tag, and helper functions"
```

---

## Chunk 3: Auto-Commit on propose_file_change Approval

### Task 3: Extend propose_file_change handler

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts:956-975`

- [ ] **Step 1: Add git-utils import and extend the handler**

Replace the `case "propose_file_change"` block (lines 956-975 in mcp-tools.ts) with:

```typescript
    case "propose_file_change": {
      const { readProjectFile, writeProjectFile, generateSimpleDiff } = await import("@/lib/codebase-tools");
      const path = String(params.path ?? "");
      const newContent = String(params.newContent ?? "");
      const description = String(params.description ?? "");

      const current = readProjectFile(path);
      const currentContent = "content" in current ? current.content : "";
      const diff = generateSimpleDiff(currentContent, newContent, path);

      const writeResult = writeProjectFile(path, newContent);
      if ("error" in writeResult) return { success: false, error: writeResult.error, message: writeResult.error };

      // Auto-commit the approved change
      let commitHash: string | undefined;
      try {
        const { commitFile, formatCommitMessage, isGitAvailable } = await import("@/lib/git-utils");
        if (isGitAvailable()) {
          // Resolve buildId from thread context (best-effort)
          let buildId: string | undefined;
          if (context?.threadId) {
            const build = await prisma.featureBuild.findFirst({
              where: { threadId: context.threadId, phase: { in: ["build", "review"] } },
              select: { buildId: true, id: true },
            });
            if (build) buildId = build.buildId;
          }

          const message = formatCommitMessage({ description, filePath: path, buildId, approvedBy: userId });
          const result = await commitFile({ filePath: path, message });

          if ("hash" in result) {
            commitHash = result.hash;

            // Update AgentActionProposal with commit hash (best-effort)
            if (context?.threadId) {
              await prisma.agentActionProposal.updateMany({
                where: { threadId: context.threadId, actionType: "propose_file_change", status: "approved", gitCommitHash: null },
                data: { gitCommitHash: commitHash },
              }).catch(() => {});
            }

            // Append commit hash to FeatureBuild (best-effort)
            if (buildId) {
              await prisma.featureBuild.update({
                where: { buildId },
                data: { gitCommitHashes: { push: commitHash } },
              }).catch(() => {});
            }
          } else {
            console.warn("[propose_file_change] git commit failed:", result.error);
          }
        }
      } catch (err) {
        console.warn("[propose_file_change] auto-commit error:", err);
      }

      return {
        success: true,
        entityId: path,
        message: commitHash ? `Applied and committed: ${path}` : `Applied change to ${path}`,
        data: { path, diff, description, ...(commitHash ? { commitHash } : {}) },
      };
    }
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat(web-lib): auto-commit on propose_file_change approval"
```

---

## Chunk 4: Git Tagging on shipBuild

### Task 4: Extend shipBuild with git tag creation

**Files:**
- Modify: `apps/web/lib/actions/build.ts:160-243`

- [ ] **Step 1: Add git tag creation after the transaction**

In `shipBuild()`, after the `prisma.$transaction()` block (after line 235, before the `return` statement), add:

```typescript
  // Git tagging + version tracking (best-effort — failures do not block shipping)
  let previousTag: string | null = null;
  let gitCommitHash: string | null = null;
  let changeCount = 0;

  try {
    const { createTag, isGitAvailable, getLatestTag, getCommitCount, getCurrentCommitHash } = await import("@/lib/git-utils");

    if (isGitAvailable()) {
      // Capture previous tag BEFORE creating the new one
      previousTag = await getLatestTag();
      gitCommitHash = await getCurrentCommitHash();

      if (previousTag) {
        changeCount = await getCommitCount(previousTag);
      }

      // Create the new tag
      const tagName = `v${result.version}`;
      const tagMessage = `${input.name} v${result.version}\n\nBuild: ${input.buildId}\nShipped-By: ${userId}`;
      const tagResult = await createTag({ tag: tagName, message: tagMessage });
      if ("error" in tagResult) {
        console.warn("[shipBuild] git tag failed:", tagResult.error);
      }
    }
  } catch (err) {
    console.warn("[shipBuild] git tag error:", err);
  }
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/build.ts
git commit -m "feat(web-lib): create git tag on shipBuild"
```

---

## Chunk 5: Version Tracking Module

### Task 5: ProductVersion and ChangePromotion creation

**Files:**
- Create: `apps/web/lib/version-tracking.ts`
- Create: `apps/web/lib/version-tracking.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/version-tracking.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generatePromotionId } from "./version-tracking";

describe("generatePromotionId", () => {
  it("returns CP- prefixed ID", () => {
    const id = generatePromotionId();
    expect(id).toMatch(/^CP-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePromotionId()));
    expect(ids.size).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter web exec vitest run lib/version-tracking.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `apps/web/lib/version-tracking.ts`:

```typescript
// apps/web/lib/version-tracking.ts
// Creates ProductVersion and ChangePromotion records on shipBuild().

import { prisma } from "@dpf/db";
import * as crypto from "crypto";

export function generatePromotionId(): string {
  return `CP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createProductVersion(opts: {
  digitalProductId: string;
  version: string;
  gitTag: string;
  gitCommitHash: string;
  featureBuildId?: string;
  shippedBy: string;
  changeCount?: number;
  changeSummary?: string;
}): Promise<{ versionId: string; promotionId: string }> {
  const promotionId = generatePromotionId();

  const productVersion = await prisma.productVersion.create({
    data: {
      digitalProductId: opts.digitalProductId,
      version: opts.version,
      gitTag: opts.gitTag,
      gitCommitHash: opts.gitCommitHash,
      featureBuildId: opts.featureBuildId ?? null,
      shippedBy: opts.shippedBy,
      changeCount: opts.changeCount ?? 0,
      changeSummary: opts.changeSummary ?? null,
    },
    select: { id: true },
  });

  await prisma.changePromotion.create({
    data: {
      promotionId,
      productVersionId: productVersion.id,
      status: "pending",
      requestedBy: opts.shippedBy,
    },
  });

  return { versionId: productVersion.id, promotionId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web exec vitest run lib/version-tracking.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/version-tracking.ts apps/web/lib/version-tracking.test.ts
git commit -m "feat(web-lib): add version-tracking module for ProductVersion and ChangePromotion"
```

---

## Chunk 6: Integrate Version Tracking into shipBuild

### Task 6: shipBuild creates ProductVersion + ChangePromotion

**Files:**
- Modify: `apps/web/lib/actions/build.ts`

- [ ] **Step 1: Add version tracking call after git tag**

Immediately after the git tag block (still inside `shipBuild()`), add. Note: `gitCommitHash`, `changeCount`, and `build` are already in scope from the tag block above and the earlier transaction:

```typescript
  // Create ProductVersion + ChangePromotion records (best-effort)
  try {
    const { createProductVersion } = await import("@/lib/version-tracking");

    await createProductVersion({
      digitalProductId: result.id,
      version: result.version,
      gitTag: `v${result.version}`,
      gitCommitHash: gitCommitHash ?? "unknown",
      featureBuildId: build.id,
      shippedBy: userId,
      changeCount,
      changeSummary: build.diffSummary ?? undefined,
    });
  } catch (err) {
    console.warn("[shipBuild] version tracking failed:", err);
  }
```

The `gitCommitHash`, `changeCount`, and `previousTag` variables were captured in the git tag block (Task 4) BEFORE the new tag was created, so `changeCount` correctly reflects commits since the previous version.

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/build.ts
git commit -m "feat(web-lib): shipBuild creates ProductVersion and ChangePromotion records"
```

---

## Chunk 7: query_version_history Tool

### Task 7: Add query_version_history MCP tool

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add tool definition to PLATFORM_TOOLS**

Add to the `PLATFORM_TOOLS` array, after the codebase tools section:

```typescript
  // ─── Version Tracking Tools ────────────────────────────────────────────────
  {
    name: "query_version_history",
    description: "List product versions with their git tags, ship dates, change counts, and promotion status. Optionally filter by digital product ID.",
    inputSchema: {
      type: "object",
      properties: {
        digitalProductId: { type: "string", description: "Filter by product (optional — returns all if omitted)" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
```

- [ ] **Step 2: Add execution handler**

Add to the `executeTool` switch statement:

```typescript
    case "query_version_history": {
      const limit = typeof params.limit === "number" ? Math.min(params.limit, 50) : 20;
      const where = typeof params.digitalProductId === "string"
        ? { digitalProductId: params.digitalProductId }
        : {};

      const versions = await prisma.productVersion.findMany({
        where,
        orderBy: { shippedAt: "desc" },
        take: limit,
        include: {
          digitalProduct: { select: { productId: true, name: true } },
          promotions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, promotionId: true } },
        },
      });

      const rows = versions.map((v) => ({
        product: v.digitalProduct?.name ?? "unknown",
        productId: v.digitalProduct?.productId ?? "unknown",
        version: v.version,
        gitTag: v.gitTag,
        shippedAt: v.shippedAt.toISOString(),
        changeCount: v.changeCount,
        changeSummary: v.changeSummary ?? "",
        promotionStatus: v.promotions[0]?.status ?? "none",
        promotionId: v.promotions[0]?.promotionId ?? null,
      }));

      const summary = rows.map((r) =>
        `${r.product} ${r.version} (${r.gitTag}) — ${r.promotionStatus} — shipped ${r.shippedAt.slice(0, 10)}`
      ).join("\n");

      return {
        success: true,
        message: summary || "No versions found.",
        data: { versions: rows },
      };
    }
```

- [ ] **Step 3: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat(web-lib): add query_version_history MCP tool"
```

---

## Chunk 8: Verification

### Task 8: Final verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

Expected: All tests pass. No regressions.

- [ ] **Step 2: Type check full project**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Verify Prisma schema is valid**

```bash
cd packages/db && npx prisma validate
```

Expected: Schema is valid.

- [ ] **Step 4: Manual verification plan**

1. Open the platform, navigate to any agent chat
2. Switch to Act mode, ask the agent to propose a file change (e.g., "Add a comment to AGENTS.md")
3. Approve the change → verify a git commit was created (`git log -1` should show the structured message)
4. Navigate to Build Studio, create and ship a build
5. Verify a git tag was created (`git tag -l` should show `v{version}`)
6. Ask the agent: "Show me the version history" → should call `query_version_history`

- [ ] **Step 5: Commit any fixups from verification**

```bash
git add -A && git commit -m "fix: address issues from manual verification"
```

Only if needed.

---

## Chunk 9: Backlog Items

### Task 9: Register this work in the backlog

- [ ] **Step 1: Create epic and backlog items**

Run via the platform's agent (or SQL):

```sql
INSERT INTO "Epic" (id, "epicId", title, description, status)
VALUES (
  gen_random_uuid()::text,
  'EP-DEVLC-5AB',
  'Development Lifecycle — Git Integration & Version Tracking (Phase 5a+5b)',
  'Auto-commit on propose_file_change approval, git tagging on shipBuild, ProductVersion and ChangePromotion models, query_version_history tool.',
  'open'
);
```

Backlog items should be created for each chunk via the platform's backlog tools.
