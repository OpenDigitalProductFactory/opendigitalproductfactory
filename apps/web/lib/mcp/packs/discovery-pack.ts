// Discovery & marketplace tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the discovery & marketplace domain out of the mcp-tools.ts executeTool
// switch: searching the portfolio for related work, searching the MCP
// integrations catalog, searching the cross-source tool marketplace readiness
// catalog, and initiating a tool-evaluation pipeline. Each handler lazy-imports
// or directly calls its backing service and reproduces the former switch case
// verbatim, so behaviour is identical when a tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// search_portfolio_context handler resolves the caller's active build the same
// way the mega-module does; the two small resolution helpers are broadly shared
// there, so a local copy is replicated here (the originals stay inline).

import { prisma } from "@dpf/db";
import {
  getIntegrationBenchmarkMetadata,
  matchesIntegrationBenchmarkFilters,
  type IntegrationBenchmarkDomain,
  type IntegrationDeploymentMode,
  type IntegrationProfileTag,
  type IntegrationTreatment,
} from "@/lib/integrate/integration-benchmarking";
import { getToolMarketplaceReadiness } from "@/lib/actions/tool-marketplace-readiness";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { resolveActiveBuildId, extractBuildIdHint } from "@/lib/mcp/build-tool-helpers";

const definitions: ToolDefinition[] = [
  {
    name: "search_portfolio_context",
    description: "Search taxonomy, products, builds, and backlog for items related to a feature description.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Plain-language feature description" } },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
  },
  {
    name: "search_integrations",
    description: "Search the MCP integrations catalog for services relevant to a feature or business need. Use when the user asks what they can connect, or when researching integrations for a new feature.",
    inputSchema: {
      type: "object",
        properties: {
          query: { type: "string", description: "What you are looking for — e.g. 'payments', 'email marketing', 'booking calendar', 'source control'" },
          category: { type: "string", description: "Optional category filter — e.g. 'finance', 'cms', 'cloud', 'crm'" },
          archetypeId: { type: "string", description: "Optional archetype filter — returns integrations tagged as relevant to this archetype" },
          pricingModel: { type: "string", enum: ["free", "paid", "freemium", "open-source"], description: "Optional pricing filter" },
          benchmarkDomain: {
            type: "string",
            enum: [
              "hr_payroll",
              "identity_directory",
              "ticketing_service_desk",
              "rmm_endpoint_device_management",
              "documentation_knowledge_cmdb_assets",
              "crm_sales",
              "accounting_billing_payments",
              "communications_email_chat",
              "project_work_management",
              "cloud_m365_google_security",
            ],
            description: "Optional benchmark domain filter aligned to the integration-harness taxonomy",
          },
          businessProfile: {
            type: "string",
            enum: ["msp"],
            description: "Optional reusable business-profile overlay filter, starting with MSP",
          },
          deploymentMode: {
            type: "string",
            enum: ["cloud", "hybrid", "on_prem"],
            description: "Optional deployment posture filter for private/on-prem aware planning",
          },
          recommendedTreatment: {
            type: "string",
            enum: ["native_first_class", "generic_connector", "bundle_default"],
            description: "Optional DPF product-treatment filter from the benchmark model",
          },
          limit: { type: "number", description: "Max results to return. Default 10." },
        },
        required: ["query"],
    },
    requiredCapability: null,
  },
  {
    name: "search_tool_marketplace",
    description:
      "Search the cross-source tool marketplace readiness catalog. Use when the user asks what integrations, MCP servers, built-in tools, model requirements, or ungranted/unconfigured tools are available for an AI coworker. " +
      "Prefer load_tools with an exact name or intent query once you know the tool — do not re-search the marketplace for the same query every turn.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Need or domain to search for, such as 'payroll', 'ADP', 'Build Studio', 'finance', or 'web search'.",
        },
        agentId: {
          type: "string",
          description: "Optional coworker id or slug to evaluate grants against. Defaults to the current coworker when available.",
        },
        includeKinds: {
          type: "array",
          items: { type: "string", enum: ["mcp", "native", "built_in", "model_requirement"] },
          description: "Optional source types to include.",
        },
        limit: { type: "number", description: "Max readiness entries to return. Default 12." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "evaluate_tool",
    description: "Initiate a tool evaluation pipeline for an external tool, MCP server, or dependency. Creates a ToolEvaluation record for multi-agent security, architecture, compliance, and integration review.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Name of the tool to evaluate" },
        toolType: { type: "string", enum: ["mcp_server", "npm_package", "api_integration", "ai_provider", "docker_image"], description: "Type of tool" },
        version: { type: "string", description: "Version to evaluate (default: latest)" },
        sourceUrl: { type: "string", description: "Registry URL, GitHub repo, or vendor page" },
      },
      required: ["toolName", "toolType"],
    },
    requiredCapability: "manage_tool_evaluations",
    sideEffect: true,
  },
];

async function searchPortfolioContextHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { searchPortfolioContext } = await import("@/lib/portfolio-search");
  const activeBuildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  let portfolioId: string | null = null;
  if (activeBuildId) {
    const build = await prisma.featureBuild.findUnique({
      where: { buildId: activeBuildId },
      select: { portfolioId: true },
    });
    portfolioId = build?.portfolioId ?? null;
  }
  const results = await searchPortfolioContext(String(params["query"] ?? ""), portfolioId);
  const totalMatches = results.taxonomyMatches.length + results.productMatches.length + results.buildMatches.length + results.backlogMatches.length;
  return { success: true, message: `Found ${totalMatches} related item${totalMatches !== 1 ? "s" : ""}.`, data: results as unknown as Record<string, unknown> };
}

async function searchIntegrationsHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const query = String(params["query"] ?? "");
  const rows = await prisma.mcpIntegration.findMany({
    where: {
      status: "active",
      ...(typeof params["category"] === "string" ? { category: params["category"] } : {}),
      ...(typeof params["pricingModel"] === "string" ? { pricingModel: params["pricingModel"] } : {}),
      ...(typeof params["archetypeId"] === "string" ? { archetypeIds: { has: params["archetypeId"] } } : {}),
    ...(query.trim() ? {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { shortDescription: { contains: query, mode: "insensitive" } },
        { tags: { has: query.toLowerCase() } },
      ],
    } : {}),
  },
    select: {
      name: true, vendor: true, shortDescription: true, category: true,
      pricingModel: true, rating: true, ratingCount: true, isVerified: true,
      documentationUrl: true, logoUrl: true, archetypeIds: true,
      slug: true, tags: true, rawMetadata: true,
    },
    orderBy: [{ isVerified: "desc" }, { installCount: "desc" }],
    take: Math.min(
      Math.max(typeof params["limit"] === "number" ? params["limit"] * 5 : 50, 50),
      200
    ),
  });
  const results = rows
    .map((row) => ({
      ...row,
      benchmark: getIntegrationBenchmarkMetadata({
        name: row.name,
        slug: row.slug,
        category: row.category,
        tags: row.tags,
        vendor: row.vendor,
        rawMetadata: row.rawMetadata,
      }),
    }))
    .filter((row) =>
      matchesIntegrationBenchmarkFilters(row.benchmark, {
        benchmarkDomain:
          typeof params["benchmarkDomain"] === "string"
            ? (params["benchmarkDomain"] as IntegrationBenchmarkDomain)
            : undefined,
        deploymentMode:
          typeof params["deploymentMode"] === "string"
            ? (params["deploymentMode"] as IntegrationDeploymentMode)
            : undefined,
        businessProfile:
          typeof params["businessProfile"] === "string"
            ? (params["businessProfile"] as IntegrationProfileTag)
            : undefined,
        recommendedTreatment:
          typeof params["recommendedTreatment"] === "string"
            ? (params["recommendedTreatment"] as IntegrationTreatment)
            : undefined,
      })
    )
    .slice(0, typeof params["limit"] === "number" ? params["limit"] : 10)
    .map(({ tags: _tags, rawMetadata: _rawMetadata, slug: _slug, ...row }) => row);
  return { success: true, message: `Found ${results.length} integration(s).`, data: { results } };
}

async function searchToolMarketplaceHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const includeKinds = Array.isArray(params["includeKinds"])
    ? params["includeKinds"].filter((kind): kind is "mcp" | "native" | "built_in" | "model_requirement" =>
      typeof kind === "string" && ["mcp", "native", "built_in", "model_requirement"].includes(kind),
    )
    : undefined;
  const readiness = await getToolMarketplaceReadiness({
    query: typeof params["query"] === "string" ? params["query"] : "",
    agentId: typeof params["agentId"] === "string" ? params["agentId"] : context?.agentId,
    includeKinds: includeKinds && includeKinds.length > 0 ? includeKinds : undefined,
    limit: typeof params["limit"] === "number" ? params["limit"] : 12,
  });

  return {
    success: true,
    message: `Found ${readiness.entries.length} marketplace readiness entr${readiness.entries.length === 1 ? "y" : "ies"}.`,
    data: {
      summary: readiness.summary,
      entries: readiness.entries,
    },
  };
}

async function evaluateToolHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { createToolEvaluation } = await import("@/lib/tool-evaluation-data");
  const evalId = await createToolEvaluation({
    toolName: String(params["toolName"] ?? ""),
    toolType: String(params["toolType"] ?? "npm_package"),
    version: String(params["version"] ?? "latest"),
    sourceUrl: String(params["sourceUrl"] ?? ""),
    proposedBy: userId,
  });
  return { success: true, entityId: evalId, message: `Tool evaluation created: ${evalId}. The evaluation pipeline will review this tool for security, architecture fit, compliance, and integration.` };
}

const handlers: Record<string, ToolPackHandler> = {
  search_portfolio_context: (params, userId) => searchPortfolioContextHandler(params, userId),
  search_integrations: (params) => searchIntegrationsHandler(params),
  search_tool_marketplace: (params, userId, context) => searchToolMarketplaceHandler(params, userId, context),
  evaluate_tool: (params, userId) => evaluateToolHandler(params, userId),
};

export const discoveryPack: ToolPack = {
  packId: "discovery",
  definitions,
  handlers,
  grants: {
    search_portfolio_context: ["portfolio_read", "registry_read"],
    search_integrations: ["external_registry_search", "registry_read"],
    search_tool_marketplace: ["registry_read"],
    evaluate_tool: ["tool_evaluation_create"],
  },
};
