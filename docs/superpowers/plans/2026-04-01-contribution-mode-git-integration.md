# Contribution Mode Git Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the three contribution modes (`fork_only`, `selective`, `contribute_all`) to the PR contribution pipeline, add DCO acceptance, escalating data-loss warnings for fork_only users, and git backup support.

**Architecture:** The existing `assess_contribution` and `contribute_to_hive` MCP tools already implement mode-aware behavior via the ship phase prompt. This plan extends `contribute_to_hive` to create upstream PRs when contributing, removes the unconditional `submitBuildAsPR` call from `deploy_feature`, adds DCO acceptance storage, escalating warnings for fork_only without git, and git credential storage via the existing `CredentialEntry` model.

**Tech Stack:** Next.js 16, Prisma 7.x, TypeScript, PostgreSQL, GitHub REST API

**Spec:** `docs/superpowers/specs/2026-04-01-contribution-mode-git-integration-design.md`

---

### Task 1: Schema Migration — Add DCO and Upstream Fields to PlatformDevConfig

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (PlatformDevConfig model, ~line 2294)
- Create: `packages/db/prisma/migrations/{timestamp}_add_dco_and_upstream_to_platform_dev_config/migration.sql`

- [ ] **Step 1: Add fields to PlatformDevConfig model**

In `packages/db/prisma/schema.prisma`, find the `PlatformDevConfig` model (~line 2294) and add three new fields after `configuredById`:

```prisma
model PlatformDevConfig {
  id               String   @id @default("singleton")
  contributionMode String   @default("selective")
  gitRemoteUrl     String?
  updatePending    Boolean  @default(false)
  pendingVersion   String?
  configuredAt     DateTime @default(now())
  configuredById   String?
  configuredBy     User?    @relation("PlatformDevConfiguredBy", fields: [configuredById], references: [id])
  dcoAcceptedAt    DateTime?
  dcoAcceptedById  String?
  dcoAcceptedBy    User?    @relation("PlatformDevDcoAcceptedBy", fields: [dcoAcceptedById], references: [id])
  upstreamRemoteUrl String?
}
```

Note: This adds a second `User` relation, so we need the named relation `"PlatformDevDcoAcceptedBy"`. Also add the inverse relation on the `User` model — find `User` model and add:

```prisma
platformDevDcoAcceptances PlatformDevConfig[] @relation("PlatformDevDcoAcceptedBy")
```

- [ ] **Step 2: Generate the migration**

```bash
cd packages/db && pnpm exec prisma migrate dev --name add_dco_and_upstream_to_platform_dev_config
```

Verify the generated SQL contains:
```sql
ALTER TABLE "PlatformDevConfig" ADD COLUMN "dcoAcceptedAt" TIMESTAMP(3);
ALTER TABLE "PlatformDevConfig" ADD COLUMN "dcoAcceptedById" TEXT;
ALTER TABLE "PlatformDevConfig" ADD COLUMN "upstreamRemoteUrl" TEXT;
ALTER TABLE "PlatformDevConfig" ADD CONSTRAINT "PlatformDevConfig_dcoAcceptedById_fkey" FOREIGN KEY ("dcoAcceptedById") REFERENCES "User"("id");
```

- [ ] **Step 3: Commit**

```
feat(db): add DCO acceptance and upstream URL fields to PlatformDevConfig
```

---

### Task 2: Mode-Aware deploy_feature — Remove Unconditional submitBuildAsPR

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (~lines 2569-2620, the submitBuildAsPR block in deploy_feature)

- [ ] **Step 1: Replace the submitBuildAsPR block with mode-aware logic**

In `apps/web/lib/mcp-tools.ts`, find the block starting with the comment `// Submit as PR contribution (EP-BUILD-HANDOFF-002 Phase 2e)` (~line 2569). Replace the entire `submitBuildAsPR` try/catch block and the `prInfo` variable usage with contribution-mode-aware logic:

```typescript
      // Contribution mode awareness (EP-BUILD-HANDOFF-002 Phase 2e extension)
      let contributionModeInfo = "";
      try {
        const devConfig = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
        const mode = devConfig?.contributionMode ?? "fork_only";

        if (mode === "fork_only" && !devConfig?.gitRemoteUrl) {
          // Count untracked shipped features for escalating warning
          const untrackedCount = await prisma.featureBuild.count({
            where: { phase: "complete", gitCommitHashes: { isEmpty: true } },
          });

          if (untrackedCount >= 5) {
            contributionModeInfo = `**Warning:** You have ${untrackedCount} custom features with no backup. This represents significant business value that could be lost in a container rebuild, Docker update, or system recovery. Setting up a git repository takes about 10 minutes and protects all your customizations. See Admin > Platform Development.`;
          } else if (untrackedCount >= 2) {
            contributionModeInfo = `**Note:** You now have ${untrackedCount} custom features deployed without version control. If your Docker containers are rebuilt, these changes could be lost. I'd recommend setting up a git repository -- see Admin > Platform Development.`;
          } else if (untrackedCount >= 1) {
            contributionModeInfo = "Note: since no git repository is configured, customizations exist only in your production container. You can set up a repository in Admin > Platform Development to protect your work.";
          }
        }
      } catch (err) {
        console.warn("[deploy_feature] contribution mode check failed:", err);
      }
```

Then update the `messageParts` assembly to use `contributionModeInfo` instead of `prInfo`:

```typescript
      if (contributionModeInfo) {
        messageParts.push("", contributionModeInfo);
      }
```

And update the return `data` object to remove `prContribution` and add `contributionMode`:

```typescript
      return {
        success: true,
        message: messageParts.join("\n"),
        data: {
          diffLength: extracted.fullDiff.length,
          summary: extracted.fullDiff.slice(0, 500),
          codeFiles: extracted.codeFiles.length,
          migrationFiles: extracted.migrationFiles.length,
          destructiveWarnings,
          windowStatus,
          impactReport,
        },
      };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd h:/opendigitalproductfactory && npx tsc --noEmit --pretty apps/web/lib/mcp-tools.ts 2>&1 | grep "^apps/"
```

Expected: no errors from our files.

- [ ] **Step 3: Commit**

```
feat(build): make deploy_feature contribution-mode-aware, add escalating warnings
```

---

### Task 3: Ship Phase Context — Inject Contribution Mode and Warnings

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts` (~lines 485-520, after the existing ship phase impact/authority block)

- [ ] **Step 1: Add contribution mode context injection after the existing ship phase block**

In `agent-coworker.ts`, find the closing of the ship phase block (the line `console.log(\`[ship] Injected impact analysis + authority context\`)`). After the closing `catch` block for that section, add a new block that injects contribution mode context:

```typescript
      // Ship phase: inject contribution mode context for STEP 5 advisory
      try {
        const devConfig = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
        const mode = devConfig?.contributionMode ?? "fork_only";
        const hasRepo = !!devConfig?.gitRemoteUrl;
        const hasDco = !!devConfig?.dcoAcceptedAt;

        const modeContext: string[] = [
          "",
          `## Platform Contribution Mode: ${mode}`,
          "",
        ];

        if (mode === "fork_only" && !hasRepo) {
          const untrackedCount = await prisma.featureBuild.count({
            where: { phase: "complete", gitCommitHashes: { isEmpty: true } },
          });
          if (untrackedCount > 0) {
            modeContext.push(
              `WARNING: ${untrackedCount} feature(s) deployed without version control backup.`,
              "After completing the ship sequence, warn the user about data loss risk.",
              "Suggest setting up a git repository in Admin > Platform Development.",
              "",
            );
          }
        }

        if (mode === "selective" || mode === "contribute_all") {
          if (!hasDco) {
            modeContext.push(
              "DCO has NOT been accepted yet. If the user chooses to contribute, remind them",
              "to accept the Developer Certificate of Origin in Admin > Platform Development first.",
              "",
            );
          }
        }

        populatedPrompt += modeContext.join("\n");
        console.log(`[ship] Injected contribution mode context: ${mode}`);
      } catch (err) {
        console.warn("[ship] Failed to inject contribution mode context:", err);
      }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd h:/opendigitalproductfactory && npx tsc --noEmit --pretty apps/web/lib/actions/agent-coworker.ts 2>&1 | grep "^apps/"
```

- [ ] **Step 3: Commit**

```
feat(build): inject contribution mode + DCO status into ship phase context
```

---

### Task 4: DCO Acceptance Actions

**Files:**
- Modify: `apps/web/lib/actions/platform-dev-config.ts`

- [ ] **Step 1: Add DCO acceptance and untracked count functions**

Add these functions to the end of `apps/web/lib/actions/platform-dev-config.ts`:

```typescript
export async function acceptDco(): Promise<{ accepted: boolean; error?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { accepted: false, error: "Not authenticated" };

  const config = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
  if (!config) return { accepted: false, error: "Platform development not configured" };

  if (config.contributionMode === "fork_only") {
    return { accepted: false, error: "DCO is not required for fork_only mode" };
  }

  await prisma.platformDevConfig.update({
    where: { id: "singleton" },
    data: {
      dcoAcceptedAt: new Date(),
      dcoAcceptedById: userId,
    },
  });

  revalidatePath("/admin/platform-development");
  return { accepted: true };
}

export async function getUntrackedFeatureCount(): Promise<number> {
  return prisma.featureBuild.count({
    where: { phase: "complete", gitCommitHashes: { isEmpty: true } },
  });
}

export async function saveGitRemoteUrl(url: string | null): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  await prisma.platformDevConfig.update({
    where: { id: "singleton" },
    data: { gitRemoteUrl: url?.trim() || null },
  });

  revalidatePath("/admin/platform-development");
}
```

Also ensure `auth` and `revalidatePath` are imported at the top of the file. Check the existing imports — `auth` should already be imported for `savePlatformDevConfig`.

- [ ] **Step 2: Update getPlatformDevConfig to include new fields**

Find the existing `getPlatformDevConfig()` function and ensure its select/include returns the new fields:

```typescript
export async function getPlatformDevConfig() {
  return prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    include: {
      configuredBy: { select: { email: true } },
      dcoAcceptedBy: { select: { email: true } },
    },
  });
}
```

- [ ] **Step 3: Commit**

```
feat(admin): add DCO acceptance, untracked count, and git remote URL actions
```

---

### Task 5: Extend contribute_to_hive for Upstream PRs

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (~lines 3278-3305, inside the contribute_to_hive handler)
- Modify: `apps/web/lib/contribution-pipeline.ts` (submitBuildAsPR — add optional targetRemoteUrl param)

- [ ] **Step 1: Add targetRemoteUrl to submitBuildAsPR**

In `apps/web/lib/contribution-pipeline.ts`, update the `SubmitBuildAsPRInput` interface to add an optional `targetRemoteUrl`:

```typescript
interface SubmitBuildAsPRInput {
  buildId: string;
  title: string;
  diffPatch: string;
  productId: string | null;
  impactReport: ChangeImpactReport | null;
  authorUserId: string;
  authorName: string;
  targetRemoteUrl?: string;    // Override: use this URL instead of origin
  dcoSignoff?: string;         // Signed-off-by line for DCO
}
```

In the `submitBuildAsPR` function body, where it calls `parseGitHubRepo(remoteUrl)`, update to prefer `input.targetRemoteUrl` when provided:

```typescript
    const remoteUrl = input.targetRemoteUrl ?? await getRemoteUrl();
    const repo = remoteUrl ? parseGitHubRepo(remoteUrl) : null;
```

And in the `generateCommitMessage` function, append the DCO signoff if provided:

```typescript
function generateCommitMessage(input: {
  title: string;
  buildId: string;
  productId: string | null;
  authorName: string;
  dcoSignoff?: string;
}): string {
  const lines = [
    `feat: ${input.title}`,
    "",
    `Build: ${input.buildId}`,
  ];
  if (input.productId) lines.push(`Product: ${input.productId}`);
  lines.push(`Author: ${input.authorName} (AI Coworker)`);
  lines.push("Change-Type: ai-proposed");
  if (input.dcoSignoff) lines.push("", input.dcoSignoff);
  return lines.join("\n");
}
```

Update the call to `generateCommitMessage` inside `submitBuildAsPR` to pass `dcoSignoff: input.dcoSignoff`.

- [ ] **Step 2: Extend contribute_to_hive to call submitBuildAsPR**

In `apps/web/lib/mcp-tools.ts`, find the `contribute_to_hive` handler. After the `FeaturePack` is created (after `prisma.featurePack.create(...)`, ~line 3291), add:

```typescript
      // Create upstream PR if configured (EP-BUILD-HANDOFF-002 contribution mode)
      let prUrl: string | null = null;
      try {
        const devConfig = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
        const upstreamUrl = devConfig?.upstreamRemoteUrl ?? "https://github.com/markdbodman/opendigitalproductfactory.git";
        const hasDco = !!devConfig?.dcoAcceptedAt;

        if (hasDco && (process.env.GITHUB_TOKEN || devConfig?.gitRemoteUrl)) {
          const { submitBuildAsPR } = await import("@/lib/contribution-pipeline");
          const userInfo = await prisma.user.findUnique({
            where: { id: userId },
            select: { employeeProfile: { select: { displayName: true, workEmail: true } } },
          });
          const displayName = userInfo?.employeeProfile?.displayName ?? userName;
          const email = userInfo?.employeeProfile?.workEmail ?? userEmail;
          const dcoSignoff = `Signed-off-by: ${displayName} <${email}>\nDCO-Accepted: ${devConfig!.dcoAcceptedAt!.toISOString()}`;

          const prResult = await submitBuildAsPR({
            buildId,
            title: build.title,
            diffPatch: diff,
            productId: null,
            impactReport: null,
            authorUserId: userId,
            authorName: displayName,
            targetRemoteUrl: devConfig?.gitRemoteUrl ?? upstreamUrl,
            dcoSignoff,
          });

          if (prResult.prUrl) {
            prUrl = prResult.prUrl;
            // Store PR URL on FeaturePack
            await prisma.featurePack.update({
              where: { packId },
              data: { manifest: { ...manifest, dcoAttestation, prUrl } as unknown as import("@dpf/db").Prisma.InputJsonValue },
            });
          }
        }
      } catch (err) {
        console.warn("[contribute_to_hive] upstream PR creation failed:", err);
      }
```

Update the return message to include the PR URL if created:

```typescript
      const prMessage = prUrl ? ` A pull request has been created: ${prUrl}` : "";
      return {
        success: true,
        message: `Feature Pack ${packId} created and contributed to the Hive Mind. ${manifest.totalFiles} file(s) packaged with DCO attestation.${prMessage} Thank you for contributing!`,
        data: { packId, manifest, dcoAttestation, prUrl },
      };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd h:/opendigitalproductfactory && npx tsc --noEmit --pretty apps/web/lib/mcp-tools.ts apps/web/lib/contribution-pipeline.ts 2>&1 | grep "^apps/"
```

- [ ] **Step 4: Commit**

```
feat(build): extend contribute_to_hive to create upstream PRs with DCO attestation
```

---

### Task 6: Git Backup for fork_only — isDevInstance Guard Relaxation

**Files:**
- Modify: `apps/web/lib/git-utils.ts` (lines 7, 304, 354, 372, 391 — isDevInstance guards)
- Create: `apps/web/lib/git-backup.ts` (new — backup push logic)

- [ ] **Step 1: Add isGitBackupAllowed function to git-utils.ts**

After the existing `isGitAvailable()` function (~line 84), add:

```typescript
/**
 * Check if git backup operations are allowed for consumer-mode installs.
 * Returns true when a git remote URL is configured in PlatformDevConfig.
 * This bypasses the isDevInstance() guard specifically for backup push operations.
 */
export async function isGitBackupAllowed(): Promise<boolean> {
  try {
    const { prisma } = await import("@dpf/db");
    const config = await prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { gitRemoteUrl: true },
    });
    return !!config?.gitRemoteUrl;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create git-backup.ts with backup push logic**

Create `apps/web/lib/git-backup.ts`:

```typescript
/**
 * Git Backup — Commit and push promotion diffs to a configured backup repository.
 * Used by fork_only mode to protect customizations against container rebuilds.
 */

import { prisma } from "@dpf/db";

const DEFAULT_UPSTREAM = "https://github.com/markdbodman/opendigitalproductfactory.git";

/**
 * Commit a promotion diff to the configured backup repository.
 * This function handles its own git operations without the isDevInstance() guard.
 */
export async function backupPromotionToGit(input: {
  buildId: string;
  title: string;
  diffPatch: string;
  productId: string | null;
  version: string | null;
}): Promise<{ pushed: boolean; error?: string }> {
  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { gitRemoteUrl: true, contributionMode: true },
  });

  if (!config?.gitRemoteUrl) {
    return { pushed: false, error: "No git remote URL configured" };
  }

  // Look up the git credential
  const credential = await prisma.credentialEntry.findUnique({
    where: { providerId: "git-backup" },
    select: { secretRef: true, status: true },
  });

  const token = credential?.secretRef ?? process.env.GITHUB_TOKEN;
  if (!token) {
    return { pushed: false, error: "No git credential configured for backup" };
  }

  try {
    const { exec: execCb } = await import("child_process");
    const { promisify } = await import("util");
    const { writeFile, unlink } = await import("fs/promises");
    const { resolve } = await import("path");
    const exec = promisify(execCb);

    const gitRoot = process.env.PROJECT_ROOT
      ? resolve(process.env.PROJECT_ROOT)
      : resolve(process.cwd(), "..", "..");

    const timeout = 30_000;

    // Write diff to temp file and apply
    const tmpFile = `/tmp/dpf-backup-${Date.now()}.patch`;
    await writeFile(tmpFile, input.diffPatch, "utf-8");

    try {
      // Apply the patch
      await exec(`git apply ${JSON.stringify(tmpFile)}`, { cwd: gitRoot, timeout });

      // Stage and commit
      const commitMsg = [
        `feat: ${input.title}`,
        "",
        `Build: ${input.buildId}`,
        input.productId ? `Product: ${input.productId}` : null,
        input.version ? `Version: ${input.version}` : null,
        "Change-Type: ai-proposed",
      ].filter(Boolean).join("\n");

      await exec("git add -A", { cwd: gitRoot, timeout });
      await exec(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: gitRoot, timeout });

      // Push with token auth
      const remoteUrl = config.gitRemoteUrl.replace(
        /^https:\/\//,
        `https://${token}@`,
      );
      await exec(`git push ${JSON.stringify(remoteUrl)} HEAD:main`, { cwd: gitRoot, timeout });

      // Record the commit hash on the build
      const { stdout } = await exec("git rev-parse HEAD", { cwd: gitRoot, timeout: 5000 });
      const hash = stdout.trim();
      if (hash) {
        const build = await prisma.featureBuild.findUnique({
          where: { buildId: input.buildId },
          select: { id: true, gitCommitHashes: true },
        });
        if (build) {
          await prisma.featureBuild.update({
            where: { id: build.id },
            data: { gitCommitHashes: [...build.gitCommitHashes, hash] },
          });
        }
      }

      return { pushed: true };
    } finally {
      try { await unlink(tmpFile); } catch { /* cleanup best-effort */ }
    }
  } catch (err) {
    return { pushed: false, error: err instanceof Error ? err.message : "Git backup push failed" };
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd h:/opendigitalproductfactory && npx tsc --noEmit --pretty apps/web/lib/git-backup.ts 2>&1 | grep "^apps/"
```

- [ ] **Step 4: Commit**

```
feat(build): add git backup module for fork_only promotion tracking
```

---

### Task 7: Wire Git Backup into Promotion Flow

**Files:**
- Modify: `apps/web/lib/actions/build.ts` (~line 540, after auto-approve in shipBuild)

- [ ] **Step 1: Add backup push call after promotion approval**

In `apps/web/lib/actions/build.ts`, in the `shipBuild()` function, find the block where the promotion is auto-approved (~line 540: `rationale: "Auto-approved via Build Studio ship phase"`). After the closing of that `prisma.changePromotion.update` call, add:

```typescript
    // Git backup for fork_only mode (EP-BUILD-HANDOFF-002 contribution mode)
    if (build.diffPatch) {
      try {
        const { backupPromotionToGit } = await import("@/lib/git-backup");
        const backupResult = await backupPromotionToGit({
          buildId: input.buildId,
          title: input.name,
          diffPatch: build.diffPatch as string,
          productId: result.productId,
          version: result.version,
        });
        if (backupResult.pushed) {
          console.log(`[shipBuild] git backup pushed for ${input.buildId}`);
        } else if (backupResult.error && backupResult.error !== "No git remote URL configured") {
          console.warn(`[shipBuild] git backup failed: ${backupResult.error}`);
        }
      } catch (err) {
        console.warn("[shipBuild] git backup failed:", err);
      }
    }
```

- [ ] **Step 2: Commit**

```
feat(build): wire git backup into shipBuild promotion flow
```

---

### Task 8: Admin UI — Git Repo URL, DCO Status, Untracked Count

**Files:**
- Modify: `apps/web/components/admin/PlatformDevelopmentForm.tsx`
- Modify: `apps/web/app/(shell)/admin/platform-development/page.tsx` (pass new props)

- [ ] **Step 1: Extend the form component**

In `PlatformDevelopmentForm.tsx`, update the component props to accept the new data:

```typescript
interface PlatformDevelopmentFormProps {
  currentMode?: string;
  configuredAt?: string;
  configuredByEmail?: string;
  gitRemoteUrl?: string | null;
  dcoAcceptedAt?: string | null;
  dcoAcceptedByEmail?: string | null;
  untrackedFeatureCount?: number;
}
```

Add state variables for git URL and DCO:

```typescript
const [gitUrl, setGitUrl] = useState(props.gitRemoteUrl ?? "");
const [showDcoDialog, setShowDcoDialog] = useState(false);
```

After the existing radio buttons section and before the Save button, add:

```tsx
{/* Git Repository URL (shown for fork_only) */}
{selectedMode === "fork_only" && (
  <div className="mt-6 space-y-2">
    <label className="block text-sm font-medium text-zinc-700">
      Git Repository URL (optional)
    </label>
    <input
      type="text"
      value={gitUrl}
      onChange={(e) => setGitUrl(e.target.value)}
      placeholder="https://github.com/your-org/your-repo.git"
      className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
    />
    <p className="text-xs text-zinc-500">
      Paste the URL of your git repository to back up customizations.
      See the setup guide for instructions on creating a repository and access token.
    </p>
    {props.untrackedFeatureCount != null && props.untrackedFeatureCount > 0 && !gitUrl && (
      <p className="text-sm text-amber-600">
        {props.untrackedFeatureCount} feature(s) deployed without version control backup.
      </p>
    )}
  </div>
)}

{/* DCO Status (shown for selective/contribute_all) */}
{(selectedMode === "selective" || selectedMode === "contribute_all") && (
  <div className="mt-6 space-y-2">
    <h3 className="text-sm font-medium text-zinc-700">
      Developer Certificate of Origin (DCO)
    </h3>
    {props.dcoAcceptedAt ? (
      <p className="text-sm text-green-600">
        DCO accepted by {props.dcoAcceptedByEmail} on{" "}
        {new Date(props.dcoAcceptedAt).toLocaleDateString()}
      </p>
    ) : (
      <div className="rounded border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm text-amber-800 mb-2">
          Community contributions require DCO acceptance.
        </p>
        <button
          type="button"
          onClick={() => setShowDcoDialog(true)}
          className="rounded bg-amber-600 px-3 py-1 text-sm text-white hover:bg-amber-700"
        >
          Accept DCO
        </button>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Add inline DCO acceptance dialog**

Add a simple modal/dialog within the same component (below the form):

```tsx
{showDcoDialog && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
      <h2 className="text-lg font-semibold mb-4">Developer Certificate of Origin</h2>
      <div className="text-sm text-zinc-600 space-y-2 mb-4">
        <p>By enabling community contributions, you confirm that:</p>
        <ol className="list-decimal ml-4 space-y-1">
          <li>You have the right to submit the code generated on this platform</li>
          <li>You assert that AI-generated code created on your platform instance is your contribution under your direction</li>
          <li>You agree to license contributions under Apache-2.0</li>
          <li>AI-generated code from your Build Studio sessions may be shared publicly</li>
          <li>You can opt out of contributing any individual feature at ship time</li>
        </ol>
        <p className="font-medium">This applies to all future contributions from this platform instance.</p>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setShowDcoDialog(false)}
          className="rounded border border-zinc-300 px-4 py-2 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={async () => {
            const { acceptDco } = await import("@/lib/actions/platform-dev-config");
            const result = await acceptDco();
            if (result.accepted) setShowDcoDialog(false);
          }}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          I Accept
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Update the page.tsx to pass new props**

In the page component that renders `PlatformDevelopmentForm`, add the new data fetching:

```typescript
const { getUntrackedFeatureCount } = await import("@/lib/actions/platform-dev-config");
const untrackedCount = config?.contributionMode === "fork_only" ? await getUntrackedFeatureCount() : 0;
```

Pass to the form:

```tsx
<PlatformDevelopmentForm
  currentMode={config?.contributionMode}
  configuredAt={config?.configuredAt?.toISOString()}
  configuredByEmail={config?.configuredBy?.email}
  gitRemoteUrl={config?.gitRemoteUrl}
  dcoAcceptedAt={config?.dcoAcceptedAt?.toISOString() ?? null}
  dcoAcceptedByEmail={config?.dcoAcceptedBy?.email ?? null}
  untrackedFeatureCount={untrackedCount}
/>
```

- [ ] **Step 4: Commit**

```
feat(admin): add git repo URL, DCO acceptance dialog, and untracked feature count to Platform Development settings
```

---

### Task 9: Git Credential Storage

**Files:**
- Modify: `apps/web/lib/actions/platform-dev-config.ts`

- [ ] **Step 1: Add git credential save/retrieve functions**

Add to `apps/web/lib/actions/platform-dev-config.ts`:

```typescript
export async function saveGitBackupCredential(token: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  // Encrypt using the same mechanism as AI provider credentials
  const { encryptSecret } = await import("@/lib/credential-encryption");
  const encrypted = encryptSecret(token);

  await prisma.credentialEntry.upsert({
    where: { providerId: "git-backup" },
    create: {
      providerId: "git-backup",
      secretRef: encrypted,
      status: "active",
    },
    update: {
      secretRef: encrypted,
      status: "active",
    },
  });

  revalidatePath("/admin/platform-development");
}

export async function hasGitBackupCredential(): Promise<boolean> {
  const cred = await prisma.credentialEntry.findUnique({
    where: { providerId: "git-backup" },
    select: { status: true },
  });
  return cred?.status === "active";
}
```

Note: Check that `encryptSecret` exists in `@/lib/credential-encryption`. If a different encryption function is used for AI provider credentials, use that instead. Search for the existing pattern with:

```bash
grep -r "encryptSecret\|encrypt.*credential\|secretRef" apps/web/lib/ --include="*.ts" -l
```

- [ ] **Step 2: Commit**

```
feat(admin): add git backup credential storage via CredentialEntry
```

---

### Task 10: Final TypeScript Check and Integration Verification

**Files:** All modified files

- [ ] **Step 1: Run full TypeScript check on modified files**

```bash
cd h:/opendigitalproductfactory && npx tsc --noEmit --pretty \
  apps/web/lib/mcp-tools.ts \
  apps/web/lib/actions/agent-coworker.ts \
  apps/web/lib/actions/platform-dev-config.ts \
  apps/web/lib/actions/build.ts \
  apps/web/lib/contribution-pipeline.ts \
  apps/web/lib/git-backup.ts \
  apps/web/lib/git-utils.ts \
  2>&1 | grep "^apps/"
```

Expected: no errors from our files.

- [ ] **Step 2: Verify the complete flow makes sense**

Trace through the three modes mentally:

- **fork_only**: `deploy_feature` extracts diff, runs impact analysis, shows escalating warning if no repo. Ship phase prompt says "do NOT call assess_contribution." If `gitRemoteUrl` configured, `shipBuild` calls `backupPromotionToGit`.

- **selective**: `deploy_feature` extracts diff, runs impact analysis. Ship phase prompt says "call assess_contribution, offer [Keep local] [Contribute]." If user contributes, `contribute_to_hive` creates FeaturePack AND calls `submitBuildAsPR` with DCO signoff.

- **contribute_all**: Same as selective, but prompt defaults to contribute.

- [ ] **Step 3: Commit all remaining changes**

```
feat(build): contribution mode git integration — complete Phase 2e extension
```
