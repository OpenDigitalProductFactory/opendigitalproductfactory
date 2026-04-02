// apps/web/lib/sandbox-promotion.ts
// Sandbox → production promotion: backup production DB, scan for destructive ops,
// extract and categorize diffs, apply promotion patches.

import { exec as execCb } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { prisma } from "@dpf/db";
import { extractDiff } from "@/lib/sandbox";

const exec = promisify(execCb);

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PRODUCTION_DB_CONTAINER =
  process.env.DPF_PRODUCTION_DB_CONTAINER ?? "opendigitalproductfactory-postgres-1";

// ─── Destructive Operation Scanning (pure) ────────────────────────────────────

export const DESTRUCTIVE_PATTERNS = [
  /DROP\s+TABLE/i,
  /DROP\s+COLUMN/i,
  /ALTER\s+COLUMN\s+.*\s+TYPE/i,
  /RENAME\s+(TABLE|COLUMN)/i,
  /DELETE\s+FROM/i,
  /TRUNCATE/i,
];

export function scanForDestructiveOps(migrationSql: string): string[] {
  const warnings: string[] = [];
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, "gi");
    let match;
    while ((match = globalPattern.exec(migrationSql)) !== null) {
      warnings.push(`Destructive operation detected: ${match[0]}`);
    }
  }
  return warnings;
}

// ─── Diff File Categorization (pure) ─────────────────────────────────────────

export function categorizeDiffFiles(filePaths: string[]): {
  migrationFiles: string[];
  codeFiles: string[];
} {
  const migrationFiles: string[] = [];
  const codeFiles: string[] = [];
  for (const fp of filePaths) {
    if (fp.startsWith("prisma/migrations/")) {
      migrationFiles.push(fp);
    } else {
      codeFiles.push(fp);
    }
  }
  return { migrationFiles, codeFiles };
}

// ─── Restore Instructions (pure) ──────────────────────────────────────────────

export function getRestoreInstructions(backupFilePath: string): string {
  return [
    "# Restore database from pre-promotion backup",
    `psql -U dpf -d dpf < "${backupFilePath}"`,
    "",
    "# Revert code changes (apply reverse patch)",
    "git diff HEAD~1 | git apply -R",
    "# Or if committed: git revert <promotion-commit-hash>",
    "",
    "# Verify",
    "pnpm prisma migrate status",
    "pnpm test",
  ].join("\n");
}

// ─── Deployment Window Check (pure) ─────────────────────────────────────────

/**
 * Returns true if the current time falls within any of the given deployment windows.
 * Checks day-of-week and time range (HH:mm format, evaluated in server timezone).
 */
export function isNowInWindow(
  windows: Array<{ dayOfWeek: number[]; startTime: string; endTime: string }>,
  now?: Date,
): boolean {
  const d = now ?? new Date();
  const currentDay = d.getDay(); // 0=Sun
  const currentTime = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return windows.some((w) => {
    if (!w.dayOfWeek.includes(currentDay)) return false;
    // Handle overnight windows (e.g., 22:00-06:00)
    if (w.startTime <= w.endTime) {
      return currentTime >= w.startTime && currentTime < w.endTime;
    }
    // Overnight: 22:00-06:00 means >= 22:00 OR < 06:00
    return currentTime >= w.startTime || currentTime < w.endTime;
  });
}

// ─── Post-Deployment Health Check ───────────────────────────────────────────

/**
 * Verifies the production application is healthy after a promotion.
 * Hits /api/health up to maxRetries times with 10s intervals.
 */
export async function verifyProductionHealth(
  maxRetries = 3,
): Promise<{ healthy: boolean; error?: string }> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch("http://localhost:3000/api/health", {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { healthy: true };
    } catch {
      // Retry
    }
    if (i < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  return { healthy: false, error: "Production health check failed after 3 retries" };
}

// ─── Unified Promotion Pipeline ─────────────────────────────────────────────

export type PromotionResult = {
  success: boolean;
  step: string;
  message: string;
  deploymentLog?: string;
  backupId?: string;
  error?: string;
  restoreInstructions?: string;
};

/**
 * End-to-end promotion pipeline. Called when an approved promotion is ready to deploy.
 *
 * Pipeline: validate → check window → backup → extract diff → scan destructive
 * → apply patch → health check → mark deployed (or rollback on failure)
 */
export async function executePromotion(
  promotionId: string,
  overrideReason?: string,
): Promise<PromotionResult> {
  // ─── Step 1: Validate promotion status ────────────────────────────────────
  const promotion = await prisma.changePromotion.findUnique({
    where: { promotionId },
    include: {
      productVersion: {
        include: { featureBuild: { select: { buildId: true, sandboxId: true, diffPatch: true } } },
      },
      changeItem: {
        include: { changeRequest: { select: { rfcId: true, type: true, riskLevel: true } } },
      },
    },
  });

  if (!promotion) return { success: false, step: "validate", message: `Promotion ${promotionId} not found.` };
  if (promotion.status !== "approved") {
    return { success: false, step: "validate", message: `Promotion must be approved first. Current status: ${promotion.status}` };
  }

  const build = promotion.productVersion.featureBuild;
  const rfc = promotion.changeItem?.changeRequest;
  const rfcType = rfc?.type ?? "normal";
  const riskLevel = rfc?.riskLevel ?? "low";
  const isEmergency = rfcType === "emergency";

  // ─── Step 2: Check deployment window ──────────────────────────────────────
  if (!isEmergency && !overrideReason && !promotion.windowOverrideReason) {
    const profile = await prisma.businessProfile.findFirst({
      where: { isActive: true },
      include: { deploymentWindows: true, blackoutPeriods: true },
    });

    if (profile) {
      // Check blackout periods
      const now = new Date();
      const activeBlackout = profile.blackoutPeriods.find(
        (bp) => bp.startAt <= now && bp.endAt >= now && !bp.exceptions.includes(rfcType),
      );
      if (activeBlackout) {
        return {
          success: false,
          step: "window_check",
          message: `Blackout period active until ${activeBlackout.endAt.toISOString()}. Reason: ${activeBlackout.reason ?? "Scheduled blackout"}. Use emergency override if critical.`,
        };
      }

      // Check deployment windows
      const matchingWindows = profile.deploymentWindows.filter(
        (w) => w.allowedChangeTypes.includes(rfcType) && w.allowedRiskLevels.includes(riskLevel),
      );
      if (matchingWindows.length > 0 && !isNowInWindow(matchingWindows)) {
        const windowSummary = matchingWindows
          .map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`)
          .join("; ");
        return {
          success: false,
          step: "window_check",
          message: `Not within a deployment window. Available windows: ${windowSummary}. Schedule for a valid window or provide an override reason.`,
        };
      }
    }
  }

  // If override reason provided, persist it
  if (overrideReason && !promotion.windowOverrideReason) {
    await prisma.changePromotion.update({
      where: { promotionId },
      data: { windowOverrideReason: overrideReason },
    });
  }

  // ─── Step 3: Get the diff ─────────────────────────────────────────────────
  let diffPatch = build?.diffPatch as string | null;
  if (!diffPatch && build?.sandboxId) {
    try {
      const extracted = await extractAndCategorizeDiff(build.sandboxId);
      diffPatch = extracted.fullDiff;

      // Persist for future reference
      await prisma.featureBuild.update({
        where: { buildId: build.buildId },
        data: { diffPatch, diffSummary: diffPatch.slice(0, 500) },
      });
    } catch (err) {
      return { success: false, step: "extract_diff", message: `Failed to extract diff from sandbox: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (!diffPatch || diffPatch.trim().length === 0) {
    return { success: false, step: "extract_diff", message: "No diff patch available. Run deploy_feature in Build Studio first." };
  }

  // ─── Step 4: Scan for destructive operations ──────────────────────────────
  const { migrationFiles } = categorizeDiffFiles(
    [...diffPatch.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]),
  );

  if (migrationFiles.length > 0 && !promotion.destructiveAcknowledged) {
    // Extract migration SQL content from the diff for scanning
    const migrationSqlBlocks: string[] = [];
    for (const mf of migrationFiles) {
      const fileRegex = new RegExp(`diff --git a/${mf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} b/.+\\n[\\s\\S]*?(?=diff --git|$)`, "g");
      const fileMatch = fileRegex.exec(diffPatch);
      if (fileMatch) migrationSqlBlocks.push(fileMatch[0]);
    }

    const allMigrationSql = migrationSqlBlocks.join("\n");
    const warnings = scanForDestructiveOps(allMigrationSql);
    if (warnings.length > 0) {
      return {
        success: false,
        step: "destructive_scan",
        message: `Destructive operations detected in migrations. Acknowledge in the promotions UI before deploying.\n\nWarnings:\n${warnings.join("\n")}`,
      };
    }
  }

  // ─── Step 5: Backup production database ───────────────────────────────────
  let backupId: string | undefined;
  let backupFilePath: string | undefined;
  try {
    const backup = await backupProductionDb(build?.buildId ?? promotionId);
    backupId = backup.id;
    backupFilePath = backup.filePath;

    // Link backup to promotion
    await prisma.changePromotion.update({
      where: { promotionId },
      data: { backupId: backup.id },
    });
  } catch (err) {
    return { success: false, step: "backup", message: `Database backup failed: ${err instanceof Error ? err.message : String(err)}. Cannot proceed without backup.` };
  }

  // ─── Step 6: Update RFC to in-progress ────────────────────────────────────
  if (rfc?.rfcId) {
    try {
      await prisma.changeRequest.update({
        where: { rfcId: rfc.rfcId },
        data: { status: "in-progress", startedAt: new Date() },
      });
    } catch {
      // Non-fatal — RFC status tracking is best-effort
    }
  }

  // ─── Step 7: Apply promotion patch ────────────────────────────────────────
  const patchResult = await applyPromotionPatch(diffPatch);
  const deploymentLog = patchResult.success
    ? `Patch applied successfully. ${migrationFiles.length} migration(s) deployed.`
    : `Patch failed: ${patchResult.error}`;

  if (!patchResult.success) {
    // Rollback: restore database from backup
    if (backupFilePath) {
      try {
        await exec(`docker exec -i ${DEFAULT_PRODUCTION_DB_CONTAINER} psql -U dpf -d dpf < "${backupFilePath}"`);
      } catch {
        // Log but don't mask the original error
      }
    }
    // Revert code patch
    try {
      await exec("git checkout -- .");
    } catch {
      // Best-effort code revert
    }

    await prisma.changePromotion.update({
      where: { promotionId },
      data: {
        status: "rolled_back",
        rolledBackAt: new Date(),
        rollbackReason: `Patch application failed: ${patchResult.error}`,
        deploymentLog,
      },
    });

    return {
      success: false,
      step: "apply_patch",
      message: `Patch application failed. Database restored from backup. ${patchResult.error}`,
      deploymentLog,
      backupId,
      restoreInstructions: backupFilePath ? getRestoreInstructions(backupFilePath) : undefined,
    };
  }

  // ─── Step 8: Post-deployment health check ─────────────────────────────────
  const healthResult = await verifyProductionHealth();

  if (!healthResult.healthy) {
    // Rollback: restore database + revert code
    if (backupFilePath) {
      try {
        await exec(`docker exec -i ${DEFAULT_PRODUCTION_DB_CONTAINER} psql -U dpf -d dpf < "${backupFilePath}"`);
      } catch { /* best-effort */ }
    }
    try {
      await exec("git checkout -- .");
    } catch { /* best-effort */ }

    await prisma.changePromotion.update({
      where: { promotionId },
      data: {
        status: "rolled_back",
        rolledBackAt: new Date(),
        rollbackReason: `Post-deployment health check failed: ${healthResult.error}`,
        deploymentLog: deploymentLog + "\n" + healthResult.error,
      },
    });

    return {
      success: false,
      step: "health_check",
      message: `Deployment applied but health check failed. Automatic rollback completed. ${healthResult.error}`,
      deploymentLog,
      backupId,
      restoreInstructions: backupFilePath ? getRestoreInstructions(backupFilePath) : undefined,
    };
  }

  // ─── Step 9: Mark as deployed ─────────────────────────────────────────────
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "deployed",
      deployedAt: new Date(),
      deploymentLog,
    },
  });

  if (rfc?.rfcId) {
    try {
      await prisma.changeRequest.update({
        where: { rfcId: rfc.rfcId },
        data: { status: "completed", completedAt: new Date(), outcome: "success" },
      });
    } catch { /* best-effort */ }
  }

  return {
    success: true,
    step: "complete",
    message: `Promotion ${promotionId} deployed successfully. Health check passed.`,
    deploymentLog,
    backupId,
  };
}

// ─── Docker/DB Functions (integration — not unit-tested) ──────────────────────

export async function backupProductionDb(
  buildId: string,
  productionDbContainerName: string = DEFAULT_PRODUCTION_DB_CONTAINER,
): Promise<{ id: string; filePath: string; sizeBytes: number }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupsDir = path.join(process.cwd(), "backups");
  const fileName = `backup-${buildId}-${timestamp}.sql`;
  const filePath = path.join(backupsDir, fileName);

  // Ensure backups directory exists
  await fs.promises.mkdir(backupsDir, { recursive: true });

  // Run pg_dump inside the production DB container, write to host via redirect
  await exec(
    `docker exec ${productionDbContainerName} pg_dump -U dpf dpf > "${filePath}"`,
  );

  // Get file size
  const stat = await fs.promises.stat(filePath);
  const sizeBytes = stat.size;

  // Create Prisma record
  const record = await prisma.promotionBackup.create({
    data: {
      buildId,
      filePath,
      sizeBytes,
      status: "complete",
    },
  });

  return { id: record.id, filePath, sizeBytes };
}

export async function extractAndCategorizeDiff(containerId: string): Promise<{
  fullDiff: string;
  migrationFiles: string[];
  codeFiles: string[];
  hasMigrations: boolean;
}> {
  const fullDiff = await extractDiff(containerId);

  // Parse file paths from diff headers: lines like "diff --git a/path/to/file b/path/to/file"
  const filePaths: string[] = [];
  const diffHeaderRegex = /^diff --git a\/(.+) b\/.+$/gm;
  let match;
  while ((match = diffHeaderRegex.exec(fullDiff)) !== null) {
    filePaths.push(match[1]);
  }

  const { migrationFiles, codeFiles } = categorizeDiffFiles(filePaths);

  return {
    fullDiff,
    migrationFiles,
    codeFiles,
    hasMigrations: migrationFiles.length > 0,
  };
}

export async function applyPromotionPatch(
  diffPatch: string,
  productionDbContainerName: string = DEFAULT_PRODUCTION_DB_CONTAINER,
): Promise<{ success: boolean; error?: string }> {
  const tmpFile = path.join(os.tmpdir(), `dpf-promotion-${Date.now()}.patch`);

  try {
    // Write patch to temp file
    await fs.promises.writeFile(tmpFile, diffPatch, "utf8");

    // Apply the patch with git apply
    await exec(`git apply "${tmpFile}"`);

    // Run prisma migrate deploy to apply any new migration files
    await exec(
      `docker exec ${productionDbContainerName} sh -c "cd /app && pnpm prisma migrate deploy"`,
    ).catch(async () => {
      // Fallback: run locally if container doesn't have the app
      await exec("pnpm prisma migrate deploy");
    });

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  } finally {
    // Clean up temp file
    await fs.promises.unlink(tmpFile).catch(() => {});
  }
}
