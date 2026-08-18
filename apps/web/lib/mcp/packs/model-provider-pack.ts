// Model & provider tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the model & provider domain out of the mcp-tools.ts executeTool
// switch: resolving which model/provider/engine will run each Build Studio
// phase, describing a Prisma model's schema shape, and adding or recategorizing
// an AI provider. Each handler lazy-imports its single backing service and
// reproduces the former switch case verbatim, so behaviour is identical when
// the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// describe_model handler resolves the caller's active build the same way the
// mega-module does; the two small resolution helpers are broadly shared there,
// so a local copy is replicated here (the originals stay inline).

import { prisma } from "@dpf/db";
import { lazyFsPromises, lazyPath, getCwd } from "@/lib/shared/lazy-node";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { resolveActiveBuildId, extractBuildIdHint } from "@/lib/mcp/build-tool-helpers";

const definitions: ToolDefinition[] = [
  {
    name: "resolve_model_selection",
    description:
      "Model Selection & Runtime Health — resolve which model/provider/engine WILL run each Build Studio phase (ideate, plan, design-review, plan-review, build) given current config, and flag where live config contradicts platform guidance. Answers 'local or cloud, per phase?' and 'how is the model chosen per phase?' in ONE call, BEFORE a build runs — establish ground truth here rather than discovering after the GPU sat idle. Model selection is split across three sources with no other synthesis: Providers & Routing (routeAndCall/V2 routing; user-configured cloud endpoints outrank the bundled local model), Build Runtime (the dispatch engine), and the local endpoint's served context window (DMR). Returns per-phase { mechanism, engine, providerId, modelId, isLocal, providerTier, contextTokens, rationale, flags } plus an overall verdict (all-local | all-cloud | mixed | unconfigured) and remediation. Read-only; runs a side-effect-free routing dry-run (no dispatch, no model call).",
    inputSchema: {
      type: "object",
      properties: {},
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "describe_model",
    description: "Look up a Prisma model's fields, types, relations, and indexes from the sandbox schema. Use this instead of asking the user about schema structure. Example: describe_model({ model_name: 'User' }) returns all fields with types.",
    inputSchema: {
      type: "object",
      properties: {
        model_name: { type: "string", description: "Exact model name (PascalCase), e.g. 'User', 'Complaint', 'FeatureBuild'" },
      },
      required: ["model_name"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "add_provider",
    description: "Add a new AI provider to the platform. Creates an unconfigured entry that can then be set up.",
    inputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string", description: "Short identifier (e.g. 'mantis', 'ollama')" },
        name: { type: "string", description: "Display name (e.g. 'Mantis (local)')" },
        category: { type: "string", enum: ["direct", "agent", "router", "local"], description: "Provider category" },
        costModel: { type: "string", enum: ["token", "compute"], description: "Pricing model" },
        baseUrl: { type: "string", description: "API base URL (optional)" },
        authMethod: { type: "string", enum: ["none", "api_key", "oauth2_client_credentials"], description: "Auth method (default: api_key)" },
      },
      required: ["providerId", "name", "category"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
  {
    name: "update_provider_category",
    description: "Change the category of an existing AI provider (e.g. from 'direct' to 'local').",
    inputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string", description: "Provider to update" },
        category: { type: "string", enum: ["direct", "agent", "router", "local"], description: "New category" },
      },
      required: ["providerId", "category"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
];

async function resolveModelSelectionHandler(): Promise<ToolResult> {
  const { resolveModelSelectionByPhase } = await import(
    "@/lib/inference/phase-model-resolution"
  );
  const overview = await resolveModelSelectionByPhase();
  return {
    success: true,
    message: `Model selection (${overview.verdict}): ${overview.summary}`,
    data: overview as unknown as Record<string, unknown>,
  };
}

async function describeModelHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  const modelName = String(params.model_name ?? "");
  if (!modelName) return { success: false, error: "model_name is required.", message: "Provide the model name (PascalCase)." };

  // Read the schema. During ideate/plan phases no sandbox exists yet, so try
  // the project filesystem first (same root as read_project_file). Fall back
  // to the sandbox only if the build has one already provisioned.
  const { describeModel, formatModelDescription } = await import("@/lib/integrate/schema-validator");

  const tryDirectRead = async (): Promise<string | null> => {
    try {
      const { resolve } = lazyPath();
      const { readFile, readdir } = lazyFsPromises();
      const root = process.env.PROJECT_ROOT
        ? resolve(process.env.PROJECT_ROOT)
        : resolve(getCwd(), "..", "..");
      const schemaDir = resolve(root, "packages/db/prisma/schema");
      const names = (await readdir(schemaDir)).filter((n) => n.endsWith(".prisma")).sort();
      const parts = await Promise.all(names.map((n) => readFile(resolve(schemaDir, n), "utf-8")));
      return parts.length > 0 ? parts.join("\n") : null;
    } catch {
      return null;
    }
  };

  const directSchema = await tryDirectRead();
  if (directSchema) {
    const desc = describeModel(directSchema, modelName);
    if (!desc) return { success: false, error: `Model "${modelName}" not found.`, message: `No model named "${modelName}" exists. Check spelling (PascalCase).` };
    return { success: true, message: formatModelDescription(desc), data: desc as unknown as Record<string, unknown> };
  }

  // Fallback: use sandbox if one is already provisioned for this build.
  const dmBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
  if (!dmBuild?.sandboxId) {
    return { success: false, error: "Schema not accessible.", message: "Could not read schema — sandbox not provisioned and project root is unavailable. Try read_project_file on packages/db/prisma/schema/<domain>.prisma instead." };
  }

  try {
    const { execInSandbox } = await import("@/lib/sandbox");
    const schemaContent = await execInSandbox(dmBuild.sandboxId, "cat /workspace/packages/db/prisma/schema/*.prisma");
    const desc = describeModel(schemaContent, modelName);
    if (!desc) return { success: false, error: `Model "${modelName}" not found.`, message: `No model named "${modelName}" exists. Check spelling (PascalCase).` };
    return { success: true, message: formatModelDescription(desc), data: desc as unknown as Record<string, unknown> };
  } catch (err) {
    return { success: false, error: "Schema read error", message: err instanceof Error ? err.message : "Failed to read schema" };
  }
}

async function addProviderHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const providerId = String(params["providerId"] ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!providerId) return { success: false, error: "Invalid provider ID", message: "Provider ID is required" };

  const existing = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (existing) return { success: false, error: "Already exists", message: `Provider "${providerId}" already exists` };

  const provider = await prisma.modelProvider.create({
    data: {
      providerId,
      name: String(params["name"] ?? providerId),
      category: String(params["category"] ?? "direct"),
      costModel: String(params["costModel"] ?? "token"),
      families: [],
      enabledFamilies: [],
      status: "unconfigured",
      authMethod: String(params["authMethod"] ?? "api_key"),
      supportedAuthMethods: [String(params["authMethod"] ?? "api_key")],
      ...(typeof params["baseUrl"] === "string" ? { baseUrl: params["baseUrl"] } : {}),
    },
  });
  return {
    success: true,
    entityId: provider.providerId,
    message: `Provider "${provider.name}" added. Visit AI Providers to configure it.`,
  };
}

async function updateProviderCategoryHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const providerId = String(params["providerId"] ?? "");
  const category = String(params["category"] ?? "");
  if (!providerId || !category) return { success: false, error: "Missing fields", message: "Provider ID and category are required" };

  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { success: false, error: "Not found", message: `Provider "${providerId}" not found` };

  await prisma.modelProvider.update({
    where: { providerId },
    data: { category },
  });
  return {
    success: true,
    entityId: providerId,
    message: `Provider "${provider.name}" category updated to "${category}".`,
  };
}

const handlers: Record<string, ToolPackHandler> = {
  resolve_model_selection: () => resolveModelSelectionHandler(),
  describe_model: (params, userId) => describeModelHandler(params, userId),
  add_provider: (params) => addProviderHandler(params),
  update_provider_category: (params) => updateProviderCategoryHandler(params),
};

export const modelProviderPack: ToolPack = {
  packId: "model-provider",
  definitions,
  handlers,
  grants: {
    resolve_model_selection: ["work_capsule_read"],
    describe_model: ["sandbox_execute"],
    add_provider: ["agent_control_read"],
    update_provider_category: ["agent_control_read"],
  },
};
