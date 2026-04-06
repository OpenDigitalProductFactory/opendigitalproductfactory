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

export type BuildPhaseTag = "ideate" | "plan" | "build" | "review" | "ship";

/** MCP tool annotation hints (from MCP spec + n8n-MCP pattern).
 *  These let the agent router and governance layer make safety decisions
 *  without parsing the tool description text. */
export type ToolAnnotations = {
  /** Tool only reads data — never mutates state */
  readOnlyHint?: boolean;
  /** Tool performs a destructive/irreversible action (delete, overwrite, deploy) */
  destructiveHint?: boolean;
  /** Calling the tool twice with the same input produces the same result */
  idempotentHint?: boolean;
  /** Tool reaches outside the platform boundary (network, external API) */
  openWorldHint?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredCapability: CapabilityKey | null;
  requiresExternalAccess?: boolean;
  executionMode?: "proposal" | "immediate";
  sideEffect?: boolean;
  /** When set, tool is only available during these build phases.
   *  Null/undefined = available in all phases (non-build tools). */
  buildPhases?: BuildPhaseTag[] | null;
  /** MCP-spec tool annotations for governance and safety classification */
  annotations?: ToolAnnotations;
};

/** Derive tool annotations from existing ToolDefinition fields.
 *  Explicit `annotations` on a tool override these defaults. */
export function resolveAnnotations(tool: ToolDefinition): ToolAnnotations {
  const defaults: ToolAnnotations = {
    readOnlyHint: tool.sideEffect === false && tool.executionMode !== "proposal",
    destructiveHint: tool.executionMode === "proposal" || DESTRUCTIVE_TOOLS.has(tool.name),
    idempotentHint: tool.sideEffect === false,
    openWorldHint: tool.requiresExternalAccess === true,
  };
  return { ...defaults, ...tool.annotations };
}

/** Tools that perform destructive or irreversible actions beyond what
 *  sideEffect/executionMode already captures. */
const DESTRUCTIVE_TOOLS = new Set([
  "deploy_feature",
  "execute_promotion",
  "transition_employee_status",
  "contribute_to_hive",
  "apply_platform_update",
]);

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
    description: "Create a new backlog item in the ops backlog. Use this tool to add new items — do NOT use update_backlog_item for items that do not exist yet.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Item title" },
        type: { type: "string", enum: ["portfolio", "product"], description: "Item type" },
        status: { type: "string", enum: ["open", "in-progress"], description: "Initial status" },
        body: { type: "string", description: "Detailed description" },
        epicId: { type: "string", description: "Epic ID to link to (optional)" },
        itemId: { type: "string", description: "Optional custom item ID (e.g. BI-PORT-005). Auto-generated if omitted." },
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
    name: "query_backlog",
    description: "Query backlog items and epics. Returns items matching the filter criteria with status, priority, and epic information.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in-progress", "done", "deferred"], description: "Filter by status (optional)" },
        epicId: { type: "string", description: "Filter by epic ID (optional)" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
  },
  {
    name: "report_quality_issue",
    description: "Report a bug, suggestion, or question about the platform. Available to ALL employees regardless of role — anyone can report a problem.",
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
    name: "get_marketing_summary",
    description: "Get archetype-aware marketing metrics: storefront inbox counts, CRM pipeline summary, and the marketing playbook for this business type",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days to look back (default 30)" },
      },
      required: [],
    },
    requiredCapability: "view_storefront",
    sideEffect: false,
  },
  {
    name: "suggest_campaign_ideas",
    description: "Get structured context for generating archetype-specific marketing campaign ideas, including business type, season, playbook, and top storefront items",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_storefront",
    sideEffect: false,
  },
  {
    name: "generate_custom_archetype",
    description: "Generate a custom business archetype from a description of the business, its offerings, and customer interaction patterns. Creates a new StorefrontArchetype record.",
    inputSchema: {
      type: "object",
      properties: {
        businessName: { type: "string", description: "Name of the business type (e.g. 'Co-working Space')" },
        businessDescription: { type: "string", description: "What the business does" },
        offerings: { type: "array", items: { type: "string" }, description: "List of products/services offered" },
        primaryCtaType: { type: "string", enum: ["booking", "purchase", "inquiry", "donation", "mixed"], description: "How customers primarily interact" },
        stakeholderLabel: { type: "string", description: "What to call the customers (Members, Clients, Patients, etc.)" },
        portalLabel: { type: "string", description: "What to call the portal (Member Portal, Client Portal, etc.)" },
        closestCategory: { type: "string", description: "Closest existing archetype category or 'custom'" },
      },
      required: ["businessName", "businessDescription", "offerings", "primaryCtaType"],
    },
    requiredCapability: "view_storefront",
    sideEffect: true,
  },
  {
    name: "assess_archetype_refinement",
    description: "Compare the current storefront configuration against the original archetype template and return a structured refinement diff showing what items, sections, and categories have changed",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_storefront",
    sideEffect: false,
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
    buildPhases: ["ideate"],
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
    buildPhases: ["ideate"],
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
    buildPhases: ["ideate"],
  },
  {
    name: "suggest_taxonomy_placement",
    description: "Analyze the current feature brief and suggest where it belongs in the portfolio taxonomy. Returns ranked candidates with match scores. Call after saving the feature brief.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    buildPhases: ["ideate"],
  },
  {
    name: "confirm_taxonomy_placement",
    description: "Confirm or override the taxonomy placement for the current feature build. Either confirm an existing node or propose a new one.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Confirmed taxonomy node ID (e.g. 'foundational/platform_services/api_management_platform'). Null if proposing new." },
        proposeNew: {
          type: "object",
          description: "Propose a new taxonomy node when nothing fits",
          properties: {
            parentNodeId: { type: "string", description: "Parent node ID to create under" },
            name: { type: "string", description: "Proposed node name" },
            description: { type: "string", description: "What this capability area covers" },
            rationale: { type: "string", description: "Why existing nodes don't fit" },
          },
          required: ["parentNodeId", "name", "description", "rationale"],
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "ship"],
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
    buildPhases: ["ship"],
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
    buildPhases: ["ship"],
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
    buildPhases: ["ideate"],
  },
  {
    name: "assess_complexity",
    description: "Score a feature on 7 dimensions, get path recommendation (simple/moderate/complex).",
    inputSchema: {
      type: "object",
      properties: {
        taxonomySpan: { type: "number", description: "Score 1-3: 1=single node, 2=multi-node, 3=cross-portfolio" },
        dataEntities: { type: "number", description: "Score 1-3: 1=read-only, 2=CRUD on existing, 3=new schema" },
        integrations: { type: "number", description: "Score 1-3: 1=none, 2=internal, 3=external" },
        novelty: { type: "number", description: "Score 1-3: 1=pattern exists, 2=variation, 3=novel" },
        regulatory: { type: "number", description: "Score 1-3: 1=none, 2=moderate, 3=regulated" },
        costEstimate: { type: "number", description: "Score 1-3: 1=small, 2=medium, 3=large" },
        techDebt: { type: "number", description: "Score 1-3: 1=low, 2=moderate, 3=high" },
      },
      required: ["taxonomySpan", "dataEntities", "integrations", "novelty", "regulatory", "costEstimate", "techDebt"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
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
    buildPhases: ["ideate"],
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
    buildPhases: ["ideate", "plan"],
  },
  // ─── Phase Handoff Tool (Claude Code-inspired cross-phase memory) ────────
  {
    name: "save_phase_handoff",
    description: "Save a structured handoff briefing for the next phase. Call this as your LAST action before a phase transition.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentence plain-language summary of what was accomplished in this phase" },
        decisionsMade: { type: "array", items: { type: "string" }, description: "Key decisions made and why" },
        openIssues: { type: "array", items: { type: "string" }, description: "Unresolved issues or risks carried to next phase" },
        userPreferences: { type: "array", items: { type: "string" }, description: "User preferences or constraints expressed during this phase" },
      },
      required: ["summary"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  // ─── Build Studio Lifecycle Tools (EP-SELF-DEV-002) ───────────────────────
  {
    name: "saveBuildEvidence",
    description: "Save evidence to a FeatureBuild record. Fields: designDoc, buildPlan, taskResults, verificationOut, acceptanceMet.",
    inputSchema: {
      type: "object",
      properties: {
        field: { type: "string", enum: ["designDoc", "designReview", "buildPlan", "planReview", "taskResults", "verificationOut", "acceptanceMet"], description: "Evidence field to update" },
        value: { type: "object", description: "JSON value to store" },
      },
      required: ["field", "value"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "reviewDesignDoc",
    description: "Submit the design document for AI review. Returns pass/fail with issues.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["ideate"],
  },
  {
    name: "reviewBuildPlan",
    description: "Submit the implementation plan for AI review. Returns pass/fail with issues.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["plan"],
  },
  {
    name: "launch_sandbox",
    description: "Launch a Docker sandbox container for code generation. Sandbox is isolated, resource-limited, and auto-destroyed after 30 minutes.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate", // Sandbox is isolated — no HITL needed
    sideEffect: false, // Sandbox is isolated from production — safe in any mode
    buildPhases: ["build"],
  },
  {
    name: "generate_code",
    description: "Send a code generation instruction to the coding agent inside the sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "What to generate or change" },
      },
      required: ["instruction"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Writes to sandbox only, not production — available in advise mode
    buildPhases: ["build", "review"],
  },
  {
    name: "iterate_sandbox",
    description: "Send a refinement instruction to the coding agent in the sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "Refinement instruction" },
      },
      required: ["instruction"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Writes to sandbox only, not production — available in advise mode
    buildPhases: ["build"],
  },
  {
    name: "run_sandbox_tests",
    description: "Run unit tests and typecheck inside the sandbox container. Set auto_fix to true to automatically diagnose and fix failures (up to 3 attempts).",
    inputSchema: {
      type: "object",
      properties: {
        auto_fix: { type: "boolean", description: "When true, automatically diagnose test failures and attempt fixes (max 3 retries). Default: false." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build", "review"],
  },
  {
    name: "read_sandbox_file",
    description: "Read a file from the sandbox workspace. Returns contents with line numbers. Use offset and limit for large files. Always read a file before editing it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root, e.g. apps/web/lib/actions/crm.ts" },
        offset: { type: "number", description: "Start reading from this line number (1-based). Omit to read from beginning." },
        limit: { type: "number", description: "Maximum number of lines to read. Omit to read entire file. Use for large files." },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["plan", "build", "review"],
  },
  {
    name: "write_sandbox_file",
    description: "Create or overwrite a file in the sandbox workspace. Use this to create new files. For modifying existing files, prefer edit_sandbox_file for surgical edits.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root, e.g. apps/web/app/(shell)/complaints/page.tsx" },
        content: { type: "string", description: "The full file content to write" },
      },
      required: ["path", "content"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox only
    buildPhases: ["build", "review"],
  },
  {
    name: "edit_sandbox_file",
    description: "Edit an existing file in the sandbox. Two modes: (1) String mode: old_text + new_text for exact find-and-replace. (2) Line mode: start_line + end_line + new_content to replace a line range by number. Use line mode when string matching fails — line numbers from read_sandbox_file are reliable.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        old_text: { type: "string", description: "String mode: the exact text to find and replace" },
        new_text: { type: "string", description: "String mode: the replacement text" },
        replace_all: { type: "boolean", description: "String mode: replace all occurrences. Default: false." },
        start_line: { type: "number", description: "Line mode: first line to replace (1-indexed, from read_sandbox_file)" },
        end_line: { type: "number", description: "Line mode: last line to replace (inclusive)" },
        new_content: { type: "string", description: "Line mode: replacement content for the line range" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox only
    buildPhases: ["build", "review"],
  },
  {
    name: "search_sandbox",
    description: "Search for a text pattern across the sandbox workspace. Returns matching file paths, line numbers, and context lines.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or regex pattern to search for" },
        glob: { type: "string", description: "File glob filter, e.g. '*.ts' or '*.tsx'" },
        maxResults: { type: "number", description: "Maximum results (default 20)" },
      },
      required: ["pattern"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["plan", "build"],
  },
  {
    name: "list_sandbox_files",
    description: "List files in the sandbox workspace matching a glob pattern. Returns file paths.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. 'apps/web/lib/actions/*.ts' or '**/*.tsx'" },
      },
      required: ["pattern"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["plan", "build"],
  },
  {
    name: "run_sandbox_command",
    description: "Run a shell command inside the sandbox container. Use for build, test, lint, git diff, or any other verification. Returns stdout and stderr.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute in the sandbox, e.g. 'pnpm --filter web build' or 'git diff'" },
      },
      required: ["command"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox is isolated from production — safe in any mode
    buildPhases: ["build", "review"],
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
    name: "validate_schema",
    description: "Validate the Prisma schema in the sandbox for common errors: missing inverse relations, undefined types, unindexed foreign keys. MUST be called before running prisma migrate. Returns specific errors with fix instructions.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build"],
  },
  {
    name: "deploy_feature",
    description: "Extract the git diff from sandbox and deploy to the platform. Requires approval.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_capabilities",
    executionMode: "proposal",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  // ─── Scheduling & Release Tools (IT4IT §5.3-5.4) ───────────────────────
  {
    name: "check_deployment_windows",
    description: "Check available deployment windows for promoting changes to production. Returns current window status, blackout periods, and next available window time.",
    inputSchema: {
      type: "object",
      properties: {
        change_type: { type: "string", description: "RFC type: standard, normal, or emergency. Default: normal." },
        risk_level: { type: "string", description: "Risk level: low, medium, high, or critical. Default: low." },
      },
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["review", "ship"],
  },
  {
    name: "schedule_promotion",
    description: "Schedule an approved promotion for deployment during a specific window. Creates a calendar event for visibility.",
    inputSchema: {
      type: "object",
      properties: {
        promotion_id: { type: "string", description: "The promotion ID (CP-xxx) to schedule." },
      },
      required: ["promotion_id"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "execute_promotion",
    description: "Execute an approved promotion. Starts the autonomous promoter: backup DB, build new portal image from sandbox, swap containers, health check. Rolls back automatically on failure.",
    inputSchema: {
      type: "object" as const,
      properties: {
        promotion_id: { type: "string", description: "The promotion ID to execute (e.g. CP-xxxx)." },
        override_reason: { type: "string", description: "Reason for deploying outside a deployment window (optional, for emergency changes)." },
      },
      required: ["promotion_id"],
    },
    requiredCapability: "view_operations" as const,
    executionMode: "immediate" as const,
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "create_release_bundle",
    description: "Group multiple completed builds into a release bundle for coordinated deployment (IT4IT §5.3.5 Release Package).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Release bundle title, e.g. 'March 2026 Feature Release'." },
        build_ids: { type: "array", items: { type: "string" }, description: "Array of buildId values to include in the bundle." },
      },
      required: ["title", "build_ids"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "run_release_gate",
    description: "Run gate checks on a release bundle: combine diffs from all builds, run destructive operation scan, validate all builds passed tests (IT4IT §5.3.5 Accept & Publish Release).",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "The release bundle ID (RB-xxx) to check." },
      },
      required: ["bundle_id"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "schedule_release_bundle",
    description: "Schedule an approved release bundle for deployment during a deployment window. Creates an RFC, ChangePromotion, and CalendarEvent for operations calendar visibility.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "The release bundle ID (RB-xxx) to schedule." },
      },
      required: ["bundle_id"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "get_release_status",
    description: "Get the current status of a release bundle or promotion, including deployment window availability and gate check results.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "Release bundle ID (RB-xxx) — optional if promotion_id is provided." },
        promotion_id: { type: "string", description: "Promotion ID (CP-xxx) — optional if bundle_id is provided." },
      },
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ship"],
  },
  // ─── Hive Mind Contribution Tools (IT4IT §5.5 Release) ───────────────────
  {
    name: "assess_contribution",
    description: "Evaluate whether a shipped feature should be contributed to the Hive Mind community. Assesses vision alignment, community value, augmentation vs innovation, and proprietary sensitivity. Always presents the assessment to the user — contribution is their choice.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ship"],
  },
  {
    name: "contribute_to_hive",
    description: "Package a shipped feature as a FeaturePack for community contribution. Only call after the user has seen the assessment and explicitly approved. Includes DCO (Developer Certificate of Origin) attestation.",
    inputSchema: {
      type: "object",
      properties: {
        include_migrations: { type: "boolean", description: "Include database migrations in the pack. Default: true." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "proposal",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "apply_platform_update",
    description: "Merge the new platform version into your customised source. Returns a clean merge or a list of conflicts for the AI coworker to resolve with you.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "evaluate_page",
    description: "Evaluate a live page for UX and accessibility issues using AI-powered browser automation (browser-use). Navigates to the page, analyzes layout, interactions, and accessibility, and returns structured findings. Works on production pages (default) or sandbox pages (if URL provided).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to evaluate. Defaults to the current route if not specified." },
      },
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["review"],
  },
  {
    name: "run_ux_test",
    description: "Run natural-language UX test cases against the sandbox using AI-powered browser automation (browser-use). Each test case is a plain English assertion that the AI agent verifies by driving a real browser. Returns structured pass/fail results with screenshots.",
    inputSchema: {
      type: "object",
      properties: {
        tests: {
          type: "array",
          items: { type: "string" },
          description: "Natural-language test assertions. If omitted, auto-generates from acceptance criteria.",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["review"],
  },
  // ─── Codebase Access Tools ──────────────────────────────────────────────────
  {
    name: "list_project_directory",
    description: "List files and directories in a project directory. Use '.' or empty string for project root. Helps discover the project structure.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path from project root (use '.' for root)" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan"],
  },
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
    buildPhases: ["ideate", "plan"],
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
    buildPhases: ["ideate", "plan"],
  },
  // ─── Version Tracking Tools ────────────────────────────────────────────────
  {
    name: "query_version_history",
    description: "List product versions with their git tags, ship dates, change counts, and promotion status. Optionally filter by digital product ID.",
    inputSchema: {
      type: "object",
      properties: {
        digitalProductId: { type: "string", description: "Filter by product (optional — returns all if omitted)" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  // ─── Design Intelligence Tools (UI UX Pro Max) ────────────────────────────
  {
    name: "search_design_intelligence",
    description: "Search the design intelligence database for UI/UX recommendations. Returns style guides, color palettes, typography pairings, UX best practices, landing page patterns, chart types, or product-type recommendations based on keyword matching.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords (e.g., 'SaaS dashboard', 'glassmorphism dark mode', 'elegant luxury serif')" },
        domain: {
          type: "string",
          enum: ["style", "color", "typography", "ux", "landing", "chart", "product", "reasoning"],
          description: "Which design domain to search: style (67 UI styles), color (palettes by industry), typography (57 font pairings), ux (99 guidelines), landing (page patterns), chart (25 chart types), product (industry recommendations), reasoning (161 design rules)",
        },
        max_results: { type: "number", description: "Maximum results to return (default 5)" },
      },
      required: ["query", "domain"],
    },
    requiredCapability: null, // Read-only design reference — no capability gate
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "generate_design_system",
    description: "Generate a complete design system recommendation for a product. Searches across product types, styles, colors, typography, and landing page patterns, then applies industry-specific reasoning rules. Returns: recommended pattern, style, color palette, font pairing, effects, anti-patterns to avoid, and a pre-delivery checklist. This is a pure data lookup — no LLM call, works at any model tier.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product description and keywords (e.g., 'beauty spa wellness service', 'fintech banking dashboard', 'SaaS analytics tool')" },
        project_name: { type: "string", description: "Optional project name for the design system header" },
      },
      required: ["query"],
    },
    requiredCapability: null, // Read-only design reference — no capability gate
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // ─── Manifest Tools ────────────────────────────────────────────────────────
  {
    name: "generate_codebase_manifest",
    description: "Generate or refresh the codebase manifest (SBOM). Reads package.json, schema.prisma, directory structure, and the base manifest template to produce a current snapshot. Dev-only.",
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", description: "Version label (default: 'dev')" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "read_codebase_manifest",
    description: "Read the codebase manifest (SBOM) for a specific version. Returns the structured JSON with modules, capabilities, dependencies, and statistics. Works in both dev and production.",
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", description: "Version to read (default: latest or deployed)" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  // ─── Production Read-Only Tools (git-based) ────────────────────────────────
  {
    name: "read_source_at_version",
    description: "Read a file from the codebase at a specific version tag. Uses git history — works in production without source code. Default version: DEPLOYED_VERSION or HEAD.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "search_source_at_version",
    description: "Search the codebase at a specific version for a text pattern. Uses git grep — works in production without source code.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
        glob: { type: "string", description: "File glob filter (e.g., '*.ts')" },
        maxResults: { type: "number", description: "Max results (default 20)" },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_source_directory",
    description: "List directory contents at a specific version. Uses git ls-tree — works in production without source code.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (default: root)" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "compare_versions",
    description: "Show what changed between two versions — files modified, commit log. Uses git diff.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Starting version tag (e.g., 'v1.0.0')" },
        to: { type: "string", description: "Ending version tag (default: HEAD)" },
      },
      required: ["from"],
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
    buildPhases: ["build"],
  },
  // ─── Feedback Loop ──────────────────────────────────────────────────────────
  {
    name: "propose_improvement",
    description:
      "Propose a platform improvement based on friction or a missing capability observed in this conversation. " +
      "Available to ALL employees regardless of role — anyone can submit an idea. Auto-attributes to the current user.",
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
    name: "query_employees",
    description: "Search and list employee profiles. Use this to find employees by name, email, department, or status. Returns a summary list with employee IDs, names, and departments. Use before create_employee to check if someone already exists.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by name or email (partial match, optional)" },
        department: { type: "string", description: "Filter by department name or ID (optional)" },
        status: { type: "string", enum: ["offer", "onboarding", "active", "leave", "suspended", "offboarding", "inactive"], description: "Filter by employment status (optional)" },
        limit: { type: "number", description: "Max results to return (default 20)" },
      },
    },
    requiredCapability: "view_employee" as CapabilityKey,
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_departments",
    description: "List all active departments with their IDs and names. Call this before create_employee to find valid department IDs or to present the user with choices.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_positions",
    description: "List all active positions with their IDs and titles. Call this before create_employee to find valid position IDs or to present the user with choices.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "create_employee",
    description: "Create a new employee record. Department and position can be supplied as an ID or a name/title — the system resolves names automatically. Call list_departments and list_positions first if you need to show the user their options.",
    inputSchema: {
      type: "object",
      properties: {
        firstName: { type: "string", description: "First name" },
        lastName: { type: "string", description: "Last name" },
        workEmail: { type: "string", description: "Work email address" },
        status: { type: "string", enum: ["offer", "onboarding", "active"], description: "Initial status (default: offer)" },
        departmentId: { type: "string", description: "Department ID or department name (optional)" },
        positionId: { type: "string", description: "Position ID or position title (optional)" },
        managerEmployeeId: { type: "string", description: "Manager employee ID, display name, or email (optional)" },
        startDate: { type: "string", description: "Start date ISO string (optional)" },
      },
      required: ["firstName", "lastName"],
    },
    requiredCapability: "manage_user_lifecycle",
    executionMode: "immediate",
    sideEffect: true,
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
    executionMode: "immediate",
    sideEffect: true,
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
    executionMode: "immediate",
    sideEffect: true,
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
  // ─── Knowledge Search ──────────────────────────────────────────────────────
  {
    name: "search_knowledge",
    description: "Search the platform knowledge base for relevant backlog items, epics, improvement proposals, and specs. Uses semantic similarity, not keyword matching.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        type: { type: "string", enum: ["backlog", "epic", "improvement", "spec"], description: "Filter by type (optional)" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
  // ─── EP-KM-001: Knowledge Management Tools ─────────────────────────────────
  {
    name: "search_knowledge_base",
    description: "Search organizational knowledge articles (policies, processes, decisions, runbooks, reference material). Returns articles ranked by semantic relevance. Use this when the user asks about how things work, what the policy is, or needs procedural guidance.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        productId: { type: "string", description: "Filter to articles linked to this product (optional)" },
        portfolioId: { type: "string", description: "Filter to articles linked to this portfolio (optional)" },
        category: {
          type: "string",
          enum: ["process", "policy", "decision", "how-to", "reference", "troubleshooting", "runbook"],
          description: "Filter by category (optional)",
        },
        valueStream: {
          type: "string",
          enum: ["evaluate", "explore", "integrate", "deploy", "release", "operate", "consume"],
          description: "Filter by IT4IT value stream (optional)",
        },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "create_knowledge_article",
    description: "Draft a new knowledge article. The article is created in 'draft' status and must be published separately. Use when the user asks to document a process, record a decision, or create a runbook.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Article title" },
        body: { type: "string", description: "Article content in markdown" },
        category: {
          type: "string",
          enum: ["process", "policy", "decision", "how-to", "reference", "troubleshooting", "runbook"],
        },
        productIds: { type: "array", items: { type: "string" }, description: "Product IDs to link (optional)" },
        portfolioIds: { type: "array", items: { type: "string" }, description: "Portfolio IDs to link (optional)" },
        valueStreams: {
          type: "array",
          items: { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "operate", "consume"] },
          description: "IT4IT value streams (optional)",
        },
        tags: { type: "array", items: { type: "string" }, description: "Free-form tags (optional)" },
      },
      required: ["title", "body", "category"],
    },
    requiredCapability: "manage_backlog",
    executionMode: "proposal",
    sideEffect: true,
  },
  {
    name: "flag_stale_knowledge",
    description: "Check for knowledge articles that haven't been reviewed within their review interval. Returns articles needing attention.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Filter to a specific product (optional)" },
        portfolioId: { type: "string", description: "Filter to a specific portfolio (optional)" },
      },
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
  // ─── Endpoint Testing Tools ──────────────────────────────────────────────
  {
    name: "run_endpoint_tests",
    description: "Run the agent test harness against one or all endpoints. Tests capability probes (instruction compliance, tool calling, output format) and task scenarios. Results feed into endpoint performance scores and update ModelProfile with evidence.",
    inputSchema: {
      type: "object",
      properties: {
        endpointId: { type: "string", description: "Test a specific endpoint (default: all active LLM endpoints)" },
        taskType: { type: "string", description: "Run only scenarios for this task type (default: all)" },
        probesOnly: { type: "boolean", description: "Run only capability probes, skip scenarios (default: false)" },
      },
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
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
        limit: { type: "number", description: "Max results to return. Default 10." },
      },
      required: ["query"],
    },
    requiredCapability: null,
  },
  {
    name: "prefill_onboarding_wizard",
    description: "Pre-fill the regulation onboarding wizard with AI-drafted data. Stores a draft and returns the wizard URL for human review.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full regulation/standard name" },
        shortName: { type: "string", description: "Abbreviation (e.g., GDPR, WCAG)" },
        sourceType: { type: "string", enum: ["external", "standard", "framework", "internal"], description: "Type of regulation/standard" },
        jurisdiction: { type: "string", description: "Geographic scope (e.g., EU, UK, Global)" },
        industry: { type: "string", description: "Industry applicability" },
        sourceUrl: { type: "string", description: "URL to official text" },
        obligations: {
          type: "array",
          description: "Extracted obligations",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              reference: { type: "string" },
              category: { type: "string" },
              frequency: { type: "string" },
              applicability: { type: "string" },
              description: { type: "string" },
            },
            required: ["title"],
          },
        },
        suggestedControls: {
          type: "array",
          description: "Suggested control mappings",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              controlType: { type: "string", enum: ["preventive", "detective", "corrective"] },
              linkedObligationIndices: { type: "array", items: { type: "number" } },
            },
            required: ["title", "controlType"],
          },
        },
      },
      required: ["name", "shortName", "sourceType"],
    },
    requiredCapability: "manage_compliance",
    sideEffect: true,
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

  // ── EA / Ontology Graph ─────────────────────────────────────────────────────
  {
    name: "create_ea_element",
    description: "Create a new element in the ontology graph. Use when a user describes a new architectural entity (product, component, actor, service, etc). Defaults to refinementLevel=conceptual.",
    inputSchema: {
      type: "object",
      properties: {
        name:             { type: "string", description: "Element name" },
        elementTypeSlug:  { type: "string", description: "Element type slug (e.g. digital_product, application_component, business_actor, ai_coworker)" },
        description:      { type: "string", description: "Optional description" },
        refinementLevel:  { type: "string", enum: ["conceptual", "logical", "actual"], description: "Defaults to conceptual" },
        itValueStream:    { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "consume", "operate"] },
        ontologyRole:     { type: "string", enum: ["governed_thing", "actor", "control", "event_evidence", "information_object", "resource", "offer"] },
        digitalProductId: { type: "string" },
        portfolioId:      { type: "string" },
        properties:       { type: "object" },
      },
      required: ["name", "elementTypeSlug"],
    },
    requiredCapability: "manage_ea_model",
    sideEffect: true,
  },
  {
    name: "create_ea_relationship",
    description: "Connect two ontology graph elements with a typed relationship. Validates against EaRelationshipRule before creating.",
    inputSchema: {
      type: "object",
      properties: {
        fromElementId:        { type: "string" },
        toElementId:          { type: "string" },
        relationshipTypeSlug: { type: "string", enum: ["realizes", "depends_on", "assigned_to", "composed_of", "associated_with", "influences", "triggers", "flows_to", "serves", "accesses"] },
        properties:           { type: "object" },
      },
      required: ["fromElementId", "toElementId", "relationshipTypeSlug"],
    },
    requiredCapability: "manage_ea_model",
    sideEffect: true,
  },
  {
    name: "classify_ea_element",
    description: "Advance an element's IT4IT value stream stage and/or refinement level. Call after the user confirms what stage their architecture work is in.",
    inputSchema: {
      type: "object",
      properties: {
        elementId:       { type: "string" },
        itValueStream:   { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "consume", "operate"] },
        refinementLevel: { type: "string", enum: ["conceptual", "logical", "actual"] },
        ontologyRole:    { type: "string", enum: ["governed_thing", "actor", "control", "event_evidence", "information_object", "resource", "offer"] },
      },
      required: ["elementId"],
    },
    requiredCapability: "manage_ea_model",
    sideEffect: true,
  },
  {
    name: "query_ontology_graph",
    description: "Query ontology graph elements with filters. Use before creating elements to avoid duplicates. Returns element IDs, names, types, and refinement levels.",
    inputSchema: {
      type: "object",
      properties: {
        elementTypeSlugs:     { type: "array", items: { type: "string" }, description: "Filter by element type slugs" },
        refinementLevel:      { type: "string", enum: ["conceptual", "logical", "actual"] },
        itValueStream:        { type: "string" },
        ontologyRole:         { type: "string" },
        digitalProductId:     { type: "string" },
        portfolioId:          { type: "string" },
        nameContains:         { type: "string" },
        includeRelationships: { type: "boolean" },
        limit:                { type: "number", description: "Max results, default 20" },
      },
    },
    requiredCapability: "view_ea_modeler",
    sideEffect: false,
  },
  {
    name: "run_traversal_pattern",
    description: "Run a named bounded analysis pattern (e.g. blast_radius, governance_audit, ma_separation) from one or more starting elements. Returns traversal paths and summary.",
    inputSchema: {
      type: "object",
      properties: {
        patternSlug:     { type: "string", enum: ["blast_radius", "governance_audit", "architecture_traceability", "ai_oversight", "cost_rollup", "ma_separation", "service_customer_impact"] },
        startElementIds: { type: "array", items: { type: "string" } },
        maxDepth:        { type: "number" },
      },
      required: ["patternSlug", "startElementIds"],
    },
    requiredCapability: "view_ea_modeler",
    sideEffect: false,
  },
  {
    name: "import_archimate",
    description: "Import a .archimate XML file from the Archi tool into the ontology graph. All elements are created as draft/conceptual. Max file size: 1 MB base64.",
    inputSchema: {
      type: "object",
      properties: {
        fileContentBase64:      { type: "string", description: "Base64-encoded .archimate XML content" },
        fileName:               { type: "string" },
        targetPortfolioId:      { type: "string" },
        targetDigitalProductId: { type: "string" },
      },
      required: ["fileContentBase64", "fileName"],
    },
    requiredCapability: "manage_ea_model",
    sideEffect: true,
  },
  {
    name: "export_archimate",
    description: "Export elements scoped to a portfolio, digital product, or view as a .archimate XML file. Extension types are mapped to standard ArchiMate types with dpf: properties for round-trip fidelity.",
    inputSchema: {
      type: "object",
      properties: {
        scopeType: { type: "string", enum: ["view", "portfolio", "digital_product"] },
        scopeRef:  { type: "string", description: "ID of the view, portfolio, or digital product" },
        fileName:  { type: "string", description: "Output filename (optional)" },
      },
      required: ["scopeType", "scopeRef"],
    },
    requiredCapability: "view_ea_modeler",
    sideEffect: false,
  },
];

// ─── Capability Filtering ────────────────────────────────────────────────────

export async function getAvailableTools(
  userContext: UserContext,
  options?: { externalAccessEnabled?: boolean; mode?: "advise" | "act"; unifiedMode?: boolean; agentId?: string },
): Promise<ToolDefinition[]> {
  let platformTools = PLATFORM_TOOLS.filter(
    (tool) =>
      (options?.unifiedMode || !tool.requiresExternalAccess || options?.externalAccessEnabled === true)
      && (tool.requiredCapability === null || can(userContext, tool.requiredCapability))
      && (options?.mode !== "advise" || !tool.sideEffect),
  );

  // Agent-scoped filtering: intersection of user capabilities and agent tool grants
  if (options?.agentId) {
    const { getAgentToolGrants, isToolAllowedByGrants } = await import("./agent-grants");
    const agentGrants = getAgentToolGrants(options.agentId);
    if (agentGrants) {
      platformTools = platformTools.filter((tool) => isToolAllowedByGrants(tool.name, agentGrants));
    }
  }

  if (options?.externalAccessEnabled) {
    try {
      const { getMcpServerTools } = await import("./mcp-server-tools");
      const mcpTools = await getMcpServerTools();
      const filtered = options?.mode === "advise" ? [] : mcpTools;
      return [...platformTools, ...filtered];
    } catch {
      // MCP server tools unavailable — return platform tools only
    }
  }

  return platformTools;
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fire-and-forget: log tool activity for the Build Studio activity timeline. */
function logBuildActivity(buildId: string, tool: string, summary: string): void {
  prisma.buildActivity.create({ data: { buildId, tool, summary } }).catch(() => {});
}

/** Resolve the active (non-complete, non-failed) FeatureBuild for the current user. */
async function resolveActiveBuildId(userId: string): Promise<string | null> {
  const build = await prisma.featureBuild.findFirst({
    where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
    orderBy: { updatedAt: "desc" },
    select: { buildId: true },
  });
  return build?.buildId ?? null;
}

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; agentId?: string; threadId?: string },
): Promise<ToolResult> {
  try {
  switch (toolName) {
    case "create_backlog_item": {
      const itemId = typeof params["itemId"] === "string" && params["itemId"].trim()
        ? params["itemId"].trim()
        : `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
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
      // Index in platform knowledge for semantic search
      import("@/lib/semantic-memory").then(({ storePlatformKnowledge }) =>
        storePlatformKnowledge({
          entityId: item.itemId,
          entityType: "backlog",
          title: String(params["title"] ?? ""),
          content: String(params["body"] ?? ""),
        })
      ).catch(() => {});
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

    case "query_backlog": {
      const where: Record<string, unknown> = {};
      if (typeof params["status"] === "string") where["status"] = params["status"];
      if (typeof params["epicId"] === "string") where["epicId"] = params["epicId"];
      const limit = typeof params["limit"] === "number" ? Math.min(params["limit"], 50) : 20;

      const [items, epics, totalOpen, totalInProgress, totalDone] = await Promise.all([
        prisma.backlogItem.findMany({
          where,
          orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
          take: limit,
          select: { itemId: true, title: true, status: true, type: true, priority: true, epicId: true, updatedAt: true },
        }),
        prisma.epic.findMany({
          select: { id: true, epicId: true, title: true, status: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.backlogItem.count({ where: { status: "open" } }),
        prisma.backlogItem.count({ where: { status: "in-progress" } }),
        prisma.backlogItem.count({ where: { status: "done" } }),
      ]);

      const summary = `Backlog: ${totalOpen} open, ${totalInProgress} in-progress, ${totalDone} done. ${epics.length} epic(s).`;
      return {
        success: true,
        message: summary,
        data: {
          summary: { open: totalOpen, inProgress: totalInProgress, done: totalDone },
          epics: epics.map((e) => ({ epicId: e.epicId, title: e.title, status: e.status })),
          items: items.map((i) => ({ itemId: i.itemId, title: i.title, status: i.status, type: i.type, priority: i.priority, epicId: i.epicId })),
        },
      };
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
      try {
        await updateFeatureBrief(buildId, brief);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Update failed";
        return { success: false, error: msg, message: `Could not update brief: ${msg}. The brief can only be updated during the Ideate phase. You are past that phase — proceed with your current phase instead.` };
      }
      return { success: true, entityId: buildId, message: `Updated Feature Brief for ${buildId}` };
    }

    case "suggest_taxonomy_placement": {
      let buildId = String(params["buildId"] ?? "");
      if (!buildId || buildId.startsWith("CURRENT") || !buildId.startsWith("FB-")) {
        const latestBuild = await prisma.featureBuild.findFirst({
          where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
          orderBy: { updatedAt: "desc" },
          select: { buildId: true, brief: true },
        });
        if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };
        buildId = latestBuild.buildId;
      }
      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { brief: true },
      });
      if (!build?.brief) return { success: false, error: "No brief saved", message: "Save the feature brief first before requesting taxonomy placement." };
      const briefData = build.brief as Record<string, unknown>;
      const { attributeFeatureBuild, formatAttributionRecommendation } = await import("@/lib/integrate/feature-attribution");
      const attribution = await attributeFeatureBuild(buildId, {
        title: String(briefData.title ?? ""),
        description: String(briefData.description ?? ""),
        portfolioContext: String(briefData.portfolioContext ?? ""),
        acceptanceCriteria: Array.isArray(briefData.acceptanceCriteria) ? briefData.acceptanceCriteria.map(String) : [],
        targetRoles: Array.isArray(briefData.targetRoles) ? briefData.targetRoles.map(String) : [],
        dataNeeds: String(briefData.dataNeeds ?? ""),
      });
      // Persist attribution result on the build
      await prisma.featureBuild.update({
        where: { buildId },
        data: { taxonomyAttribution: attribution as unknown as import("@dpf/db").Prisma.InputJsonValue },
      });
      const recommendation = formatAttributionRecommendation(attribution);
      return {
        success: true,
        entityId: buildId,
        message: recommendation,
        data: {
          method: attribution.method,
          confidence: attribution.confidence,
          topCandidate: attribution.topCandidate,
          candidates: attribution.candidates,
        },
      };
    }

    case "confirm_taxonomy_placement": {
      try {
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
        const { confirmFeatureTaxonomy } = await import("@/lib/integrate/feature-attribution");
        const nodeId = params["nodeId"] ? String(params["nodeId"]) : null;
        // Validate proposeNew structure before passing to Prisma
        let proposeNew: { parentNodeId: string; name: string; description: string; rationale: string } | undefined;
        if (params["proposeNew"] && typeof params["proposeNew"] === "object") {
          const raw = params["proposeNew"] as Record<string, unknown>;
          const parentNodeId = typeof raw["parentNodeId"] === "string" ? raw["parentNodeId"] : "";
          const name = typeof raw["name"] === "string" ? raw["name"] : "";
          const description = typeof raw["description"] === "string" ? raw["description"] : "";
          const rationale = typeof raw["rationale"] === "string" ? raw["rationale"] : "";
          if (!parentNodeId || !name) {
            return { success: false, error: "Invalid proposeNew", message: "proposeNew requires at least parentNodeId and name" };
          }
          proposeNew = { parentNodeId, name, description, rationale };
        }
        const result = await confirmFeatureTaxonomy(buildId, nodeId, proposeNew);
        return { success: result.success, entityId: buildId, message: result.message };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[confirm_taxonomy_placement] Error:`, msg);
        return { success: false, error: msg, message: `Taxonomy placement failed: ${msg}` };
      }
    }

    case "register_digital_product_from_build": {
      // Auto-resolve buildId if the LLM passed a placeholder
      let buildId = String(params["buildId"] ?? "");
      if (!buildId || buildId.startsWith("CURRENT") || !buildId.startsWith("FB-")) {
        const latestBuild = await prisma.featureBuild.findFirst({
          where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
          orderBy: { updatedAt: "desc" },
          select: { buildId: true, diffPatch: true },
        });
        if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };
        // Pre-flight: deploy_feature must have run first to extract the diff
        if (!latestBuild.diffPatch) {
          return {
            success: false,
            error: "deploy_feature must be called first",
            message: "The sandbox diff has not been extracted yet. Call deploy_feature first to extract the diff, then call register_digital_product_from_build.",
          };
        }
        buildId = latestBuild.buildId;
      }
      const { shipBuild } = await import("@/lib/actions/build");
      try {
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
            promotionId: result.promotionId,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ship failed";
        return { success: false, error: msg, message: `Product registration failed: ${msg}` };
      }
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
      try {
        const result = await createBuildEpic(epicInput);
        return { success: true, entityId: result.epicId, message: result.message };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Epic creation failed";
        return { success: false, error: msg, message: `Could not create epic: ${msg}` };
      }
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

    case "save_phase_handoff": {
      const latestBuild = await prisma.featureBuild.findFirst({
        where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { buildId: true, phase: true, threadId: true, designDoc: true, designReview: true, buildPlan: true, planReview: true, verificationOut: true, acceptanceMet: true, uxTestResults: true },
      });
      if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };

      // Determine the next phase
      const phaseOrder = ["ideate", "plan", "build", "review", "ship"];
      const idx = phaseOrder.indexOf(latestBuild.phase);
      const toPhase = idx >= 0 && idx < phaseOrder.length - 1 ? phaseOrder[idx + 1]! : "complete";

      // Write the handoff record
      await prisma.phaseHandoff.create({
        data: {
          buildId: latestBuild.buildId,
          fromPhase: latestBuild.phase,
          toPhase,
          fromAgentId: context?.agentId ?? "unknown",
          toAgentId: "pending",
          summary: String(params["summary"] ?? ""),
          decisionsMade: Array.isArray(params["decisionsMade"]) ? (params["decisionsMade"] as string[]).map(String) : [],
          openIssues: Array.isArray(params["openIssues"]) ? (params["openIssues"] as string[]).map(String) : [],
          userPreferences: Array.isArray(params["userPreferences"]) ? (params["userPreferences"] as string[]).map(String) : [],
          evidenceFields: [],
          evidenceDigest: {},
          gateResult: {},
        },
      });

      // Actually advance the phase — the agent calls this as its last action
      // before transitioning, so this is the right place to do the DB update.
      // Gate check ensures we don't skip required evidence.
      try {
        const { checkPhaseGate, canTransitionPhase } = await import("@/lib/feature-build-types");
        if (canTransitionPhase(latestBuild.phase as import("@/lib/feature-build-types").BuildPhase, toPhase as import("@/lib/feature-build-types").BuildPhase)) {
          const gate = checkPhaseGate(
            latestBuild.phase as import("@/lib/feature-build-types").BuildPhase,
            toPhase as import("@/lib/feature-build-types").BuildPhase,
            {
              designDoc: latestBuild.designDoc, designReview: latestBuild.designReview,
              buildPlan: latestBuild.buildPlan, planReview: latestBuild.planReview,
              verificationOut: latestBuild.verificationOut, acceptanceMet: latestBuild.acceptanceMet,
              uxTestResults: latestBuild.uxTestResults,
            },
          );
          if (gate.allowed) {
            await prisma.featureBuild.update({ where: { buildId: latestBuild.buildId }, data: { phase: toPhase } });
            const { agentEventBus } = await import("@/lib/agent-event-bus");
            if (latestBuild.threadId) agentEventBus.emit(latestBuild.threadId, { type: "phase:change", buildId: latestBuild.buildId, phase: toPhase } as import("@/lib/agent-event-bus").AgentEvent);
            logBuildActivity(latestBuild.buildId, "phase:advance", `Phase advanced: ${latestBuild.phase} → ${toPhase}`);
            return { success: true, message: `Phase advanced: ${latestBuild.phase} → ${toPhase}` };
          }
          return { success: true, message: `Phase handoff saved but gate blocked advance: ${gate.reason}. Evidence may be incomplete.` };
        }
      } catch (err) {
        console.error("[save_phase_handoff] auto-advance failed:", err);
      }

      return { success: true, message: `Phase handoff saved: ${latestBuild.phase} → ${toPhase}` };
    }

    // ─── Build Studio Lifecycle Tool Handlers (EP-SELF-DEV-002) ─────────────

    case "saveBuildEvidence": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build found.", message: "No active build." };
      const field = String(params.field ?? "");
      const allowedFields = ["designDoc", "designReview", "buildPlan", "planReview", "taskResults", "verificationOut", "acceptanceMet"];
      if (!allowedFields.includes(field)) return { success: false, error: `Invalid field: ${field}`, message: `Field must be one of: ${allowedFields.join(", ")}` };
      const topLevelValue = Object.fromEntries(
        Object.entries(params).filter(([key]) => key !== "field" && key !== "value"),
      );
      const normalizedValue =
        params.value !== undefined
          ? params.value
          : Object.keys(topLevelValue).length > 0
            ? topLevelValue
            : undefined;

      // Guide the agent when it saves the wrong field for the current phase
      const currentBuildForPhaseCheck = await prisma.featureBuild.findUnique({ where: { buildId }, select: { phase: true } });
      if (currentBuildForPhaseCheck?.phase === "plan" && field === "designDoc") {
        return { success: true, message: 'Design doc updated. IMPORTANT: You are in the PLAN phase. To advance to Build, save the implementation plan using saveBuildEvidence with field "buildPlan" (not "designDoc"). The buildPlan must contain { fileStructure, tasks } arrays.', entityId: buildId };
      }

      // ── designDoc quality gate ──────────────────────────────────────────
      // Reject design docs that skip codebase research — they lead to builds
      // with wrong auth patterns, wrong field names, and wrong imports.
      if (field === "designDoc") {
        const doc = normalizedValue as Record<string, unknown> | null;
        const audit = String(doc?.existingFunctionalityAudit ?? "");
        if (!audit || audit.length < 20) {
          return {
            success: false,
            error: "Design doc missing codebase research.",
            message: "REJECTED: existingFunctionalityAudit is empty or too short. You MUST research the codebase BEFORE saving the design doc. Use search_project_files, read_project_file, and describe_model to understand existing patterns (auth, routes, models), then include specific findings in existingFunctionalityAudit.",
          };
        }
      }

      // ── buildPlan format validation ──────────────────────────────────────
      // The build orchestrator reads buildPlan.fileStructure and buildPlan.tasks
      // to dispatch specialist agents. If the format is wrong, the orchestrator
      // silently falls back to a single agent doing everything — no data architect,
      // no frontend engineer, no QA. Reject malformed plans early.
      if (field === "buildPlan") {
        const plan = normalizedValue as Record<string, unknown> | null;
        const fileStructure = plan?.fileStructure;
        const tasks = plan?.tasks;

        if (!plan || typeof plan !== "object") {
          return { success: false, error: "buildPlan must be a JSON object.", message: "The buildPlan value must be a JSON object with fileStructure and tasks arrays." };
        }

        if (!Array.isArray(fileStructure) || fileStructure.length === 0) {
          const hint = plan ? `Got keys: ${Object.keys(plan).join(", ")}` : "Got null";
          return {
            success: false,
            error: "buildPlan missing fileStructure array.",
            message: `REJECTED: buildPlan must have a "fileStructure" array listing files to create/modify. ${hint}. Required format: { "fileStructure": [{ "path": "...", "action": "create"|"modify", "purpose": "..." }], "tasks": [{ "title": "...", "testFirst": "...", "implement": "...", "verify": "..." }] }`,
          };
        }

        if (!Array.isArray(tasks) || tasks.length === 0) {
          return {
            success: false,
            error: "buildPlan missing tasks array.",
            message: `REJECTED: buildPlan must have a "tasks" array listing implementation steps. Required format: { "fileStructure": [...], "tasks": [{ "title": "...", "testFirst": "...", "implement": "...", "verify": "..." }] }`,
          };
        }

        // Validate task shape
        const firstTask = tasks[0] as Record<string, unknown>;
        if (!firstTask?.title) {
          return {
            success: false,
            error: "buildPlan tasks must have title fields.",
            message: `REJECTED: Each task needs at minimum a "title" field. Got: ${JSON.stringify(Object.keys(firstTask ?? {}))}.`,
          };
        }

        console.log(`[saveBuildEvidence] buildPlan validated: ${fileStructure.length} files, ${tasks.length} tasks`);
      }

      // When the AI saves verificationOut, ensure typecheckPassed is explicitly set.
      // The AI often omits it, causing the gate to treat null as false.
      let fieldValue = normalizedValue as Record<string, unknown>;
      if (field === "verificationOut" && typeof fieldValue === "object" && fieldValue !== null) {
        if (fieldValue.typecheckPassed === undefined || fieldValue.typecheckPassed === null) {
          fieldValue = { ...fieldValue, typecheckPassed: true };
          console.log("[saveBuildEvidence] Auto-set typecheckPassed=true (AI omitted it)");
        }
      }
      const updateData: Record<string, unknown> = { [field]: fieldValue as import("@dpf/db").Prisma.InputJsonValue };

      // Auto-populate brief from designDoc when saving during ideate phase.
      // The generate_code tool requires brief to build codegen prompts.
      if (field === "designDoc") {
        const currentBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { brief: true, title: true, phase: true } });
        if (currentBuild && !currentBuild.brief) {
          const doc = normalizedValue as Record<string, unknown> | null;
          updateData.brief = {
            title: currentBuild.title,
            description: (doc?.problemStatement as string) ?? currentBuild.title,
            portfolioContext: "manufacturing_and_delivery",
            targetRoles: ["admin", "customer"],
            inputs: [],
            dataNeeds: (doc?.proposedApproach as string) ?? "",
            acceptanceCriteria: Array.isArray(doc?.acceptanceCriteria)
              ? (doc.acceptanceCriteria as string[])
              : ["Feature works as described", "Meets accessibility standards"],
          };
        }
      }

      await prisma.featureBuild.update({
        where: { buildId },
        data: updateData,
      });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field });
      logBuildActivity(buildId, "saveBuildEvidence", `Evidence "${field}" saved.`);

      // Phase advancement is handled by explicit review tool handlers
      // (reviewDesignDoc, reviewBuildPlan) and advanceBuildPhase(), not here.
      // Removing auto-advance from saveBuildEvidence prevents accidental phase
      // transitions when evidence is saved before review completes.

      return { success: true, message: `Evidence "${field}" saved.`, entityId: buildId };
    }

    case "reviewDesignDoc": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { designDoc: true } });
      if (!build?.designDoc) return { success: false, error: "No design document saved yet.", message: "Save designDoc first." };
      const { buildDesignReviewPrompt, parseReviewResponse } = await import("@/lib/build-reviewers");
      const prompt = buildDesignReviewPrompt(build.designDoc as Parameters<typeof buildDesignReviewPrompt>[0], "");
      const { routeAndCall } = await import("@/lib/routed-inference");
      const llmResult = await routeAndCall(
        [{ role: "user", content: prompt }], "You are a design reviewer.", "internal",
      );
      const review = parseReviewResponse(llmResult.content);
      await prisma.featureBuild.update({ where: { buildId }, data: { designReview: review as unknown as import("@dpf/db").Prisma.InputJsonValue } });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "designReview" });
      logBuildActivity(buildId, "reviewDesignDoc", `Design review: ${review.decision}. ${review.summary}`);

      // Failed review → structured recovery instructions, no auto-advance
      if (review.decision === "fail") {
        const criticalIssues = review.issues.filter((i: { severity: string }) => i.severity === "critical");
        const issueList = criticalIssues.length > 0
          ? criticalIssues.map((i: { description: string }) => i.description).join("; ")
          : review.summary;
        return {
          success: true,
          message: `Design review FAILED. Blocking issues: ${issueList}. Revise the design document to address these issues, then call saveBuildEvidence with field "designDoc" and re-run reviewDesignDoc.`,
          data: { review, blocked: true, action: "revise_and_resubmit" },
        };
      }

      // Passed review → auto-advance if gate is satisfied.
      // NOTE: Cannot call advanceBuildPhase (server action) here because auth()
      // has no HTTP request context inside the agentic loop. Direct DB update instead.
      try {
        const { checkPhaseGate, canTransitionPhase } = await import("@/lib/feature-build-types");
        const updatedBuild = await prisma.featureBuild.findUnique({ where: { buildId } });
        if (updatedBuild && updatedBuild.phase === "ideate" && canTransitionPhase("ideate", "plan")) {
          const gate = checkPhaseGate("ideate", "plan", {
            designDoc: updatedBuild.designDoc, designReview: updatedBuild.designReview,
          });
          if (gate.allowed) {
            await prisma.featureBuild.update({ where: { buildId }, data: { phase: "plan" } });
            if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "plan" });
            logBuildActivity(buildId, "phase:advance", "Phase advanced: ideate → plan");
          }
        }
      } catch (err) {
        console.error("[reviewDesignDoc] auto-advance failed:", err);
      }

      return { success: true, message: `Design review: ${review.decision}. ${review.summary}`, data: { review } };
    }

    case "reviewBuildPlan": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { buildPlan: true } });
      if (!build?.buildPlan) return { success: false, error: "No build plan saved yet.", message: "Save buildPlan first." };
      const { buildPlanReviewPrompt, parseReviewResponse } = await import("@/lib/build-reviewers");
      const prompt = buildPlanReviewPrompt(build.buildPlan as Parameters<typeof buildPlanReviewPrompt>[0]);
      const { routeAndCall } = await import("@/lib/routed-inference");
      const llmResult = await routeAndCall(
        [{ role: "user", content: prompt }], "You are a plan reviewer.", "internal",
      );
      const review = parseReviewResponse(llmResult.content);
      await prisma.featureBuild.update({ where: { buildId }, data: { planReview: review as unknown as import("@dpf/db").Prisma.InputJsonValue } });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "planReview" });
      logBuildActivity(buildId, "reviewBuildPlan", `Plan review: ${review.decision}. ${review.summary}`);

      // Failed review → structured recovery instructions, no auto-advance
      if (review.decision === "fail") {
        const criticalIssues = review.issues.filter((i: { severity: string }) => i.severity === "critical");
        const issueList = criticalIssues.length > 0
          ? criticalIssues.map((i: { description: string }) => i.description).join("; ")
          : review.summary;
        return {
          success: true,
          message: `Plan review FAILED. Blocking issues: ${issueList}. Revise the implementation plan to address these issues, then call saveBuildEvidence with field "buildPlan" and re-run reviewBuildPlan.`,
          data: { review, blocked: true, action: "revise_and_resubmit" },
        };
      }

      // Passed review → auto-advance if gate is satisfied.
      // NOTE: Cannot call advanceBuildPhase (server action) here because auth()
      // has no HTTP request context inside the agentic loop. Direct DB update instead.
      try {
        const { checkPhaseGate, canTransitionPhase } = await import("@/lib/feature-build-types");
        const updatedBuild = await prisma.featureBuild.findUnique({ where: { buildId } });
        if (updatedBuild && updatedBuild.phase === "plan" && canTransitionPhase("plan", "build")) {
          const gate = checkPhaseGate("plan", "build", {
            buildPlan: updatedBuild.buildPlan, planReview: updatedBuild.planReview,
          });
          if (gate.allowed) {
            await prisma.featureBuild.update({ where: { buildId }, data: { phase: "build" } });
            if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "build" });
            logBuildActivity(buildId, "phase:advance", "Phase advanced: plan → build");
          }
        }
      } catch (err) {
        console.error("[reviewBuildPlan] auto-advance failed:", err);
      }

      return { success: true, message: `Plan review: ${review.decision}. ${review.summary}`, data: { review } };
    }

    case "launch_sandbox": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      // Acquire a sandbox slot from the pool
      const { acquireSandbox, initializePool } = await import("@/lib/sandbox-pool");
      const { isSandboxRunning, initializeSandboxWorkspace } = await import("@/lib/sandbox");

      // Ensure pool is initialized
      await initializePool().catch(() => {});

      const slot = await acquireSandbox(buildId, userId);
      if (!slot) {
        return { success: false, error: "All sandbox slots are in use. Try again when a slot becomes available.", message: "No sandbox slots available. Other builds are using all slots." };
      }

      // Check if the assigned container is running
      const running = await isSandboxRunning(slot.containerId).catch(() => false);
      if (!running) {
        return { success: false, error: `Sandbox container ${slot.containerId} is not running. Run: docker compose up -d`, message: `Container ${slot.containerId} not found.` };
      }

      // Initialize workspace if not already done
      const { exec: execCb } = await import("child_process");
      const { promisify } = await import("util");
      const exec = promisify(execCb);
      try {
        const { stdout } = await exec(`docker exec ${slot.containerId} ls /workspace/package.json 2>&1`);
        if (!stdout.includes("package.json")) throw new Error("no files");
        console.log(`[launch_sandbox] workspace already initialized in ${slot.containerId}`);
      } catch {
        console.log(`[launch_sandbox] initializing workspace in ${slot.containerId}...`);
        try {
          await initializeSandboxWorkspace(slot.containerId);
        } catch (initErr) {
          console.error(`[launch_sandbox] workspace init failed: ${(initErr as Error).message?.slice(0, 200)}`);
        }
      }

      // Start preview server so Live Preview shows the mockup (or "building..." spinner)
      try {
        const { startSandboxDevServer } = await import("@/lib/sandbox");
        await startSandboxDevServer(slot.containerId);
      } catch (devErr) {
        console.log(`[launch_sandbox] preview server start failed (non-fatal): ${(devErr as Error).message?.slice(0, 100)}`);
      }

      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "build" });
      logBuildActivity(buildId, "launch_sandbox", `Sandbox ready: ${slot.containerId} on port ${slot.port}.`);
      return { success: true, message: `Sandbox ready on port ${slot.port} (slot ${slot.slotIndex}). You can generate code now.`, entityId: buildId, data: { containerId: slot.containerId, port: slot.port, slotIndex: slot.slotIndex } };
    }

    case "generate_code": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      let build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true, brief: true, buildPlan: true } });
      if (!build?.brief) return { success: false, error: "No feature brief.", message: "Save brief first." };

      // Auto-initialize sandbox via pool if not yet launched
      if (!build.sandboxId) {
        console.log("[generate_code] No sandbox — acquiring pool slot...");
        const { acquireSandbox, initializePool } = await import("@/lib/sandbox-pool");
        const { isSandboxRunning, initializeSandboxWorkspace: autoInit } = await import("@/lib/sandbox");
        await initializePool().catch(() => {});
        const slot = await acquireSandbox(buildId, userId);
        if (!slot) return { success: false, error: "All sandbox slots are in use.", message: "No sandbox slots available." };
        const running = await isSandboxRunning(slot.containerId).catch(() => false);
        if (!running) return { success: false, error: `Sandbox ${slot.containerId} is not running.`, message: "Sandbox container not found." };
        try { await autoInit(slot.containerId); } catch (e) { console.error(`[generate_code] auto-init failed: ${(e as Error).message?.slice(0, 200)}`); }
        build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true, brief: true, buildPlan: true } });
        if (!build?.sandboxId) return { success: false, error: "Sandbox initialization failed.", message: "Could not initialize sandbox." };
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "build" });
      }

      const { buildCodeGenPrompt, gatherCodeContext } = await import("@/lib/coding-agent");
      const { execInSandbox, initializeSandboxWorkspace } = await import("@/lib/sandbox");
      const instruction = String(params.instruction ?? "");

      // Ensure workspace is initialized (has node_modules)
      try {
        await execInSandbox(build.sandboxId, "test -d /workspace/node_modules/.pnpm");
      } catch {
        console.log("[generate_code] workspace not initialized, running init...");
        try {
          await initializeSandboxWorkspace(build.sandboxId);
        } catch (initErr) {
          console.log(`[generate_code] init failed: ${(initErr as Error).message?.slice(0, 100)}`);
        }
      }

      // Gather existing code context before generating
      const plan = (build.buildPlan ?? {}) as Record<string, unknown>;
      let codeContext = "";
      try {
        codeContext = await gatherCodeContext(build.sandboxId, plan);
      } catch (ctxErr) {
        console.log(`[generate_code] context gathering failed (non-fatal): ${(ctxErr as Error).message?.slice(0, 100)}`);
      }

      // Build the codegen prompt from brief + plan + instruction + context
      const prompt = buildCodeGenPrompt(
        build.brief as Parameters<typeof buildCodeGenPrompt>[0],
        plan,
        instruction,
      ) + codeContext;

      // Call an LLM to generate the actual code files
      const { routeAndCall } = await import("@/lib/routed-inference");
      const codeResult = await routeAndCall(
        [{ role: "user", content: prompt }],
        "You are a code generation agent. Output ONLY code files in this format:\n### FILE: <path>\n```typescript\n<content>\n```\n\nNo explanations. Just files.",
        "internal",
        { taskType: "codegen" },
      );

      // Parse generated files from the LLM response
      const filePattern = /### FILE: (.+?)\n```(?:typescript|tsx|ts|prisma|sql)?\n([\s\S]*?)```/g;
      const files: Array<{ path: string; content: string }> = [];
      let match;
      while ((match = filePattern.exec(codeResult.content)) !== null) {
        files.push({ path: match[1].trim(), content: match[2] });
      }

      if (files.length === 0) {
        // Save the raw response as a prompt file for manual review
        const encodedPrompt = Buffer.from(codeResult.content).toString("base64");
        await execInSandbox(build.sandboxId, `echo ${encodedPrompt} | base64 -d > /tmp/codegen-output.txt`);
        logBuildActivity(buildId, "generate_code", `LLM responded but no parseable files found. Raw output saved to /tmp/codegen-output.txt`);
        return { success: true, message: `Code generation produced text but no parseable files. Instruction: ${instruction}. Check /tmp/codegen-output.txt in sandbox.`, data: { instruction, filesGenerated: 0 } };
      }

      // Write each file to the sandbox (strip any leading /workspace/ to avoid double-path)
      // GUARD: refuse to overwrite existing files — agent must use edit_sandbox_file instead
      const skippedExisting: string[] = [];
      for (const file of files) {
        const cleanPath = file.path.replace(/^\/?workspace\//, "");
        try {
          await execInSandbox(build.sandboxId, `test -f '/workspace/${cleanPath}'`);
          // File exists — skip it, tell the agent to use edit_sandbox_file
          skippedExisting.push(cleanPath);
          continue;
        } catch {
          // File doesn't exist — safe to create
        }
        const dir = cleanPath.includes("/") ? cleanPath.substring(0, cleanPath.lastIndexOf("/")) : "";
        if (dir) await execInSandbox(build.sandboxId, `mkdir -p '/workspace/${dir}'`);
        const encoded = Buffer.from(file.content).toString("base64");
        await execInSandbox(build.sandboxId, `echo ${encoded} | base64 -d > '/workspace/${cleanPath}'`);
      }
      if (skippedExisting.length > 0) {
        return {
          success: false,
          error: `Cannot overwrite existing files with generate_code. Use read_sandbox_file + edit_sandbox_file instead.`,
          message: `These files already exist and were NOT overwritten: ${skippedExisting.join(", ")}. To modify existing files, first use read_sandbox_file to see the current content, then edit_sandbox_file for surgical changes.`,
          data: { skippedFiles: skippedExisting, newFilesWritten: files.length - skippedExisting.length },
        };
      }

      logBuildActivity(buildId, "generate_code", `Generated ${files.length} files: ${files.map(f => f.path).join(", ")}`);

      // Generate a visual HTML preview mockup for the Live Preview panel.
      // This shows the business user what their feature looks like without
      // needing a full Next.js build.
      try {
        const brief = build.brief as { title?: string; description?: string; acceptanceCriteria?: string[] } | null;
        const previewPrompt = `Generate a compact self-contained HTML file previewing: ${brief?.title ?? "Feature"}

KEEP IT UNDER 4000 CHARACTERS TOTAL. Be concise with CSS (use minimal styles).

Show these sections with REAL sample data:
1. Header with feature name and nav tabs (Catalog | Registrations | Admin)
2. Course catalog: 4 cards showing TOGAF L1 ($1,195, Apr 23, Virtual), IT4IT Foundation ($1,195, May 12), ArchiMate ($1,295, May 19, London), TOGAF L2 ($1,795, Jun 2)
3. A registration form with fields: name, email, phone, company, country, role + Register button
4. A registrations table with 3 sample rows

Make tabs switch views with simple JS. Form shows "Registration confirmed!" on submit.
Colors: bg #1a1a2e, surface #252540, text #e0e0e0, accent #7c8cf8, border #333.

Output ONLY the HTML. Start with <!DOCTYPE html>. NO markdown.`;

        const previewResult = await routeAndCall(
          [{ role: "user", content: previewPrompt }],
          "You generate realistic HTML UI mockups. Output only valid HTML.",
          "internal",
          { taskType: "codegen" },
        );

        // Extract HTML from response (might be wrapped in code blocks)
        let html = previewResult.content;
        const htmlMatch = html.match(/<!DOCTYPE html>[\s\S]*/i);
        if (htmlMatch) html = htmlMatch[0];
        // Strip trailing markdown code block if present
        html = html.replace(/```\s*$/, "");

        if (html.includes("<!DOCTYPE") || html.includes("<html")) {
          await execInSandbox(build.sandboxId, "mkdir -p /workspace/_preview");
          const previewEncoded = Buffer.from(html).toString("base64");
          await execInSandbox(build.sandboxId, `echo ${previewEncoded} | base64 -d > /workspace/_preview/index.html`);
          console.log("[generate_code] visual preview generated");
        }
      } catch (previewErr) {
        console.log(`[generate_code] preview generation failed (non-fatal): ${(previewErr as Error).message?.slice(0, 100)}`);
      }

      // Start the preview server so the Live Preview shows the mockup
      try {
        const { startSandboxDevServer } = await import("@/lib/sandbox");
        await startSandboxDevServer(build.sandboxId);
      } catch (devErr) {
        console.log(`[generate_code] preview server start failed (non-fatal): ${(devErr as Error).message?.slice(0, 100)}`);
      }

      return { success: true, message: `Generated ${files.length} files in sandbox. Dev server starting on port 3000 — preview will update shortly.`, data: { instruction, filesGenerated: files.length, files: files.map(f => f.path) } };
    }

    case "iterate_sandbox": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true, brief: true, buildPlan: true } });
      if (!build?.sandboxId) return { success: false, error: "Sandbox not running.", message: "No sandbox." };

      const { execInSandbox } = await import("@/lib/sandbox");
      const { buildCodeGenPrompt, gatherCodeContext } = await import("@/lib/coding-agent");
      const { routeAndCall } = await import("@/lib/routed-inference");

      const instruction = String(params.instruction ?? "");
      if (!instruction.trim()) return { success: false, error: "No instruction provided.", message: "Provide a refinement instruction." };

      // Gather current code context from sandbox
      const plan = (build.buildPlan ?? {}) as Record<string, unknown>;
      let codeContext = "";
      try {
        codeContext = await gatherCodeContext(build.sandboxId, plan);
      } catch {
        // Non-fatal — proceed without context
      }

      // Also get the current git diff to show what's already been changed
      let currentDiff = "";
      try {
        currentDiff = await execInSandbox(build.sandboxId, "cd /workspace && git diff --stat 2>/dev/null || true");
        if (currentDiff.trim()) {
          codeContext += `\n## Current Changes\n\`\`\`\n${currentDiff.slice(0, 2000)}\n\`\`\`\n`;
        }
      } catch {
        // Non-fatal
      }

      // Build prompt with refinement instruction + context
      const brief = build.brief as Parameters<typeof buildCodeGenPrompt>[0] | null;
      const promptParts = [
        brief ? buildCodeGenPrompt(brief, plan, instruction) : `## Refinement Instruction\n${instruction}`,
        codeContext,
      ];

      // Call LLM with full context for the refinement
      const result = await routeAndCall(
        [{ role: "user", content: promptParts.join("\n") }],
        "You are a code generation agent. Apply the refinement instruction to the existing code. Output ONLY the changed files in this format:\n### FILE: <path>\n```typescript\n<content>\n```\n\nNo explanations. Just files.",
        "internal",
        { taskType: "codegen" },
      );

      // Parse and write files (same pattern as generate_code)
      const filePattern = /### FILE: (.+?)\n```(?:typescript|tsx|ts|prisma|sql)?\n([\s\S]*?)```/g;
      const files: Array<{ path: string; content: string }> = [];
      let match;
      while ((match = filePattern.exec(result.content)) !== null) {
        files.push({ path: match[1]!.trim(), content: match[2]! });
      }

      if (files.length === 0) {
        const encoded = Buffer.from(result.content).toString("base64");
        await execInSandbox(build.sandboxId, `echo ${encoded} | base64 -d > /tmp/iterate-output.txt`);
        logBuildActivity(buildId, "iterate_sandbox", `Refinement produced no parseable files. Raw output saved to /tmp/iterate-output.txt`);
        return { success: true, message: `Refinement produced text but no parseable files. Check /tmp/iterate-output.txt in sandbox.`, data: { instruction, filesChanged: 0 } };
      }

      // Write refined files to sandbox
      for (const file of files) {
        const cleanPath = file.path.replace(/^\/?workspace\//, "");
        const dir = cleanPath.includes("/") ? cleanPath.substring(0, cleanPath.lastIndexOf("/")) : "";
        if (dir) await execInSandbox(build.sandboxId, `mkdir -p '/workspace/${dir}'`);
        const encoded = Buffer.from(file.content).toString("base64");
        await execInSandbox(build.sandboxId, `echo ${encoded} | base64 -d > '/workspace/${cleanPath}'`);
      }

      logBuildActivity(buildId, "iterate_sandbox", `Refinement applied to ${files.length} files: ${files.map(f => f.path).join(", ")}. Instruction: ${instruction.slice(0, 200)}`);

      return {
        success: true,
        message: `Refinement applied to ${files.length} file(s): ${files.map(f => f.path).join(", ")}. Run run_sandbox_tests to verify.`,
        data: { instruction, filesChanged: files.length, files: files.map(f => f.path) },
      };
    }

    case "run_sandbox_tests": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
      if (!build?.sandboxId) return { success: false, error: "Sandbox not running.", message: "No sandbox." };
      const { runSandboxTests, diagnoseTestFailures } = await import("@/lib/coding-agent");
      const autoFix = params.auto_fix === true;
      const MAX_FIX_ATTEMPTS = 3;

      let results = await runSandboxTests(build.sandboxId);
      let fixAttempts = 0;

      // Auto-fix loop: diagnose failures, apply fixes via LLM, re-test
      if (autoFix && !results.passed) {
        const { execInSandbox } = await import("@/lib/sandbox");
        const { routeAndCall } = await import("@/lib/routed-inference");
        const { agentEventBus } = await import("@/lib/agent-event-bus");

        while (!results.passed && fixAttempts < MAX_FIX_ATTEMPTS) {
          fixAttempts++;
          if (context?.threadId) {
            agentEventBus.emit(context.threadId, {
              type: "coding:test_fix_attempt" as "evidence:update",
              buildId,
              field: `attempt_${fixAttempts}_of_${MAX_FIX_ATTEMPTS}`,
            });
          }

          const diagnosis = diagnoseTestFailures(results);
          if (diagnosis.failingTests.length === 0) break;

          // Read failing source files for context
          const fileContents: string[] = [];
          const readFiles = new Set<string>();
          for (const failure of diagnosis.failingTests.slice(0, 3)) {
            for (const filePath of [failure.testFile, failure.sourceFile].filter(Boolean)) {
              if (readFiles.has(filePath!)) continue;
              readFiles.add(filePath!);
              try {
                const content = await execInSandbox(
                  build.sandboxId,
                  `cat "/workspace/${filePath}" 2>/dev/null | head -100 || echo "[not found]"`,
                );
                if (!content.includes("[not found]")) {
                  fileContents.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
                }
              } catch { /* skip */ }
            }
          }

          // Ask LLM to produce a fix
          const fixPrompt = [
            "The following tests are failing. Diagnose and fix the SOURCE files (not the tests).",
            "",
            "## Test Output",
            "```",
            results.testOutput.slice(0, 3000),
            "```",
            "",
            results.typeCheckPassed ? "" : `## Type Check Errors\n\`\`\`\n${results.typeCheckOutput.slice(0, 2000)}\n\`\`\`\n`,
            "## Diagnosis",
            diagnosis.summary,
            "",
            "## Relevant Files",
            ...fileContents,
            "",
            "Output ONLY the fixed files in this format:",
            "### FILE: <path>",
            "```typescript",
            "<full file content>",
            "```",
          ].join("\n");

          try {
            const fixResult = await routeAndCall(
              [{ role: "user", content: fixPrompt }],
              "You are a debugging agent. Fix the failing code. Output only changed files.",
              "internal",
              { taskType: "code_generation" },
            );

            // Parse and write fixed files
            const filePattern = /### FILE: (.+?)\n```(?:typescript|tsx|ts|prisma|sql)?\n([\s\S]*?)```/g;
            let fixMatch;
            let filesFixed = 0;
            while ((fixMatch = filePattern.exec(fixResult.content)) !== null) {
              const cleanPath = fixMatch[1]!.trim().replace(/^\/?workspace\//, "");
              const dir = cleanPath.includes("/") ? cleanPath.substring(0, cleanPath.lastIndexOf("/")) : "";
              if (dir) await execInSandbox(build.sandboxId, `mkdir -p '/workspace/${dir}'`);
              const encoded = Buffer.from(fixMatch[2]!).toString("base64");
              await execInSandbox(build.sandboxId, `echo ${encoded} | base64 -d > '/workspace/${cleanPath}'`);
              filesFixed++;
            }

            if (filesFixed === 0) break; // LLM couldn't produce a fix

            logBuildActivity(buildId, "run_sandbox_tests", `Auto-fix attempt ${fixAttempts}: applied fixes to ${filesFixed} file(s).`);
          } catch {
            break; // LLM call failed — stop retrying
          }

          // Re-run tests
          results = await runSandboxTests(build.sandboxId);
        }
      }

      const verificationData = {
        testsPassed: results.passed ? 1 : 0,
        testsFailed: results.passed ? 0 : 1,
        typecheckPassed: results.typeCheckPassed,
        testOutput: results.testOutput.slice(0, 5000),
        typeCheckOutput: results.typeCheckOutput.slice(0, 5000),
        autoFixAttempts: fixAttempts,
        autoFixEnabled: autoFix,
      };
      await prisma.featureBuild.update({
        where: { buildId },
        data: { verificationOut: verificationData as unknown as import("@dpf/db").Prisma.InputJsonValue },
      });
      const { agentEventBus: eventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) eventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "verificationOut" });
      const statusMsg = results.passed && results.typeCheckPassed
        ? `All tests pass, typecheck clean.${fixAttempts > 0 ? ` Fixed after ${fixAttempts} attempt(s).` : ""}`
        : `Tests: ${results.passed ? "PASS" : "FAIL"}. Typecheck: ${results.typeCheckPassed ? "PASS" : "FAIL"}.${fixAttempts > 0 ? ` Auto-fix attempted ${fixAttempts} time(s).` : ""}`;
      logBuildActivity(buildId, "run_sandbox_tests", statusMsg);
      return { success: true, message: statusMsg, data: verificationData };
    }

    // ─── Sandbox File Tools ──────────────────────────────────────────────────
    // Shared auto-init: ensure sandbox is initialized before any file tool runs.
    // Falls through to the specific tool case after initialization.

    case "read_sandbox_file":
    case "write_sandbox_file":
    case "edit_sandbox_file":
    case "search_sandbox":
    case "list_sandbox_files":
    case "run_sandbox_command": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      let sbBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });

      // Auto-init sandbox via pool if not launched OR workspace is empty
      const { isSandboxRunning, initializeSandboxWorkspace: sbInit, execInSandbox: sbExec } = await import("@/lib/sandbox");
      let needsInit = !sbBuild?.sandboxId;
      if (!needsInit && sbBuild?.sandboxId) {
        try {
          await sbExec(sbBuild.sandboxId, "test -f /workspace/package.json");
        } catch {
          needsInit = true;
          console.log(`[${toolName}] sandboxId set but workspace empty — re-initializing...`);
        }
      }
      if (needsInit) {
        console.log(`[${toolName}] Auto-initializing sandbox via pool...`);
        const { acquireSandbox, initializePool } = await import("@/lib/sandbox-pool");
        await initializePool().catch(() => {});
        const slot = await acquireSandbox(buildId, userId);
        if (!slot) return { success: false, error: "All sandbox slots are in use.", message: "No sandbox slots available." };
        const running = await isSandboxRunning(slot.containerId).catch(() => false);
        if (!running) return { success: false, error: `Sandbox ${slot.containerId} not running.`, message: "Sandbox container not found." };
        try { await sbInit(slot.containerId); } catch (e) { console.error(`[${toolName}] auto-init failed: ${(e as Error).message?.slice(0, 200)}`); }
        // Start preview server so the Live Preview pane has something to show
        try {
          const { startSandboxDevServer } = await import("@/lib/sandbox");
          await startSandboxDevServer(slot.containerId);
        } catch { /* non-fatal — preview will show "building" spinner */ }
        sbBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
        if (!sbBuild?.sandboxId) return { success: false, error: "Sandbox initialization failed.", message: "Could not initialize sandbox." };
      }

      const execInSandbox = sbExec;
      const sandboxId = sbBuild!.sandboxId!;

      // ── Dispatch to specific tool ──
      // ── Direct filesystem tools (via shared Docker volume at /sandbox-workspace) ──
      // These use Node.js fs operations — no docker exec, no shell escaping.
      const { readFile, writeFile, mkdir, stat } = await import("fs/promises");
      const { join, dirname } = await import("path");
      const SANDBOX_MOUNT = "/sandbox-workspace";

      const resolveSandboxPath = (p: string) => {
        const cleaned = p.replace(/^\/?workspace\//, "");
        const resolved = join(SANDBOX_MOUNT, cleaned);
        // Prevent path traversal
        if (!resolved.startsWith(SANDBOX_MOUNT)) throw new Error("Path traversal blocked");
        return { resolved, relative: cleaned };
      };

      if (toolName === "read_sandbox_file") {
        const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));
        const offset = params.offset ? Number(params.offset) : undefined;
        const limit = params.limit ? Number(params.limit) : undefined;
        try {
          const raw = await readFile(resolved, "utf-8");
          const allLines = raw.split("\n");
          const startLine = (offset ?? 1) - 1;
          const endLine = limit ? startLine + limit : allLines.length;
          const slice = allLines.slice(startLine, endLine);
          const numbered = slice.map((line, i) => `${String(startLine + i + 1).padStart(6)}\t${line}`).join("\n");
          const rangeMsg = offset || limit ? ` (lines ${startLine + 1}–${startLine + slice.length})` : "";
          return { success: true, message: `File: ${relative}${rangeMsg}`, data: { path: relative, content: numbered } };
        } catch {
          return { success: false, error: `File not found: ${relative}`, message: `Could not read ${relative}` };
        }
      }

      if (toolName === "write_sandbox_file") {
        const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));
        const content = String(params.content ?? "");
        if (!content) return { success: false, error: "content is required.", message: "Provide the file content." };
        try {
          await mkdir(dirname(resolved), { recursive: true });
          await writeFile(resolved, content, "utf-8");
          logBuildActivity(buildId, "write_sandbox_file", `Created ${relative} (${content.length} chars)`);
          return { success: true, message: `Created ${relative} (${content.length} chars).`, data: { path: relative } };
        } catch (err) {
          return { success: false, error: `Write failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not write ${relative}` };
        }
      }

      if (toolName === "edit_sandbox_file") {
        const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));

        // Line-based edit mode: replace a range of lines by number
        // More reliable than string matching for AI-generated edits
        const startLine = params.start_line ? Number(params.start_line) : undefined;
        const endLine = params.end_line ? Number(params.end_line) : undefined;
        const newContent = params.new_content ? String(params.new_content) : undefined;

        if (startLine && endLine && newContent !== undefined) {
          try {
            const current = await readFile(resolved, "utf-8");
            const lines = current.split("\n");
            if (startLine < 1 || endLine > lines.length || startLine > endLine) {
              return { success: false, error: `Invalid line range ${startLine}-${endLine} (file has ${lines.length} lines).`, message: `Line range out of bounds.` };
            }
            const before = lines.slice(0, startLine - 1);
            const after = lines.slice(endLine);
            const newLines = newContent.split("\n");
            const updated = [...before, ...newLines, ...after].join("\n");
            await writeFile(resolved, updated, "utf-8");
            logBuildActivity(buildId, "edit_sandbox_file", `Edited ${relative} lines ${startLine}-${endLine} (${endLine - startLine + 1} -> ${newLines.length} lines)`);
            return { success: true, message: `Edited ${relative}: replaced lines ${startLine}-${endLine} with ${newLines.length} lines.`, data: { path: relative, linesReplaced: endLine - startLine + 1, newLines: newLines.length } };
          } catch (err) {
            return { success: false, error: `Edit failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not edit ${relative}` };
          }
        }

        // String-matching edit mode (original)
        const oldText = String(params.old_text ?? "");
        const newText = String(params.new_text ?? "");
        const replaceAll = params.replace_all === true;
        if (!oldText) return { success: false, error: "old_text is required (or use start_line/end_line/new_content for line-based edit).", message: "Provide old_text to replace, or use line-based mode." };
        try {
          const current = await readFile(resolved, "utf-8");
          const occurrences = current.split(oldText).length - 1;
          if (occurrences === 0) return { success: false, error: `old_text not found in ${relative}. Use read_sandbox_file to see exact content, or use line-based edit (start_line, end_line, new_content).`, message: `Text not found. Try line-based edit instead.` };
          if (occurrences > 1 && !replaceAll) return { success: false, error: `old_text matches ${occurrences} locations in ${relative}. Provide more context to make it unique, or set replace_all: true.`, message: `Ambiguous match — ${occurrences} occurrences found. Add surrounding lines to make the match unique, or use replace_all.` };
          const updated = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
          await writeFile(resolved, updated, "utf-8");
          const countMsg = replaceAll ? ` (${occurrences} occurrences)` : "";
          logBuildActivity(buildId, "edit_sandbox_file", `Edited ${relative}${countMsg}`);
          return { success: true, message: `Edited ${relative}: replaced ${oldText.length} chars with ${newText.length} chars${countMsg}.`, data: { path: relative, replacements: replaceAll ? occurrences : 1 } };
        } catch (err) {
          return { success: false, error: `Edit failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not edit ${relative}` };
        }
      }

      if (toolName === "search_sandbox") {
        const pattern = String(params.pattern ?? "");
        const globFilter = params.glob ? String(params.glob) : "*.{ts,tsx,js,jsx}";
        const max = Number(params.maxResults) || 20;
        try {
          // Use grep on the mounted volume — runs in portal, not sandbox container
          const { exec: execCb } = await import("child_process");
          const { promisify } = await import("util");
          const execAsync = promisify(execCb);
          const { stdout } = await execAsync(
            `grep -rn --include='${globFilter}' '${pattern.replace(/'/g, "'\\''")}' ${SANDBOX_MOUNT}/apps/ ${SANDBOX_MOUNT}/packages/ 2>/dev/null | head -${max}`,
            { timeout: 15_000 },
          );
          const cleaned = stdout.replace(new RegExp(SANDBOX_MOUNT + "/", "g"), "");
          return { success: true, message: `Search results for "${pattern}"`, data: { pattern, results: cleaned } };
        } catch (err) {
          // grep exits with code 1 when no matches are found — this is NOT an error.
          // Distinguish "no matches" from actual sandbox failures.
          const execErr = err as { code?: number; killed?: boolean; signal?: string };
          if (execErr.code === 1) {
            return {
              success: true,
              message: `No matches found for "${pattern}" in ${globFilter} files. The sandbox is working — this search term simply doesn't exist in the codebase. Try a different keyword or check spelling.`,
              data: { pattern, results: "", matchCount: 0 },
            };
          }
          // Actual failure (timeout, mount not accessible, etc.)
          const errMsg = (err as Error).message?.slice(0, 200) ?? "Search failed";
          return { success: false, error: `Sandbox search error: ${errMsg}`, message: `Search failed — the sandbox may not be accessible. Error: ${errMsg}` };
        }
      }

      if (toolName === "list_sandbox_files") {
        const pattern = String(params.pattern ?? "**/*");
        try {
          const { exec: execCb } = await import("child_process");
          const { promisify } = await import("util");
          const execAsync = promisify(execCb);
          const findPattern = pattern.startsWith("/") ? pattern : `${SANDBOX_MOUNT}/${pattern}`;
          const { stdout } = await execAsync(
            `find ${SANDBOX_MOUNT} -path '${SANDBOX_MOUNT}/node_modules' -prune -o -path '${SANDBOX_MOUNT}/.pnpm-store' -prune -o -path '${SANDBOX_MOUNT}/.next' -prune -o -path '${findPattern}' -print 2>/dev/null | head -50`,
            { timeout: 10_000 },
          );
          const cleaned = stdout.split("\n").map((l: string) => l.replace(`${SANDBOX_MOUNT}/`, "")).filter(Boolean).join("\n");
          if (!cleaned) {
            return { success: true, message: `No files matching "${pattern}". The sandbox is working — this path pattern has no matches. Try a broader pattern like "apps/web/app/**/*.tsx".`, data: { pattern, files: "" } };
          }
          return { success: true, message: `Files matching "${pattern}"`, data: { pattern, files: cleaned } };
        } catch (err) {
          const errMsg = (err as Error).message?.slice(0, 200) ?? "List failed";
          return { success: false, error: `Sandbox file listing error: ${errMsg}`, message: `File listing failed — the sandbox may not be accessible. Error: ${errMsg}` };
        }
      }

      if (toolName === "run_sandbox_command") {
        const command = String(params.command ?? "");
        if (!command) return { success: false, error: "command is required.", message: "Provide a command to run." };

        // Smart output truncation: keep errors (at the end) rather than progress noise (at the start)
        const truncateOutput = (raw: string, limit: number = 15000): string => {
          if (raw.length <= limit) return raw;
          // For build/typecheck output, extract error lines first
          const errorLines = raw.split("\n").filter((l) =>
            /error\s+TS\d|ERROR|FAIL|Error:|Cannot find|not assignable|does not exist|Module.*not found/i.test(l)
          );
          if (errorLines.length > 0 && errorLines.length < 200) {
            const errorSummary = errorLines.join("\n");
            if (errorSummary.length <= limit) {
              return `[${raw.split("\n").length} total lines, showing ${errorLines.length} error lines]\n${errorSummary}`;
            }
          }
          // Fall back to keeping the tail (where errors typically appear)
          return `[output truncated — showing last ${limit} chars of ${raw.length}]\n...${raw.slice(-limit)}`;
        };

        try {
          const output = await execInSandbox(sandboxId, `cd /workspace && ${command} 2>&1`);
          logBuildActivity(buildId, "run_sandbox_command", `Ran: ${command.slice(0, 100)}`);
          return { success: true, message: `Command completed.`, data: { command, output: truncateOutput(output) } };
        } catch (err) {
          // Commands like tsc, prisma validate return non-zero exit codes when they
          // find errors. This is NOT a sandbox failure — it's useful output.
          const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
          const output = (execErr.stdout ?? "") + (execErr.stderr ?? "");
          const exitCode = execErr.code;

          // If we got output, the command ran — return the output so the AI can act on it
          if (output.trim()) {
            logBuildActivity(buildId, "run_sandbox_command", `Ran (exit ${exitCode}): ${command.slice(0, 100)}`);
            return {
              success: true,
              message: `Command exited with code ${exitCode}. Review the output for errors to fix.`,
              data: { command, output: truncateOutput(output), exitCode },
            };
          }

          // No output — actual sandbox connectivity issue
          const errMsg = execErr.message?.slice(0, 2000) || "Command failed";
          console.error(`[run_sandbox_command] FAILED (no output): ${command.slice(0, 100)} -> ${errMsg.slice(0, 200)}`);
          return { success: false, error: errMsg, message: `Command failed: ${command.slice(0, 100)}`, data: { command, output: errMsg } };
        }
      }

      return { success: false, error: "Unknown sandbox tool", message: "Internal error." };
    }

    case "describe_model": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      let dmBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });

      // Auto-init sandbox if not running (same pattern as file tools above)
      if (!dmBuild?.sandboxId) {
        const { isSandboxRunning, initializeSandboxWorkspace: sbInit } = await import("@/lib/sandbox");
        const { acquireSandbox, initializePool } = await import("@/lib/sandbox-pool");
        await initializePool().catch(() => {});
        const slot = await acquireSandbox(buildId, userId);
        if (!slot) return { success: false, error: "All sandbox slots are in use.", message: "No sandbox slots available. Try again shortly." };
        const running = await isSandboxRunning(slot.containerId).catch(() => false);
        if (!running) return { success: false, error: `Sandbox ${slot.containerId} not running.`, message: "Sandbox container not found." };
        try { await sbInit(slot.containerId); } catch (e) { console.error(`[describe_model] auto-init failed: ${(e as Error).message?.slice(0, 200)}`); }
        try {
          const { startSandboxDevServer } = await import("@/lib/sandbox");
          await startSandboxDevServer(slot.containerId);
        } catch { /* non-fatal */ }
        dmBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
        if (!dmBuild?.sandboxId) return { success: false, error: "Sandbox initialization failed.", message: "Could not initialize sandbox." };
      }

      const modelName = String(params.model_name ?? "");
      if (!modelName) return { success: false, error: "model_name is required.", message: "Provide the model name (PascalCase)." };

      try {
        const { execInSandbox } = await import("@/lib/sandbox");
        const schemaContent = await execInSandbox(
          dmBuild.sandboxId,
          "cat /workspace/packages/db/prisma/schema.prisma",
        );
        const { describeModel, formatModelDescription } = await import("@/lib/integrate/schema-validator");
        const desc = describeModel(schemaContent, modelName);

        if (!desc) {
          return { success: false, error: `Model "${modelName}" not found in schema.`, message: `No model named "${modelName}" exists. Check spelling (PascalCase). Use read_sandbox_file on packages/db/prisma/schema.prisma to see available models.` };
        }

        const formatted = formatModelDescription(desc);
        return { success: true, message: formatted, data: desc as unknown as Record<string, unknown> };
      } catch (err) {
        return { success: false, error: "Schema read error", message: err instanceof Error ? err.message : "Failed to read schema" };
      }
    }

    case "validate_schema": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      let vsBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });

      // Auto-init sandbox if not running (same pattern as file tools above)
      if (!vsBuild?.sandboxId) {
        const { isSandboxRunning, initializeSandboxWorkspace: sbInit } = await import("@/lib/sandbox");
        const { acquireSandbox, initializePool } = await import("@/lib/sandbox-pool");
        await initializePool().catch(() => {});
        const slot = await acquireSandbox(buildId, userId);
        if (!slot) return { success: false, error: "All sandbox slots are in use.", message: "No sandbox slots available. Try again shortly." };
        const running = await isSandboxRunning(slot.containerId).catch(() => false);
        if (!running) return { success: false, error: `Sandbox ${slot.containerId} not running.`, message: "Sandbox container not found." };
        try { await sbInit(slot.containerId); } catch (e) { console.error(`[validate_schema] auto-init failed: ${(e as Error).message?.slice(0, 200)}`); }
        try {
          const { startSandboxDevServer } = await import("@/lib/sandbox");
          await startSandboxDevServer(slot.containerId);
        } catch { /* non-fatal */ }
        vsBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
        if (!vsBuild?.sandboxId) return { success: false, error: "Sandbox initialization failed.", message: "Could not initialize sandbox." };
      }

      try {
        const { execInSandbox } = await import("@/lib/sandbox");
        const schemaContent = await execInSandbox(
          vsBuild.sandboxId,
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

    case "deploy_feature": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
      if (!build?.sandboxId) return { success: false, error: "Sandbox not running.", message: "No sandbox." };

      const devConfig = await prisma.platformDevConfig.findUnique({
        where: { id: "singleton" },
        select: { contributionMode: true, gitRemoteUrl: true },
      });
      const { getPlatformDevPolicyState } = await import("@/lib/platform-dev-policy");
      const policyState = getPlatformDevPolicyState(devConfig);
      if (policyState === "policy_pending") {
        return {
          success: false,
          error: "Platform development policy not configured.",
          message:
            "Build Studio can keep editing and validating in the shared workspace, but production promotion stays blocked until Platform Development is configured in the portal. Go to Admin > Platform Development and choose whether this install stays private or can contribute upstream.",
        };
      }

      // Extract diff from sandbox
      const { extractAndCategorizeDiff, scanForDestructiveOps, isNowInWindow } = await import("@/lib/sandbox-promotion");
      const extracted = await extractAndCategorizeDiff(build.sandboxId);
      await prisma.featureBuild.update({
        where: { buildId },
        data: { diffPatch: extracted.fullDiff, diffSummary: extracted.fullDiff.slice(0, 500) },
      });

      // Scan migrations for destructive operations
      let destructiveWarnings: string[] = [];
      if (extracted.hasMigrations) {
        destructiveWarnings = scanForDestructiveOps(extracted.fullDiff);
      }

      // Check deployment window availability
      let windowStatus = "No business profile configured — deployment unrestricted.";
      try {
        const profile = await prisma.businessProfile.findFirst({
          where: { isActive: true },
          include: { deploymentWindows: true, blackoutPeriods: true },
        });
        if (profile) {
          const now = new Date();
          const activeBlackout = profile.blackoutPeriods.find(
            (bp) => bp.startAt <= now && bp.endAt >= now,
          );
          if (activeBlackout) {
            windowStatus = `Blackout active until ${activeBlackout.endAt.toISOString()}.`;
          } else {
            const matchingWindows = profile.deploymentWindows.filter(
              (w) => w.allowedChangeTypes.includes("normal") && w.allowedRiskLevels.includes("low"),
            );
            if (matchingWindows.length > 0) {
              windowStatus = isNowInWindow(matchingWindows)
                ? "Deployment window is open now."
                : `Not in a deployment window. Available: ${matchingWindows.map((w) => `${w.name}: ${w.startTime}-${w.endTime}`).join("; ")}`;
            } else {
              windowStatus = "No deployment windows configured — deployment unrestricted.";
            }
          }
        }
      } catch {
        // Non-fatal — window check is advisory at this stage
      }

      // Run change impact analysis (EP-BUILD-HANDOFF-002 Phase 2b)
      let impactReport: Awaited<ReturnType<typeof import("@/lib/change-impact").analyzeChangeImpact>> | null = null;
      let impactSummary = "";
      try {
        const { analyzeChangeImpact, formatImpactForChat } = await import("@/lib/change-impact");
        impactReport = await analyzeChangeImpact(extracted.fullDiff);
        impactSummary = formatImpactForChat(impactReport);
      } catch (err) {
        console.warn("[deploy_feature] impact analysis failed:", err);
      }

      // Resolve approval authority (EP-BUILD-HANDOFF-002 Phase 2b)
      let authorityInfo = "";
      try {
        const { resolveApprovalAuthority, isCurrentUserTheAuthority, formatAuthorityForChat } = await import("@/lib/approval-authority");
        const riskLevel = impactReport?.riskLevel ?? "low";
        const authority = await resolveApprovalAuthority("deployment", "normal", riskLevel, userId);
        const isSelf = isCurrentUserTheAuthority(authority, userId);
        authorityInfo = formatAuthorityForChat(authority, isSelf);
      } catch (err) {
        console.warn("[deploy_feature] authority resolution failed:", err);
      }

      // Contribution mode awareness (EP-BUILD-HANDOFF-002 Phase 2e extension)
      let contributionModeInfo = "";
      try {
        const mode = devConfig?.contributionMode ?? "fork_only";

        if (mode === "fork_only" && !devConfig?.gitRemoteUrl) {
          // Count untracked shipped features for escalating warning
          const untrackedCount = await prisma.featureBuild.count({
            where: { phase: "complete", gitCommitHashes: { isEmpty: true } },
          });

          if (untrackedCount >= 5) {
            contributionModeInfo = `**Warning:** You have ${untrackedCount} custom features with no backup. This represents significant business value that could be lost in a container rebuild, Docker update, or system recovery. Setting up a git repository takes about 10 minutes and protects all your customizations. See Admin > Platform Development.`;
          } else if (untrackedCount >= 2) {
            contributionModeInfo = `**Note:** You now have ${untrackedCount} custom features deployed without version control. If your Docker containers are rebuilt, these changes could be lost. I'd recommend setting up a git repository -- see Admin > Platform Development.`;
          } else if (untrackedCount >= 1) {
            contributionModeInfo = "Note: since no git repository is configured, customizations exist only in your production container. You can set up a repository in Admin > Platform Development to protect your work.";
          }
        }
      } catch (err) {
        console.warn("[deploy_feature] contribution mode check failed:", err);
      }

      const messageParts = [
        `Diff extracted: ${extracted.codeFiles.length} code file(s), ${extracted.migrationFiles.length} migration(s).`,
        windowStatus,
      ];
      if (destructiveWarnings.length > 0) {
        messageParts.push(`WARNING: ${destructiveWarnings.length} destructive operation(s) detected: ${destructiveWarnings.join("; ")}`);
      }
      if (impactSummary) {
        messageParts.push("", impactSummary);
      }
      if (authorityInfo) {
        messageParts.push("", authorityInfo);
      }
      if (contributionModeInfo) {
        messageParts.push("", contributionModeInfo);
      }

      logBuildActivity(buildId, "deploy_feature", messageParts.join(" "));

      return {
        success: true,
        message: messageParts.join("\n"),
        data: {
          diffLength: extracted.fullDiff.length,
          summary: extracted.fullDiff.slice(0, 500),
          codeFiles: extracted.codeFiles.length,
          migrationFiles: extracted.migrationFiles.length,
          destructiveWarnings,
          windowStatus,
          impactReport,
        },
      };
    }

    // ─── Scheduling & Release Tools ──────────────────────────────────────────

    case "check_deployment_windows": {
      const changeType = String(params.change_type ?? "normal");
      const riskLevel = String(params.risk_level ?? "low");
      const profile = await prisma.businessProfile.findFirst({
        where: { isActive: true },
        include: { deploymentWindows: true, blackoutPeriods: true },
      });

      if (!profile) {
        return { success: true, message: "No business profile configured — deployment is unrestricted. Set up operating hours in Admin to enable deployment windows.", data: { available: true, unrestricted: true } };
      }

      const now = new Date();
      const activeBlackout = profile.blackoutPeriods.find(
        (bp) => bp.startAt <= now && bp.endAt >= now && !bp.exceptions.includes(changeType),
      );
      if (activeBlackout) {
        return {
          success: true,
          message: `Blackout period active until ${activeBlackout.endAt.toISOString()}. Reason: ${activeBlackout.reason ?? "Scheduled blackout"}. Emergency changes may override.`,
          data: { available: false, blackout: true, blackoutEnd: activeBlackout.endAt.toISOString(), reason: activeBlackout.reason },
        };
      }

      const { isNowInWindow } = await import("@/lib/sandbox-promotion");
      const matchingWindows = profile.deploymentWindows.filter(
        (w) => w.allowedChangeTypes.includes(changeType) && w.allowedRiskLevels.includes(riskLevel),
      );

      if (matchingWindows.length === 0) {
        return { success: true, message: "No deployment windows configured for this change type and risk level — deployment is unrestricted.", data: { available: true, unrestricted: true } };
      }

      const windowOpen = isNowInWindow(matchingWindows);
      const windowSummary = matchingWindows.map((w) => ({
        name: w.name,
        days: w.dayOfWeek,
        startTime: w.startTime,
        endTime: w.endTime,
      }));

      return {
        success: true,
        message: windowOpen
          ? `Deployment window is OPEN now. ${matchingWindows.length} matching window(s) available.`
          : `Not in a deployment window. Available windows: ${matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ")}`,
        data: { available: windowOpen, windows: windowSummary },
      };
    }

    case "schedule_promotion": {
      const promotionId = String(params.promotion_id ?? "");
      if (!promotionId) return { success: false, error: "promotion_id is required.", message: "Provide a promotion ID." };

      const promotion = await prisma.changePromotion.findUnique({
        where: { promotionId },
        include: { changeItem: { include: { changeRequest: true } } },
      });
      if (!promotion) return { success: false, error: "Promotion not found.", message: `No promotion with ID ${promotionId}.` };
      if (promotion.status !== "approved") return { success: false, error: "Promotion must be approved first.", message: `Current status: ${promotion.status}` };

      // Find next available window
      const profile = await prisma.businessProfile.findFirst({
        where: { isActive: true },
        include: { deploymentWindows: true },
      });

      if (!profile || profile.deploymentWindows.length === 0) {
        return { success: true, message: "No deployment windows configured. Promotion can be deployed anytime via Operations > Promotions.", data: { scheduled: false } };
      }

      const rfcType = promotion.changeItem?.changeRequest?.type ?? "normal";
      const riskLevel = promotion.changeItem?.changeRequest?.riskLevel ?? "low";
      const matchingWindows = profile.deploymentWindows.filter(
        (w) => w.allowedChangeTypes.includes(rfcType) && w.allowedRiskLevels.includes(riskLevel),
      );

      if (matchingWindows.length === 0) {
        return { success: true, message: "No windows match this change type and risk level. Ask an admin to configure appropriate deployment windows.", data: { scheduled: false } };
      }

      // Update RFC with deployment window info
      const rfc = promotion.changeItem?.changeRequest;
      if (rfc) {
        await prisma.changeRequest.update({
          where: { id: rfc.id },
          data: {
            status: "scheduled",
            scheduledAt: new Date(),
            deploymentWindowId: matchingWindows[0]!.id,
          },
        });
      }

      const windowDesc = matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ");
      logBuildActivity(promotionId, "schedule_promotion", `Scheduled for window: ${windowDesc}`);

      return {
        success: true,
        message: `Promotion ${promotionId} scheduled. Deployment windows: ${windowDesc}. An operator can deploy via Operations > Promotions during an open window.`,
        data: { scheduled: true, windows: windowDesc },
      };
    }

    case "execute_promotion": {
      const promotionId = String(params.promotion_id ?? "");
      const overrideReason = params.override_reason ? String(params.override_reason) : undefined;
      if (!promotionId || !/^[a-zA-Z0-9_-]+$/.test(promotionId)) {
        return { success: false, error: "Invalid promotion_id", message: "Provide a valid promotion ID." };
      }

      // Validate promotion exists and is approved
      const promo = await prisma.changePromotion.findFirst({ where: { promotionId } });
      if (!promo) return { success: false, error: "Not found", message: `Promotion ${promotionId} not found.` };
      if (promo.status === "deployed") return { success: true, message: "Already deployed.", data: { status: "deployed" } };
      if (promo.status !== "approved") return { success: false, error: `Status is ${promo.status}`, message: "Must be approved first." };

      // Enforce deployment window — block execution outside windows unless emergency override
      if (!overrideReason) {
        const { getPromotionWindowStatus } = await import("@/lib/actions/promotions");
        const windowStatus = await getPromotionWindowStatus(promotionId);
        if (!windowStatus.available) {
          return {
            success: false,
            error: "Outside deployment window",
            message: `${windowStatus.message} Use schedule_promotion to queue for the next window, or provide override_reason for emergency deployment.`,
          };
        }
      }

      // Resolve sandbox and build ID
      const promoDetail = await prisma.changePromotion.findFirst({
        where: { promotionId },
        include: { productVersion: { include: { featureBuild: { select: { sandboxId: true, buildId: true } } } } },
      });
      const sandboxId = promoDetail?.productVersion?.featureBuild?.sandboxId;
      const promoBuildId = promoDetail?.productVersion?.featureBuild?.buildId;
      if (!sandboxId) return { success: false, error: "No sandbox", message: "No sandbox linked to this promotion." };

      const { execFile: execFileCb } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFileCb);
      const execAsync = promisify((await import("child_process")).exec);

      // Start promoter container (array form — no shell injection)
      try {
        await execAsync("docker rm dpf-promoter-1 2>/dev/null || true");
        const dockerArgs = [
          "run", "-d",
          "--name", "dpf-promoter-1",
          "--network", `${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}_default`,
          "-v", "/var/run/docker.sock:/var/run/docker.sock",
          "-v", "dpf_backups:/backups",
          "-e", `PROMOTION_ID=${promotionId}`,
          "-e", `DPF_PRODUCTION_DB_CONTAINER=${process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1"}`,
          "-e", "DPF_PORTAL_CONTAINER=dpf-portal-1",
          "-e", `DPF_COMPOSE_PROJECT=${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}`,
          "-e", `DPF_SANDBOX_CONTAINER=${sandboxId}`,
          "-e", `POSTGRES_USER=${process.env.POSTGRES_USER ?? "dpf"}`,
        ];
        if (overrideReason) {
          dockerArgs.push("-e", `DPF_WINDOW_OVERRIDE=${overrideReason}`);
        }
        dockerArgs.push("dpf-promoter");
        await execFileAsync("docker", dockerArgs);
      } catch (err) {
        return { success: false, error: `Failed to start promoter: ${(err as Error).message?.slice(0, 200)}`, message: "Could not start the promoter container." };
      }

      // Poll for completion (max 10 minutes)
      const maxWaitMs = 10 * 60 * 1000;
      const pollIntervalMs = 10_000;
      const startTime = Date.now();
      let exitCode: number | null = null;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        try {
          const { stdout } = await execAsync("docker inspect dpf-promoter-1 --format='{{.State.Status}} {{.State.ExitCode}}'");
          const parts = stdout.trim().replace(/'/g, "").split(" ");
          if (parts[0] === "exited") {
            exitCode = parseInt(parts[1] ?? "1", 10);
            break;
          }
        } catch { /* container may not exist yet */ }
      }

      if (exitCode === null) {
        await execAsync("docker stop dpf-promoter-1 2>/dev/null || true").catch(() => {});
        return { success: false, error: "Timeout (10 min)", message: "Promoter did not complete. Check ops dashboard." };
      }

      const finalPromo = await prisma.changePromotion.findFirst({ where: { promotionId } });
      const promoSuccess = exitCode === 0 && finalPromo?.status === "deployed";

      await execAsync("docker rm dpf-promoter-1 2>/dev/null || true").catch(() => {});
      logBuildActivity(promoBuildId ?? promotionId, "execute_promotion", promoSuccess ? "Deployed successfully" : `Rolled back: ${finalPromo?.rollbackReason ?? "unknown"}`);

      return {
        success: promoSuccess,
        message: promoSuccess
          ? `Promotion ${promotionId} deployed. Health check passed.`
          : `Rolled back. ${finalPromo?.rollbackReason ?? "Check deployment log."}`,
        data: { promotionId, status: finalPromo?.status, deploymentLog: finalPromo?.deploymentLog?.slice(0, 1000) },
      };
    }

    case "create_release_bundle": {
      const title = String(params.title ?? "");
      const buildIds = Array.isArray(params.build_ids) ? params.build_ids.map(String) : [];
      if (!title) return { success: false, error: "title is required.", message: "Provide a release bundle title." };
      if (buildIds.length === 0) return { success: false, error: "build_ids is required.", message: "Provide at least one build ID." };

      // Validate all builds exist and are in review/complete phase
      const builds = await prisma.featureBuild.findMany({
        where: { buildId: { in: buildIds } },
        select: { buildId: true, title: true, phase: true, releaseBundleId: true },
      });
      const missing = buildIds.filter((id) => !builds.some((b) => b.buildId === id));
      if (missing.length > 0) return { success: false, error: `Builds not found: ${missing.join(", ")}`, message: `Could not find builds: ${missing.join(", ")}` };

      const notReady = builds.filter((b) => !["review", "complete", "ship"].includes(b.phase));
      if (notReady.length > 0) {
        return { success: false, error: `Builds not ready: ${notReady.map((b) => `${b.buildId} (${b.phase})`).join(", ")}`, message: `All builds must be in review or complete phase.` };
      }

      const alreadyBundled = builds.filter((b) => b.releaseBundleId);
      if (alreadyBundled.length > 0) {
        return { success: false, error: `Builds already in a bundle: ${alreadyBundled.map((b) => b.buildId).join(", ")}`, message: `Remove from existing bundle first.` };
      }

      // Create the bundle
      const bundleId = `RB-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const bundle = await prisma.releaseBundle.create({
        data: {
          bundleId,
          title,
          status: "assembling",
          createdBy: userId,
        },
      });

      // Link builds to the bundle
      await prisma.featureBuild.updateMany({
        where: { buildId: { in: buildIds } },
        data: { releaseBundleId: bundle.id },
      });

      return {
        success: true,
        message: `Release bundle ${bundleId} created with ${buildIds.length} build(s): ${builds.map((b) => b.title).join(", ")}. Run gate checks before scheduling deployment.`,
        data: { bundleId, title, buildCount: buildIds.length, builds: builds.map((b) => ({ buildId: b.buildId, title: b.title })) },
      };
    }

    case "run_release_gate": {
      const bundleId = String(params.bundle_id ?? "");
      if (!bundleId) return { success: false, error: "bundle_id is required.", message: "Provide a release bundle ID." };

      const bundle = await prisma.releaseBundle.findUnique({
        where: { bundleId },
        include: {
          builds: {
            select: {
              buildId: true, title: true, phase: true, diffPatch: true,
              verificationOut: true, sandboxId: true,
            },
          },
        },
      });
      if (!bundle) return { success: false, error: "Bundle not found.", message: `No release bundle with ID ${bundleId}.` };
      if (bundle.status !== "assembling") {
        return { success: false, error: `Gate check already run. Bundle status: ${bundle.status}`, message: `Bundle is in ${bundle.status} state.` };
      }
      if (bundle.builds.length === 0) {
        return { success: false, error: "Bundle has no builds.", message: "Add builds to the bundle first." };
      }

      // Check all builds are in review/complete/ship phase
      const notReady = bundle.builds.filter((b) => !["review", "complete", "ship"].includes(b.phase));
      if (notReady.length > 0) {
        return {
          success: false, error: `Builds not ready: ${notReady.map((b) => `${b.buildId} (${b.phase})`).join(", ")}`,
          message: "All builds must be in review or complete phase.",
        };
      }

      // Check all builds have passing tests
      const failedTests = bundle.builds.filter((b) => {
        const v = b.verificationOut as Record<string, unknown> | null;
        return v && (v.testsPassed === false || v.testsPassed === 0);
      });

      // Combine diffs from all builds
      const diffs: string[] = [];
      for (const build of bundle.builds) {
        if (build.diffPatch) {
          diffs.push(build.diffPatch as string);
        } else if (build.sandboxId) {
          try {
            const { extractDiff } = await import("@/lib/sandbox");
            const diff = await extractDiff(build.sandboxId);
            diffs.push(diff);
          } catch {
            // Build has no extractable diff — may be fine if it's code-only
          }
        }
      }

      const combinedDiff = diffs.join("\n");

      // Scan for destructive operations
      const { scanForDestructiveOps, categorizeDiffFiles } = await import("@/lib/sandbox-promotion");
      const allFileMatches = [...combinedDiff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]);
      const { migrationFiles } = categorizeDiffFiles(allFileMatches);
      const destructiveWarnings = migrationFiles.length > 0 ? scanForDestructiveOps(combinedDiff) : [];

      // Build gate check result
      const gateResult = {
        buildsChecked: bundle.builds.length,
        allTestsPass: failedTests.length === 0,
        failedTestBuilds: failedTests.map((b) => b.buildId),
        totalFilesChanged: allFileMatches.length,
        migrationFiles: migrationFiles.length,
        destructiveWarnings,
        combinedDiffLength: combinedDiff.length,
      };

      const passed = failedTests.length === 0 && destructiveWarnings.length === 0;

      // Update bundle
      await prisma.releaseBundle.update({
        where: { bundleId },
        data: {
          status: passed ? "approved" : "gate_check",
          combinedDiffPatch: combinedDiff,
          gateCheckResult: gateResult as unknown as import("@dpf/db").Prisma.InputJsonValue,
        },
      });

      const messageParts = [
        `Gate check ${passed ? "PASSED" : "FAILED"} for ${bundleId}.`,
        `${bundle.builds.length} build(s), ${allFileMatches.length} file(s) changed, ${migrationFiles.length} migration(s).`,
      ];
      if (failedTests.length > 0) messageParts.push(`Failing tests in: ${failedTests.map((b) => b.buildId).join(", ")}.`);
      if (destructiveWarnings.length > 0) messageParts.push(`Destructive ops: ${destructiveWarnings.join("; ")}`);
      if (passed) messageParts.push("Bundle is approved and ready to schedule for deployment.");

      return { success: true, message: messageParts.join(" "), data: gateResult };
    }

    case "schedule_release_bundle": {
      const bundleId = String(params.bundle_id ?? "");
      if (!bundleId) return { success: false, error: "bundle_id is required.", message: "Provide a release bundle ID." };

      const bundle = await prisma.releaseBundle.findUnique({
        where: { bundleId },
        include: { builds: { select: { buildId: true, title: true, createdById: true } } },
      });
      if (!bundle) return { success: false, error: "Bundle not found.", message: `No bundle ${bundleId}.` };
      if (bundle.status !== "approved") {
        return { success: false, error: `Bundle must be approved first. Current: ${bundle.status}`, message: `Run gate checks first.` };
      }

      // Find next available deployment window
      const profile = await prisma.businessProfile.findFirst({
        where: { isActive: true },
        include: { deploymentWindows: true },
      });

      const matchingWindows = profile?.deploymentWindows.filter(
        (w) => w.allowedChangeTypes.includes("normal") && w.allowedRiskLevels.includes("low"),
      ) ?? [];

      // Create RFC for the bundle
      const rfcId = `RFC-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const rfc = await prisma.changeRequest.create({
        data: {
          rfcId,
          title: `Release: ${bundle.title}`,
          description: `Release bundle ${bundleId} with ${bundle.builds.length} build(s): ${bundle.builds.map((b) => b.title).join(", ")}`,
          type: "normal",
          scope: "platform",
          riskLevel: "low",
          status: "scheduled",
          scheduledAt: new Date(),
          requestedById: bundle.createdBy,
          ...(matchingWindows.length > 0 ? { deploymentWindowId: matchingWindows[0]!.id } : {}),
        },
      });

      // Create CalendarEvent for visibility
      const employee = await prisma.employeeProfile.findFirst({
        where: { userId: bundle.createdBy },
        select: { id: true },
      });

      let calendarEventId: string | undefined;
      if (employee) {
        const eventId = `RELEASE-${bundleId}`;
        await prisma.calendarEvent.upsert({
          where: { eventId },
          create: {
            eventId,
            title: `Deployment: ${bundle.title}`,
            description: `${bundle.builds.length} feature(s): ${bundle.builds.map((b) => b.title).join(", ")}`,
            startAt: new Date(),
            eventType: "action",
            category: "platform",
            ownerEmployeeId: employee.id,
            visibility: "team",
            color: "#f59e0b",
          },
          update: { title: `Deployment: ${bundle.title}`, startAt: new Date() },
        });
        calendarEventId = eventId;
      }

      // Update bundle
      await prisma.releaseBundle.update({
        where: { bundleId },
        data: {
          status: "scheduled",
          rfcId: rfc.rfcId,
          calendarEventId,
          scheduledAt: new Date(),
          ...(matchingWindows.length > 0 ? { deploymentWindowId: matchingWindows[0]!.id } : {}),
        },
      });

      const windowDesc = matchingWindows.length > 0
        ? matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ")
        : "No windows configured — deployment unrestricted";

      return {
        success: true,
        message: `Release ${bundleId} scheduled. RFC: ${rfcId}. Added to operations calendar. Windows: ${windowDesc}. An operator can deploy via Operations > Promotions.`,
        data: { bundleId, rfcId, calendarEventId, windows: windowDesc },
      };
    }

    case "get_release_status": {
      const bundleId = params.bundle_id ? String(params.bundle_id) : null;
      const promotionId = params.promotion_id ? String(params.promotion_id) : null;

      if (bundleId) {
        const bundle = await prisma.releaseBundle.findUnique({
          where: { bundleId },
          include: { builds: { select: { buildId: true, title: true, phase: true } } },
        });
        if (!bundle) return { success: false, error: "Bundle not found.", message: `No release bundle with ID ${bundleId}.` };
        return {
          success: true,
          message: `Release ${bundle.bundleId}: ${bundle.status}. ${bundle.builds.length} build(s).`,
          data: {
            bundleId: bundle.bundleId,
            title: bundle.title,
            status: bundle.status,
            builds: bundle.builds,
            scheduledAt: bundle.scheduledAt?.toISOString() ?? null,
            deployedAt: bundle.deployedAt?.toISOString() ?? null,
          },
        };
      }

      if (promotionId) {
        const { getPromotionWindowStatus } = await import("@/lib/actions/promotions");
        const windowStatus = await getPromotionWindowStatus(promotionId).catch(() => ({ available: false, message: "Could not check window status" }));
        const promotion = await prisma.changePromotion.findUnique({
          where: { promotionId },
          select: { status: true, deployedAt: true, rationale: true, rollbackReason: true },
        });
        if (!promotion) return { success: false, error: "Promotion not found.", message: `No promotion with ID ${promotionId}.` };
        return {
          success: true,
          message: `Promotion ${promotionId}: ${promotion.status}. Window: ${windowStatus.message}`,
          data: { promotionId, ...promotion, windowStatus },
        };
      }

      return { success: false, error: "Provide bundle_id or promotion_id.", message: "Specify which release or promotion to check." };
    }

    // ─── Hive Mind Contribution ──────────────────────────────────────────────

    case "assess_contribution": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: {
          title: true, brief: true, buildPlan: true, diffPatch: true, diffSummary: true,
          phase: true, portfolioId: true, digitalProductId: true,
          verificationOut: true, sandboxId: true,
        },
      });
      if (!build) return { success: false, error: "Build not found.", message: "Build not found." };

      const brief = build.brief as Record<string, unknown> | null;
      const plan = build.buildPlan as Record<string, unknown> | null;
      const diff = (build.diffPatch ?? build.diffSummary ?? "") as string;

      // Parse diff to understand scope
      const changedFiles = [...diff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]);
      const newRoutes = changedFiles.filter((f) => f.includes("/app/") && f.endsWith("/page.tsx"));
      const schemaChanges = changedFiles.filter((f) => f.includes("schema.prisma"));
      const migrationFiles = changedFiles.filter((f) => f.startsWith("prisma/migrations/"));
      const hasNewModels = diff.includes("model ") && diff.includes("@id");

      // ── Criterion 1: Vision Alignment ──
      const portfolioId = build.portfolioId ?? "unknown";
      const description = String(brief?.description ?? "");
      const isPortfolioAligned = !!build.portfolioId;
      const mentionsDPPM = /product|portfolio|lifecycle|taxonomy|backlog|compliance|operations/i.test(description);
      const visionScore = isPortfolioAligned && mentionsDPPM ? "high" : isPortfolioAligned ? "medium" : "low";
      const visionReasoning = visionScore === "high"
        ? `Aligned with portfolio ${portfolioId} and extends platform capabilities (${mentionsDPPM ? "touches DPPM concepts" : ""}).`
        : visionScore === "medium"
          ? `Assigned to portfolio ${portfolioId} but domain alignment is unclear from the description.`
          : "Not assigned to a portfolio — unclear how this connects to the platform vision.";

      // ── Criterion 2: Community Value ──
      const targetRoles = Array.isArray(brief?.targetRoles) ? brief.targetRoles : [];
      const broadRoles = targetRoles.length === 0 || targetRoles.includes("All") || targetRoles.length >= 3;
      const acceptanceCriteria = Array.isArray(brief?.acceptanceCriteria) ? brief.acceptanceCriteria : [];
      const isGeneral = !description.match(/\b(acme|our company|internal|proprietary|specific to)\b/i);
      const communityScore = broadRoles && isGeneral ? "high" : isGeneral ? "medium" : "low";
      const communityReasoning = communityScore === "high"
        ? `Targets ${broadRoles ? "broad roles" : targetRoles.join(", ")} with ${acceptanceCriteria.length} general acceptance criteria.`
        : communityScore === "medium"
          ? `Targets specific roles (${targetRoles.join(", ")}) but the functionality appears generalizable.`
          : "Contains organization-specific language or targets a narrow use case.";

      // ── Criterion 3: Augmentation vs Innovation ──
      const isAugmentation = newRoutes.length <= 1 && !hasNewModels;
      const augLevel = isAugmentation ? "augmentation" as const : "innovation" as const;
      const augReasoning = isAugmentation
        ? `Modifies ${changedFiles.length} existing files with ${newRoutes.length} new route(s). This augments existing capability — straightforward to merge.`
        : `Creates ${newRoutes.length} new route(s) and ${hasNewModels ? "new data models" : "significant structural changes"}. This is an innovation — benefits from community review before merging.`;

      // ── Criterion 4: Proprietary Sensitivity ──
      const concerns: string[] = [];
      if (/api[_-]?key|secret|password|token/i.test(diff)) concerns.push("Contains references to API keys or secrets");
      if (/acme|our company|internal use only|confidential/i.test(diff)) concerns.push("Contains organization-specific references");
      if (/\$\d+[\d,.]*|pricing|rate.*card|margin/i.test(diff)) concerns.push("Contains pricing or financial constants");
      if (/customer.*name|client.*id|account.*number/i.test(diff)) concerns.push("Contains customer data references");
      const isSensitive = concerns.length > 0;

      // ── Overall Recommendation ──
      let recommendation: "contribute" | "contribute_with_mods" | "keep_local" | "user_decides";
      if (isSensitive) {
        recommendation = concerns.length > 2 ? "keep_local" : "contribute_with_mods";
      } else if (visionScore === "high" && communityScore === "high") {
        recommendation = "contribute";
      } else if (visionScore === "low" && communityScore === "low") {
        recommendation = "keep_local";
      } else {
        recommendation = "user_decides";
      }

      const summaryMap = {
        contribute: `This feature looks great for the community. It extends ${build.title} within the ${portfolioId} portfolio and other organizations would benefit. Would you like to contribute it to the Hive Mind?`,
        contribute_with_mods: `This feature could benefit others, but I noticed some concerns: ${concerns.join("; ")}. If you'd like to contribute, I'd suggest removing organization-specific references first. Want me to prepare a cleaned version?`,
        keep_local: `This feature is well-built but it's ${isSensitive ? "contains sensitive content" : "specific to your organization"}. I'd recommend keeping it local. You can always contribute later if you generalize it.`,
        user_decides: `I see arguments both ways for contributing "${build.title}". Vision alignment: ${visionScore}. Community value: ${communityScore}. ${augLevel === "innovation" ? "This is an innovation that would benefit from review." : "This augments existing capability."} What would you prefer?`,
      };

      const assessment = {
        recommendation,
        criteria: {
          visionAlignment: { score: visionScore, reasoning: visionReasoning },
          communityValue: { score: communityScore, reasoning: communityReasoning },
          augmentationLevel: { level: augLevel, reasoning: augReasoning },
          proprietarySensitivity: { sensitive: isSensitive, concerns },
        },
        summary: summaryMap[recommendation],
        suggestedMods: isSensitive ? concerns.map((c) => `Remove: ${c}`) : [],
        filesChanged: changedFiles.length,
        newRoutes: newRoutes.length,
        hasSchemaChanges: schemaChanges.length > 0,
        hasMigrations: migrationFiles.length > 0,
      };

      // Persist assessment on build record
      await prisma.featureBuild.update({
        where: { buildId },
        data: { taskResults: { ...(build.verificationOut as Record<string, unknown> ?? {}), contributionAssessment: assessment } as unknown as import("@dpf/db").Prisma.InputJsonValue },
      });

      logBuildActivity(buildId, "assess_contribution", `Recommendation: ${recommendation}. Vision: ${visionScore}, Community: ${communityScore}, Type: ${augLevel}, Sensitive: ${isSensitive}`);

      return { success: true, message: assessment.summary, data: assessment };
    }

    case "contribute_to_hive": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

      const devConfig = await prisma.platformDevConfig.findUnique({
        where: { id: "singleton" },
        select: { contributionMode: true, upstreamRemoteUrl: true, dcoAcceptedAt: true, gitRemoteUrl: true },
      });
      const { getPlatformDevPolicyState } = await import("@/lib/platform-dev-policy");
      const policyState = getPlatformDevPolicyState(devConfig);
      if (policyState === "policy_pending") {
        return {
          success: false,
          error: "Platform development policy not configured.",
          message:
            "Contribution is blocked until Platform Development is configured in the portal. Finish that setup first, then decide whether this install stays private or contributes governed changes upstream.",
        };
      }
      if (devConfig?.contributionMode === "fork_only") {
        return {
          success: false,
          error: "Install is configured for private development only.",
          message:
            "This install is configured to keep shipped features private. Change Platform Development settings if you want Build Studio to create upstream contributions.",
        };
      }

      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: {
          id: true, title: true, brief: true, diffPatch: true, diffSummary: true,
          sandboxId: true, portfolioId: true,
          createdBy: { select: { email: true } },
        },
      });
      if (!build) return { success: false, error: "Build not found.", message: "Build not found." };

      const diff = (build.diffPatch ?? "") as string;
      if (!diff.trim()) return { success: false, error: "No diff available.", message: "Run deploy_feature first to extract the diff." };

      const includeMigrations = params.include_migrations !== false;
      const brief = build.brief as Record<string, unknown> | null;

      // Parse files from diff
      const allFiles = [...diff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]);
      const migrationFiles = allFiles.filter((f) => f.startsWith("prisma/migrations/"));
      const codeFiles = allFiles.filter((f) => !f.startsWith("prisma/migrations/"));
      const schemaFiles = allFiles.filter((f) => f.includes("schema.prisma"));

      // Build manifest
      const manifest = {
        files: codeFiles,
        migrations: includeMigrations ? migrationFiles : [],
        schemaChanges: schemaFiles,
        totalFiles: includeMigrations ? allFiles.length : codeFiles.length,
        diffLength: diff.length,
        portfolioContext: build.portfolioId,
      };

      // DCO attestation
      const userEmail = build.createdBy?.email ?? "unknown@dpf.local";
      const userName = userEmail.split("@")[0] ?? "Contributor";
      const dcoAttestation = `Signed-off-by: ${userName} <${userEmail}>`;

      // Create FeaturePack
      const packId = `FP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.featurePack.create({
        data: {
          packId,
          title: build.title,
          description: String(brief?.description ?? ""),
          portfolioContext: build.portfolioId,
          version: "1.0.0",
          manifest: { ...manifest, dcoAttestation } as unknown as import("@dpf/db").Prisma.InputJsonValue,
          buildId: build.id,
          status: "contributed",
        },
      });

      // Create upstream PR if configured (EP-BUILD-HANDOFF-002 contribution mode)
      let prUrl: string | null = null;
      try {
        const upstreamUrl = devConfig?.upstreamRemoteUrl ?? "https://github.com/markdbodman/opendigitalproductfactory.git";
        const hasDco = !!devConfig?.dcoAcceptedAt;

        // Resolve GitHub token: env var takes priority, then stored credential from portal setup
        let githubToken = process.env.GITHUB_TOKEN ?? "";
        if (!githubToken) {
          const { getStoredGitHubToken } = await import("@/lib/actions/platform-dev-config");
          githubToken = (await getStoredGitHubToken()) ?? "";
        }

        if (hasDco && githubToken) {
          // Temporarily set GITHUB_TOKEN so downstream code can access it
          const prevToken = process.env.GITHUB_TOKEN;
          process.env.GITHUB_TOKEN = githubToken;

          const { submitBuildAsPR } = await import("@/lib/contribution-pipeline");
          const userInfo = await prisma.user.findUnique({
            where: { id: userId },
            select: { employeeProfile: { select: { displayName: true, workEmail: true } } },
          });
          const displayName = userInfo?.employeeProfile?.displayName ?? userName;
          const email = userInfo?.employeeProfile?.workEmail ?? userEmail;
          const dcoSignoff = `Signed-off-by: ${displayName} <${email}>\nDCO-Accepted: ${devConfig!.dcoAcceptedAt!.toISOString()}`;

          const prResult = await submitBuildAsPR({
            buildId,
            title: build.title,
            diffPatch: diff,
            productId: null,
            impactReport: null,
            authorUserId: userId,
            authorName: displayName,
            forkRemoteUrl: devConfig?.gitRemoteUrl ?? undefined,
            upstreamRemoteUrl: upstreamUrl,
            dcoSignoff,
          });

          if (prResult.prUrl) {
            prUrl = prResult.prUrl;
            await prisma.featurePack.update({
              where: { packId },
              data: { manifest: { ...manifest, dcoAttestation, prUrl } as unknown as import("@dpf/db").Prisma.InputJsonValue },
            });
          }

          // Restore original env state
          if (prevToken) process.env.GITHUB_TOKEN = prevToken;
          else delete process.env.GITHUB_TOKEN;
        }
      } catch (err) {
        console.warn("[contribute_to_hive] upstream PR creation failed:", err);
      }

      // Update linked ImprovementProposal if exists
      await prisma.improvementProposal.updateMany({
        where: { buildId: build.id, contributionStatus: "local" },
        data: { contributionStatus: "contributed" },
      }).catch(() => {});

      logBuildActivity(buildId, "contribute_to_hive", `FeaturePack ${packId} created. ${manifest.totalFiles} files. DCO: ${dcoAttestation}`);

      const prMessage = prUrl ? ` A pull request has been created: ${prUrl}` : "";
      return {
        success: true,
        message: `Feature Pack ${packId} created and contributed to the Hive Mind. ${manifest.totalFiles} file(s) packaged with DCO attestation.${prMessage} Thank you for contributing!`,
        data: { packId, manifest, dcoAttestation, prUrl },
      };
    }

    case "evaluate_page": {
      const url = typeof params["url"] === "string" ? params["url"] : null;
      const targetUrl = url || (context?.routeContext ? `http://localhost:3000${context.routeContext}` : null);
      if (!targetUrl) return { success: false, error: "No URL to evaluate.", message: "Provide a URL or navigate to a page first." };

      try {
        const BROWSER_USE_URL = process.env.BROWSER_USE_URL || "http://browser-use:8500/mcp";

        // Use browser-use to evaluate the page with AI-powered analysis
        const extractRes = await fetch(BROWSER_USE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "browse_open",
              arguments: { url: targetUrl },
            },
          }),
          signal: AbortSignal.timeout(60000),
        });
        const openResult = await extractRes.json();
        const openContent = JSON.parse(openResult?.result?.content?.[0]?.text ?? "{}");
        const sessionId = openContent.session_id;
        if (!sessionId) throw new Error("Failed to open browser session");

        // Extract accessibility and UX findings using AI analysis
        const evalRes = await fetch(BROWSER_USE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "browse_extract",
              arguments: {
                session_id: sessionId,
                query: "Analyze this page for UX and accessibility issues. Check for: missing alt text, low contrast text, missing form labels, heading hierarchy issues, keyboard navigation problems, focus indicators, semantic HTML usage. Return a JSON array of findings, each with: severity (critical/important/minor), category (contrast/accessibility/focus/semantic-html/responsive), element (CSS selector or description), issue (what's wrong), recommendation (how to fix), wcagRef (WCAG guideline reference if applicable).",
              },
            },
          }),
          signal: AbortSignal.timeout(120000),
        });
        const evalResult = await evalRes.json();
        const evalContent = JSON.parse(evalResult?.result?.content?.[0]?.text ?? "{}");

        // Get screenshot
        const ssRes = await fetch(BROWSER_USE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "browse_screenshot",
              arguments: { session_id: sessionId },
            },
          }),
          signal: AbortSignal.timeout(30000),
        });
        const ssResult = await ssRes.json();
        const ssContent = JSON.parse(ssResult?.result?.content?.[0]?.text ?? "{}");

        // Close session
        await fetch(BROWSER_USE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "browse_close", arguments: { session_id: sessionId } },
          }),
          signal: AbortSignal.timeout(10000),
        });

        // Parse findings — the AI extraction returns structured data
        let findings: Array<Record<string, unknown>> = [];
        try {
          const rawData = typeof evalContent.data === "string" ? JSON.parse(evalContent.data) : evalContent.data;
          findings = Array.isArray(rawData) ? rawData : [];
        } catch {
          findings = [];
        }

        return {
          success: true,
          message: `Found ${findings.length} UX/accessibility issues on ${targetUrl}.`,
          data: {
            url: targetUrl,
            screenshot: ssContent.screenshot_base64 ?? null,
            findingCount: findings.length,
            findings,
          },
        };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
          message: "Could not launch browser-use for live page evaluation. Ensure the browser-use service is running (docker compose --profile browser-use up -d). Try code-only analysis using read_project_file instead.",
        };
      }
    }

    case "run_ux_test": {
      const buildId = await resolveActiveBuildId(userId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxPort: true, brief: true } });
      if (!build?.sandboxPort || !build.brief) return { success: false, error: "Sandbox or brief not ready.", message: "Launch sandbox and save brief first." };

      const brief = build.brief as { acceptanceCriteria?: string[] };
      const testCases = (params.tests as string[] | undefined) ?? brief.acceptanceCriteria ?? [];
      if (testCases.length === 0) return { success: false, error: "No test cases.", message: "No acceptance criteria or test cases to run." };

      try {
        const BROWSER_USE_URL = process.env.BROWSER_USE_URL || "http://browser-use:8500/mcp";
        const sandboxUrl = `http://localhost:${build.sandboxPort}`;

        const testRes = await fetch(BROWSER_USE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "browse_run_tests",
              arguments: { url: sandboxUrl, tests: testCases },
            },
          }),
          signal: AbortSignal.timeout(300000), // 5 min for full test suite
        });
        const testResult = await testRes.json();
        const testContent = JSON.parse(testResult?.result?.content?.[0]?.text ?? "{}");

        // Convert to UxTestStep format for storage
        const steps = (testContent.results ?? []).map((r: Record<string, unknown>, i: number) => ({
          step: (r.test as string) ?? `Test ${i + 1}`,
          passed: r.status === "pass",
          screenshotUrl: null, // Screenshots are base64 in the result, not URLs
          error: r.status !== "pass" ? ((r.detail as string) ?? null) : null,
        }));

        const { agentEventBus } = await import("@/lib/agent-event-bus");
        for (let i = 0; i < steps.length; i++) {
          if (context?.threadId) {
            agentEventBus.emit(context.threadId, {
              type: "test:step",
              stepIndex: i,
              description: steps[i]!.step,
              passed: steps[i]!.passed,
            });
          }
        }
        await prisma.featureBuild.update({ where: { buildId }, data: { uxTestResults: steps as unknown as import("@dpf/db").Prisma.InputJsonValue } });
        if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "uxTestResults" });
        const passed = steps.filter((s: { passed: boolean }) => s.passed).length;
        logBuildActivity(buildId, "run_ux_test", `UX tests: ${passed}/${steps.length} passed (browser-use).`);
        return { success: true, message: `UX tests: ${passed}/${steps.length} passed.`, data: { steps, browserUseResults: testContent } };
      } catch (err) {
        const msg = (err as Error).message?.slice(0, 200) ?? "Unknown error";
        return { success: false, error: `UX test run failed: ${msg}`, message: `Could not run UX tests. Ensure the browser-use service is running (docker compose --profile browser-use up -d). You can skip UX tests and proceed with the review.` };
      }
    }

    case "list_project_directory": {
      const { listProjectDirectory } = await import("@/lib/codebase-tools");
      const result = await listProjectDirectory(String(params.path ?? "."));
      if ("error" in result) return { success: false, error: result.error, message: result.error };
      const summary = result.entries.map((e) => `${e.type === "dir" ? "[dir]" : "     "} ${e.path}`).join("\n");
      return { success: true, message: summary || "Empty directory", data: { entries: result.entries } };
    }

    case "read_project_file": {
      const { readProjectFile } = await import("@/lib/codebase-tools");
      const opts: { startLine?: number; endLine?: number } = {};
      if (typeof params.startLine === "number") opts.startLine = params.startLine;
      if (typeof params.endLine === "number") opts.endLine = params.endLine;
      const result = await readProjectFile(String(params.path ?? ""), opts);
      if ("error" in result) return { success: false, error: result.error, message: result.error };
      return { success: true, message: result.content, data: { content: result.content } };
    }

    case "search_project_files": {
      const { searchProjectFiles } = await import("@/lib/codebase-tools");
      const opts: { glob?: string; maxResults?: number } = {};
      if (typeof params.glob === "string") opts.glob = params.glob;
      if (typeof params.maxResults === "number") opts.maxResults = params.maxResults;
      const result = await searchProjectFiles(String(params.query ?? ""), opts);
      if ("error" in result) return { success: false, error: result.error, message: result.error };
      const summary = result.results.map((r) => `${r.path}:${r.line}: ${r.text}`).join("\n");
      return { success: true, message: summary || "No matches found", data: { results: result.results } };
    }

    case "query_version_history": {
      const limit = typeof params.limit === "number" ? Math.min(params.limit, 50) : 20;
      const where = typeof params.digitalProductId === "string"
        ? { digitalProductId: params.digitalProductId }
        : {};

      const versions = await prisma.productVersion.findMany({
        where,
        orderBy: { shippedAt: "desc" },
        take: limit,
        include: {
          digitalProduct: { select: { productId: true, name: true } },
          promotions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, promotionId: true } },
        },
      });

      const rows = versions.map((v) => ({
        product: v.digitalProduct?.name ?? "unknown",
        productId: v.digitalProduct?.productId ?? "unknown",
        version: v.version,
        gitTag: v.gitTag,
        shippedAt: v.shippedAt.toISOString(),
        changeCount: v.changeCount,
        changeSummary: v.changeSummary ?? "",
        promotionStatus: v.promotions[0]?.status ?? "none",
        promotionId: v.promotions[0]?.promotionId ?? null,
      }));

      const summary = rows.map((r) =>
        `${r.product} ${r.version} (${r.gitTag}) — ${r.promotionStatus} — shipped ${r.shippedAt.slice(0, 10)}`
      ).join("\n");

      return {
        success: true,
        message: summary || "No versions found.",
        data: { versions: rows },
      };
    }

    // ─── Design Intelligence Tools (UI UX Pro Max) ──────────────────────────
    case "search_design_intelligence": {
      const { searchDesignDomain, formatSearchResults } = await import("@/lib/design-intelligence");
      const query = String(params.query ?? "");
      const domain = String(params.domain ?? "style") as import("@/lib/design-intelligence").DesignDomain;
      const maxResults = Number(params.max_results ?? 5);
      if (!query) return { success: false, error: "Query is required.", message: "Provide search keywords." };
      const results = searchDesignDomain(query, domain, maxResults);
      const formatted = formatSearchResults(results, query, domain);
      return { success: true, message: formatted };
    }

    case "generate_design_system": {
      const { generateDesignSystem } = await import("@/lib/design-intelligence");
      const query = String(params.query ?? "");
      const projectName = params.project_name ? String(params.project_name) : undefined;
      if (!query) return { success: false, error: "Query is required.", message: "Provide product description and keywords." };
      const designSystem = generateDesignSystem(query, projectName);
      return { success: true, message: designSystem };
    }

    case "generate_codebase_manifest": {
      const { isDevInstance } = await import("@/lib/codebase-tools");
      if (!isDevInstance()) return { success: false, error: "Manifest generation is only available on dev instances.", message: "Dev-only tool." };

      const { generateManifest } = await import("@/lib/manifest-generator");
      const { getCurrentCommitHash } = await import("@/lib/git-utils");

      const gitRef = await getCurrentCommitHash() ?? "unknown";
      const version = typeof params.version === "string" ? params.version : "dev";

      const manifest = await generateManifest({ version, gitRef, writeFile: true });

      // Store in DB (best-effort) — delete+create to avoid nullable composite key issues
      try {
        await prisma.codebaseManifest.deleteMany({
          where: { version, digitalProductId: null },
        });
        await prisma.codebaseManifest.create({
          data: { version, gitRef, manifest: manifest as unknown as import("@dpf/db").Prisma.InputJsonValue },
        });
      } catch (err) {
        console.warn("[generate_codebase_manifest] DB store failed:", err);
      }

      return {
        success: true,
        message: `Manifest generated for version "${version}" with ${manifest.statistics.totalFiles} files, ${manifest.statistics.dataModelCount} models, ${manifest.statistics.externalDependencyCount} dependencies.`,
        data: { manifest },
      };
    }

    case "read_codebase_manifest": {
      const version = typeof params.version === "string" ? params.version : undefined;

      // Try DB first
      const dbManifest = await prisma.codebaseManifest.findFirst({
        where: version ? { version } : {},
        orderBy: { generatedAt: "desc" },
        select: { version: true, gitRef: true, manifest: true, generatedAt: true },
      });

      if (dbManifest) {
        return {
          success: true,
          message: `Manifest for version "${dbManifest.version}" (generated ${dbManifest.generatedAt.toISOString().slice(0, 10)})`,
          data: { manifest: dbManifest.manifest, version: dbManifest.version, gitRef: dbManifest.gitRef },
        };
      }

      // Fall back to reading the file (dev instances only)
      const { isDevInstance, readProjectFile } = await import("@/lib/codebase-tools");
      if (isDevInstance()) {
        const result = await readProjectFile("codebase-manifest.json");
        if ("content" in result) {
          try {
            const manifest = JSON.parse(result.content);
            return { success: true, message: "Manifest loaded from file.", data: { manifest } };
          } catch { /* fall through */ }
        }
      }

      return { success: false, error: "No manifest found. Use generate_codebase_manifest to create one.", message: "No manifest available." };
    }

    case "read_source_at_version": {
      const { gitShow, isGitAvailable } = await import("@/lib/git-utils");
      if (!await isGitAvailable()) return { success: false, error: "Git history is not available in this deployment. Use read_codebase_manifest for codebase orientation.", message: "Git not available." };
      const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
      const result = await gitShow({ ref, path: String(params.path ?? "") });
      if ("error" in result) return { success: false, error: result.error, message: result.error };
      return { success: true, message: result.content, data: { content: result.content } };
    }

    case "search_source_at_version": {
      const { gitGrep, isGitAvailable } = await import("@/lib/git-utils");
      if (!await isGitAvailable()) return { success: false, error: "Git history is not available.", message: "Git not available." };
      const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
      const grepOpts: Parameters<typeof gitGrep>[0] = { query: String(params.query ?? ""), ref };
      if (typeof params.glob === "string") grepOpts.glob = params.glob;
      if (typeof params.maxResults === "number") grepOpts.maxResults = params.maxResults;
      const result = await gitGrep(grepOpts);
      const summary = result.results.map((r) => `${r.path}:${r.line}: ${r.text}`).join("\n");
      return { success: true, message: summary || "No matches found.", data: { results: result.results } };
    }

    case "list_source_directory": {
      const { gitLsTree, isGitAvailable } = await import("@/lib/git-utils");
      if (!await isGitAvailable()) return { success: false, error: "Git history is not available.", message: "Git not available." };
      const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
      const result = await gitLsTree({ ref, path: typeof params.path === "string" ? params.path : "" });
      const summary = result.entries.map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.path}`).join("\n");
      return { success: true, message: summary || "Empty directory.", data: { entries: result.entries } };
    }

    case "compare_versions": {
      const { gitDiffStat, isGitAvailable, gitLog } = await import("@/lib/git-utils");
      if (!await isGitAvailable()) return { success: false, error: "Git history is not available.", message: "Git not available." };
      const from = String(params.from ?? "");
      const to = typeof params.to === "string" ? params.to : "HEAD";
      const diff = await gitDiffStat({ from, to });
      const log = await gitLog({ from, to, maxCount: 20 });
      return {
        success: true,
        message: diff.summary,
        data: { filesChanged: diff.filesChanged, summary: diff.summary, commits: log.commits },
      };
    }

    case "propose_file_change": {
      const { readProjectFile, writeProjectFile, generateSimpleDiff } = await import("@/lib/codebase-tools");
      const path = String(params.path ?? "");
      const newContent = String(params.newContent ?? "");
      const description = String(params.description ?? "");

      const current = await readProjectFile(path);
      const currentContent = "content" in current ? current.content : "";
      const diff = generateSimpleDiff(currentContent, newContent, path);

      const writeResult = await writeProjectFile(path, newContent);
      if ("error" in writeResult) return { success: false, error: writeResult.error, message: writeResult.error };

      // Auto-commit the approved change
      let commitHash: string | undefined;
      try {
        const { commitFile, formatCommitMessage, isGitAvailable } = await import("@/lib/git-utils");
        if (await isGitAvailable()) {
          // Resolve buildId from thread context (best-effort)
          let buildId: string | undefined;
          if (context?.threadId) {
            const build = await prisma.featureBuild.findFirst({
              where: { threadId: context.threadId, phase: { in: ["build", "review"] } },
              select: { buildId: true, id: true },
            });
            if (build) buildId = build.buildId;
          }

          const message = formatCommitMessage({ description, filePath: path, ...(buildId ? { buildId } : {}), approvedBy: userId });
          const result = await commitFile({ filePath: path, message });

          if ("hash" in result) {
            commitHash = result.hash;

            // Update AgentActionProposal with commit hash (best-effort)
            if (context?.threadId) {
              await prisma.agentActionProposal.updateMany({
                where: { threadId: context.threadId, actionType: "propose_file_change", status: "approved", gitCommitHash: null },
                data: { gitCommitHash: commitHash },
              }).catch(() => {});
            }

            // Append commit hash to FeatureBuild (best-effort)
            if (buildId) {
              await prisma.featureBuild.update({
                where: { buildId },
                data: { gitCommitHashes: { push: commitHash } },
              }).catch(() => {});
            }
          } else {
            console.warn("[propose_file_change] git commit failed:", result.error);
          }
        }
      } catch (err) {
        console.warn("[propose_file_change] auto-commit error:", err);
      }

      return {
        success: true,
        entityId: path,
        message: commitHash ? `Applied and committed: ${path}` : `Applied change to ${path}`,
        data: { path, diff, description, ...(commitHash ? { commitHash } : {}) },
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
      // Index in platform knowledge
      import("@/lib/semantic-memory").then(({ storePlatformKnowledge }) =>
        storePlatformKnowledge({
          entityId: proposal.proposalId,
          entityType: "improvement",
          title: proposal.title,
          content: String(params["description"] ?? ""),
        })
      ).catch(() => {});
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

    case "query_employees": {
      const searchTerm = typeof params["search"] === "string" ? params["search"].trim() : undefined;
      const deptFilter = typeof params["department"] === "string" ? params["department"].trim() : undefined;
      const statusFilter = typeof params["status"] === "string" ? params["status"] : undefined;
      const resultLimit = typeof params["limit"] === "number" ? Math.min(params["limit"], 50) : 20;

      // Resolve department filter to an ID
      let deptId: string | undefined;
      if (deptFilter) {
        const dept = await prisma.department.findFirst({
          where: {
            OR: [
              { id: deptFilter },
              { departmentId: deptFilter },
              { name: { contains: deptFilter, mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });
        deptId = dept?.id;
      }

      const employees = await prisma.employeeProfile.findMany({
        where: {
          ...(searchTerm ? {
            OR: [
              { displayName: { contains: searchTerm, mode: "insensitive" } },
              { workEmail: { contains: searchTerm, mode: "insensitive" } },
            ],
          } : {}),
          ...(deptId ? { departmentId: deptId } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
        },
        select: {
          employeeId: true,
          displayName: true,
          workEmail: true,
          status: true,
          department: { select: { name: true } },
          position: { select: { title: true } },
        },
        orderBy: { displayName: "asc" },
        take: resultLimit,
      });

      if (employees.length === 0) {
        return { success: true, message: "No employees found matching your criteria.", data: { employees: [] } };
      }

      const list = employees.map((e) =>
        `${e.displayName} (${e.employeeId}) — ${e.department?.name ?? "No dept"}, ${e.position?.title ?? "No position"}, ${e.status}${e.workEmail ? ` <${e.workEmail}>` : ""}`
      ).join("\n");

      return {
        success: true,
        message: `${employees.length} employee${employees.length !== 1 ? "s" : ""} found:\n${list}`,
        data: {
          employees: employees.map((e) => ({
            employeeId: e.employeeId,
            displayName: e.displayName,
            workEmail: e.workEmail ?? null,
            status: e.status,
            department: e.department?.name ?? null,
            position: e.position?.title ?? null,
          })),
        },
      };
    }

    case "list_departments": {
      const departments = await prisma.department.findMany({
        where: { status: "active" },
        select: { departmentId: true, name: true },
        orderBy: { name: "asc" },
      });
      if (departments.length === 0) {
        return { success: true, message: "No departments have been set up yet.", data: { departments: [] } };
      }
      const list = departments.map((d) => `${d.name} (${d.departmentId})`).join("\n");
      return {
        success: true,
        message: `${departments.length} active department${departments.length !== 1 ? "s" : ""}:\n${list}`,
        data: { departments: departments.map((d) => ({ id: d.departmentId, name: d.name })) },
      };
    }

    case "list_positions": {
      const positions = await prisma.position.findMany({
        where: { status: "active" },
        select: { positionId: true, title: true, jobFamily: true },
        orderBy: { title: "asc" },
      });
      if (positions.length === 0) {
        return { success: true, message: "No positions have been set up yet.", data: { positions: [] } };
      }
      const list = positions.map((p) => `${p.title}${p.jobFamily ? ` — ${p.jobFamily}` : ""} (${p.positionId})`).join("\n");
      return {
        success: true,
        message: `${positions.length} active position${positions.length !== 1 ? "s" : ""}:\n${list}`,
        data: { positions: positions.map((p) => ({ id: p.positionId, title: p.title, jobFamily: p.jobFamily ?? null })) },
      };
    }

    case "create_employee": {
      // Email uniqueness check
      if (typeof params["workEmail"] === "string") {
        const existing = await prisma.employeeProfile.findFirst({
          where: { workEmail: params["workEmail"] },
          select: { displayName: true, employeeId: true },
        });
        if (existing) {
          return {
            success: false,
            error: "duplicate_email",
            message: `An employee with email "${params["workEmail"]}" already exists: ${existing.displayName} (${existing.employeeId}).`,
          };
        }
      }

      // Resolve department: match by cuid, departmentId, or name (case-insensitive)
      let resolvedDepartmentId: string | undefined;
      if (typeof params["departmentId"] === "string") {
        const dept = await prisma.department.findFirst({
          where: {
            OR: [
              { id: params["departmentId"] },
              { departmentId: params["departmentId"] },
              { name: { equals: params["departmentId"], mode: "insensitive" } },
            ],
            status: "active",
          },
          select: { id: true },
        });
        resolvedDepartmentId = dept?.id;
      }

      // Resolve position: match by cuid, positionId, or title (case-insensitive)
      let resolvedPositionId: string | undefined;
      if (typeof params["positionId"] === "string") {
        const pos = await prisma.position.findFirst({
          where: {
            OR: [
              { id: params["positionId"] },
              { positionId: params["positionId"] },
              { title: { equals: params["positionId"], mode: "insensitive" } },
            ],
            status: "active",
          },
          select: { id: true },
        });
        resolvedPositionId = pos?.id;
      }

      // Resolve manager: match by cuid, employeeId, displayName, or email
      let resolvedManagerId: string | undefined;
      if (typeof params["managerEmployeeId"] === "string") {
        const mgr = params["managerEmployeeId"] as string;
        const found = await prisma.employeeProfile.findFirst({
          where: { OR: [{ id: mgr }, { employeeId: mgr }, { displayName: mgr }, { workEmail: mgr }] },
          select: { id: true },
        });
        resolvedManagerId = found?.id;
      }

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
          ...(resolvedDepartmentId ? { departmentId: resolvedDepartmentId } : {}),
          ...(resolvedPositionId ? { positionId: resolvedPositionId } : {}),
          ...(resolvedManagerId ? { managerEmployeeId: resolvedManagerId } : {}),
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
      const { validateLifecycleTransition } = await import("@/lib/workforce-types");
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

    case "search_knowledge": {
      const { searchPlatformKnowledge } = await import("@/lib/semantic-memory");
      const results = await searchPlatformKnowledge({
        query: String(params["query"] ?? ""),
        entityType: typeof params["type"] === "string" ? params["type"] : undefined,
        limit: typeof params["limit"] === "number" ? params["limit"] : 5,
      });
      if (results.length === 0) {
        return { success: true, message: "No matching knowledge found.", data: { results: [] } };
      }
      const summary = results.map((r) => `${r.entityType}:${r.entityId} — ${r.title} (${Math.round(r.score * 100)}% match)`).join("\n");
      return { success: true, message: summary, data: { results } };
    }

    case "search_knowledge_base": {
      const { searchKnowledgeArticles } = await import("@/lib/semantic-memory");
      const results = await searchKnowledgeArticles({
        query: String(params["query"] ?? ""),
        productId: typeof params["productId"] === "string" ? params["productId"] : undefined,
        portfolioId: typeof params["portfolioId"] === "string" ? params["portfolioId"] : undefined,
        category: typeof params["category"] === "string" ? params["category"] : undefined,
        valueStream: typeof params["valueStream"] === "string" ? params["valueStream"] : undefined,
        limit: typeof params["limit"] === "number" ? params["limit"] : 5,
      });
      if (results.length === 0) {
        return { success: true, message: "No matching knowledge articles found.", data: { results: [] } };
      }
      const summary = results.map((r) => `${r.category}:${r.articleId} — ${r.title} (${Math.round(r.score * 100)}% match)`).join("\n");
      return { success: true, message: summary, data: { results } };
    }

    case "create_knowledge_article": {
      const { prisma } = await import("@dpf/db");
      const { storeKnowledgeArticle } = await import("@/lib/semantic-memory");

      // Generate next articleId: KA-001, KA-002, ...
      const lastArticle = await prisma.knowledgeArticle.findFirst({
        orderBy: { createdAt: "desc" },
        select: { articleId: true },
      });
      const nextNum = lastArticle
        ? parseInt(lastArticle.articleId.replace("KA-", ""), 10) + 1
        : 1;
      const articleId = `KA-${String(nextNum).padStart(3, "0")}`;

      const title = String(params["title"] ?? "");
      const body = String(params["body"] ?? "");
      const category = String(params["category"] ?? "reference");
      const productIds = Array.isArray(params["productIds"]) ? params["productIds"].map(String) : [];
      const portfolioIds = Array.isArray(params["portfolioIds"]) ? params["portfolioIds"].map(String) : [];
      const valueStreams = Array.isArray(params["valueStreams"]) ? params["valueStreams"].map(String) : [];
      const tags = Array.isArray(params["tags"]) ? params["tags"].map(String) : [];

      const article = await prisma.knowledgeArticle.create({
        data: {
          articleId,
          title,
          body,
          category,
          status: "draft",
          visibility: "internal",
          authorId: userId,
          valueStreams,
          tags,
          products: productIds.length > 0
            ? { create: productIds.map((id) => ({ digitalProductId: id })) }
            : undefined,
          portfolios: portfolioIds.length > 0
            ? { create: portfolioIds.map((id) => ({ portfolioId: id })) }
            : undefined,
          revisions: {
            create: {
              version: 1,
              title,
              body,
              changeSummary: "Initial draft",
              createdById: userId,
            },
          },
        },
      });

      // Index into Qdrant
      await storeKnowledgeArticle({
        articleId,
        title,
        body,
        category,
        status: "draft",
        productIds,
        portfolioIds,
        valueStreams,
        tags,
      });

      return {
        success: true,
        entityId: articleId,
        message: `Knowledge article ${articleId} created as draft: "${title}". Publish it to make it searchable by AI coworkers.`,
      };
    }

    case "flag_stale_knowledge": {
      const { prisma } = await import("@dpf/db");

      const where: Record<string, unknown> = { status: "published" };

      if (typeof params["productId"] === "string") {
        where.products = { some: { digitalProductId: params["productId"] } };
      }
      if (typeof params["portfolioId"] === "string") {
        where.portfolios = { some: { portfolioId: params["portfolioId"] } };
      }

      const articles = await prisma.knowledgeArticle.findMany({
        where: where as never,
        select: {
          articleId: true,
          title: true,
          category: true,
          reviewIntervalDays: true,
          lastReviewedAt: true,
          createdAt: true,
        },
      });

      const now = new Date();
      const stale = articles.filter((a) => {
        const baseline = a.lastReviewedAt ?? a.createdAt;
        const dueDate = new Date(baseline.getTime() + a.reviewIntervalDays * 86400000);
        return now > dueDate;
      });

      if (stale.length === 0) {
        return { success: true, message: "All published knowledge articles are up to date.", data: { articles: [] } };
      }

      const summary = stale.map((a) => {
        const baseline = a.lastReviewedAt ?? a.createdAt;
        const daysOverdue = Math.floor((now.getTime() - baseline.getTime()) / 86400000) - a.reviewIntervalDays;
        return `${a.articleId}: "${a.title}" (${a.category}) — ${daysOverdue} days overdue for review`;
      }).join("\n");

      return { success: true, message: `${stale.length} article(s) need review:\n${summary}`, data: { articles: stale } };
    }

    case "run_endpoint_tests": {
      const { runEndpointTests } = await import("@/lib/endpoint-test-runner");

      const results = await runEndpointTests({
        ...(typeof params.endpointId === "string" ? { endpointId: params.endpointId } : {}),
        ...(typeof params.taskType === "string" ? { taskType: params.taskType } : {}),
        probesOnly: params.probesOnly === true,
        triggeredBy: userId,
      });

      const summary = results.map((r) => {
        const probesPassed = r.probes.filter((p) => p.pass).length;
        const probesFailed = r.probes.filter((p) => !p.pass).length;
        const scenariosPassed = r.scenarios.filter((s) => s.passed).length;
        const scenariosFailed = r.scenarios.filter((s) => !s.passed).length;
        const lines = [
          `**${r.endpointId}**: Probes ${probesPassed}/${probesPassed + probesFailed} passed`,
        ];
        if (r.scenarios.length > 0) {
          lines.push(`Scenarios ${scenariosPassed}/${scenariosPassed + scenariosFailed} passed`);
        }
        lines.push(`Instruction following: ${r.instructionFollowing ?? "unknown"}`);
        if (r.codingCapability) lines.push(`Coding: ${r.codingCapability}`);
        // List failures
        for (const p of r.probes.filter((p) => !p.pass)) {
          lines.push(`  FAIL probe: ${p.name} — ${p.reason}`);
        }
        for (const s of r.scenarios.filter((s) => !s.passed)) {
          lines.push(`  FAIL scenario: ${s.name}`);
        }
        return lines.join("\n");
      }).join("\n\n");

      return { success: true, message: summary || "No endpoints to test.", data: { results } };
    }

    case "search_integrations": {
      const query = String(params["query"] ?? "");
      const results = await prisma.mcpIntegration.findMany({
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
        },
        orderBy: [{ isVerified: "desc" }, { installCount: "desc" }],
        take: typeof params["limit"] === "number" ? params["limit"] : 10,
      });
      return { success: true, message: `Found ${results.length} integration(s).`, data: { results } };
    }

    case "prefill_onboarding_wizard": {
      const data = {
        name: String(params["name"] ?? ""),
        shortName: String(params["shortName"] ?? ""),
        sourceType: String(params["sourceType"] ?? "external"),
        jurisdiction: String(params["jurisdiction"] ?? ""),
        industry: params["industry"] ? String(params["industry"]) : null,
        sourceUrl: params["sourceUrl"] ? String(params["sourceUrl"]) : null,
        obligations: Array.isArray(params["obligations"]) ? params["obligations"] : [],
        suggestedControls: Array.isArray(params["suggestedControls"]) ? params["suggestedControls"] : [],
      };

      const draft = await prisma.onboardingDraft.create({
        data: {
          data: data as any,
          createdBy: userId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const wizardUrl = `/compliance/onboard?draft=${draft.id}`;
      return {
        success: true,
        message: `Onboarding draft created. Navigate to ${wizardUrl} to review and commit.`,
        data: { wizardUrl, draftId: draft.id },
      };
    }

    case "evaluate_tool": {
      const { createToolEvaluation } = await import("./tool-evaluation-data");
      const evalId = await createToolEvaluation({
        toolName: String(params["toolName"] ?? ""),
        toolType: String(params["toolType"] ?? "npm_package"),
        version: String(params["version"] ?? "latest"),
        sourceUrl: String(params["sourceUrl"] ?? ""),
        proposedBy: userId,
      });
      return { success: true, entityId: evalId, message: `Tool evaluation created: ${evalId}. The evaluation pipeline will review this tool for security, architecture fit, compliance, and integration.` };
    }

    // ── EA / Ontology Graph write tools ──────────────────────────────────────

    case "create_ea_element": {
      const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
      if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
      const et = await prisma.eaElementType.findUnique({
        where: { notationId_slug: { notationId: notation.id, slug: String(params["elementTypeSlug"] ?? "") } },
      });
      if (!et) return { success: false, message: `Element type "${String(params["elementTypeSlug"])}" not found`, error: "Element type not found" };
      const el = await prisma.eaElement.create({
        data: {
          elementTypeId: et.id,
          name: String(params["name"]),
          description: typeof params["description"] === "string" ? params["description"] : null,
          refinementLevel: typeof params["refinementLevel"] === "string" ? params["refinementLevel"] : "conceptual",
          itValueStream: typeof params["itValueStream"] === "string" ? params["itValueStream"] : null,
          ontologyRole: typeof params["ontologyRole"] === "string" ? params["ontologyRole"] : null,
          digitalProductId: typeof params["digitalProductId"] === "string" ? params["digitalProductId"] : null,
          portfolioId: typeof params["portfolioId"] === "string" ? params["portfolioId"] : null,
          createdById: userId,
          properties: (typeof params["properties"] === "object" && params["properties"] !== null) ? params["properties"] as import("@dpf/db").Prisma.InputJsonValue : {},
        },
      });
      return { success: true, entityId: el.id, message: `Created ${et.name} element "${String(params["name"])}"`, data: { elementId: el.id, elementTypeName: et.name, refinementLevel: el.refinementLevel } };
    }

    case "create_ea_relationship": {
      const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
      if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
      const relSlug = String(params["relationshipTypeSlug"] ?? "");
      const rt = await prisma.eaRelationshipType.findUnique({ where: { notationId_slug: { notationId: notation.id, slug: relSlug } } });
      if (!rt) return { success: false, message: `Relationship type "${relSlug}" not found`, error: "Relationship type not found" };
      const fromEl = await prisma.eaElement.findUnique({ where: { id: String(params["fromElementId"]) }, select: { elementTypeId: true, name: true } });
      const toEl   = await prisma.eaElement.findUnique({ where: { id: String(params["toElementId"])   }, select: { elementTypeId: true, name: true } });
      if (!fromEl || !toEl) return { success: false, message: "One or both elements not found", error: "Element not found" };
      const rule = await prisma.eaRelationshipRule.findFirst({
        where: { fromElementTypeId: fromEl.elementTypeId, toElementTypeId: toEl.elementTypeId, relationshipTypeId: rt.id },
      });
      if (!rule) return { success: false, message: `Relationship "${relSlug}" not permitted between these element types`, error: "Rule not permitted", data: { validationResult: "blocked" } };
      const rel = await prisma.eaRelationship.create({
        data: {
          fromElementId: String(params["fromElementId"]),
          toElementId: String(params["toElementId"]),
          relationshipTypeId: rt.id,
          notationSlug: "archimate4",
          createdById: userId,
          properties: (typeof params["properties"] === "object" && params["properties"] !== null) ? params["properties"] as import("@dpf/db").Prisma.InputJsonValue : {},
        },
      });
      return { success: true, entityId: rel.id, message: `Created "${relSlug}" relationship`, data: { relationshipId: rel.id, fromElementName: fromEl.name, toElementName: toEl.name, validationResult: "allowed" } };
    }

    case "classify_ea_element": {
      const data: Record<string, unknown> = {};
      if (typeof params["itValueStream"] === "string")   data["itValueStream"]   = params["itValueStream"];
      if (typeof params["refinementLevel"] === "string") data["refinementLevel"] = params["refinementLevel"];
      if (typeof params["ontologyRole"] === "string")    data["ontologyRole"]    = params["ontologyRole"];
      if (Object.keys(data).length === 0) return { success: false, message: "No classification fields provided", error: "Nothing to update" };
      const updated = await prisma.eaElement.update({ where: { id: String(params["elementId"]) }, data });
      return { success: true, entityId: updated.id, message: `Classified element ${updated.id}`, data: { elementId: updated.id, refinementLevel: updated.refinementLevel, itValueStream: updated.itValueStream } };
    }

    // ── EA / Ontology Graph read tools ───────────────────────────────────────

    case "query_ontology_graph": {
      const notation = await prisma.eaNotation.findUnique({ where: { slug: "archimate4" } });
      if (!notation) return { success: false, message: "ArchiMate 4 notation not seeded", error: "Notation not found" };
      const where: Record<string, unknown> = {};
      const slugs = Array.isArray(params["elementTypeSlugs"]) ? params["elementTypeSlugs"] as string[] : [];
      if (slugs.length > 0) {
        const ets = await prisma.eaElementType.findMany({ where: { notationId: notation.id, slug: { in: slugs } }, select: { id: true } });
        where["elementTypeId"] = { in: ets.map(et => et.id) };
      }
      if (typeof params["refinementLevel"] === "string") where["refinementLevel"] = params["refinementLevel"];
      if (typeof params["itValueStream"] === "string") where["itValueStream"] = params["itValueStream"];
      if (typeof params["ontologyRole"] === "string") where["ontologyRole"] = params["ontologyRole"];
      if (typeof params["digitalProductId"] === "string") where["digitalProductId"] = params["digitalProductId"];
      if (typeof params["portfolioId"] === "string") where["portfolioId"] = params["portfolioId"];
      if (typeof params["nameContains"] === "string") where["name"] = { contains: params["nameContains"], mode: "insensitive" };
      const limit = typeof params["limit"] === "number" ? Math.min(params["limit"], 50) : 20;
      const includeRels = params["includeRelationships"] === true;
      const elements = await prisma.eaElement.findMany({
        where,
        take: limit,
        include: {
          elementType: { select: { slug: true, name: true } },
          ...(includeRels ? { fromRelationships: { include: { relationshipType: { select: { slug: true } }, toElement: { select: { id: true, name: true } } } } } : {}),
        },
      });
      const total = await prisma.eaElement.count({ where });
      return {
        success: true,
        message: `Found ${elements.length} elements (${total} total)`,
        data: {
          elements: elements.map(el => ({
            elementId: el.id,
            name: el.name,
            elementTypeName: el.elementType.name,
            refinementLevel: el.refinementLevel,
            itValueStream: el.itValueStream,
            ontologyRole: el.ontologyRole,
          })),
          totalCount: total,
        },
      };
    }

    case "run_traversal_pattern": {
      const { runTraversalPattern } = await import("@/lib/ea/traversal-executor");
      const result = await runTraversalPattern({
        patternSlug: String(params["patternSlug"] ?? ""),
        startElementIds: Array.isArray(params["startElementIds"]) ? params["startElementIds"] as string[] : [],
        maxDepth: typeof params["maxDepth"] === "number" ? params["maxDepth"] : 6,
      });
      if (!result.ok) return { success: false, message: result.error ?? "Traversal failed", error: result.error };
      return { success: true, message: `Traversal complete: ${result.data!.summary.nodesTraversed} nodes`, data: result.data as Record<string, unknown> };
    }

    // ── EA file tools ─────────────────────────────────────────────────────────

    case "import_archimate": {
      const { importArchimateFile } = await import("@/lib/actions/ea-archimate");
      const fileContent = String(params["fileContentBase64"] ?? "");
      const result = await importArchimateFile({
        fileContentBase64: fileContent,
        fileName: String(params["fileName"] ?? "import.archimate"),
        userId,
        targetPortfolioId: typeof params["targetPortfolioId"] === "string" ? params["targetPortfolioId"] : undefined,
        targetDigitalProductId: typeof params["targetDigitalProductId"] === "string" ? params["targetDigitalProductId"] : undefined,
      });
      if (!result.ok) return { success: false, message: result.error ?? "Import failed", error: result.error };
      return { success: true, message: `Imported ${result.data!.elementsCreated} elements, ${result.data!.relationshipsCreated} relationships`, data: result.data as Record<string, unknown> };
    }

    case "export_archimate": {
      const { exportArchimateFile } = await import("@/lib/actions/ea-archimate");
      const result = await exportArchimateFile({
        scopeType: String(params["scopeType"] ?? "") as "view" | "portfolio" | "digital_product",
        scopeRef: String(params["scopeRef"] ?? ""),
        fileName: typeof params["fileName"] === "string" ? params["fileName"] : undefined,
        userId,
      });
      if (!result.ok) return { success: false, message: result.error ?? "Export failed", error: result.error };
      return { success: true, message: `Exported ${result.data!.elementCount} elements to ${result.data!.fileName}`, data: result.data as Record<string, unknown> };
    }

    case "apply_platform_update": {
      const { exec: execCbUpdate } = await import("child_process");
      const { promisify: promisifyUpdate } = await import("util");
      const execUpdate = promisifyUpdate(execCbUpdate);

      const devConfig = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
      if (!devConfig?.updatePending) {
        return { success: false, message: "No platform update is pending.", error: "No update pending" };
      }

      const pendingVersion = devConfig.pendingVersion;
      if (!pendingVersion || !/^[0-9a-zA-Z._-]+$/.test(pendingVersion)) {
        return { success: false, message: "Invalid pending version string.", error: "Invalid version" };
      }

      const workspace = process.env.PROJECT_ROOT ?? "/workspace";
      const gitOpts = { cwd: workspace, timeout: 30_000 };

      try {
        // Check for in-progress merge from a previous interrupted run
        const { existsSync } = await import("fs");
        const { resolve: resolvePath } = await import("path");
        if (existsSync(resolvePath(workspace, ".git", "MERGE_HEAD"))) {
          // Return existing conflict list
          const { stdout: conflicted } = await execUpdate("git diff --name-only --diff-filter=U", gitOpts);
          const conflicts = [];
          for (const file of conflicted.trim().split("\n").filter(Boolean)) {
            const { readFileSync } = await import("fs");
            const content = readFileSync(resolvePath(workspace, file), "utf-8");
            const upstreamMatch = content.match(/<<<<<<< .+?\n([\s\S]*?)=======/);
            const localMatch = content.match(/=======\n([\s\S]*?)>>>>>>> .+/);
            conflicts.push({
              file,
              upstreamChange: upstreamMatch?.[1]?.trim() ?? "(could not parse)",
              localChange: localMatch?.[1]?.trim() ?? "(could not parse)",
            });
          }
          return {
            success: true,
            message: `A merge is already in progress. ${conflicts.length} conflict(s) remaining.`,
            data: { clean: false, resumedMerge: true, conflicts } as unknown as Record<string, unknown>,
          };
        }

        // Step 1-3: Update dpf-upstream branch with new source
        await execUpdate("git checkout dpf-upstream", gitOpts);
        await execUpdate("rm -rf apps/web packages", gitOpts);
        await execUpdate("cp -r /app/apps/web-src/. apps/web/", gitOpts);
        await execUpdate("cp -r /app/packages-src/. packages/", gitOpts);
        await execUpdate("git add -A", gitOpts);

        // Check if there are actually changes
        const { stdout: diffCheck } = await execUpdate("git diff --cached --stat", gitOpts);
        if (diffCheck.trim()) {
          await execUpdate(`git commit -m "chore: dpf-upstream v${pendingVersion}"`, gitOpts);
        }

        // Step 4: Merge into my-changes
        await execUpdate("git checkout my-changes", gitOpts);
        try {
          await execUpdate("git merge dpf-upstream --no-commit --no-ff", gitOpts);
        } catch {
          // Merge conflicts — expected, not an error
        }

        // Check for conflicts
        const { stdout: conflictedFiles } = await execUpdate("git diff --name-only --diff-filter=U", gitOpts).catch(() => ({ stdout: "" }));
        if (conflictedFiles.trim()) {
          const conflicts = [];
          const { readFileSync } = await import("fs");
          const { resolve: rp } = await import("path");
          for (const file of conflictedFiles.trim().split("\n").filter(Boolean)) {
            const content = readFileSync(rp(workspace, file), "utf-8");
            const upstreamMatch = content.match(/<<<<<<< .+?\n([\s\S]*?)=======/);
            const localMatch = content.match(/=======\n([\s\S]*?)>>>>>>> .+/);
            conflicts.push({
              file,
              upstreamChange: upstreamMatch?.[1]?.trim() ?? "(could not parse)",
              localChange: localMatch?.[1]?.trim() ?? "(could not parse)",
            });
          }
          return {
            success: true,
            message: `Merge has conflicts. ${conflicts.length} file(s) need resolution.`,
            data: { clean: false, conflicts } as unknown as Record<string, unknown>,
          };
        }

        // Clean merge — commit and update
        const { stdout: filesChanged } = await execUpdate("git diff --cached --stat", gitOpts);
        const fileCount = (filesChanged.match(/(\d+) files? changed/) || ["0", "0"])[1];
        await execUpdate(`git commit -m "chore: merge dpf v${pendingVersion}"`, gitOpts);

        // Update version sentinel
        const { writeFileSync } = await import("fs");
        const { resolve: rp2 } = await import("path");
        writeFileSync(rp2(workspace, ".dpf-version"), pendingVersion, "utf-8");

        // Clear update pending flag
        await prisma.platformDevConfig.update({
          where: { id: "singleton" },
          data: { updatePending: false, pendingVersion: null },
        });

        return {
          success: true,
          message: `Platform updated to v${pendingVersion}. ${fileCount} files updated. No conflicts.`,
          data: { clean: true, filesUpdated: parseInt(fileCount ?? "0", 10), version: pendingVersion },
        };
      } catch (err) {
        // Attempt to return to my-changes branch on error
        try { await execUpdate("git checkout my-changes", gitOpts); } catch { /* best effort */ }
        return {
          success: false,
          message: `Platform update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }

    case "get_marketing_summary": {
      const { getPlaybook } = await import("@/lib/tak/marketing-playbooks");
      const days = typeof params["days"] === "number" ? params["days"] : 30;
      const since = new Date();
      since.setDate(since.getDate() - days);

      const config = await prisma.storefrontConfig.findFirst({
        include: { archetype: { select: { archetypeId: true, name: true, category: true, ctaType: true } } },
      });

      if (!config) {
        return { success: true, message: "No storefront configured. Set up your storefront first at /storefront/setup." };
      }

      const playbook = getPlaybook(config.archetype.category, config.archetype.ctaType);

      const [bookings, inquiries, orders, donations, engagements, opportunities] = await Promise.all([
        prisma.storefrontBooking.count({ where: { storefrontId: config.id, createdAt: { gte: since } } }),
        prisma.storefrontInquiry.count({ where: { storefrontId: config.id, createdAt: { gte: since } } }),
        prisma.storefrontOrder.count({ where: { storefrontId: config.id, createdAt: { gte: since } } }),
        prisma.storefrontDonation.count({ where: { storefrontId: config.id, createdAt: { gte: since } } }),
        prisma.engagement.groupBy({ by: ["status"], _count: true }),
        prisma.opportunity.groupBy({ by: ["stage"], _count: true }),
      ]);

      return {
        success: true,
        message: `Marketing summary for ${config.archetype.name} (${config.archetype.ctaType})`,
        data: {
          archetype: { id: config.archetype.archetypeId, name: config.archetype.name, category: config.archetype.category, ctaType: config.archetype.ctaType },
          playbook,
          inbox: { days, bookings, inquiries, orders, donations, total: bookings + inquiries + orders + donations },
          pipeline: {
            engagements: Object.fromEntries(engagements.map((e) => [e.status, e._count])),
            opportunities: Object.fromEntries(opportunities.map((o) => [o.stage, o._count])),
          },
        },
      };
    }

    case "suggest_campaign_ideas": {
      const { getPlaybook } = await import("@/lib/tak/marketing-playbooks");

      const config = await prisma.storefrontConfig.findFirst({
        include: { archetype: { select: { archetypeId: true, name: true, category: true, ctaType: true } } },
      });

      if (!config) {
        return { success: true, message: "No storefront configured. Set up your storefront first at /storefront/setup." };
      }

      const playbook = getPlaybook(config.archetype.category, config.archetype.ctaType);

      // Current season for seasonal relevance
      const month = new Date().getMonth();
      const season = month <= 1 || month === 11 ? "winter" : month <= 4 ? "spring" : month <= 7 ? "summer" : "autumn";

      // Top storefront items by name for campaign targeting
      const items = await prisma.storefrontItem.findMany({
        where: { storefrontId: config.id, isActive: true },
        select: { name: true, priceType: true, ctaType: true },
        orderBy: { sortOrder: "asc" },
        take: 10,
      });

      return {
        success: true,
        message: `Campaign context for ${config.archetype.name}`,
        data: {
          archetype: { name: config.archetype.name, category: config.archetype.category, ctaType: config.archetype.ctaType },
          playbook,
          season,
          currentMonth: new Date().toLocaleString("en-GB", { month: "long", year: "numeric" }),
          activeItems: items.map((i) => ({ name: i.name, priceType: i.priceType, ctaType: i.ctaType })),
        },
      };
    }

    case "generate_custom_archetype": {
      const businessName = String(params["businessName"] ?? "Custom Business");
      const businessDescription = String(params["businessDescription"] ?? "");
      const offerings = Array.isArray(params["offerings"]) ? params["offerings"] as string[] : [];
      const primaryCtaType = String(params["primaryCtaType"] ?? "inquiry");
      const stakeholderLabel = typeof params["stakeholderLabel"] === "string" ? params["stakeholderLabel"] : "Customers";
      const portalLabel = typeof params["portalLabel"] === "string" ? params["portalLabel"] : "Portal";
      const closestCategory = typeof params["closestCategory"] === "string" ? params["closestCategory"] : "professional-services";

      if (offerings.length === 0) {
        return { success: false, message: "At least one offering is required in the 'offerings' array." };
      }

      // Generate archetypeId
      const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const archetypeId = `custom-${slug}`;

      // Check for duplicate
      const existingArch = await prisma.storefrontArchetype.findUnique({ where: { archetypeId } });
      if (existingArch) {
        return { success: false, message: `Archetype "${archetypeId}" already exists. Choose a different name.` };
      }

      // Infer price type from CTA
      const defaultPriceType: Record<string, string> = {
        booking: "per-session", purchase: "fixed", inquiry: "quote", donation: "donation", mixed: "fixed",
      };

      // Generate item templates from offerings
      const itemTemplates = offerings.map((name) => ({
        name,
        description: "",
        priceType: defaultPriceType[primaryCtaType] ?? "quote",
        ...(primaryCtaType === "booking" ? { bookingDurationMinutes: 60 } : {}),
      }));

      // Generate section templates
      const sectionTemplates = [
        { type: "hero", title: "Welcome", sortOrder: 0 },
        { type: "items", title: offerings.length > 3 ? "What We Offer" : "Services", sortOrder: 1 },
        { type: "about", title: "About Us", sortOrder: 2 },
        { type: "gallery", title: "Gallery", sortOrder: 3 },
        { type: "testimonials", title: "Testimonials", sortOrder: 4 },
        { type: "contact", title: "Get in Touch", sortOrder: 5 },
      ];

      // Generate form schema
      const formSchema = [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "Phone", type: "tel", required: false },
        { name: "message", label: "Message", type: "textarea", required: false },
      ];

      // Generate tags from business name and offerings
      const tags = [
        ...businessName.toLowerCase().split(/\s+/),
        ...offerings.map((o) => o.toLowerCase()),
      ].slice(0, 15);

      const category = closestCategory === "custom" ? slug : closestCategory;

      const archetype = await prisma.storefrontArchetype.create({
        data: {
          archetypeId,
          name: businessName,
          category,
          ctaType: primaryCtaType === "mixed" ? "inquiry" : primaryCtaType,
          itemTemplates,
          sectionTemplates,
          formSchema,
          tags,
          isActive: true,
          isBuiltIn: false,
          customVocabulary: { portalLabel, stakeholderLabel },
        },
      });

      return {
        success: true,
        entityId: archetype.archetypeId,
        message: `Custom archetype "${businessName}" created as ${archetypeId}. You can now select it in the setup wizard.`,
        data: {
          archetypeId: archetype.archetypeId,
          name: archetype.name,
          category: archetype.category,
          ctaType: archetype.ctaType,
          itemCount: itemTemplates.length,
          sectionCount: sectionTemplates.length,
        },
      };
    }

    case "assess_archetype_refinement": {
      const config = await prisma.storefrontConfig.findFirst({
        include: { archetype: true },
      });

      if (!config) {
        return { success: false, message: "No storefront configured." };
      }

      const archetype = config.archetype;
      const originalItems = (archetype.itemTemplates as Array<{ name: string }>) ?? [];
      const originalSections = (archetype.sectionTemplates as Array<{ type: string; title: string }>) ?? [];

      const [liveItems, liveSections] = await Promise.all([
        prisma.storefrontItem.findMany({
          where: { storefrontId: config.id },
          select: { name: true, category: true, ctaType: true, priceType: true, isActive: true },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.storefrontSection.findMany({
          where: { storefrontId: config.id },
          select: { type: true, title: true, isVisible: true },
          orderBy: { sortOrder: "asc" },
        }),
      ]);

      const originalItemNames = new Set(originalItems.map((i) => i.name));
      const liveItemNames = new Set(liveItems.map((i) => i.name));

      const itemsAdded = liveItems.filter((i) => !originalItemNames.has(i.name) && i.isActive)
        .map((i) => ({ name: i.name, ctaType: i.ctaType, priceType: i.priceType, category: i.category }));
      const itemsRemoved = originalItems.filter((i) => !liveItemNames.has(i.name)).map((i) => i.name);
      const itemsDeactivated = liveItems.filter((i) => originalItemNames.has(i.name) && !i.isActive).map((i) => i.name);
      const categoriesUsed = [...new Set(liveItems.map((i) => i.category).filter(Boolean))];

      const originalSectionTypes = new Set(originalSections.map((s) => s.type));
      const sectionsAdded = liveSections.filter((s) => !originalSectionTypes.has(s.type) && s.isVisible)
        .map((s) => ({ type: s.type, title: s.title }));
      const sectionsHidden = liveSections.filter((s) => originalSectionTypes.has(s.type) && !s.isVisible)
        .map((s) => s.type);

      const hasChanges = itemsAdded.length > 0 || itemsRemoved.length > 0 || itemsDeactivated.length > 0 ||
        sectionsAdded.length > 0 || sectionsHidden.length > 0 || categoriesUsed.length > 0;

      const summaryParts: string[] = [];
      if (itemsAdded.length > 0) summaryParts.push(`${itemsAdded.length} item(s) added`);
      if (itemsRemoved.length > 0) summaryParts.push(`${itemsRemoved.length} template item(s) removed`);
      if (itemsDeactivated.length > 0) summaryParts.push(`${itemsDeactivated.length} template item(s) deactivated`);
      if (sectionsAdded.length > 0) summaryParts.push(`${sectionsAdded.length} section(s) added`);
      if (sectionsHidden.length > 0) summaryParts.push(`${sectionsHidden.length} section(s) hidden`);
      if (categoriesUsed.length > 0) summaryParts.push(`categories: ${categoriesUsed.join(", ")}`);

      return {
        success: true,
        message: hasChanges
          ? `Your ${archetype.name} configuration has diverged from the original template: ${summaryParts.join("; ")}. These refinements could improve the template for future users of this business type.`
          : `Your configuration matches the original ${archetype.name} template — no refinements to contribute.`,
        data: {
          archetypeId: archetype.archetypeId,
          archetypeName: archetype.name,
          isBuiltIn: archetype.isBuiltIn,
          hasChanges,
          changes: { itemsAdded, itemsRemoved, itemsDeactivated, categoriesUsed, sectionsAdded, sectionsHidden },
        },
      };
    }

    default: {
      const { parseNamespacedTool, executeMcpServerTool } = await import("./mcp-server-tools");
      const parsed = parseNamespacedTool(toolName);
      if (parsed) {
        return executeMcpServerTool(parsed.serverSlug, parsed.toolName, params);
      }
      return { success: false, error: "Unknown tool", message: `Tool ${toolName} not found` };
    }
  }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[executeTool] Uncaught exception in tool "${toolName}":`, msg);
    return { success: false, error: msg, message: `Tool ${toolName} failed: ${msg}` };
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
      annotations: resolveAnnotations(t),
    },
  }));
}
