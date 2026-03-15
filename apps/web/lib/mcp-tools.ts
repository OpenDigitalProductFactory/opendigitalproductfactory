import type { CapabilityKey } from "@/lib/permissions";
import { can, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import {
  analyzePublicWebsiteBranding,
  fetchPublicWebsiteEvidence,
  searchPublicWeb,
} from "@/lib/public-web-tools";
import { recordExternalEvidence } from "@/lib/actions/external-evidence";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredCapability: CapabilityKey | null;
  requiresExternalAccess?: boolean;
  executionMode?: "proposal" | "immediate";
};

export type ToolResult = {
  success: boolean;
  entityId?: string;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
};

// ─── Tool Registry ───────────────────────────────────────────────────────────

export const PLATFORM_TOOLS: ToolDefinition[] = [
  {
    name: "create_backlog_item",
    description: "Create a new backlog item in the ops backlog",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Item title" },
        type: { type: "string", enum: ["portfolio", "product"], description: "Item type" },
        status: { type: "string", enum: ["open", "in-progress"], description: "Initial status" },
        body: { type: "string", description: "Detailed description" },
        epicId: { type: "string", description: "Epic ID to link to (optional)" },
      },
      required: ["title", "type"],
    },
    requiredCapability: "manage_backlog",
  },
  {
    name: "update_backlog_item",
    description: "Update an existing backlog item",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID (e.g., BI-PORT-001)" },
        title: { type: "string", description: "New title" },
        status: { type: "string", enum: ["open", "in-progress", "done", "deferred"] },
        priority: { type: "number", description: "Priority number" },
        body: { type: "string", description: "Updated description" },
      },
      required: ["itemId"],
    },
    requiredCapability: "manage_backlog",
  },
  {
    name: "create_digital_product",
    description: "Register a new digital product in the inventory",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name" },
        productId: { type: "string", description: "Unique product identifier" },
        lifecycleStage: { type: "string", enum: ["plan", "design", "build", "production", "retirement"] },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
      },
      required: ["name", "productId"],
    },
    requiredCapability: "manage_backlog",
  },
  {
    name: "update_lifecycle",
    description: "Update a digital product's lifecycle stage and status",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product identifier" },
        lifecycleStage: { type: "string", enum: ["plan", "design", "build", "production", "retirement"] },
        lifecycleStatus: { type: "string", enum: ["draft", "active", "inactive"] },
      },
      required: ["productId"],
    },
    requiredCapability: "manage_backlog",
  },
  {
    name: "report_quality_issue",
    description: "Report a bug, suggestion, or question about the platform",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["runtime_error", "user_report", "feedback"], description: "Issue type" },
        title: { type: "string", description: "Short summary" },
        description: { type: "string", description: "Detailed description" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      },
      required: ["type", "title"],
    },
    requiredCapability: null,
  },
  {
    name: "search_public_web",
    description: "Search the public web for relevant pages or facts",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    requiredCapability: null,
    requiresExternalAccess: true,
    executionMode: "immediate",
  },
  {
    name: "fetch_public_website",
    description: "Fetch a public website and summarize visible branding and metadata",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public http or https URL" },
      },
      required: ["url"],
    },
    requiredCapability: null,
    requiresExternalAccess: true,
    executionMode: "immediate",
  },
  {
    name: "analyze_public_website_branding",
    description: "Analyze a public website and propose branding values such as company name, logo, and accent color",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public http or https URL" },
      },
      required: ["url"],
    },
    requiredCapability: "manage_branding",
    requiresExternalAccess: true,
    executionMode: "immediate",
  },
  // ─── Build Studio Tools ───────────────────────────────────────────────────
  {
    name: "update_feature_brief",
    description: "Update the Feature Brief for an active build with structured fields",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The build ID (e.g., FB-XXXXX)" },
        title: { type: "string", description: "Feature title" },
        description: { type: "string", description: "Plain-language feature description" },
        portfolioContext: { type: "string", description: "Portfolio slug that owns this feature" },
        targetRoles: { type: "array", items: { type: "string" }, description: "Role IDs that will use this feature" },
        inputs: { type: "array", items: { type: "string" }, description: "User inputs the feature accepts" },
        dataNeeds: { type: "string", description: "What data the feature stores" },
        acceptanceCriteria: { type: "array", items: { type: "string" }, description: "What done looks like" },
      },
      required: ["buildId", "title", "description", "portfolioContext", "targetRoles", "dataNeeds", "acceptanceCriteria"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "register_digital_product_from_build",
    description: "Register or update a DigitalProduct from a shipped feature build",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The build ID being shipped" },
        name: { type: "string", description: "Product name" },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
        versionBump: { type: "string", enum: ["major", "minor", "patch"], description: "How to bump the version" },
      },
      required: ["buildId", "name", "portfolioSlug"],
    },
    requiredCapability: "manage_capabilities",
  },
  {
    name: "create_build_epic",
    description: "Create an Epic and initial backlog items for a shipped feature build",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The build ID" },
        title: { type: "string", description: "Epic title (e.g., Feature Name v1.0.0)" },
        portfolioSlug: { type: "string", description: "Portfolio slug to link the epic to" },
        digitalProductId: { type: "string", description: "Product internal ID for backlog items" },
      },
      required: ["buildId", "title"],
    },
    requiredCapability: "manage_capabilities",
  },
];

// ─── Capability Filtering ────────────────────────────────────────────────────

export function getAvailableTools(
  userContext: UserContext,
  options?: { externalAccessEnabled?: boolean },
): ToolDefinition[] {
  return PLATFORM_TOOLS.filter(
    (tool) =>
      (!tool.requiresExternalAccess || options?.externalAccessEnabled === true)
      && (tool.requiredCapability === null || can(userContext, tool.requiredCapability)),
  );
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string },
): Promise<ToolResult> {
  switch (toolName) {
    case "create_backlog_item": {
      const itemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const item = await prisma.backlogItem.create({
        data: {
          itemId,
          title: String(params["title"] ?? "Untitled"),
          type: String(params["type"] ?? "product"),
          status: String(params["status"] ?? "open"),
          ...(typeof params["body"] === "string" ? { body: params["body"] } : {}),
          ...(typeof params["epicId"] === "string" ? { epicId: params["epicId"] } : {}),
        },
      });
      return { success: true, entityId: item.itemId, message: `Created backlog item ${item.itemId}` };
    }

    case "update_backlog_item": {
      const existing = await prisma.backlogItem.findUnique({ where: { itemId: String(params["itemId"]) } });
      if (!existing) return { success: false, error: "Item not found", message: `Item ${String(params["itemId"])} not found` };
      const data: Record<string, unknown> = {};
      if (typeof params["title"] === "string") data["title"] = params["title"];
      if (typeof params["status"] === "string") data["status"] = params["status"];
      if (typeof params["priority"] === "number") data["priority"] = params["priority"];
      if (typeof params["body"] === "string") data["body"] = params["body"];
      await prisma.backlogItem.update({ where: { itemId: String(params["itemId"]) }, data });
      return { success: true, entityId: String(params["itemId"]), message: `Updated ${String(params["itemId"])}` };
    }

    case "create_digital_product": {
      const product = await prisma.digitalProduct.create({
        data: {
          productId: String(params["productId"]),
          name: String(params["name"]),
          lifecycleStage: String(params["lifecycleStage"] ?? "plan"),
          lifecycleStatus: "draft",
        },
      });
      return { success: true, entityId: product.productId, message: `Created product ${product.productId}` };
    }

    case "update_lifecycle": {
      const prod = await prisma.digitalProduct.findUnique({ where: { productId: String(params["productId"]) } });
      if (!prod) return { success: false, error: "Product not found", message: `Product ${String(params["productId"])} not found` };
      const updates: Record<string, unknown> = {};
      if (typeof params["lifecycleStage"] === "string") updates["lifecycleStage"] = params["lifecycleStage"];
      if (typeof params["lifecycleStatus"] === "string") updates["lifecycleStatus"] = params["lifecycleStatus"];
      await prisma.digitalProduct.update({ where: { productId: String(params["productId"]) }, data: updates });
      return { success: true, entityId: String(params["productId"]), message: `Updated lifecycle for ${String(params["productId"])}` };
    }

    case "report_quality_issue": {
      const reportId = "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();
      await prisma.platformIssueReport.create({
        data: {
          reportId,
          type: String(params["type"] ?? "user_report"),
          title: String(params["title"] ?? "Untitled"),
          ...(typeof params["description"] === "string" ? { description: params["description"] } : {}),
          severity: String(params["severity"] ?? "medium"),
          reportedById: userId,
          source: "ai_assisted",
        },
      });
      return { success: true, entityId: reportId, message: `Filed report ${reportId}` };
    }

    case "search_public_web": {
      const query = String(params["query"] ?? "").trim();
      const results = await searchPublicWeb(query);
      if (context?.routeContext) {
        await recordExternalEvidence({
          actorUserId: userId,
          routeContext: context.routeContext,
          operationType: "public_web_search",
          target: query,
          provider: "brave_search",
          resultSummary: `Found ${results.length} public search result(s)`,
          details: results as import("@dpf/db").Prisma.InputJsonValue,
        });
      }
      return {
        success: true,
        message: results.length > 0
          ? `Found ${results.length} public search result(s). Top result: ${results[0]!.title} (${results[0]!.url})`
          : "No public search results were found.",
        data: { results },
      };
    }

    case "fetch_public_website": {
      const url = String(params["url"] ?? "").trim();
      const evidence = await fetchPublicWebsiteEvidence(url);
      if (context?.routeContext) {
        await recordExternalEvidence({
          actorUserId: userId,
          routeContext: context.routeContext,
          operationType: "public_web_fetch",
          target: evidence.finalUrl,
          provider: "public_fetch",
          resultSummary: `Fetched public website evidence for ${evidence.finalUrl}`,
          details: evidence as unknown as import("@dpf/db").Prisma.InputJsonValue,
        });
      }
      return {
        success: true,
        message: `Fetched ${evidence.finalUrl}${evidence.title ? ` (${evidence.title})` : ""}.`,
        data: evidence,
      };
    }

    case "analyze_public_website_branding": {
      const url = String(params["url"] ?? "").trim();
      const evidence = await fetchPublicWebsiteEvidence(url);
      const branding = analyzePublicWebsiteBranding(evidence);
      if (context?.routeContext) {
        await recordExternalEvidence({
          actorUserId: userId,
          routeContext: context.routeContext,
          operationType: "branding_analysis",
          target: evidence.finalUrl,
          provider: "public_fetch",
          resultSummary: `Derived branding proposal for ${evidence.finalUrl}`,
          details: {
            evidence,
            branding,
          } as import("@dpf/db").Prisma.InputJsonValue,
        });
      }
      return {
        success: true,
        message: `Derived branding suggestions for ${branding.companyName ?? evidence.finalUrl}.`,
        data: {
          companyName: branding.companyName,
          logoUrl: branding.logoUrl,
          paletteAccent: branding.paletteAccent,
          notes: branding.notes,
        },
      };
    }

    case "update_feature_brief": {
      // Auto-resolve buildId if the LLM passed a placeholder or invalid value
      let buildId = String(params["buildId"] ?? "");
      if (!buildId || buildId.startsWith("CURRENT") || !buildId.startsWith("FB-")) {
        const latestBuild = await prisma.featureBuild.findFirst({
          where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
          orderBy: { updatedAt: "desc" },
          select: { buildId: true },
        });
        if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };
        buildId = latestBuild.buildId;
      }
      const { updateFeatureBrief } = await import("@/lib/actions/build");
      const brief = {
        title: String(params["title"] ?? ""),
        description: String(params["description"] ?? ""),
        portfolioContext: String(params["portfolioContext"] ?? ""),
        targetRoles: Array.isArray(params["targetRoles"]) ? params["targetRoles"].map(String) : [],
        inputs: Array.isArray(params["inputs"]) ? params["inputs"].map(String) : [],
        dataNeeds: String(params["dataNeeds"] ?? ""),
        acceptanceCriteria: Array.isArray(params["acceptanceCriteria"]) ? params["acceptanceCriteria"].map(String) : [],
      };
      await updateFeatureBrief(buildId, brief);
      return { success: true, entityId: buildId, message: `Updated Feature Brief for ${buildId}` };
    }

    case "register_digital_product_from_build": {
      // Auto-resolve buildId if the LLM passed a placeholder
      let buildId = String(params["buildId"] ?? "");
      if (!buildId || buildId.startsWith("CURRENT") || !buildId.startsWith("FB-")) {
        const latestBuild = await prisma.featureBuild.findFirst({
          where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
          orderBy: { updatedAt: "desc" },
          select: { buildId: true },
        });
        if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };
        buildId = latestBuild.buildId;
      }
      const { shipBuild } = await import("@/lib/actions/build");
      const result = await shipBuild({
        buildId,
        name: String(params["name"]),
        portfolioSlug: String(params["portfolioSlug"]),
        versionBump: (params["versionBump"] as "major" | "minor" | "patch") ?? "minor",
      });
      return {
        success: true,
        entityId: result.productId,
        message: result.message,
        data: {
          productInternalId: result.productInternalId,
          portfolioInternalId: result.portfolioInternalId,
        },
      };
    }

    case "create_build_epic": {
      // Auto-resolve buildId if the LLM passed a placeholder
      let epicBuildId = String(params["buildId"] ?? "");
      if (!epicBuildId || epicBuildId.startsWith("CURRENT") || !epicBuildId.startsWith("FB-")) {
        const latestBuild = await prisma.featureBuild.findFirst({
          where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
          orderBy: { updatedAt: "desc" },
          select: { buildId: true },
        });
        if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };
        epicBuildId = latestBuild.buildId;
      }
      const { createBuildEpic } = await import("@/lib/actions/build");
      const epicInput: { buildId: string; title: string; portfolioSlug?: string; digitalProductId?: string } = {
        buildId: epicBuildId,
        title: String(params["title"]),
      };
      if (typeof params["portfolioSlug"] === "string") epicInput.portfolioSlug = params["portfolioSlug"];
      if (typeof params["digitalProductId"] === "string") epicInput.digitalProductId = params["digitalProductId"];
      const result = await createBuildEpic(epicInput);
      return { success: true, entityId: result.epicId, message: result.message };
    }

    default:
      return { success: false, error: "Unknown tool", message: `Tool ${toolName} not found` };
  }
}

// ─── Convert to provider format ──────────────────────────────────────────────

export function toolsToOpenAIFormat(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
