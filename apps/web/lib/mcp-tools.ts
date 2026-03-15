import type { CapabilityKey } from "@/lib/permissions";
import { can, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import * as crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredCapability: CapabilityKey | null;
};

export type ToolResult = {
  success: boolean;
  entityId?: string;
  message: string;
  error?: string;
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

  // ─── Build Studio Tools ─────────────────────────────────────────────────────
  {
    name: "start_feature_brief",
    description: "Create a new FeatureBuild record and start the Ideate phase",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Feature title" },
        description: { type: "string", description: "Plain language description" },
        portfolioContext: { type: "string", description: "Portfolio slug for context" },
      },
      required: ["title"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "launch_sandbox",
    description: "Spin up a sandbox container, install dependencies, and start the dev server",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "generate_code",
    description: "Send the implementation plan to the coding agent in the sandbox",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "iterate_sandbox",
    description: "Send refinement instructions to the coding agent in the sandbox",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
        instruction: { type: "string", description: "What to change (e.g., 'make the button bigger')" },
      },
      required: ["buildId", "instruction"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "preview_sandbox",
    description: "Get the sandbox preview proxy URL for the current build",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "run_sandbox_tests",
    description: "Run pnpm test and tsc --noEmit inside the sandbox, return results",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "deploy_feature",
    description: "Extract the git diff from the sandbox and apply to the running platform",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "manage_capabilities",
  },
  {
    name: "contribute_to_hive",
    description: "Package the feature as a Feature Pack for contribution to the Hive Mind",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
        title: { type: "string", description: "Pack title" },
        description: { type: "string", description: "Pack description" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
];

// ─── Capability Filtering ────────────────────────────────────────────────────

export function getAvailableTools(userContext: UserContext): ToolDefinition[] {
  return PLATFORM_TOOLS.filter(
    (t) => t.requiredCapability === null || can(userContext, t.requiredCapability),
  );
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
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

    case "start_feature_brief": {
      const buildId = `FB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.featureBuild.create({
        data: {
          buildId,
          title: String(params["title"] ?? "Untitled Feature"),
          ...(typeof params["description"] === "string" ? { description: params["description"] } : {}),
          ...(typeof params["portfolioContext"] === "string" ? { portfolioId: params["portfolioContext"] } : {}),
          createdById: userId,
        },
      });
      return { success: true, entityId: buildId, message: `Created feature build ${buildId}` };
    }

    case "launch_sandbox":
      return { success: false, error: "Not implemented", message: "Sandbox launch requires Docker — use the Build Studio UI" };

    case "generate_code":
      return { success: false, error: "Not implemented", message: "Code generation requires an active sandbox — use the Build Studio UI" };

    case "iterate_sandbox":
      return { success: false, error: "Not implemented", message: "Iteration requires an active sandbox — use the Build Studio UI" };

    case "preview_sandbox": {
      const previewBuild = await prisma.featureBuild.findUnique({ where: { buildId: String(params["buildId"]) } });
      if (!previewBuild?.sandboxPort) return { success: false, error: "No sandbox", message: "Sandbox not running" };
      return { success: true, message: `/api/sandbox/preview?buildId=${String(params["buildId"])}` };
    }

    case "run_sandbox_tests":
      return { success: false, error: "Not implemented", message: "Test execution requires an active sandbox — use the Build Studio UI" };

    case "deploy_feature":
      return { success: false, error: "Not implemented", message: "Deployment requires review approval — use the Build Studio UI" };

    case "contribute_to_hive": {
      const packId = `FP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.featurePack.create({
        data: {
          packId,
          title: String(params["title"] ?? "Untitled Pack"),
          ...(typeof params["description"] === "string" ? { description: params["description"] } : {}),
          buildId: String(params["buildId"]),
          manifest: {},
          status: "local",
        },
      });
      return { success: true, entityId: packId, message: `Created feature pack ${packId}` };
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
