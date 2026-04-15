// packages/db/src/backfill-capability-ids.ts
// One-time backfill: populate capabilityId and auditClass on existing ToolExecution rows.
//
// Run AFTER Phase 3 migration deploys (20260412220000_tool_execution_audit_class).
// Run AFTER Phase 2 sync-capabilities has populated PlatformCapability rows.
//
// Safe to re-run — all UPDATE statements are guarded with WHERE IS NULL.
// Do NOT add to portal-init or seed.ts. Run manually with operator oversight:
//
//   pnpm --filter @dpf/db exec tsx src/backfill-capability-ids.ts

import { prisma } from "./client.js";

async function main(): Promise<void> {
  console.log("[backfill] Starting ToolExecution capability ID backfill...");

  // Guard: warn if PlatformCapability is empty (Phase 2 not yet run)
  const capCount = await prisma.platformCapability.count();
  if (capCount === 0) {
    console.warn(
      "[backfill] WARNING: PlatformCapability is empty — auditClass backfill will use conservative defaults. " +
      "Run sync-capabilities (Phase 2) first for accurate audit classes.",
    );
  } else {
    console.log(`[backfill] ${capCount} PlatformCapability rows available for auditClass lookup.`);
  }

  // Step 1: Platform tools (name does NOT contain __)
  const platformResult = await prisma.$executeRaw`
    UPDATE "ToolExecution"
    SET "capabilityId" = 'platform:' || "toolName"
    WHERE "capabilityId" IS NULL
      AND "toolName" NOT LIKE '%__%'
  `;
  console.log(`[backfill] Platform tools: ${platformResult} rows updated with capabilityId.`);

  // Step 2: MCP tools (name contains __ — serverSlug__toolName format)
  const mcpResult = await prisma.$executeRaw`
    UPDATE "ToolExecution"
    SET "capabilityId" = 'mcp:' || "toolName"
    WHERE "capabilityId" IS NULL
      AND "toolName" LIKE '%__%'
  `;
  console.log(`[backfill] MCP tools: ${mcpResult} rows updated with capabilityId.`);

  // Step 3: auditClass backfill from PlatformCapability manifest (requires Phase 2)
  if (capCount > 0) {
    const auditResult = await prisma.$executeRaw`
      UPDATE "ToolExecution" te
      SET "auditClass" = COALESCE(
        (
          SELECT (pc.manifest->>'auditClass')
          FROM "PlatformCapability" pc
          WHERE pc."capabilityId" = 'platform:' || te."toolName"
          LIMIT 1
        ),
        'journal'
      )
      WHERE te."auditClass" IS NULL
    `;
    console.log(`[backfill] auditClass: ${auditResult} rows updated.`);
  } else {
    // Fall back to conservative 'journal' for all remaining NULL rows
    const fallbackResult = await prisma.$executeRaw`
      UPDATE "ToolExecution"
      SET "auditClass" = 'journal'
      WHERE "auditClass" IS NULL
    `;
    console.log(`[backfill] auditClass (conservative fallback): ${fallbackResult} rows set to 'journal'.`);
  }

  // Verification
  const nullCapability = await prisma.toolExecution.count({ where: { capabilityId: null } });
  const nullAuditClass = await prisma.toolExecution.count({ where: { auditClass: null } });

  if (nullCapability > 0) {
    console.warn(`[backfill] WARNING: ${nullCapability} rows still have NULL capabilityId.`);
  } else {
    console.log("[backfill] All rows have capabilityId set.");
  }

  if (nullAuditClass > 0) {
    console.warn(`[backfill] WARNING: ${nullAuditClass} rows still have NULL auditClass.`);
  } else {
    console.log("[backfill] All rows have auditClass set.");
  }

  // Summary by audit class
  const classSummary = await prisma.$queryRaw<Array<{ auditClass: string | null; count: bigint }>>`
    SELECT "auditClass", COUNT(*) as count FROM "ToolExecution" GROUP BY "auditClass"
  `;
  console.log("[backfill] Summary by auditClass:");
  for (const row of classSummary) {
    console.log(`  ${row.auditClass ?? "NULL"}: ${row.count}`);
  }

  console.log("[backfill] Done.");
}

main()
  .catch((err) => {
    console.error("[backfill] Error:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
