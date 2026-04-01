/**
 * Change Impact Analysis — EP-BUILD-HANDOFF-002 Phase 2b
 *
 * Parses a git diff to identify blast radius: new/modified/deleted routes,
 * schema changes, and impacted users. Output stored on the RFC as impactReport.
 */

import { prisma } from "@dpf/db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RouteChange {
  path: string;          // e.g., "/complaints"
  file: string;          // e.g., "app/(shell)/complaints/page.tsx"
  changeType: "new" | "modified" | "deleted";
}

export interface SchemaChange {
  model: string;         // e.g., "Complaint"
  changeType: "new" | "modified" | "deleted";
  hasDestructiveOps: boolean;
  details: string;
}

export interface ImpactedRole {
  role: string;
  reason: string;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RollbackComplexity = "simple" | "complex";

export interface ChangeImpactReport {
  routes: {
    new: RouteChange[];
    modified: RouteChange[];
    deleted: RouteChange[];
  };
  schemaChanges: SchemaChange[];
  impactedRoles: ImpactedRole[];
  blastRadius: {
    newRoutes: number;
    modifiedRoutes: number;
    deletedRoutes: number;
    schemaChanges: number;
    totalFilesChanged: number;
  };
  riskLevel: RiskLevel;
  rollbackComplexity: RollbackComplexity;
  summary: string;
}

// ─── Diff Parsing ───────────────────────────────────────────────────────────

const ROUTE_FILE_PATTERN = /^app\/(?:\([^)]+\)\/)*([^/]+(?:\/[^/]+)*)\/page\.tsx?$/;
const MIGRATION_FILE_PATTERN = /^(?:packages\/db\/)?prisma\/migrations\//;
const SCHEMA_FILE_PATTERN = /^(?:packages\/db\/)?prisma\/schema\.prisma$/;

/**
 * Extract file paths and their change type from a unified diff.
 */
function parseDiffFiles(diff: string): Array<{ file: string; status: "added" | "modified" | "deleted" }> {
  const files: Array<{ file: string; status: "added" | "modified" | "deleted" }> = [];
  const lines = diff.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Git diff header: diff --git a/path b/path
    if (line.startsWith("diff --git ")) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      if (!match) continue;

      const filePath = match[2];

      // Look ahead for status indicators
      let status: "added" | "modified" | "deleted" = "modified";
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].startsWith("new file mode")) {
          status = "added";
          break;
        }
        if (lines[j].startsWith("deleted file mode")) {
          status = "deleted";
          break;
        }
        if (lines[j].startsWith("diff --git ")) break;
      }

      files.push({ file: filePath, status });
    }
  }

  return files;
}

/**
 * Extract route path from a Next.js app router file path.
 * e.g., "app/(shell)/complaints/page.tsx" -> "/complaints"
 */
function fileToRoute(filePath: string): string | null {
  // Strip leading paths like "apps/web/"
  const normalized = filePath.replace(/^apps\/web\//, "");
  const match = normalized.match(ROUTE_FILE_PATTERN);
  if (!match) return null;

  // Remove route groups like (shell) from the path
  const segments = match[1].split("/").filter((s) => !s.startsWith("("));
  return "/" + segments.join("/");
}

/**
 * Detect schema/model changes from diff content touching schema.prisma.
 */
function parseSchemaChanges(diff: string): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const lines = diff.split("\n");

  let inSchemaFile = false;
  const addedModels = new Set<string>();
  const removedModels = new Set<string>();
  const modifiedModels = new Set<string>();

  for (const line of lines) {
    if (line.startsWith("diff --git ") && line.includes("schema.prisma")) {
      inSchemaFile = true;
      continue;
    }
    if (line.startsWith("diff --git ") && !line.includes("schema.prisma")) {
      inSchemaFile = false;
      continue;
    }

    if (!inSchemaFile) continue;

    const modelMatch = line.match(/^[+-]\s*model\s+(\w+)\s*\{/);
    if (modelMatch) {
      const modelName = modelMatch[1];
      if (line.startsWith("+")) addedModels.add(modelName);
      if (line.startsWith("-")) removedModels.add(modelName);
      continue;
    }

    // Field changes within a model context
    const fieldMatch = line.match(/^[+-]\s+(\w+)\s+\w+/);
    if (fieldMatch && (line.startsWith("+") || line.startsWith("-"))) {
      // We can't always know which model a field belongs to from diff alone,
      // but we track that schema was modified
    }
  }

  // Models that appear in both added and removed = modified
  Array.from(addedModels).forEach((model) => {
    if (removedModels.has(model)) {
      modifiedModels.add(model);
      addedModels.delete(model);
      removedModels.delete(model);
    }
  });

  const destructivePattern = /DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE.*DROP/i;
  const hasDestructive = destructivePattern.test(diff);

  Array.from(addedModels).forEach((model) => {
    changes.push({ model, changeType: "new", hasDestructiveOps: false, details: "New model added" });
  });
  Array.from(removedModels).forEach((model) => {
    changes.push({ model, changeType: "deleted", hasDestructiveOps: true, details: "Model removed" });
  });
  Array.from(modifiedModels).forEach((model) => {
    changes.push({ model, changeType: "modified", hasDestructiveOps: hasDestructive, details: "Model modified" });
  });

  // If we detect migration files with destructive ops but no schema model changes,
  // still report it
  if (changes.length === 0 && hasDestructive) {
    changes.push({
      model: "(migration)",
      changeType: "modified",
      hasDestructiveOps: true,
      details: "Migration contains destructive operations",
    });
  }

  return changes;
}

/**
 * Determine which platform roles might be impacted by route changes.
 */
async function resolveImpactedRoles(routes: {
  modified: RouteChange[];
  deleted: RouteChange[];
}): Promise<ImpactedRole[]> {
  const roles: ImpactedRole[] = [];

  // All platform roles are potentially impacted by deleted routes
  if (routes.deleted.length > 0) {
    const allRoles = await prisma.platformRole.findMany({
      select: { roleId: true, name: true },
    });
    for (const role of allRoles) {
      roles.push({
        role: `${role.name} (${role.roleId})`,
        reason: `Deleted route(s): ${routes.deleted.map((r) => r.path).join(", ")}`,
      });
    }
  }

  // Modified routes impact users who access them — since we don't have
  // per-route ACL yet, flag all roles for modified routes
  if (routes.modified.length > 0) {
    const allRoles = await prisma.platformRole.findMany({
      select: { roleId: true, name: true },
    });
    for (const role of allRoles) {
      const exists = roles.find((r) => r.role.includes(role.roleId));
      if (!exists) {
        roles.push({
          role: `${role.name} (${role.roleId})`,
          reason: `Modified route(s): ${routes.modified.map((r) => r.path).join(", ")}`,
        });
      }
    }
  }

  return roles;
}

// ─── Risk Assessment ────────────────────────────────────────────────────────

function assessRisk(report: {
  routes: { new: RouteChange[]; modified: RouteChange[]; deleted: RouteChange[] };
  schemaChanges: SchemaChange[];
}): RiskLevel {
  const hasDestructiveSchema = report.schemaChanges.some((s) => s.hasDestructiveOps);
  const hasDeletedRoutes = report.routes.deleted.length > 0;
  const hasDeletedModels = report.schemaChanges.some((s) => s.changeType === "deleted");

  if (hasDestructiveSchema || hasDeletedModels) return "critical";
  if (hasDeletedRoutes || report.schemaChanges.length > 0) return "high";
  if (report.routes.modified.length > 0) return "medium";
  return "low"; // New routes only
}

function assessRollbackComplexity(schemaChanges: SchemaChange[]): RollbackComplexity {
  if (schemaChanges.length > 0) return "complex";
  return "simple";
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Analyze a git diff for change impact. Returns a structured report suitable
 * for storage on ChangeRequest.impactReport and presentation to the approver.
 */
export async function analyzeChangeImpact(diff: string): Promise<ChangeImpactReport> {
  const files = parseDiffFiles(diff);

  // Categorize route changes
  const routeChanges: { new: RouteChange[]; modified: RouteChange[]; deleted: RouteChange[] } = {
    new: [],
    modified: [],
    deleted: [],
  };

  for (const file of files) {
    const routePath = fileToRoute(file.file);
    if (!routePath) continue;

    const rc: RouteChange = { path: routePath, file: file.file, changeType: file.status === "added" ? "new" : file.status === "deleted" ? "deleted" : "modified" };

    if (rc.changeType === "new") routeChanges.new.push(rc);
    else if (rc.changeType === "deleted") routeChanges.deleted.push(rc);
    else routeChanges.modified.push(rc);
  }

  // Detect schema changes
  const hasSchemaFile = files.some((f) => SCHEMA_FILE_PATTERN.test(f.file));
  const hasMigrations = files.some((f) => MIGRATION_FILE_PATTERN.test(f.file));
  const schemaChanges = (hasSchemaFile || hasMigrations) ? parseSchemaChanges(diff) : [];

  // Resolve impacted roles
  const impactedRoles = await resolveImpactedRoles({
    modified: routeChanges.modified,
    deleted: routeChanges.deleted,
  });

  const riskLevel = assessRisk({ routes: routeChanges, schemaChanges });
  const rollbackComplexity = assessRollbackComplexity(schemaChanges);

  // Build human-readable summary
  const summaryParts: string[] = [];

  if (routeChanges.new.length > 0) {
    summaryParts.push(`${routeChanges.new.length} new page(s): ${routeChanges.new.map((r) => r.path).join(", ")}`);
  }
  if (routeChanges.modified.length > 0) {
    summaryParts.push(`${routeChanges.modified.length} modified page(s): ${routeChanges.modified.map((r) => r.path).join(", ")}`);
  }
  if (routeChanges.deleted.length > 0) {
    summaryParts.push(`${routeChanges.deleted.length} deleted page(s): ${routeChanges.deleted.map((r) => r.path).join(", ")}`);
  }
  if (schemaChanges.length > 0) {
    summaryParts.push(`${schemaChanges.length} schema change(s)`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push("Code-only changes (no route or schema modifications)");
  }
  summaryParts.push(`Risk: ${riskLevel}. Rollback: ${rollbackComplexity}.`);

  if (impactedRoles.length > 0) {
    summaryParts.push(`Impacted roles: ${impactedRoles.map((r) => r.role).join(", ")}`);
  } else {
    summaryParts.push("No existing users impacted (new functionality only).");
  }

  return {
    routes: routeChanges,
    schemaChanges,
    impactedRoles,
    blastRadius: {
      newRoutes: routeChanges.new.length,
      modifiedRoutes: routeChanges.modified.length,
      deletedRoutes: routeChanges.deleted.length,
      schemaChanges: schemaChanges.length,
      totalFilesChanged: files.length,
    },
    riskLevel,
    rollbackComplexity,
    summary: summaryParts.join("\n"),
  };
}

/**
 * Format an impact report as a concise string for AI Coworker chat display.
 */
export function formatImpactForChat(report: ChangeImpactReport): string {
  const lines: string[] = ["**Impact Analysis:**"];

  if (report.blastRadius.newRoutes > 0) {
    lines.push(`- ${report.blastRadius.newRoutes} new page(s): ${report.routes.new.map((r) => r.path).join(", ")}`);
  }
  if (report.blastRadius.modifiedRoutes > 0) {
    lines.push(`- ${report.blastRadius.modifiedRoutes} modified page(s): ${report.routes.modified.map((r) => r.path).join(", ")}`);
  }
  if (report.blastRadius.deletedRoutes > 0) {
    lines.push(`- ${report.blastRadius.deletedRoutes} deleted page(s): ${report.routes.deleted.map((r) => r.path).join(", ")}`);
  }
  if (report.blastRadius.schemaChanges > 0) {
    lines.push(`- ${report.blastRadius.schemaChanges} schema change(s)`);
  }
  if (report.blastRadius.newRoutes === 0 && report.blastRadius.modifiedRoutes === 0 &&
      report.blastRadius.deletedRoutes === 0 && report.blastRadius.schemaChanges === 0) {
    lines.push("- Code-only changes, no route or schema modifications");
  }

  lines.push(`- Risk: **${report.riskLevel}** | Rollback: **${report.rollbackComplexity}**`);
  lines.push(`- Total files changed: ${report.blastRadius.totalFilesChanged}`);

  if (report.impactedRoles.length > 0) {
    lines.push(`- Impacted roles: ${report.impactedRoles.map((r) => r.role).join(", ")}`);
  } else {
    lines.push("- No existing users impacted (new functionality only)");
  }

  return lines.join("\n");
}
