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
