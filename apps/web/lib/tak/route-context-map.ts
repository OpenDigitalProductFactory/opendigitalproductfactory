// apps/web/lib/route-context-map.ts
// Factual domain context definitions per route — replaces persona-based agent routing.

import type { SensitivityLevel } from "./agent-router-types";

export type RouteContextDef = {
  routePrefix: string;
  domain: string;
  sensitivity: SensitivityLevel;
  domainContext: string;
  domainTools: string[];
  docsPath?: string;
  skills: Array<{
    label: string;
    description: string;
    capability: string | null;
    prompt: string;
    taskType?: "conversation" | "code_generation" | "analysis";
  }>;
};

// ─── Universal Skills (added to every route) ────────────────────────────────
// These appear on every page, giving the agent baseline page-interaction ability.

export const UNIVERSAL_SKILLS: RouteContextDef["skills"] = [
  {
    label: "Analyze this page",
    description: "Get key insights about what's on this page",
    capability: null,
    taskType: "conversation",
    prompt: "This is a CONVERSATION request, not a tool request. Look at the PAGE DATA section in your context. Tell me what's important — key data I might miss, actionable items, missing elements, or things that need attention. Do NOT call any tools. Just read what you already know about this page and give me 2-3 sentences of insight. If nothing notable, say 'looks good!'",
  },
  {
    label: "Do this for me",
    description: "Perform the primary action on this page",
    capability: null,
    taskType: "conversation",
    prompt: "Look at what this page is for and do the main thing a human would do here. If it's a form, fill it out with sensible defaults. If it's a list, create a new entry. If it's a dashboard, summarize what needs attention. Use your tools — don't describe what to do, just do it.",
  },
  {
    label: "Add a skill",
    description: "Add a new skill to this page's agent",
    capability: null,
    taskType: "code_generation",
    prompt: "I want to add a new skill to this page's agent. A skill is a quick-action button that triggers a specific prompt. Ask me what the skill should do, then use propose_file_change to add it to the skills array in route-context-map.ts for this route.",
  },
  {
    label: "Evaluate this page",
    description: "Check this page for usability issues — accessibility, contrast, layout, and UX patterns",
    capability: null,
    taskType: "analysis",
    prompt: "Evaluate the UX of this page. First, use read_project_file and search_project_files to find and read the component code for the current route. Then use evaluate_page to run a live accessibility audit. Synthesize both code analysis and live findings into a plain-language assessment. For each issue found: create a backlog item grouped by category (one item per category, not per finding). After presenting findings, ask the user if they want to build fixes now — if yes, assemble a FeatureBrief and launch Build Studio.",
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
      "query_version_history",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/portfolios/index",
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
        label: "Find knowledge",
        description: "Search knowledge articles for this portfolio or product",
        capability: "view_portfolio",
        prompt: "Search the knowledge base for articles relevant to this product or portfolio. Show me what's available.",
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
    domainTools: [
      "create_digital_product",
      "update_lifecycle",
      "query_version_history",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/products/index",
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
      "This page hosts the EA modelling canvas using ArchiMate 4 notation. Users create views, add elements across business/application/technology layers, and map relationships. Models here are implementable, not illustrative. Note: EA canvas actions (create view, add element, link relationships) do not yet have agent tools — advise on structure and create backlog items to track modelling work.",
    domainTools: [],
    docsPath: "/docs/architecture/index",
    skills: [
      {
        label: "Create a view",
        description: "Start a new EA view",
        capability: "manage_ea_model",
        prompt: "The user wants to create a new EA view. Agent tools for direct EA canvas manipulation are not yet available. Ask what view they want to create (name, layer, purpose), advise on the ArchiMate elements that belong in it, then create a backlog item to track the modelling work so it isn't lost.",
      },
      {
        label: "Impact analysis",
        description: "Trace what changes if a component changes",
        capability: "view_ea_modeler",
        prompt: "The user wants to know what is affected if a component changes. Use the PAGE DATA to reason about the visible model. Describe the dependency chain in plain language. Do not call any tools — this is a read-and-reason task on what is already shown.",
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
      "This page manages employee profiles, role assignments, team structures, HITL tier commitments, and delegation grants. Data here is classified as confidential — it contains personal role and accountability information. Every critical decision must have a qualified human in the loop. Only firstName and lastName are required to add an employee — all other fields (email, department, position, start date) are optional. Use query_employees to search before creating. Use list_departments and list_positions when the user doesn't know the exact department or position name.",
    domainTools: [
      "query_employees",
      "create_employee",
      "list_departments",
      "list_positions",
      "transition_employee_status",
      "propose_leave_policy",
      "submit_feedback",
    ],
    docsPath: "/docs/hr/index",
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
      "This page displays customer accounts, service relationships, and conversion funnels. Data here is classified as confidential \u2014 it includes customer identity and service-level information. Users track adoption rates, satisfaction signals, friction points, and conversion funnels from storefront interactions through the CRM pipeline.",
    domainTools: [
      "get_marketing_summary",
      "create_backlog_item",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/customers/index",
    skills: [
      {
        label: "Add a customer",
        description: "Register a new customer account",
        capability: "view_customer",
        prompt: "The user wants to register a new customer account. Direct customer creation is not yet available as an agent action — explain this briefly, then ask what details they have and create a backlog item titled 'Add customer: [name]' so the request is tracked. Do not pretend to create the account.",
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
    docsPath: "/docs/operations/index",
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
      // Feature brief and backlog
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
      // Sandbox — all ops needed during Build phase
      "launch_sandbox",
      "generate_code",
      "iterate_sandbox",
      "edit_sandbox_file",
      "read_sandbox_file",
      "search_sandbox",
      "list_sandbox_files",
      "run_sandbox_command",
      "run_sandbox_tests",
      // Review and UX testing
      "generate_ux_test",
      "run_ux_test",
      // Ship and release pipeline
      "deploy_feature",
      "check_deployment_windows",
      "schedule_promotion",
      "create_release_bundle",
      "get_release_status",
      "run_release_gate",
      "schedule_release_bundle",
      "assess_contribution",
      "contribute_to_hive",
      // Codebase access (Ideate phase search + Build fallback)
      "read_project_file",
      "search_project_files",
      "list_project_directory",
      "propose_file_change",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/build-studio/index",
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
    domainTools: [
      "add_provider",
      "update_provider_category",
      "run_endpoint_tests",
      "evaluate_tool",
      "search_integrations",
    ],
    docsPath: "/docs/ai-workforce/index",
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
    domainTools: [
      "analyze_brand_document",
      "analyze_public_website_branding",
      "fetch_public_website",
    ],
    docsPath: "/docs/admin/index",
    skills: [
      {
        label: "Manage users",
        description: "User accounts and roles",
        capability: "manage_users",
        prompt: "The user wants to manage user accounts. Direct user management agent tools are not yet available — employee lifecycle tools are on the /employee page instead. Ask what they want to do (create, deactivate, change role), then either redirect them to the right page or create a backlog item to track the request. Do not claim to have updated any account.",
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
    domainTools: [
      "prefill_onboarding_wizard",
      "search_knowledge",
      "search_knowledge_base",
      "search_public_web",
    ],
    docsPath: "/docs/compliance/index",
    skills: [
      {
        label: "Add a regulation",
        description: "Register a new regulation to track",
        capability: "manage_compliance",
        prompt: "The user wants to register a new regulation. Direct compliance record creation is not yet an agent action — for full onboarding use the 'Onboard a regulation' skill which calls the wizard. For a quick request: ask for the name and jurisdiction, then create a backlog item titled 'Register regulation: [name]' so it is tracked. Do not claim to have created the record.",
      },
      {
        label: "Map a control",
        description: "Link a control to an obligation for coverage",
        capability: "manage_compliance",
        prompt: "The user wants to map a control to an obligation. Direct control mapping is not yet an agent action. Ask which obligation has the gap and which control addresses it, then create a backlog item to track the mapping. Do not claim to have updated any control.",
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
        prompt: "The user wants to add a new obligation to a regulation. Direct obligation creation is not yet an agent action. Ask for the obligation title, reference (article/clause), and category. Then create a backlog item to track the addition. Do not claim to have created the obligation record.",
      },
      {
        label: "Onboard a regulation or standard",
        description: "Research and import a regulation, standard, or framework into the compliance register",
        capability: "manage_compliance",
        taskType: "analysis",
        prompt: "Help the user onboard a new regulation, standard, or framework. Ask what they want to onboard. Then: (1) Research it — use web search for public standards, or ask for a document upload for proprietary ones. (2) Extract the obligation structure — titles, references (article/clause numbers), categories, frequency, applicability. (3) Suggest control mappings where obvious. (4) Call prefill_onboarding_wizard with the drafted structure to create a draft and navigate the user to the onboarding wizard for review.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/admin/storefront": {
    routePrefix: "/admin/storefront",
    domain: "Business Portal & Engagement",
    sensitivity: "confidential",
    domainContext:
      "This page manages the business portal and engagement strategy. " +
      "The portal adapts to the business model \u2014 it may be a Storefront, Community Portal, Client Portal, Patient Portal, etc. " +
      "The PAGE DATA contains the portal label, stakeholder types, and a marketing playbook specific to this business model \u2014 " +
      "reference them in every recommendation. Use stakeholder-appropriate language (homeowners, patients, members, etc.). " +
      "Users manage sections, items/services/campaigns, team/staff, inbox/requests, and settings.",
    domainTools: [
      "get_marketing_summary",
      "suggest_campaign_ideas",
      "generate_custom_archetype",
      "assess_archetype_refinement",
      "create_backlog_item",
      "search_knowledge",
      "search_knowledge_base",
    ],
    skills: [
      {
        label: "Campaign ideas",
        description: "Get archetype-tailored campaign suggestions",
        capability: "view_storefront",
        prompt:
          "Suggest 3-5 marketing campaigns tailored to our business type and current season. Reference the archetype playbook in your PAGE DATA. For each campaign: name, goal, target audience, channel, and expected outcome.",
      },
      {
        label: "Content brief",
        description: "Draft a content piece for your audience",
        capability: "view_storefront",
        prompt:
          "Draft a content brief for a marketing piece adapted to our business archetype. Include: topic, format (blog/email/social/flyer), tone guidance from the playbook, key messages, and call-to-action. Ask what the content should be about.",
      },
      {
        label: "Review inbox",
        description: "Spot marketing opportunities in recent interactions",
        capability: "view_storefront",
        prompt:
          "Summarise recent storefront inbox activity. Identify marketing opportunities \u2014 recurring questions that could become FAQ content, popular services that deserve promotion, or quiet periods that need campaigns.",
      },
      {
        label: "Marketing health check",
        description: "Assess your marketing posture by archetype",
        capability: "view_storefront",
        taskType: "analysis" as const,
        prompt:
          "Run a marketing health check for this business. Using the archetype playbook and current metrics from PAGE DATA: (1) assess whether key metrics are healthy for this business type, (2) identify the biggest gap in the marketing strategy, (3) suggest one high-impact action. Create a backlog item for the recommended action.",
      },
      {
        label: "Improve template",
        description: "Review how your config differs from the original template and contribute improvements",
        capability: "view_storefront",
        taskType: "analysis" as const,
        prompt:
          "Use assess_archetype_refinement to compare my current portal configuration against the original archetype template. " +
          "Show me what I've changed (added items, removed sections, new categories). " +
          "Then tell me whether these refinements could improve the template for future users of the same business type. " +
          "If contribution mode is enabled, offer to contribute the improvements back via Hive Mind.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/setup": {
    routePrefix: "/setup",
    domain: "Platform Onboarding",
    sensitivity: "internal",
    domainContext:
      "The user is going through initial platform setup. Guide them through each step: business identity, account creation, AI capabilities, branding, financials, and workspace creation. Be professional, understanding, and transparent about the local AI model's limitations.",
    domainTools: [],
    skills: [],
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
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/workspace/index",
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

  "/docs": {
    routePrefix: "/docs",
    domain: "Documentation",
    sensitivity: "internal",
    domainContext:
      "This page displays the platform user documentation. The documentation specialist agent (AGT-904) assists with Mermaid diagram creation and validation, document structure review, cross-reference integrity checks, and renderer compatibility analysis. It optimizes for accuracy, self-containment, and renderability across GitHub, VS Code, and GitBook.",
    domainTools: [
      "search_knowledge",
      "search_knowledge_base",
      "search_project_files",
      "read_project_file",
      "list_project_directory",
    ],
    docsPath: "/docs",
    skills: [
      {
        label: "Generate diagram",
        description: "Create a Mermaid diagram for a concept",
        capability: null,
        taskType: "code_generation" as const,
        prompt:
          "Generate a Mermaid diagram for the concept I describe. Choose the appropriate diagram type (flowchart, sequence, class, state, ER, C4) based on the subject. Output the raw Mermaid syntax in a code block.",
      },
      {
        label: "Review doc structure",
        description: "Check a document for structural issues",
        capability: null,
        taskType: "analysis" as const,
        prompt:
          "Review the structure of this document. Check heading hierarchy, cross-references, section completeness, and IT4IT alignment. Flag any TODOs, placeholder content, or missing sections.",
      },
      {
        label: "Regenerate diagrams",
        description: "Update all diagrams in a doc to match current state",
        capability: null,
        taskType: "code_generation" as const,
        prompt:
          "Find and regenerate all Mermaid diagrams in this document to reflect the current codebase and architecture state. Use read_project_file and search_project_files to verify accuracy.",
      },
      {
        label: "Renderer compatibility",
        description: "Check diagrams for renderer compatibility",
        capability: null,
        taskType: "analysis" as const,
        prompt:
          "Check this Mermaid diagram for compatibility issues across renderers (GitHub, VS Code, GitBook). Flag unsupported syntax, excessive nesting, or features that render differently.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
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
