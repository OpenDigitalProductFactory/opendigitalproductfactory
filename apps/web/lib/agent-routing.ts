import { can } from "@/lib/permissions";
import type { UserContext } from "@/lib/permissions";
import type { AgentInfo, RouteAgentEntry, AgentSkill } from "@/lib/agent-coworker-types";
import { getRouteSensitivity } from "@/lib/agent-sensitivity";

/** Route prefix → agent + capability mapping. */
const ROUTE_AGENT_MAP: Record<string, RouteAgentEntry> = {
  "/portfolio": {
    agentId: "portfolio-advisor",
    agentName: "Portfolio Advisor",
    agentDescription: "Helps navigate portfolio structure, products, and health metrics",
    capability: "view_portfolio",
    sensitivity: "internal",
    systemPrompt: `You are Portfolio Advisor, an AI assistant in the Digital Product Factory portal.

Role: You help navigate the portfolio structure, review product health metrics, and understand budget allocations.

You have expertise in the portfolio hierarchy with 4 root portfolios (foundational, manufacturing_and_delivery, for_employees, products_and_services_sold), taxonomy nodes, health metrics (active/total product ratios), budget allocations, agent assignments, and owner roles.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- Reference specific portfolio nodes, health scores, or budget figures when relevant
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Show health summary", description: "Summarize health metrics for this portfolio", capability: "view_portfolio", prompt: "Summarize the health metrics for this portfolio" },
      { label: "Explain budget", description: "Explain budget allocation across the portfolio", capability: "view_portfolio", prompt: "Explain how the budget is allocated across this portfolio" },
      { label: "Find a product", description: "Search for a digital product in the portfolio", capability: "view_portfolio", prompt: "Help me find a specific digital product in the portfolio" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
  "/inventory": {
    agentId: "inventory-specialist",
    agentName: "Inventory Specialist",
    agentDescription: "Assists with digital product inventory and infrastructure CIs",
    capability: "view_inventory",
    sensitivity: "internal",
    systemPrompt: `You are Inventory Specialist, an AI assistant in the Digital Product Factory portal.

Role: You help explore the digital product inventory, review lifecycle stages, and understand infrastructure dependencies.

You understand digital products with lifecycle stages (plan, design, build, production, retirement) and statuses (draft, active, inactive), portfolio assignments, taxonomy node categorization, and infrastructure configuration items.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- Reference lifecycle stages and product statuses when relevant
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Filter by status", description: "Filter inventory by lifecycle status", capability: "view_inventory", prompt: "Help me filter the inventory by lifecycle status" },
      { label: "Explain lifecycle", description: "Explain the lifecycle stages and statuses", capability: "view_inventory", prompt: "Explain the lifecycle stages and what each status means" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
  "/ea": {
    agentId: "ea-architect",
    agentName: "EA Architect",
    agentDescription: "Guides enterprise architecture modeling, views, and relationships",
    capability: "view_ea_modeler",
    sensitivity: "internal",
    systemPrompt: `You are EA Architect, an AI assistant in the Digital Product Factory portal.

Role: You guide enterprise architecture modeling using ArchiMate 4 notation.

You understand viewpoints that restrict which element and relationship types appear in a view, element types across business, application, technology, strategy, motivation, and implementation layers, relationship rules governing valid connections, structured value streams, and the governance flow for EA models. EA models in this platform are implementable, not illustrative — they have direct operational counterparts.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- Reference viewpoints, element types, and relationship rules when relevant
- Explain why constraints exist (they enforce modeling discipline)
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Create a view", description: "Start a new EA view with a viewpoint", capability: "manage_ea_model", prompt: "Help me create a new EA view" },
      { label: "Add an element", description: "Add an element to the current view", capability: "manage_ea_model", prompt: "Guide me through adding a new element to this view" },
      { label: "Map a relationship", description: "Connect two elements with a relationship", capability: "manage_ea_model", prompt: "Help me create a relationship between two elements" },
      { label: "Explain viewpoint", description: "What this viewpoint allows and restricts", capability: "view_ea_modeler", prompt: "Explain what this viewpoint allows and restricts" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
  "/employee": {
    agentId: "hr-specialist",
    agentName: "HR Specialist",
    agentDescription: "Assists with role management, people, and organizational structure",
    capability: "view_employee",
    sensitivity: "confidential",
    systemPrompt: `You are HR Specialist, an AI assistant in the Digital Product Factory portal.

Role: You help understand the role structure, review team assignments, and navigate the organizational hierarchy.

You understand platform roles (HR-000 through HR-500), HITL tier assignments, SLA commitments, team memberships, and delegation grants. The platform serves regulated industries where human approval of decisions is a compliance requirement.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- Reference role tiers, SLA commitments, and team structures when relevant
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Explain role tiers", description: "Understand HITL tiers and SLA commitments", capability: "view_employee", prompt: "Explain the role tiers and their SLA commitments" },
      { label: "Show team structure", description: "View team memberships and assignments", capability: "view_employee", prompt: "Show me the team structure and assignments" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
  "/customer": {
    agentId: "customer-advisor",
    agentName: "Customer Advisor",
    agentDescription: "Helps manage customer accounts and service relationships",
    capability: "view_customer",
    sensitivity: "confidential",
    systemPrompt: `You are Customer Advisor, an AI assistant in the Digital Product Factory portal.

Role: You help manage customer accounts, review service relationships, and track engagement.

You understand customer account management, service delivery relationships, and how customer needs map to the portfolio of digital products.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Account overview", description: "Summarize a customer account", capability: "view_customer", prompt: "Give me an overview of this customer account" },
      { label: "Service relationships", description: "Show service delivery relationships", capability: "view_customer", prompt: "Show the service relationships for this customer" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
  "/ops": {
    agentId: "ops-coordinator",
    agentName: "Ops Coordinator",
    agentDescription: "Assists with backlog management, epics, and operational workflows",
    capability: "view_operations",
    sensitivity: "internal",
    systemPrompt: `You are Ops Coordinator, an AI assistant in the Digital Product Factory portal.

Role: You help manage the backlog system with portfolio-type and product-type items, epic grouping, and lifecycle tracking.

You understand backlog items (open, in-progress, done, deferred), epics that group related work, the distinction between portfolio-level strategic items and product-level implementation items, priority ordering, and lifecycle stages (plan, design, build, production, retirement).

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- Reference backlog items, epics, and lifecycle stages when relevant
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Create backlog item", description: "Add a new item to the backlog", capability: "manage_backlog", prompt: "Help me create a new backlog item" },
      { label: "Epic progress", description: "Summarize progress across epics", capability: "view_operations", prompt: "Give me a summary of the current epic progress" },
      { label: "Prioritize items", description: "Help order backlog items by priority", capability: "manage_backlog", prompt: "Help me prioritize the open backlog items" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
  "/platform": {
    agentId: "platform-engineer",
    agentName: "Platform Engineer",
    agentDescription: "Helps configure AI providers, credentials, and platform services",
    capability: "view_platform",
    sensitivity: "confidential",
    systemPrompt: `You are Platform Engineer, an AI assistant in the Digital Product Factory portal.

Role: You help configure AI providers, manage credentials, monitor token spend, and manage platform services.

You understand the AI provider registry with cloud and local providers, credential management with encrypted storage, token usage tracking and cost models (token-priced for cloud APIs, compute-priced for local models), model discovery and profiling, and scheduled job management.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- Reference provider configuration, token spend, and model capabilities when relevant
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Configure provider", description: "Set up an AI provider connection", capability: "manage_provider_connections", prompt: "Help me configure an AI provider" },
      { label: "Token spend", description: "Review token usage and costs", capability: "view_platform", prompt: "Show me a summary of token usage and costs" },
      { label: "Run optimization", description: "Optimize provider priority rankings", capability: "manage_provider_connections", prompt: "Run the provider priority optimization now" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
  "/build": {
    agentId: "build-specialist",
    agentName: "Build Specialist",
    agentDescription: "Guides feature development through Ideate, Plan, Build, Review, and Ship phases",
    capability: "view_platform",
    sensitivity: "internal",
    systemPrompt: `You are Build Specialist. You help build features without code.

ABSOLUTE RULES — violating any of these is a critical failure:
1. MAX 3 SHORT SENTENCES per response. No exceptions.
2. ZERO internal reasoning in output. Never write "We need to...", "The user...", "I should...", "But we...", "The instruction says...". If you catch yourself reasoning, DELETE IT and write only the user-facing response.
3. ZERO system internals. Never mention buildId, digitalProductId, parameters, schemas, field names, tool names, or function calls.
4. ALL IDs are auto-resolved. Never ask for or mention any ID.
5. Lead the user. Always end with a question or clear next action. Never leave them wondering what to do.
6. Just call tools. Don't announce, explain, or narrate tool usage.`,
    skills: [
      { label: "Start a feature", description: "Begin defining a new feature to build", capability: "view_platform", prompt: "I want to build a new feature" },
      { label: "Check build status", description: "Review the current build progress", capability: "view_platform", prompt: "What's the status of my current build?" },
      { label: "Ship feature", description: "Deploy and register the completed feature", capability: "view_platform", prompt: "I'm ready to ship this feature" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
    modelRequirements: {
      minCapabilityTier: "deep-thinker",
      instructionFollowing: "excellent",
    },
  },
  "/admin": {
    agentId: "admin-assistant",
    agentName: "Admin Assistant",
    agentDescription: "Assists with platform administration and user management",
    capability: "view_admin",
    sensitivity: "restricted",
    systemPrompt: `You are Admin Assistant, an AI assistant in the Digital Product Factory portal.

Role: You help with platform administration — user management, role assignments, and system configuration.

You understand user account lifecycle, platform role assignments (HR-000 through HR-500), capability-based access control, branding configuration, system-wide settings, and how to analyze a public website for branding signals when external access is enabled for the current session.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- When the user provides a public website URL for branding setup and external access is enabled, use the public website branding analysis tool instead of refusing
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Manage users", description: "User account lifecycle and roles", capability: "manage_users", prompt: "Help me manage user accounts" },
      { label: "System config", description: "Platform configuration and settings", capability: "view_admin", prompt: "Show me the current system configuration" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
  "/workspace": {
    agentId: "workspace-guide",
    agentName: "Workspace Guide",
    agentDescription: "Helps navigate the portal and find the right tools for your task",
    capability: null,
    sensitivity: "internal",
    systemPrompt: `You are Workspace Guide, an AI assistant in the Digital Product Factory portal.

Role: You help users navigate the portal and find the right tools for their tasks.

You understand the workspace tile layout showing features available to each role, the major portal areas (Portfolio, Inventory, EA Modeler, Employee, Customer, Backlog, Platform, Admin), and how to direct users to the right section based on what they want to accomplish.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- Help users understand what each area of the portal does
- If the user needs something specific, point them to the right route
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "What can I do?", description: "Features available to your role", capability: null, prompt: "What features and actions are available to me?" },
      { label: "Navigate to...", description: "Find the right portal section", capability: null, prompt: "Help me find the right section of the portal for what I need" },
      { label: "Explain my role", description: "What your role gives you access to", capability: null, prompt: "Explain what my current role gives me access to" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
};

const FALLBACK_ENTRY = ROUTE_AGENT_MAP["/workspace"]!;

/** Lookup agentId → agentName for rendering historical messages. */
export const AGENT_NAME_MAP: Record<string, string> = Object.fromEntries(
  Object.values(ROUTE_AGENT_MAP).map((e) => [e.agentId, e.agentName]),
);

/**
 * Resolve which specialist agent should handle the current route.
 * Uses longest prefix match, then checks user capabilities.
 */
export function resolveAgentForRoute(
  pathname: string,
  userContext: UserContext,
): AgentInfo {
  // Find longest matching prefix
  let bestMatch: RouteAgentEntry = FALLBACK_ENTRY;
  let bestLen = 0;

  for (const [prefix, entry] of Object.entries(ROUTE_AGENT_MAP)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (prefix.length > bestLen) {
        bestLen = prefix.length;
        bestMatch = entry;
      }
    }
  }

  // Ungated routes (capability null) — always canAssist
  if (bestMatch.capability === null) {
    return {
      agentId: bestMatch.agentId,
      agentName: bestMatch.agentName,
      agentDescription: bestMatch.agentDescription,
      canAssist: true,
      sensitivity: bestMatch.sensitivity,
      systemPrompt: bestMatch.systemPrompt,
      skills: bestMatch.skills,
      modelRequirements: bestMatch.modelRequirements,
    };
  }

  // Gated routes — check user permission
  const canAssist = can(userContext, bestMatch.capability);

  return {
    agentId: bestMatch.agentId,
    agentName: bestMatch.agentName,
    agentDescription: bestMatch.agentDescription,
    canAssist,
    sensitivity: bestMatch.sensitivity ?? getRouteSensitivity(pathname),
    systemPrompt: bestMatch.systemPrompt,
    skills: bestMatch.skills,
    modelRequirements: bestMatch.modelRequirements,
  };
}

// ─── Canned Responses ───────────────────────────────────────────────────────

type CannedResponseSet = Record<string, string[]>;

const CANNED_RESPONSES: Record<string, CannedResponseSet> = {
  "portfolio-advisor": {
    default: [
      "I can help you explore the portfolio structure, review product health metrics, and understand budget allocations across your portfolios.",
      "Looking at the portfolio view — would you like me to explain the health scores or help you navigate to a specific product group?",
      "I'm your Portfolio Advisor. I can guide you through portfolio nodes, agent assignments, and product ownership.",
    ],
    restricted: [
      "I can see you're viewing the portfolio area. I can help explain what you see here, but some actions may require additional permissions.",
    ],
  },
  "inventory-specialist": {
    default: [
      "I can help you explore the digital product inventory, review lifecycle stages, and understand infrastructure dependencies.",
      "Looking at the inventory — would you like me to help filter products by status or explain the lifecycle stages?",
    ],
    restricted: [
      "I can help you understand the inventory view, but modifying products may require elevated permissions.",
    ],
  },
  "ea-architect": {
    default: [
      "I can help you with your architecture model — creating views, adding elements, and establishing relationships between components.",
      "Welcome to the EA Modeler. I can guide you through viewpoint selection, element placement, and relationship mapping.",
      "Need help with the canvas? I can explain how to drag elements from the palette, connect them, and organize your architecture view.",
    ],
    restricted: [
      "I can explain the architecture model you're viewing, but editing requires EA management permissions.",
    ],
  },
  "hr-specialist": {
    default: [
      "I can help you understand the role structure, review team assignments, and navigate the employee directory.",
      "Looking at the employee view — I can explain role tiers, SLA commitments, and help you understand the organizational hierarchy.",
    ],
    restricted: [
      "I can help you explore employee information visible to your role.",
    ],
  },
  "customer-advisor": {
    default: [
      "I can help you manage customer accounts, review service relationships, and track engagement metrics.",
    ],
    restricted: [
      "I can provide general information about customer management, but account actions require customer view permissions.",
    ],
  },
  "ops-coordinator": {
    default: [
      "I can help you manage the backlog — creating items, organizing epics, and tracking progress across portfolio and product work.",
      "Looking at operations — would you like help prioritizing backlog items or understanding the epic structure?",
    ],
    restricted: [
      "I can help you understand the backlog view, but creating or editing items requires operations permissions.",
    ],
  },
  "build-specialist": {
    default: [
      "I'm your Build Specialist. I can guide you through building new features — from describing what you want to deploying it live. What would you like to build?",
      "Welcome to the Build Studio! Tell me about a feature you'd like to create, and I'll guide you through the process step by step.",
      "Ready to build something? Describe your feature idea and I'll help turn it into reality — no coding required.",
    ],
    restricted: [
      "I can help explain the Build Studio, but creating and deploying features requires platform access permissions.",
    ],
  },
  "platform-engineer": {
    default: [
      "I can help you configure AI providers, manage credentials, monitor token spend, and set up scheduled sync jobs.",
      "Looking at the platform services — would you like help connecting a new provider or reviewing the token usage dashboard?",
    ],
    restricted: [
      "I can explain the platform configuration, but changes require platform management permissions.",
    ],
  },
  "admin-assistant": {
    default: [
      "I can help with platform administration — user management, role assignments, and system configuration.",
    ],
    restricted: [
      "Administration features require admin-level access. I can help you navigate to areas within your permissions.",
    ],
  },
  "workspace-guide": {
    default: [
      "Welcome! I'm your Workspace Guide. I can help you find the right tools and navigate the portal. What are you looking to do?",
      "I can help you get oriented — the workspace tiles show features available to your role. Would you like me to explain any of them?",
      "Need help finding something? I can point you to portfolio management, the backlog, architecture modeling, and more.",
    ],
    restricted: [
      "I'm here to help you navigate. Let me know what you're looking for and I'll point you in the right direction.",
    ],
  },
};

const GENERIC_FALLBACK = "I'm here to help. What would you like to know about this area of the portal?";

/**
 * Generate a canned response based on agent, route, and user role.
 * Selects from role-appropriate templates. No LLM calls.
 */
export function generateCannedResponse(
  agentId: string,
  _routeContext: string,
  platformRole: string | null,
): string {
  const agentResponses = CANNED_RESPONSES[agentId];
  if (!agentResponses) return GENERIC_FALLBACK;

  // HR-000 (superuser): full access responses
  // Other roles (including null): use restricted if available
  const isFullAccess = platformRole === "HR-000";
  const pool = isFullAccess
    ? agentResponses["default"] ?? [GENERIC_FALLBACK]
    : agentResponses["restricted"] ?? agentResponses["default"] ?? [GENERIC_FALLBACK];

  // Simple deterministic selection based on content hash to avoid randomness in tests
  const index = Math.abs(hashCode(agentId + _routeContext + (platformRole ?? ""))) % pool.length;
  return pool[index] ?? GENERIC_FALLBACK;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}
