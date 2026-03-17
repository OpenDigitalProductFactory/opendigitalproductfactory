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
  sideEffect?: boolean;
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
    sideEffect: true,
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
    sideEffect: true,
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
    sideEffect: true,
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
    sideEffect: true,
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
    sideEffect: true,
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
    sideEffect: false,
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
    sideEffect: false,
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
    sideEffect: false,
  },
  // ─── Build Studio Tools ───────────────────────────────────────────────────
  // update_feature_brief and create_build_epic execute immediately (no approval dialog).
  // Only register_digital_product_from_build needs HITL approval (creates a real product).
  {
    name: "update_feature_brief",
    description: "Save the Feature Brief for the current build. Build ID is auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Feature title" },
        description: { type: "string", description: "Plain-language feature description" },
        portfolioContext: { type: "string", description: "Portfolio slug that owns this feature" },
        targetRoles: { type: "array", items: { type: "string" }, description: "Roles that will use this feature" },
        inputs: { type: "array", items: { type: "string" }, description: "User inputs the feature accepts" },
        dataNeeds: { type: "string", description: "What data the feature stores" },
        acceptanceCriteria: { type: "array", items: { type: "string" }, description: "What done looks like" },
      },
      required: ["title", "description", "portfolioContext", "targetRoles", "dataNeeds", "acceptanceCriteria"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "register_digital_product_from_build",
    description: "Register or update a DigitalProduct from the current build. Build ID is auto-resolved. Requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name" },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
      },
      required: ["name", "portfolioSlug"],
    },
    requiredCapability: "manage_capabilities",
    sideEffect: true,
  },
  {
    name: "create_build_epic",
    description: "Create an Epic and backlog items for a shipped build. All IDs are auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Epic title" },
      },
      required: ["title"],
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
  },
  // ─── Intake Tools ─────────────────────────────────────────────────────────
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
  },
  {
    name: "assess_complexity",
    description: "Score a feature on 7 dimensions, get path recommendation (simple/moderate/complex).",
    inputSchema: {
      type: "object",
      properties: {
        taxonomySpan: { type: "number", enum: [1, 2, 3] },
        dataEntities: { type: "number", enum: [1, 2, 3] },
        integrations: { type: "number", enum: [1, 2, 3] },
        novelty: { type: "number", enum: [1, 2, 3] },
        regulatory: { type: "number", enum: [1, 2, 3] },
        costEstimate: { type: "number", enum: [1, 2, 3] },
        techDebt: { type: "number", enum: [1, 2, 3] },
      },
      required: ["taxonomySpan", "dataEntities", "integrations", "novelty", "regulatory", "costEstimate", "techDebt"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "propose_decomposition",
    description: "Generate an epic + feature set breakdown for a complex idea.",
    inputSchema: {
      type: "object",
      properties: {
        epicTitle: { type: "string" },
        epicDescription: { type: "string" },
        featureSets: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, type: { type: "string", enum: ["feature_build", "digital_product"] }, estimatedBuilds: { type: "number" }, recommendation: { type: "string", enum: ["build", "buy", "integrate"] }, rationale: { type: "string" }, techDebtNote: { type: "string" } }, required: ["title", "description", "type", "estimatedBuilds", "recommendation", "rationale"] } },
      },
      required: ["epicTitle", "epicDescription", "featureSets"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "register_tech_debt",
    description: "Log a technical shortcut as a refactoring backlog item.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      },
      required: ["title", "description"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  // ─── Build Notes Tool ───────────────────────────────────────────────────
  {
    name: "save_build_notes",
    description: "Persist key points from the conversation to the running spec. Call silently after each significant exchange.",
    inputSchema: {
      type: "object",
      properties: {
        processes: { type: "array", items: { type: "string" }, description: "Manual or automated processes described" },
        requirements: { type: "array", items: { type: "string" }, description: "Requirements discovered (fields, workflows, roles)" },
        decisions: { type: "array", items: { type: "string" }, description: "Decisions made (build vs buy, priorities)" },
        integrations: { type: "array", items: { type: "string" }, description: "External systems or APIs mentioned" },
        dataModel: { type: "array", items: { type: "string" }, description: "Data fields, entities, or structures identified" },
        openQuestions: { type: "array", items: { type: "string" }, description: "Questions still to resolve" },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  // ─── Codebase Access Tools ──────────────────────────────────────────────────
  {
    name: "read_project_file",
    description: "Read a file from the project codebase. Use relative paths like 'apps/web/lib/mcp-tools.ts'. Cannot access .env, credentials, or node_modules.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path from project root" },
        startLine: { type: "number", description: "Start line (1-based, optional)" },
        endLine: { type: "number", description: "End line (optional)" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "search_project_files",
    description: "Search the project codebase for a text pattern. Returns matching file paths, line numbers, and context.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search for" },
        glob: { type: "string", description: "File glob filter, e.g. '*.ts' or '*.tsx'" },
        maxResults: { type: "number", description: "Maximum results (default 20)" },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "propose_file_change",
    description: "Propose a change to a project file. Shows a diff for human review. Requires approval before the change is applied.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path to modify or create" },
        description: { type: "string", description: "Human-readable description of the change" },
        newContent: { type: "string", description: "The complete new file contents" },
      },
      required: ["path", "description", "newContent"],
    },
    requiredCapability: "manage_capabilities",
    sideEffect: true,
  },
  // ─── Feedback Loop ──────────────────────────────────────────────────────────
  {
    name: "propose_improvement",
    description:
      "Propose a platform improvement based on friction or a missing capability observed in this conversation. " +
      "Auto-attributes to the current user. No special permission needed.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the improvement (max 100 chars)" },
        description: { type: "string", description: "What should be improved and why" },
        category: {
          type: "string",
          enum: ["ux_friction", "missing_feature", "performance", "accessibility", "security", "process"],
          description: "Improvement category",
        },
        severity: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Impact severity (default: medium)",
        },
        observedFriction: { type: "string", description: "What you observed that prompted this suggestion" },
      },
      required: ["title", "description", "category"],
    },
    requiredCapability: null,
    executionMode: "proposal",
    sideEffect: true,
  },
  // ─── Provider Management ────────────────────────────────────────────────────
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
  {
    name: "analyze_brand_document",
    description: "Analyze an uploaded brand guidelines document (PDF or image) and extract brand assets: logo, colors, and fonts",
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Original filename" },
        fileContent: { type: "string", description: "Base64-encoded file content" },
        fileType: { type: "string", enum: ["pdf", "png", "jpg", "svg"], description: "File type" },
      },
      required: ["fileName", "fileContent", "fileType"],
    },
    requiredCapability: "manage_branding" as CapabilityKey,
    executionMode: "immediate",
  },
  // ─── HR Lifecycle Tools ─────────────────────────────────────────────────────
  {
    name: "create_employee",
    description: "Create a new employee record (starts in offer or onboarding status). Provide name, email, department, position, manager, and start date.",
    inputSchema: {
      type: "object",
      properties: {
        firstName: { type: "string", description: "First name" },
        lastName: { type: "string", description: "Last name" },
        workEmail: { type: "string", description: "Work email address" },
        status: { type: "string", enum: ["offer", "onboarding", "active"], description: "Initial status (default: offer)" },
        departmentId: { type: "string", description: "Department ID (optional)" },
        positionId: { type: "string", description: "Position ID (optional)" },
        managerEmployeeId: { type: "string", description: "Manager employee profile ID (optional)" },
        startDate: { type: "string", description: "Start date ISO string (optional)" },
      },
      required: ["firstName", "lastName"],
    },
    requiredCapability: "manage_user_lifecycle",
  },
  {
    name: "transition_employee_status",
    description: "Move an employee through lifecycle stages (e.g. offer → onboarding, onboarding → active, active → offboarding).",
    inputSchema: {
      type: "object",
      properties: {
        employeeId: { type: "string", description: "Employee ID (e.g. EMP-XXXXX)" },
        newStatus: { type: "string", enum: ["onboarding", "active", "leave", "suspended", "offboarding", "inactive"], description: "Target status" },
        reason: { type: "string", description: "Reason for the transition" },
      },
      required: ["employeeId", "newStatus"],
    },
    requiredCapability: "manage_user_lifecycle",
  },
  {
    name: "propose_leave_policy",
    description: "Suggest leave policies for an employee based on their location/country. Creates default leave policy records.",
    inputSchema: {
      type: "object",
      properties: {
        locationContext: { type: "string", description: "Country or region for policy recommendations" },
        policies: {
          type: "array",
          description: "Array of policy suggestions",
          items: {
            type: "object",
            properties: {
              leaveType: { type: "string" },
              name: { type: "string" },
              annualAllocation: { type: "number" },
              carryoverLimit: { type: "number" },
            },
          },
        },
      },
      required: ["locationContext", "policies"],
    },
    requiredCapability: "manage_user_lifecycle",
  },
  {
    name: "submit_feedback",
    description: "Log a feedback note for an employee (praise, constructive, or observation).",
    inputSchema: {
      type: "object",
      properties: {
        toEmployeeId: { type: "string", description: "Employee profile ID receiving feedback" },
        content: { type: "string", description: "Feedback content" },
        feedbackType: { type: "string", enum: ["praise", "constructive", "observation"], description: "Type of feedback" },
        visibility: { type: "string", enum: ["private", "shared", "public"], description: "Visibility (default: private)" },
      },
      required: ["toEmployeeId", "content", "feedbackType"],
    },
    requiredCapability: null,
    executionMode: "immediate",
  },
];

// ─── Capability Filtering ────────────────────────────────────────────────────

export function getAvailableTools(
  userContext: UserContext,
  options?: { externalAccessEnabled?: boolean; mode?: "advise" | "act"; unifiedMode?: boolean },
): ToolDefinition[] {
  return PLATFORM_TOOLS.filter(
    (tool) =>
      (options?.unifiedMode || !tool.requiresExternalAccess || options?.externalAccessEnabled === true)
      && (tool.requiredCapability === null || can(userContext, tool.requiredCapability))
      && (options?.mode !== "advise" || !tool.sideEffect),
  );
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; agentId?: string; threadId?: string },
): Promise<ToolResult> {
  switch (toolName) {
    case "create_backlog_item": {
      const itemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const status = String(params["status"] ?? "open");
      const item = await prisma.backlogItem.create({
        data: {
          itemId,
          title: String(params["title"] ?? "Untitled"),
          type: String(params["type"] ?? "product"),
          status,
          submittedById: userId,
          agentId: context?.agentId ?? null,
          ...(status === "done" ? { completedAt: new Date() } : {}),
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
      if (typeof params["status"] === "string") {
        data["status"] = params["status"];
        // Track completion date
        const isTerminal = params["status"] === "done" || params["status"] === "deferred";
        const wasTerminal = existing.status === "done" || existing.status === "deferred";
        if (isTerminal && !wasTerminal) {
          data["completedAt"] = new Date();
        } else if (!isTerminal && wasTerminal) {
          data["completedAt"] = null;
        }
      }
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
      let results: Awaited<ReturnType<typeof searchPublicWeb>>;
      try {
        results = await searchPublicWeb(query);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Web search failed";
        return { success: false, error: msg, message: msg };
      }
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
      // Auto-resolve buildId and digitalProductId from the build record
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
      // Auto-resolve digitalProductId and portfolioSlug from the build's linked product
      const epicBuild = await prisma.featureBuild.findUnique({
        where: { buildId: epicBuildId },
        select: {
          digitalProductId: true,
          portfolioId: true,
          digitalProduct: { select: { portfolio: { select: { slug: true } } } },
        },
      });
      const resolvedProductId = epicBuild?.digitalProductId ?? undefined;
      const resolvedPortfolioSlug = typeof params["portfolioSlug"] === "string"
        ? params["portfolioSlug"]
        : epicBuild?.digitalProduct?.portfolio?.slug ?? undefined;

      const { createBuildEpic } = await import("@/lib/actions/build");
      const epicInput: { buildId: string; title: string; portfolioSlug?: string; digitalProductId?: string } = {
        buildId: epicBuildId,
        title: String(params["title"]),
      };
      if (resolvedPortfolioSlug) epicInput.portfolioSlug = resolvedPortfolioSlug;
      if (resolvedProductId) epicInput.digitalProductId = resolvedProductId;
      const result = await createBuildEpic(epicInput);
      return { success: true, entityId: result.epicId, message: result.message };
    }

    case "search_portfolio_context": {
      const { searchPortfolioContext } = await import("@/lib/portfolio-search");
      let portfolioId: string | null = null;
      const latestBuild = await prisma.featureBuild.findFirst({
        where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { portfolioId: true },
      });
      portfolioId = latestBuild?.portfolioId ?? null;
      const results = await searchPortfolioContext(String(params["query"] ?? ""), portfolioId);
      const totalMatches = results.taxonomyMatches.length + results.productMatches.length + results.buildMatches.length + results.backlogMatches.length;
      return { success: true, message: `Found ${totalMatches} related item${totalMatches !== 1 ? "s" : ""}.`, data: results as unknown as Record<string, unknown> };
    }

    case "assess_complexity": {
      const { assessComplexity } = await import("@/lib/complexity-assessment");
      const scores = {
        taxonomySpan: Number(params["taxonomySpan"] ?? 1) as 1 | 2 | 3,
        dataEntities: Number(params["dataEntities"] ?? 1) as 1 | 2 | 3,
        integrations: Number(params["integrations"] ?? 1) as 1 | 2 | 3,
        novelty: Number(params["novelty"] ?? 1) as 1 | 2 | 3,
        regulatory: Number(params["regulatory"] ?? 1) as 1 | 2 | 3,
        costEstimate: Number(params["costEstimate"] ?? 1) as 1 | 2 | 3,
        techDebt: Number(params["techDebt"] ?? 1) as 1 | 2 | 3,
      };
      const result = assessComplexity(scores);
      return { success: true, message: `Complexity: ${result.total}/21 — ${result.path} path.`, data: result as unknown as Record<string, unknown> };
    }

    case "propose_decomposition": {
      const { validateDecompositionPlan } = await import("@/lib/decomposition");
      const plan = {
        epicTitle: String(params["epicTitle"] ?? ""),
        epicDescription: String(params["epicDescription"] ?? ""),
        featureSets: Array.isArray(params["featureSets"]) ? params["featureSets"] as import("@/lib/feature-build-types").FeatureSetEntry[] : [],
      };
      const validation = validateDecompositionPlan(plan);
      if (!validation.valid) return { success: false, error: validation.errors.join(", "), message: `Invalid: ${validation.errors.join(", ")}` };
      return { success: true, message: `${plan.epicTitle} — ${plan.featureSets.length} feature set${plan.featureSets.length !== 1 ? "s" : ""}.`, data: plan as unknown as Record<string, unknown> };
    }

    case "register_tech_debt": {
      const { createTechDebtItem } = await import("@/lib/decomposition");
      const item = createTechDebtItem({ title: String(params["title"] ?? ""), description: String(params["description"] ?? ""), severity: String(params["severity"] ?? "medium") });
      const refactorEpic = await prisma.epic.findUnique({ where: { epicId: "EP-REFACTOR-001" } });
      await prisma.backlogItem.create({
        data: { itemId: item.itemId, title: item.title, type: item.type, status: item.status, body: item.body, priority: item.priority, submittedById: userId, agentId: context?.agentId ?? null, ...(refactorEpic ? { epicId: refactorEpic.id } : {}) },
      });
      return { success: true, entityId: item.itemId, message: `Tech debt logged: ${item.itemId}` };
    }

    case "save_build_notes": {
      // Auto-resolve the active build and merge notes into its plan field
      const latestBuild = await prisma.featureBuild.findFirst({
        where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { buildId: true, plan: true },
      });
      if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };

      const existing = (latestBuild.plan as Record<string, unknown> | null) ?? {};
      const mergeArray = (key: string) => {
        const prev = Array.isArray(existing[key]) ? existing[key] as string[] : [];
        const incoming = Array.isArray(params[key]) ? (params[key] as string[]).map(String) : [];
        // Deduplicate
        return [...new Set([...prev, ...incoming])];
      };

      const merged = {
        ...existing,
        processes: mergeArray("processes"),
        requirements: mergeArray("requirements"),
        decisions: mergeArray("decisions"),
        integrations: mergeArray("integrations"),
        dataModel: mergeArray("dataModel"),
        openQuestions: mergeArray("openQuestions"),
        lastUpdated: new Date().toISOString(),
      };

      await prisma.featureBuild.update({
        where: { buildId: latestBuild.buildId },
        data: { plan: merged as import("@dpf/db").Prisma.InputJsonValue },
      });

      const totalItems = merged.processes.length + merged.requirements.length + merged.decisions.length + merged.integrations.length + merged.dataModel.length;
      return { success: true, message: `Spec updated — ${totalItems} items captured.` };
    }

    case "read_project_file": {
      const { readProjectFile } = await import("@/lib/codebase-tools");
      const opts: { startLine?: number; endLine?: number } = {};
      if (typeof params.startLine === "number") opts.startLine = params.startLine;
      if (typeof params.endLine === "number") opts.endLine = params.endLine;
      const result = readProjectFile(String(params.path ?? ""), opts);
      if ("error" in result) return { success: false, error: result.error, message: result.error };
      return { success: true, message: result.content, data: { content: result.content } };
    }

    case "search_project_files": {
      const { searchProjectFiles } = await import("@/lib/codebase-tools");
      const opts: { glob?: string; maxResults?: number } = {};
      if (typeof params.glob === "string") opts.glob = params.glob;
      if (typeof params.maxResults === "number") opts.maxResults = params.maxResults;
      const result = searchProjectFiles(String(params.query ?? ""), opts);
      if ("error" in result) return { success: false, error: result.error, message: result.error };
      const summary = result.results.map((r) => `${r.path}:${r.line}: ${r.text}`).join("\n");
      return { success: true, message: summary || "No matches found", data: { results: result.results } };
    }

    case "propose_file_change": {
      const { readProjectFile, writeProjectFile, generateSimpleDiff } = await import("@/lib/codebase-tools");
      const path = String(params.path ?? "");
      const newContent = String(params.newContent ?? "");
      const description = String(params.description ?? "");

      const current = readProjectFile(path);
      const currentContent = "content" in current ? current.content : "";
      const diff = generateSimpleDiff(currentContent, newContent, path);

      const writeResult = writeProjectFile(path, newContent);
      if ("error" in writeResult) return { success: false, error: writeResult.error, message: writeResult.error };

      return {
        success: true,
        entityId: path,
        message: `Applied change to ${path}`,
        data: { path, diff, description },
      };
    }

    case "propose_improvement": {
      const proposalId = `IP-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;

      // Capture conversation excerpt (last 5 messages) for evidence
      let conversationExcerpt: string | null = null;
      if (context?.threadId) {
        const recentMessages = await prisma.agentMessage.findMany({
          where: { threadId: context.threadId },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { role: true, content: true },
        });
        if (recentMessages.length > 0) {
          conversationExcerpt = recentMessages
            .reverse()
            .map((m) => `[${m.role}] ${m.content?.slice(0, 200)}`)
            .join("\n");
        }
      }

      const proposal = await prisma.improvementProposal.create({
        data: {
          proposalId,
          title: String(params["title"] ?? "Untitled improvement"),
          description: String(params["description"] ?? ""),
          category: String(params["category"] ?? "missing_feature"),
          severity: String(params["severity"] ?? "medium"),
          observedFriction: typeof params["observedFriction"] === "string" ? params["observedFriction"] : null,
          conversationExcerpt,
          submittedById: userId,
          agentId: context?.agentId ?? "unknown",
          routeContext: context?.routeContext ?? "unknown",
          threadId: context?.threadId ?? null,
        },
      });
      return {
        success: true,
        entityId: proposal.proposalId,
        message: `Improvement proposal ${proposal.proposalId} created: "${proposal.title}". It will be reviewed by a manager.`,
      };
    }

    case "add_provider": {
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

    case "update_provider_category": {
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

    case "analyze_brand_document": {
      const { fileName, fileType } = params as { fileName: string; fileContent: string; fileType: string };
      return {
        success: true,
        message: `Analyzing brand document: ${fileName} (${fileType})`,
        data: {
          companyName: null,
          logoDataUrl: null,
          colors: [],
          fonts: [],
          notes: `Document "${fileName}" received for brand analysis. The AI agent should analyze the base64 content to extract brand assets.`,
        },
      };
    }

    case "create_employee": {
      const employeeId = `EMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const status = String(params["status"] ?? "offer");
      const eventType = status === "offer" ? "offer_created" : status === "active" ? "hired" : "onboarding_started";

      const employee = await prisma.employeeProfile.create({
        data: {
          employeeId,
          firstName: String(params["firstName"] ?? ""),
          lastName: String(params["lastName"] ?? ""),
          displayName: `${String(params["firstName"] ?? "")} ${String(params["lastName"] ?? "")}`.trim(),
          workEmail: typeof params["workEmail"] === "string" ? params["workEmail"] : undefined,
          status,
          ...(typeof params["departmentId"] === "string" ? { departmentId: params["departmentId"] } : {}),
          ...(typeof params["positionId"] === "string" ? { positionId: params["positionId"] } : {}),
          ...(typeof params["managerEmployeeId"] === "string" ? { managerEmployeeId: params["managerEmployeeId"] } : {}),
          ...(typeof params["startDate"] === "string" ? { startDate: new Date(params["startDate"]) } : {}),
          employmentEvents: {
            create: {
              eventId: `EVT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
              eventType,
              effectiveAt: typeof params["startDate"] === "string" ? new Date(params["startDate"]) : new Date(),
              reason: "Created via AI co-worker",
              actorUserId: userId,
            },
          },
        },
      });
      return {
        success: true,
        entityId: employee.employeeId,
        message: `Employee ${employee.displayName} (${employee.employeeId}) created with status "${status}".`,
      };
    }

    case "transition_employee_status": {
      const employee = await prisma.employeeProfile.findUnique({
        where: { employeeId: String(params["employeeId"]) },
      });
      if (!employee) return { success: false, error: "Employee not found", message: `Employee ${String(params["employeeId"])} not found` };

      const newStatus = String(params["newStatus"]);
      const { validateLifecycleTransition } = await import("@/lib/actions/workforce");
      const error = validateLifecycleTransition({
        currentStatus: employee.status as import("@/lib/workforce-types").WorkforceStatus,
        nextStatus: newStatus as import("@/lib/workforce-types").WorkforceStatus,
        eventType: "activated",
        terminationDate: newStatus === "inactive" ? new Date() : null,
      });
      if (error) return { success: false, error, message: error };

      const eventMap: Record<string, string> = {
        onboarding: employee.status === "offer" ? "offer_accepted" : "onboarding_started",
        active: employee.status === "onboarding" ? "onboarding_completed" : "activated",
        leave: "leave_started",
        suspended: "suspended",
        offboarding: "offboarding_started",
        inactive: employee.status === "offboarding" ? "offboarding_completed" : "terminated",
      };

      await prisma.$transaction([
        prisma.employeeProfile.update({
          where: { employeeId: String(params["employeeId"]) },
          data: { status: newStatus },
        }),
        prisma.employmentEvent.create({
          data: {
            eventId: `EVT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
            employeeProfileId: employee.id,
            eventType: eventMap[newStatus] ?? "activated",
            effectiveAt: new Date(),
            reason: typeof params["reason"] === "string" ? params["reason"] : null,
            actorUserId: userId,
          },
        }),
      ]);

      return {
        success: true,
        entityId: employee.employeeId,
        message: `${employee.displayName} transitioned from "${employee.status}" to "${newStatus}".`,
      };
    }

    case "propose_leave_policy": {
      const policies = params["policies"] as Array<{ leaveType: string; name: string; annualAllocation: number; carryoverLimit?: number }> | undefined;
      if (!policies || !Array.isArray(policies)) return { success: false, error: "No policies provided", message: "Provide an array of policy suggestions" };

      let created = 0;
      for (const p of policies) {
        const policyId = `LP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        await prisma.leavePolicy.create({
          data: {
            policyId,
            leaveType: p.leaveType,
            name: p.name,
            annualAllocation: p.annualAllocation,
            carryoverLimit: p.carryoverLimit ?? null,
            isDefault: true,
          },
        });
        created++;
      }
      return {
        success: true,
        message: `Created ${created} leave ${created !== 1 ? "policies" : "policy"} for ${String(params["locationContext"])}.`,
      };
    }

    case "submit_feedback": {
      const fromProfile = await prisma.employeeProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!fromProfile) return { success: false, error: "Your employee profile not found", message: "Cannot submit feedback without an employee profile" };

      const feedbackId = `FB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.feedbackNote.create({
        data: {
          feedbackId,
          fromEmployeeId: fromProfile.id,
          toEmployeeId: String(params["toEmployeeId"]),
          content: String(params["content"]),
          feedbackType: String(params["feedbackType"] ?? "observation"),
          visibility: String(params["visibility"] ?? "private"),
        },
      });
      return {
        success: true,
        entityId: feedbackId,
        message: "Feedback submitted.",
      };
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
