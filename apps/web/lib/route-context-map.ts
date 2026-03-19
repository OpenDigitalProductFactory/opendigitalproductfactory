// apps/web/lib/route-context-map.ts
// Factual domain context definitions per route — replaces persona-based agent routing.

import type { SensitivityLevel } from "./agent-router-types";

export type RouteContextDef = {
  routePrefix: string;
  domain: string;
  sensitivity: SensitivityLevel;
  domainContext: string;
  domainTools: string[];
  skills: Array<{
    label: string;
    description: string;
    capability: string | null;
    prompt: string;
  }>;
};

// ─── Universal Skills (added to every route) ────────────────────────────────
// These appear on every page, giving the agent baseline page-interaction ability.

export const UNIVERSAL_SKILLS: RouteContextDef["skills"] = [
  {
    label: "Analyze this page",
    description: "Get key insights about what's on this page",
    capability: null,
    prompt: "Analyze this page and tell me what's important. Focus on what I might miss: key data, actionable items, missing elements, or configuration issues. Be concise (2-3 sentences max). If nothing notable, just say 'looks good!'",
  },
  {
    label: "Do this for me",
    description: "Perform the primary action on this page",
    capability: null,
    prompt: "Look at what this page is for and do the main thing a human would do here. If it's a form, fill it out with sensible defaults. If it's a list, create a new entry. If it's a dashboard, summarize what needs attention. Use your tools — don't describe what to do, just do it.",
  },
  {
    label: "Add a skill",
    description: "Add a new skill to this page's agent",
    capability: null,
    prompt: "I want to add a new skill to this page's agent. A skill is a quick-action button that triggers a specific prompt. Ask me what the skill should do, then use propose_file_change to add it to the skills array in route-context-map.ts for this route.",
  },
];

export const ROUTE_CONTEXT_MAP: Record<string, RouteContextDef> = {
  "/portfolio": {
    routePrefix: "/portfolio",
    domain: "Portfolio Management",
    sensitivity: "internal",
    domainContext:
      "This page displays the digital product portfolio organised into four root portfolios with a 481-node DPPM taxonomy tree. Users can review health metrics, budget allocations, and product groupings. Investment balance and risk concentration are the primary analytical dimensions.",
    domainTools: [
      "search_portfolio_context",
      "create_digital_product",
      "update_lifecycle",
    ],
    skills: [
      {
        label: "Health summary",
        description: "Analyse health metrics and flag risks",
        capability: "view_portfolio",
        prompt:
          "Analyse the health metrics for this portfolio — what's strong, what's at risk?",
      },
      {
        label: "Register a product",
        description: "Create a new digital product in the portfolio",
        capability: "view_portfolio",
        prompt: "Help me register a new digital product. Ask me for the name and which portfolio it belongs to, then create it.",
      },
      {
        label: "Find a product",
        description: "Search for a digital product in the taxonomy",
        capability: "view_portfolio",
        prompt: "Help me find a specific digital product in the portfolio",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/inventory": {
    routePrefix: "/inventory",
    domain: "Product Inventory",
    sensitivity: "internal",
    domainContext:
      "This page shows the digital product inventory with lifecycle stages (plan, design, build, production, retirement) and statuses (draft, active, inactive). Users manage individual product records, stage-gate readiness, and portfolio attribution.",
    domainTools: ["create_digital_product", "update_lifecycle"],
    skills: [
      {
        label: "Advance a product",
        description: "Move a product to the next lifecycle stage",
        capability: "view_inventory",
        prompt: "Help me advance a product to the next lifecycle stage. Check the stage-gate criteria and update the lifecycle.",
      },
      {
        label: "Lifecycle review",
        description: "Analyse products by lifecycle stage",
        capability: "view_inventory",
        prompt:
          "Which products need attention based on their lifecycle stage?",
      },
      {
        label: "Stage-gate check",
        description: "Evaluate whether a product is ready to advance",
        capability: "view_inventory",
        prompt:
          "Help me evaluate whether a product is ready to advance to the next stage",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/ea": {
    routePrefix: "/ea",
    domain: "Enterprise Architecture",
    sensitivity: "internal",
    domainContext:
      "This page hosts the EA modelling canvas using ArchiMate 4 notation. Users create views, add elements across business/application/technology layers, and map relationships. Models here are implementable, not illustrative.",
    domainTools: [],
    skills: [
      {
        label: "Create a view",
        description: "Start a new EA view",
        capability: "manage_ea_model",
        prompt: "Help me create a new EA view",
      },
      {
        label: "Impact analysis",
        description: "Trace what changes if a component changes",
        capability: "view_ea_modeler",
        prompt: "If I change this component, what else is affected?",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/employee": {
    routePrefix: "/employee",
    domain: "Employee Management",
    sensitivity: "confidential",
    domainContext:
      "This page manages role assignments, team structures, HITL tier commitments, and delegation grants. Data here is classified as confidential — it contains personal role and accountability information. Every critical decision must have a qualified human in the loop.",
    domainTools: [],
    skills: [
      {
        label: "Assign a role",
        description: "Assign or update an employee's role",
        capability: "view_employee",
        prompt: "Help me assign or update an employee's role. Ask me which employee and what role, then make the change.",
      },
      {
        label: "Role tiers",
        description: "Review HITL tiers and SLA commitments",
        capability: "view_employee",
        prompt: "Explain the role tiers and their SLA commitments",
      },
      {
        label: "Team structure",
        description: "View team memberships and assignments",
        capability: "view_employee",
        prompt: "Show me the team structure and assignments",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/customer": {
    routePrefix: "/customer",
    domain: "Customer Success",
    sensitivity: "confidential",
    domainContext:
      "This page displays customer accounts and service relationships. Data here is classified as confidential — it includes customer identity and service-level information. Users track adoption rates, satisfaction signals, and friction points.",
    domainTools: [],
    skills: [
      {
        label: "Add a customer",
        description: "Register a new customer account",
        capability: "view_customer",
        prompt: "Help me register a new customer account. Ask me for the details, then create it.",
      },
      {
        label: "Account overview",
        description: "Summarise a customer account",
        capability: "view_customer",
        prompt: "Give me an overview of this customer account",
      },
      {
        label: "Friction analysis",
        description: "Identify where customers are struggling",
        capability: "view_customer",
        prompt: "Where are customers experiencing friction?",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/ops": {
    routePrefix: "/ops",
    domain: "Operations",
    sensitivity: "internal",
    domainContext:
      "This page shows the delivery backlog with items, epics, priorities, and statuses. Users create and update work items, track epic progress, and manage delivery flow. Work-in-progress limits and blocker visibility are key operational controls.",
    domainTools: ["query_backlog", "create_backlog_item", "update_backlog_item"],
    skills: [
      {
        label: "Create item",
        description: "Add a new backlog item",
        capability: "manage_backlog",
        prompt: "Help me create a new backlog item",
      },
      {
        label: "Epic progress",
        description: "Review how epics are progressing",
        capability: "view_operations",
        prompt: "Give me a status report on the current epics",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/build": {
    routePrefix: "/build",
    domain: "Build Studio",
    sensitivity: "internal",
    domainContext:
      "This page is the Build Studio where users develop features through five phases: Ideate, Plan, Build, Review, Ship. The conversation panel, feature brief, and phase indicator guide the workflow. The assistant can read and search project files and propose code changes.",
    domainTools: [
      "update_feature_brief",
      "create_build_epic",
      "register_digital_product_from_build",
      "search_portfolio_context",
      "assess_complexity",
      "propose_decomposition",
      "register_tech_debt",
      "save_build_notes",
      // Build Studio lifecycle (EP-SELF-DEV-002)
      "saveBuildEvidence",
      "reviewDesignDoc",
      "reviewBuildPlan",
      "launch_sandbox",
      "generate_code",
      "iterate_sandbox",
      "run_sandbox_tests",
      "deploy_feature",
      "generate_ux_test",
      "run_ux_test",
      // Codebase access (needed for Ideate phase search + Build fallback)
      "read_project_file",
      "search_project_files",
      "list_project_directory",
      "propose_file_change",
    ],
    skills: [
      {
        label: "Start a feature",
        description: "Begin a new feature build",
        capability: "view_platform",
        prompt: "I want to build a new feature",
      },
      {
        label: "Check status",
        description: "Review build progress",
        capability: "view_platform",
        prompt: "What's the status of my current build?",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/platform": {
    routePrefix: "/platform",
    domain: "Platform & AI",
    sensitivity: "confidential",
    domainContext:
      "This page manages AI providers, model profiles, token spend, and agent-to-provider assignments. Data here is classified as confidential — it includes API keys, cost data, and infrastructure configuration. Users configure failover chains and optimise capability-per-dollar.",
    domainTools: ["add_provider", "update_provider_category"],
    skills: [
      {
        label: "Add a provider",
        description: "Register a new AI provider",
        capability: "manage_provider_connections",
        prompt: "Help me add and configure a new AI provider. Walk me through the setup.",
      },
      {
        label: "Optimize providers",
        description: "Rebalance provider priorities for cost and capability",
        capability: "manage_provider_connections",
        prompt: "Run the provider priority optimization — rebalance for best capability-per-dollar.",
      },
      {
        label: "Configure provider",
        description: "Set up a provider connection",
        capability: "manage_provider_connections",
        prompt: "Help me configure an AI provider",
      },
      {
        label: "Token spend",
        description: "Review usage and costs",
        capability: "view_platform",
        prompt: "Show me a summary of token usage and costs",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/admin": {
    routePrefix: "/admin",
    domain: "Administration",
    sensitivity: "restricted",
    domainContext:
      "This page handles user management, role assignments, branding configuration, and platform settings. Data here is classified as restricted — it includes access control rules, credentials, and security configuration. All changes are auditable.",
    domainTools: [],
    skills: [
      {
        label: "Manage users",
        description: "User accounts and roles",
        capability: "manage_users",
        prompt: "Help me manage user accounts",
      },
      {
        label: "Set up branding",
        description: "Configure platform brand and theme",
        capability: "manage_branding",
        prompt: "Help me set up the platform branding",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/compliance": {
    routePrefix: "/compliance",
    domain: "Compliance & Regulatory",
    sensitivity: "confidential",
    domainContext:
      "This page manages regulatory compliance — regulations, obligations, controls, evidence, risk assessments, incidents, corrective actions, audits, policies, and regulatory submissions. " +
      "Data here is classified as confidential — it contains regulatory exposure, control gaps, incident records, and audit findings. " +
      "The compliance engine tracks obligation-to-control coverage, posture scoring, and gap assessment. " +
      "Key workflows: register regulations and their obligations, map controls to obligations for coverage, collect evidence, manage incidents with regulatory notification deadlines, " +
      "track corrective actions, run audits, manage internal policies with employee acknowledgments, and submit regulatory reports. " +
      "The agent should understand the regulation currently being viewed and its obligations when on a regulation detail page.",
    domainTools: [],
    skills: [
      {
        label: "Add a regulation",
        description: "Register a new regulation to track",
        capability: "manage_compliance",
        prompt: "Help me register a new regulation. Ask me for the name, jurisdiction, and key details, then create it with its obligations.",
      },
      {
        label: "Map a control",
        description: "Link a control to an obligation for coverage",
        capability: "manage_compliance",
        prompt: "Help me map a control to an obligation. Show me which obligations have gaps and let me pick one to address.",
      },
      {
        label: "Gap assessment",
        description: "Analyse compliance coverage gaps",
        capability: "view_compliance",
        prompt: "Show me where our compliance gaps are — which obligations have no controls?",
      },
      {
        label: "Posture report",
        description: "Review overall compliance health",
        capability: "view_compliance",
        prompt: "What is our current compliance posture score and what's dragging it down?",
      },
      {
        label: "Add obligation",
        description: "Create a new regulatory obligation",
        capability: "manage_compliance",
        prompt: "Help me add a new obligation to this regulation",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/workspace": {
    routePrefix: "/workspace",
    domain: "Workspace",
    sensitivity: "confidential",
    domainContext:
      "This is the cross-cutting workspace with visibility over all platform areas. Data here is classified as confidential — it spans portfolio, operations, and workforce data. Users manage backlog items, browse the codebase, and propose changes across the platform.",
    domainTools: [
      "query_backlog",
      "create_backlog_item",
      "update_backlog_item",
      "list_project_directory",
      "read_project_file",
      "search_project_files",
      "propose_file_change",
    ],
    skills: [
      {
        label: "Backlog status",
        description: "Review epics and priorities",
        capability: "view_platform",
        prompt:
          "Give me the current backlog status — open epics, what's done, what's next.",
      },
      {
        label: "Create task",
        description: "Create a backlog item",
        capability: "manage_backlog",
        prompt: "Create a new task",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback.",
      },
    ],
  },
};

/** Default context used when no route prefix matches. */
export const FALLBACK_ROUTE_CONTEXT: RouteContextDef =
  ROUTE_CONTEXT_MAP["/workspace"]!;

/**
 * Resolve which route context applies for a given pathname.
 * Uses longest prefix match; falls back to workspace.
 * Merges universal skills into every route's skills array.
 */
export function resolveRouteContext(pathname: string): RouteContextDef {
  let best: RouteContextDef = FALLBACK_ROUTE_CONTEXT;
  let bestLen = 0;

  for (const [prefix, def] of Object.entries(ROUTE_CONTEXT_MAP)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (prefix.length > bestLen) {
        bestLen = prefix.length;
        best = def;
      }
    }
  }

  // Merge universal skills — page-specific first, then universal, then "Report an issue" last
  const reportIssue = best.skills.find((s) => s.label === "Report an issue");
  const pageSkills = best.skills.filter((s) => s.label !== "Report an issue");
  const mergedSkills = [...UNIVERSAL_SKILLS, ...pageSkills, ...(reportIssue ? [reportIssue] : [])];

  return { ...best, skills: mergedSkills };
}
