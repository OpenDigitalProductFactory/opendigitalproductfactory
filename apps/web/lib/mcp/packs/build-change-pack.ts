// Build-change tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the two change-time tools out of the mcp-tools.ts executeTool switch:
// recording the human's keep-private/share disposition on the current change,
// and validating the sandbox Prisma schema before a migration. Each handler
// reproduces the former switch case verbatim — same lazy imports, same
// branches, same return shapes — so behaviour is identical over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// shared Build Studio helpers (resolveActiveBuildId / extractBuildIdHint /
// logBuildActivity) are imported from the shared module rather than replicated.

import { prisma } from "@dpf/db";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  resolveActiveBuildId,
  extractBuildIdHint,
  logBuildActivity,
} from "@/lib/mcp/build-tool-helpers";

const definitions: ToolDefinition[] = [
  {
    name: "validate_schema",
    description: "Validate the Prisma schema in the sandbox for common errors: missing inverse relations, undefined types, unindexed foreign keys. MUST be called before running prisma migrate. Returns specific errors with fix instructions.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build"],
  },
  {
    name: "set_change_disposition",
    description: "Record the human's Keep/Share call on the current change at ship time. A change must be 'shareable' before contribute_to_hive or a public-hive PR will share it; the default 'private' is fail-closed — inaction never shares.",
    inputSchema: {
      type: "object",
      properties: {
        disposition: { type: "string", enum: ["private", "shareable"], description: "'private' keeps the change on the user's system; 'shareable' clears it to be contributed to the community." },
        reason: { type: "string", description: "Optional short note on why this disposition was chosen." },
      },
      required: ["disposition"],
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
];

async function validateSchema(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  // Simple availability check — no slot management
  const { isSandboxAvailable } = await import("@/lib/integrate/sandbox/build-branch");
  const vsAvailable = await isSandboxAvailable();
  if (!vsAvailable) {
    return {
      success: false,
      error: "Sandbox container is not running.",
      message: "The sandbox (dpf-sandbox-1) is not running. Call start_build first.",
    };
  }
  const vsSandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

  try {
    const { execInSandbox } = await import("@/lib/sandbox");
    const schemaContent = await execInSandbox(
      vsSandboxId,
      "cat /workspace/packages/db/prisma/schema.prisma",
    );
    const { validatePrismaSchema, formatSchemaValidation } = await import("@/lib/integrate/schema-validator");
    const result = validatePrismaSchema(schemaContent);

    logBuildActivity(buildId, "validate_schema", result.summary);

    if (!result.valid) {
      return {
        success: false,
        error: "Schema validation failed",
        message: formatSchemaValidation(result),
        data: result as unknown as Record<string, unknown>,
      };
    }

    return {
      success: true,
      message: formatSchemaValidation(result),
      data: result as unknown as Record<string, unknown>,
    };
  } catch (err) {
    return { success: false, error: "Schema validation error", message: err instanceof Error ? err.message : "Failed to validate schema" };
  }
}

async function setChangeDisposition(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
  const disposition = (params.disposition as string) ?? "";
  if (disposition !== "private" && disposition !== "shareable") {
    return { success: false, error: "Invalid disposition.", message: "disposition must be 'private' or 'shareable'." };
  }
  const reason = typeof params.reason === "string" ? params.reason : null;
  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      disposition,
      dispositionReason: reason,
      dispositionSource: "operator",
      dispositionDecidedAt: new Date(),
      dispositionDecidedById: userId,
    },
  });
  logBuildActivity(buildId, "set_change_disposition", `disposition=${disposition}${reason ? ` (${reason})` : ""}`);
  return {
    success: true,
    message: disposition === "shareable"
      ? "This change is marked to share with the community. Run contribute_to_hive (or create the portal PR) to share it."
      : "This change is kept on your system and will not be shared.",
  };
}

const handlers: Record<string, ToolPackHandler> = {
  validate_schema: (params, userId) => validateSchema(params, userId),
  set_change_disposition: (params, userId) => setChangeDisposition(params, userId),
};

export const buildChangePack: ToolPack = {
  packId: "build-change",
  definitions,
  handlers,
  grants: {
    validate_schema: ["sandbox_execute"],
    set_change_disposition: ["backlog_write"],
  },
};
