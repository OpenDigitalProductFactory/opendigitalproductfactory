import { can } from "@/lib/permissions";
import type { UserContext } from "@/lib/permissions";
import type { AgentInfo, RouteAgentEntry } from "@/lib/agent-coworker-types";

/** Route prefix → agent + capability mapping. */
const ROUTE_AGENT_MAP: Record<string, RouteAgentEntry> = {
  "/portfolio": {
    agentId: "portfolio-advisor",
    agentName: "Portfolio Advisor",
    agentDescription: "Helps navigate portfolio structure, products, and health metrics",
    capability: "view_portfolio",
  },
  "/inventory": {
    agentId: "inventory-specialist",
    agentName: "Inventory Specialist",
    agentDescription: "Assists with digital product inventory and infrastructure CIs",
    capability: "view_inventory",
  },
  "/ea": {
    agentId: "ea-architect",
    agentName: "EA Architect",
    agentDescription: "Guides enterprise architecture modeling, views, and relationships",
    capability: "view_ea_modeler",
  },
  "/employee": {
    agentId: "hr-specialist",
    agentName: "HR Specialist",
    agentDescription: "Assists with role management, people, and organizational structure",
    capability: "view_employee",
  },
  "/customer": {
    agentId: "customer-advisor",
    agentName: "Customer Advisor",
    agentDescription: "Helps manage customer accounts and service relationships",
    capability: "view_customer",
  },
  "/ops": {
    agentId: "ops-coordinator",
    agentName: "Ops Coordinator",
    agentDescription: "Assists with backlog management, epics, and operational workflows",
    capability: "view_operations",
  },
  "/platform": {
    agentId: "platform-engineer",
    agentName: "Platform Engineer",
    agentDescription: "Helps configure AI providers, credentials, and platform services",
    capability: "view_platform",
  },
  "/admin": {
    agentId: "admin-assistant",
    agentName: "Admin Assistant",
    agentDescription: "Assists with platform administration and user management",
    capability: "view_admin",
  },
  "/workspace": {
    agentId: "workspace-guide",
    agentName: "Workspace Guide",
    agentDescription: "Helps navigate the portal and find the right tools for your task",
    capability: null,
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
    };
  }

  // Gated routes — check user permission
  const canAssist = can(userContext, bestMatch.capability);

  return {
    agentId: bestMatch.agentId,
    agentName: bestMatch.agentName,
    agentDescription: bestMatch.agentDescription,
    canAssist,
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
