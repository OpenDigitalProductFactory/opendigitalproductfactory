// apps/web/lib/route-context-map.ts
import { resolveDocsPath } from "@/lib/docs-route-map";
import { AGRICULTURE_ROUTE_CONTEXT } from "./agriculture-route-context";
import { CHANGE_REVIEWER_ROUTE_CONTEXT } from "./change-reviewer-route";
import { PERFORMANCE_ROUTE_CONTEXT } from "./performance-route";
import { PRODUCT_LINE_ROUTE_CONTEXT } from "./product-line-route-context";
import { PRODUCT_ROUTE_CONTEXT } from "./product-route-context";
import { LEAVE_DECISION_ROUTE_CONTEXT } from "./leave-decision-route";
import type { RouteContextDef } from "./route-context-types";
export type { RouteContextDef } from "./route-context-types";
// Universal baseline page-interaction skills added to every route.
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
  "/coworker/leave-decision": LEAVE_DECISION_ROUTE_CONTEXT,
  ...AGRICULTURE_ROUTE_CONTEXT,
  // Sensitivity MUST match ROUTE_AGENT_MAP["/coworker-decisions/craft"] — the
  // LIFE-007 conformance check fails on divergence, because the
  // USE_UNIFIED_COWORKER flag would otherwise flip this route's data boundary.
  "/coworker-decisions/craft": {
    routePrefix: "/coworker-decisions/craft",
    domain: "Craft (WSID)",
    sensitivity: "internal",
    domainContext:
      "This page is the WSID craft surface: the professions the platform grounds its coworkers in — the competent-professional answer for each role — and where a business adds its own local overrides. For ux-design it carries the design-critique technique, the lens set, the corpus authority contract, and the calibration gate that governs when design critique may carry any weight.",
    domainTools: [
      "wiki_query",
      "search_knowledge",
      "search_knowledge_base",
      "doc_search",
      "doc_load",
      "evaluate_profession_decision",
    ],
    docsPath: "/docs/wiki/index",
    skills: [
      {
        label: "Capture a critique",
        description: "Turn a UX review note into a corpus entry",
        capability: "view_platform",
        prompt:
          "I want to record a UX review note into the critique corpus. Ask me for the route, what specifically is wrong, and my verdict — then draft the entry.",
      },
      {
        label: "Corpus gaps",
        description: "Entries still missing a founder verdict",
        capability: "view_platform",
        prompt:
          "Show me critique corpus entries that are still missing a founder verdict, and cluster them so I can work through them quickly.",
      },
      {
        label: "Explain a lens",
        description: "How the hierarchy and density lenses apply here",
        capability: "view_platform",
        prompt:
          "Explain how the information-hierarchy and content-density lenses apply to this profession's craft guidance.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },
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
      "wiki_query",
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
  "/portfolio/product-line": PRODUCT_LINE_ROUTE_CONTEXT,

  "/inventory": {
    routePrefix: "/inventory",
    domain: "Discovery Operations",
    sensitivity: "internal",
    domainContext:
      "This route is the legacy alias for discovery operations. Treat discovery as evidence for the shared product estate, not as a standalone inventory list. Focus on ownership, purpose, dependency mapping, evidence freshness, and posture gaps that need review before humans act on the estate.",
    domainTools: [
      "summarize_estate_posture",
      "review_estate_identity",
      "validate_version_confidence",
      "explain_blast_radius",
      "discovery_sweep",
      "attribute_entity_to_product",
      "dismiss_entity",
      "resolve_portfolio_quality_issue",
      "configure_gateway_scan",
      "wiki_query",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/products/index",
    skills: [
      {
        label: "Summarize estate posture",
        description: "Highlight the biggest support, freshness, and evidence risks",
        capability: "view_inventory",
        prompt: "Summarize the current estate posture and tell me what needs attention first.",
      },
      {
        label: "Review item identity",
        description: "Explain who made the item, what it likely is, and how solid that identity is",
        capability: "view_inventory",
        prompt: "Review the identity evidence for this item and tell me what we know versus what still needs review.",
      },
      {
        label: "Explain blast radius",
        description: "Show what breaks or becomes unreachable if an item fails",
        capability: "view_inventory",
        prompt: "Explain the blast radius for the item I'm looking at.",
      },
      {
        label: "Check version confidence",
        description: "Explain how strong the version evidence really is",
        capability: "view_inventory",
        prompt: "Check how confident we are in the version information for this item.",
      },
      {
        label: "Attribute this item to a product",
        description: "Link a discovered item to the portfolio taxonomy so it counts in the estate",
        capability: "manage_provider_connections",
        prompt: "Attribute this item to the right portfolio taxonomy node.",
      },
      {
        label: "Dismiss this item",
        description: "Mark noise or out-of-scope items so they stop appearing in the review queue",
        capability: "manage_provider_connections",
        prompt: "Dismiss this discovered item — it isn't part of our managed estate.",
      },
      {
        label: "Resolve a quality issue",
        description: "Close an open PortfolioQualityIssue after the cause is fixed or the issue doesn't apply",
        capability: "manage_provider_connections",
        prompt: "Resolve or dismiss this open quality issue.",
      },
      {
        label: "Configure a gateway scan",
        description: "Set up a subnet/gateway collector so unreachable networks become visible",
        capability: "manage_provider_connections",
        prompt: "Configure a gateway scan so we can discover devices on this subnet.",
      },
      {
        label: "Run discovery sweep",
        description: "Run a fresh discovery pass to improve evidence quality",
        capability: "manage_provider_connections",
        prompt: "Run a discovery sweep to refresh the evidence on this route.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/portfolio/product": PRODUCT_ROUTE_CONTEXT,

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

  // Sensitivity MUST match ROUTE_AGENT_MAP["/ea/data-model"] (LIFE-007).
  "/ea/data-model": {
    routePrefix: "/ea/data-model",
    domain: "Data Architecture",
    sensitivity: "internal",
    domainContext:
      "This page shows the Prisma→EA data-model mirror: the entity-relationship view of the live schema with models, declared relations, keys, indexes, and enums. The Data Architect stewards it with 3NF/DAMA-DMBOK discipline — referential integrity is declared, not implied, and schema evolution must be fleet-safe (forward-only, expand → migrate → contract, safe at any data state).",
    domainTools: [
      "wiki_query",
      "evaluate_profession_decision",
      "describe_model",
      "validate_schema",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/architecture/index",
    skills: [
      {
        label: "Review a model",
        description: "Assess a model's normalization, relations, and index hygiene",
        capability: "view_ea_modeler",
        prompt:
          "Review the model I'm looking at: normalization, declared relations, keys, enums, and index coverage in both directions.",
      },
      {
        label: "Validate a schema change",
        description: "Check a proposed change for fleet-safe evolution",
        capability: "view_ea_modeler",
        prompt:
          "I'm considering a schema change. Walk it through the expand → migrate → contract lens and tell me whether it is safe at any data state.",
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
      "This page manages employee profiles, role assignments, team structures, oversight commitments, and delegation grants. Data here is classified as confidential — it contains personal role and accountability information. Every critical decision must have a qualified employee in the loop. Only firstName and lastName are required to add an employee — all other fields (email, department, position, start date) are optional. Use query_employees to search before creating. Use list_departments and list_positions when the user doesn't know the exact department or position name.",
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
        description: "Review oversight and SLA commitments",
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
      "wiki_query",
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

  "/customer/marketing": {
    routePrefix: "/customer/marketing",
    domain: "Customer Marketing",
    sensitivity: "confidential",
    domainContext:
      "This page is the internal marketing workspace for customer acquisition. Data here is classified as confidential — it can include customer segments, market assumptions, funnel diagnostics, offer positioning, and campaign planning. Users work strategy first, then campaigns, funnel analysis, and automation planning.",
    domainTools: [
      "get_marketing_summary",
      "suggest_campaign_ideas",
      "save_marketing_review",
      "create_marketing_campaign_brief",
      "create_marketing_asset_task",
      "record_marketing_kpi_checkpoint",
      "create_marketing_automation_candidate",
      "analyze_seo_opportunity",
      "create_backlog_item",
      "wiki_query",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/customers/index",
    skills: [
      {
        label: "Campaign ideas",
        description: "Generate strategy-aware campaign suggestions",
        capability: "view_marketing",
        prompt: "Suggest 3-5 campaign ideas tailored to this business, market, and current season. Keep the recommendations specific to the route to market and likely customer segment.",
      },
      {
        label: "Content brief",
        description: "Draft a brief for a campaign asset or offer",
        capability: "view_marketing",
        prompt: "Draft a content brief that supports our acquisition strategy. Include audience, message, channel, proof points, CTA, and why this piece matters now.",
      },
      {
        label: "Review inbox",
        description: "Look for demand signals in recent interactions",
        capability: "view_marketing",
        prompt: "Review the recent interaction signals in our marketing context. Identify recurring questions, objections, interest themes, and content or campaign opportunities we should act on.",
      },
      {
        label: "Marketing health check",
        description: "Assess strategy, channels, and funnel posture",
        capability: "view_marketing",
        taskType: "analysis" as const,
        prompt: "Run a marketing health check for this business. Tell me what is strong, what is missing, what looks stale, and which one action would improve acquisition most.",
      },
      {
        label: "SEO content optimizer",
        description: "Find what to write about to attract the right audience",
        capability: "view_marketing",
        prompt: "Use our business context, services, and locality to identify SEO content opportunities. Recommend topics, intent, format, and why each one matters.",
      },
      {
        label: "Email campaign builder",
        description: "Draft an email campaign aligned to our market and offer",
        capability: "view_marketing",
        prompt: "Help me build an email campaign for the right segment. Ask what the email is for only if needed, then draft subject lines, body copy, CTA, and a follow-up angle.",
      },
      {
        label: "Competitive analysis",
        description: "Clarify our market position and opportunity gaps",
        capability: "view_marketing",
        prompt: "Help me understand our competitive position. Use the available business context and ask for the minimum missing competitor details, then summarize overlap, differentiation, and opportunity gaps.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/finance/banking": {
    routePrefix: "/finance/banking",
    domain: "Bookkeeping",
    sensitivity: "confidential",
    domainContext:
      "This page shows bank/card accounts, imported statement transactions, categorization rules, and reconciliation status — confidential money-of-record data. Amounts come from statements, never guesses; unmatched lines and unparseable rows are surfaced, not filled in. Account setup and statement import are money-of-record actions that route to the owner for approval; categorization and matching are ordinary, reversible steps.",
    domainTools: [
      "list_bank_accounts",
      "get_bank_account",
      "get_bank_transactions",
      "get_reconciliation_summary",
      "suggest_transaction_matches",
      "list_bank_rules",
      "create_bank_account",
      "import_bank_statement",
      "match_transaction",
      "unmatch_transaction",
      "create_bank_rule",
      "delete_bank_rule",
      "wiki_query",
      "search_knowledge",
    ],
    docsPath: "/docs/finance/index",
    skills: [
      {
        label: "How current are our books?",
        description: "Reconciliation status per account: matched vs unmatched, balance, last reconciled",
        capability: "view_finance",
        prompt: "Give me the reconciliation status of each bank/card account — what's matched, what's still unmatched, and how current the books are.",
      },
      {
        label: "Reconcile unmatched transactions",
        description: "Walk the unmatched lines and match them against recorded payments",
        capability: "manage_finance",
        prompt: "Walk our unmatched bank transactions and reconcile each one against the right recorded payment, surfacing anything you can't match.",
      },
      {
        label: "Set up categorization rules",
        description: "Propose bank rules to auto-categorize recurring vendors",
        capability: "manage_finance",
        prompt: "Look at our recent transactions and propose bank rules to auto-categorize the recurring vendors.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },
  "/finance": {
    routePrefix: "/finance",
    domain: "Finance Operations",
    sensitivity: "confidential",
    domainContext:
      "This page displays finance operations data classified as confidential: invoices, bills, expense claims, recurring schedules, collections posture, tax remittance readiness, and accounting handoff boundaries. Treat finance figures as evidence-backed operational summaries, not guesses. Use canonical finance records for financial answers, call out open or incomplete records, and keep tax/legal recommendations separate from verified transaction totals.",
    domainTools: [
      "get_finance_period_summary",
      "mcp-browser-use__browse_open",
      "mcp-browser-use__browse_act",
      "mcp-browser-use__browse_extract",
      "mcp-browser-use__browse_screenshot",
      "mcp-browser-use__browse_close",
      "search_public_web",
      "fetch_public_website",
      "wiki_query",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/finance/index",
    skills: [
      {
        label: "Income vs expenses this month",
        description: "Verified month-to-date income, expenses, and net from the canonical finance data",
        capability: "view_finance",
        prompt: "Show me income vs expenses for this month so far, with any gaps surfaced.",
      },
      {
        label: "Review finance posture",
        description: "Summarize finance configuration, recurring billing, and handoff boundaries",
        capability: "view_finance",
        prompt: "Summarize our current finance operating posture and where tax or accounting handoffs still need clarification.",
      },
      {
        label: "Retrieve billing portal costs",
        description: "Use the governed browser to collect subscription cost, renewal, and invoice evidence",
        capability: "view_finance",
        prompt: "Use browser-use to retrieve current provider and subscription billing details from the relevant billing portal. Extract plan name, amount, currency, cadence, renewal date, invoice or receipt evidence, and any access blocker. Do not change plans, submit payments, or update external account settings. If the portal cannot resolve a required field, queue the human ask with the exact missing fields.",
      },
      {
        label: "Review tax setup",
        description: "Summarize tax posture, open gaps, and what the coworker needs next",
        capability: "view_finance",
        prompt: "Review our current tax remittance setup and tell me what still needs to be clarified.",
      },
      {
        label: "Research tax processing proposal",
        description: "Use official sources to propose what DPF should configure for tax processing",
        capability: "view_finance",
        prompt: "Use External Access to research official tax authority sources for this business, then propose what DPF should configure to process taxes safely. Include assumptions, sources checked, approval boundaries, and next data needed.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/ops/dev-loop": {
    routePrefix: "/ops/dev-loop",
    domain: "Dev Loop — Runtime Coordination",
    sensitivity: "internal",
    domainContext:
      "This page is the Dev Loop runtime coordination map. It shows governed RuntimeTargets (root portal, dev portal, build sandboxes, promotion sandboxes) grouped by lifecycle status, the active non-prod environment leases, and the runtimeTargetJanitor rules (BI-AD949172). It is NOT the delivery backlog. Use the PAGE DATA block as ground truth for what is currently deployed where. Multiple targets can legitimately share a status and even a URL/port at once — each build sandbox registers its own target on the shared sandbox port, and a 'running' target whose lastHeartbeat is stale simply has not been swept to 'expired' yet (janitor: running + no heartbeat for 2h → expired). Always reconcile a target's status against its lastHeartbeat before treating it as live, and prefer get_runtime_coordination_map for the full live record.",
    domainTools: [
      "get_runtime_coordination_map",
      "list_nonprod_environment_leases",
      "search_code_graph",
      "trace_code_surface",
      "doc_search",
      "search_knowledge",
    ],
    docsPath: "/docs/operations/index",
    skills: [
      {
        label: "Explain the runtime map",
        description: "Summarize what is deployed where and flag anything stale",
        capability: "view_platform",
        taskType: "analysis",
        prompt: "Look at the PAGE DATA for this Dev Loop page. Summarize the active runtime targets and leases in plain language, and flag any 'running' target whose lastHeartbeat is old enough that the janitor should sweep it to expired. Explain why duplicates on the same port can be normal. Don't call tools unless the page data is missing something you need from get_runtime_coordination_map.",
      },
      {
        label: "Why is this here?",
        description: "Trace a runtime target or janitor rule back to the code that creates it",
        capability: "view_platform",
        taskType: "analysis",
        prompt: "I'll name a runtime target, lease, or janitor behavior on this page. Use search_code_graph / trace_code_surface and read_project_file to find the code that registers or sweeps it, and the docs that describe it, then explain how it works and why this entry exists.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  // /ops/self-upgrade governs how the portal updates ITSELF (image/source
  // deploy), not the delivery backlog. Same class of bug as /ops/dev-loop
  // (BI-FD7E4D72): without its own entry, longest-prefix match falls to "/ops"
  // and the coworker describes the delivery backlog on an upgrade page. This is
  // the DOMAIN-CONTEXT map (injector #2); PR #4048 fixes the PAGE DATA provider
  // (injector #1) for the same route. Guarded by
  // route-context-inheritance.conformance.test.ts (BI-5457E216).
  "/ops/self-upgrade": {
    routePrefix: "/ops/self-upgrade",
    domain: "Self-Upgrade — Portal Release Status",
    sensitivity: "internal",
    domainContext:
      "This page is the governed portal self-upgrade console: whether upgrade automation is enabled and on which channel, the running platform version, the latest and last-successful upgrade runs, whether an update is available, whether it is safe to apply now (maintenance window / quiescence blockers), whether the operator can keep working during it, and whether it can be rolled back. It is NOT the delivery backlog — do not answer questions here with backlog items or epics. Use the PAGE DATA block as ground truth for the running version and run history. In merge mode the deployed identity is a local merge commit that CONTAINS but never equals the upstream target, so a raw SHA comparison can read 'update available' forever — the build is fresh when the upstream lineage it already absorbed equals the target. For the live 'is a batch pending / is an upgrade eligible' answer prefer get_self_upgrade_queue_status; for what is holding an in-flight upgrade use get_quiescence_status.",
    domainTools: [
      "get_self_upgrade_queue_status",
      "get_quiescence_status",
      "request_self_upgrade",
      "repair_promoter_image",
      "search_code_graph",
      "trace_code_surface",
      "doc_search",
      "search_knowledge",
    ],
    docsPath: "/docs/operations/index",
    skills: [
      {
        label: "Is an update available?",
        description: "Explain the current upgrade status and whether one is pending",
        capability: "view_operations",
        taskType: "analysis",
        prompt: "Look at the PAGE DATA for this Self-Upgrade page. In plain language tell me: is upgrade automation on, what version is running, and whether an update is available or a release batch is still accumulating. If the page data doesn't settle it, call get_self_upgrade_queue_status for the live batch/eligibility tally. Don't describe the delivery backlog — this page is about portal updates.",
      },
      {
        label: "What's holding the upgrade?",
        description: "Explain blockers on an in-flight or pending upgrade",
        capability: "view_operations",
        taskType: "analysis",
        prompt: "Explain what, if anything, is blocking a self-upgrade right now — maintenance window, quiescence drain, cooldown, or job-engine health. Use get_quiescence_status and get_self_upgrade_queue_status for live state, then summarize whether it's safe to keep working and what would let the upgrade proceed.",
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
    // `exact`: this entry asserts a SPECIFIC page identity ("the delivery
    // backlog"), which is wrong for sibling ops pages (/ops/patches,
    // /ops/journeys, ...). Marking it exact stops those descendants inheriting
    // the backlog identity — the runtime fix for BI-5457E216 / the /ops/* debt
    // that route-context-inheritance.conformance.test.ts had been tracking.
    match: "exact",
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

  "/build/work": CHANGE_REVIEWER_ROUTE_CONTEXT,

  "/build": {
    routePrefix: "/build",
    domain: "Build Studio",
    sensitivity: "internal",
    domainContext: `This page is the Build Studio where users develop features through five phases: Ideate, Plan, Build, Review, Ready to Ship. The Ready-to-Ship phase forks into two parallel outcomes (upstream PR + promote to prod) that may land or skip independently. The conversation panel, feature brief, and phase indicator guide the workflow. The assistant can read and search project files and propose code changes.

FRONTEND DESIGN SYSTEM — DPF Tokens:
When generating or reviewing UI code, enforce these rules:
- Colors: NEVER hardcode hex. Use CSS variables: var(--dpf-text), var(--dpf-text-secondary), var(--dpf-muted), var(--dpf-bg), var(--dpf-surface-1/2/3), var(--dpf-border), var(--dpf-accent), var(--dpf-success), var(--dpf-warning), var(--dpf-error), var(--dpf-info). Only exception: white text on accent buttons.
- Elevation: shadow-dpf-xs, shadow-dpf-sm, shadow-dpf-md, shadow-dpf-lg (Tailwind classes).
- Animation: animate-dpf-fade-in (200ms), animate-dpf-slide-up (320ms), animate-dpf-scale-in (200ms).
- Layout: Tailwind utility classes, no component library (no shadcn/Radix/MUI). Responsive via sm:/md:/lg: breakpoints.
- Semantic HTML: <nav>, <main>, <section>, <button> — never <span role="button"> or <div onClick>.
- Accessibility: aria-labels on all interactive elements, focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)], role="tablist"/role="tab" for tab panels, min 44px touch targets.
- Loading: spinner pattern: w-N h-N border-2 border-[var(--dpf-accent)] border-t-transparent rounded-full animate-spin. Skeleton: animate-pulse bg-[var(--dpf-surface-2)] rounded.
- Contrast: var(--dpf-muted) is labels only (3.5:1). Body text must use var(--dpf-text-secondary) (5.8:1) or var(--dpf-text) (full contrast).
- Forms: vanilla HTML inputs — globals.css provides base styling via @layer components. No form library.`,
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
      "report_quality_issue",
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
      "get_code_graph_freshness",
      "inspect_build_code_impact",
      "search_code_graph",
      "trace_code_surface",
      "find_related_tests",
      "wiki_query",
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
        label: "Design a component",
        description: "Create a polished UI component with DPF design tokens",
        capability: "view_platform",
        taskType: "code_generation",
        prompt: "I want to design a new UI component. Before writing code: ask me what the component does, what states it needs (loading, empty, error, populated), and where it fits in the layout. Then generate the component using the DPF design system: CSS variable tokens for all colors (never hardcode hex), Tailwind utility classes for layout, semantic HTML elements, accessible names on all interactive elements, focus-visible rings, and loading/skeleton states. Use animate-dpf-slide-up for entrance. Read an existing similar component first with read_project_file to match patterns.",
      },
      {
        label: "Build a page",
        description: "Scaffold a complete page with layout, data loading, and responsive design",
        capability: "view_platform",
        taskType: "code_generation",
        prompt: "I want to build a new page. Ask me: what data does it display, what actions can users take, and which route should it live under. Then scaffold the full page: server component for data loading, client components for interactivity, responsive layout (sidebar + content or single-column with breakpoints), proper loading.tsx skeleton, error.tsx boundary, and semantic HTML landmarks (nav, main, section). Use read_project_file on an existing page under app/(shell)/ to match the layout pattern. All colors must use var(--dpf-*) tokens.",
      },
      {
        label: "Ship feature",
        description: "Deploy the completed feature",
        capability: "view_platform",
        prompt: "I'm ready to ship this feature",
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

  "/platform/tools/discovery": {
    routePrefix: "/platform/tools/discovery",
    domain: "Discovery Operations",
    sensitivity: "internal",
    domainContext:
      "This page is the specialist evidence workspace for discovery operations. Use it to improve attribution, vendor and version accuracy, topology understanding, dependency mapping, and support posture across the shared product estate. Discovery outputs are evidence, not the primary human-facing inventory.",
    domainTools: [
      "summarize_estate_posture",
      "review_estate_identity",
      "validate_version_confidence",
      "explain_blast_radius",
      "discovery_sweep",
      "wiki_query",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/platform/index",
    skills: [
      {
        label: "Summarize estate posture",
        description: "Highlight the biggest support, freshness, and evidence risks",
        capability: "view_inventory",
        prompt: "Summarize the current discovery posture and tell me what needs attention first.",
      },
      {
        label: "Review item identity",
        description: "Explain who made the item, what it likely is, and how solid that identity is",
        capability: "view_inventory",
        prompt: "Review the identity evidence for the items on this page and tell me what still needs review.",
      },
      {
        label: "Review discovery quality",
        description: "Assess freshness, evidence quality, and attribution confidence",
        capability: "view_inventory",
        prompt: "Review the discovery quality and evidence confidence for the items on this page.",
      },
      {
        label: "Explain blast radius",
        description: "Show what breaks or becomes unreachable if an item fails",
        capability: "view_inventory",
        prompt: "Explain the blast radius for the item I'm looking at.",
      },
      {
        label: "Run discovery sweep",
        description: "Run a fresh discovery pass to improve evidence quality",
        capability: "manage_provider_connections",
        prompt: "Run a discovery sweep to refresh the evidence on this route.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  // Sensitivity MUST match ROUTE_AGENT_MAP["/platform/integrations"] (LIFE-007).
  "/platform/integrations": {
    routePrefix: "/platform/integrations",
    domain: "Integrations & Coordination Plane",
    sensitivity: "internal",
    domainContext:
      "This page shows the platform's connected integrations, sync status, and connector configuration. The MCP & Integration Engineer stewards the coordination plane as a set of contracts: the MCP protocol version window is N/N-1 with a written retirement procedure, tool names are frozen contracts (a rename ships as an alias with identical grants and a stated expiry), and the tool surface is held to a context budget with bounded results.",
    domainTools: [
      "wiki_query",
      "evaluate_profession_decision",
      "search_integrations",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/platform/index",
    skills: [
      {
        label: "Review an integration",
        description: "Assess a connector's contract, grants, and exposure",
        capability: "view_platform",
        prompt:
          "Review the integration I'm looking at: its contract shape, grant mapping, endpoint classification, and any layer-separation concerns.",
      },
      {
        label: "Audit the tool surface",
        description: "Review tool-name stability and context economy",
        capability: "view_platform",
        prompt:
          "Audit the tool surface: flag renamed tools missing aliases, oversized schemas, and unbounded results that blow the context budget.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/admin/issue-reports": {
    routePrefix: "/admin/issue-reports",
    domain: "Admin Issue Triage",
    sensitivity: "restricted",
    domainContext:
      "This page is the restricted administration queue for PlatformIssueReport records. The admin coworker should separate actionable process defects from automated warmup noise, inspect logs and read-only database evidence, create or update backlog work when a report needs code changes, and suppress or locally triage non-actionable operational noise. Do not redirect issue-report triage to Build Studio; use admin and backlog tools from this route.",
    domainTools: [
      "admin_view_logs",
      "admin_query_db",
      "admin_read_file",
      "create_backlog_item",
      "update_backlog_item",
      "report_quality_issue",
      "wiki_query",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/admin/index",
    skills: [
      {
        label: "Triage issue reports",
        description: "Group reports into actionable defects, warmup noise, and resolved items",
        capability: "view_admin",
        taskType: "analysis",
        prompt:
          "Triage the issue reports on this page. Use the visible queue first, then use admin_query_db for PlatformIssueReport and ToolExecution evidence and admin_view_logs when logs are relevant. Do not use Build Studio. Return the actionable cause, recommended status, and whether a backlog item or PR is needed.",
      },
      {
        label: "Investigate open report",
        description: "Inspect backend evidence for the selected or top open report",
        capability: "view_admin",
        taskType: "analysis",
        prompt:
          "Investigate the top open issue report. Use admin_query_db, admin_view_logs, and admin_read_file as needed. Explain the backend cause, whether it is a product defect or operational noise, and the next admin action. Do not redirect this to Build Studio.",
      },
      {
        label: "Suppress warmup noise",
        description: "Identify warmup probes that should not dominate issue triage",
        capability: "view_admin",
        prompt:
          "Find warmup and health-check reports that are safe to suppress. Use backend evidence, avoid hiding genuine failures, and summarize which reports should move to suppressed status.",
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
      "This page handles user management, role assignments, branding configuration, platform settings, and infrastructure administration. Data here is classified as restricted — the admin coworker can view logs, query the database, restart services, run migrations, and execute project-level commands. All tool calls are audit-logged to AdminActivity.",
    domainTools: [
      "admin_view_logs",
      "admin_query_db",
      "admin_read_file",
      "admin_restart_service",
      "admin_run_migration",
      "admin_run_seed",
      "admin_run_command",
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

  "/compliance/licensing": {
    routePrefix: "/compliance/licensing",
    domain: "Licensing & Permit Readiness",
    sensitivity: "confidential",
    domainContext:
      "This page manages licensing, permit, legality, display-obligation, fee, and staff-credential readiness for the business. " +
      "Data here is classified as confidential because it can expose regulated activities, jurisdictional gaps, licensing blockers, responsible staff credentials, and fee obligations. " +
      "The agent should treat seed reference data as a starting point only, ask whether the business is already operating, newly setting up, or expanding footprint, and use official sources to investigate what still needs to be verified. " +
      "The operational page remains factual; coworker dialog owns the investigation, question flow, and recommendations.",
    domainTools: [
      "save_licensing_investigation",
      "create_licensing_readiness_issue",
      "search_public_web",
      "create_backlog_item",
      "wiki_query",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/compliance/index",
    skills: [
      {
        label: "Classify setup posture",
        description: "Decide whether the business is already operating, newly setting up, or expanding",
        capability: "manage_compliance",
        taskType: "analysis" as const,
        prompt:
          "Review the visible licensing posture and ask only the next useful question needed to classify this business as already operating, newly setting up, or expanding into new jurisdictions. When you have enough evidence, call save_licensing_investigation so the posture is persisted.",
      },
      {
        label: "Investigate licensing footprint",
        description: "Research likely authority layers and unresolved licensing questions for this business",
        capability: "manage_compliance",
        taskType: "analysis" as const,
        prompt:
          "Use the business archetype, geography, and visible licensing records to investigate what authority layers or regulated activities still need review. Use official public sources when needed, persist findings with save_licensing_investigation, and create factual licensing readiness issues for unresolved gaps.",
      },
      {
        label: "Review company permits",
        description: "Find missing organization-held permits, registrations, or display requirements",
        capability: "view_compliance",
        taskType: "analysis" as const,
        prompt:
          "Review company-held licensing readiness on this page. Tell me which organization licenses, permits, postings, or fee obligations look complete, incomplete, stale, or unsupported by evidence.",
      },
      {
        label: "Review staff credential gaps",
        description: "Check whether person-held credentials or supervising roles are missing",
        capability: "view_compliance",
        taskType: "analysis" as const,
        prompt:
          "Review the person-held credential posture for this business. Call out missing credentials, weak supervising-role coverage, expiring records, or qualifications that should be tied to staffing readiness.",
      },
      {
        label: "Create readiness issue",
        description: "Record a concrete licensing blocker or open investigation follow-up",
        capability: "manage_compliance",
        prompt:
          "Create a factual licensing readiness issue for the gap we just identified. Use a specific title, name the jurisdiction or authority layer when known, and avoid inventing legal conclusions.",
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
      "wiki_query",
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

  // Sensitivity MUST match ROUTE_AGENT_MAP["/governance"] (LIFE-007).
  "/governance": {
    routePrefix: "/governance",
    domain: "Governance & Security Stewardship",
    sensitivity: "confidential",
    domainContext:
      "This page is the governance surface, where oversight records and accountability live. Data here is classified as confidential. The Security Engineer stewards platform exposure from here: every surface (endpoint, MCP/A2A plane, connector) is classified at birth as public, authenticated, or private-mesh — default private — and an unauthenticated externally reachable surface is sev-high by classification. Findings are filed as backlog items; the coworker never blocks merges itself.",
    domainTools: [
      "wiki_query",
      "evaluate_profession_decision",
      "search_knowledge",
      "search_knowledge_base",
    ],
    docsPath: "/docs/compliance/index",
    skills: [
      {
        label: "Classify a surface",
        description: "Assign an exposure class to an endpoint or plane",
        capability: "view_compliance",
        prompt:
          "Help me classify the exposure of a platform surface: public, authenticated, or private-mesh — and record what evidence supports it.",
      },
      {
        label: "Triage advisories",
        description: "Rank open vulnerability and supply-chain findings",
        capability: "view_compliance",
        prompt:
          "Triage the open vulnerability and supply-chain advisories: rank them by reachability and exposure class, and tell me which need a backlog item.",
      },
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/storefront": {
    routePrefix: "/storefront",
    domain: "Storefront Operations",
    sensitivity: "confidential",
    domainContext:
      "This page manages the public storefront experience and operational setup. " +
      "Data here is classified as confidential because it includes the live offer structure, inbound request handling, team readiness, and business configuration. " +
      "Users manage sections, items or services, inbox requests, team setup, and storefront settings.",
    domainTools: [
      "create_backlog_item",
      "wiki_query",
      "search_knowledge",
      "search_knowledge_base",
    ],
    skills: [
      {
        label: "Review storefront presentation",
        description: "Assess whether the public experience is clear and current",
        capability: "view_storefront",
        prompt:
          "Review the storefront presentation on this page. Tell me what looks clear, what could confuse customers, and what should be tightened up first.",
      },
      {
        label: "Review inbox operations",
        description: "Summarize inbound request patterns and service gaps",
        capability: "view_storefront",
        prompt:
          "Review the visible inbox and request flow. Summarize recurring request themes, unanswered or risky patterns, and any operational follow-up the team should address.",
      },
      {
        label: "Check offer structure",
        description: "Look for problems in sections, services, or public offer organization",
        capability: "view_storefront",
        prompt:
          "Review the current storefront structure and tell me whether the sections, items, and offer flow make sense for a public visitor.",
      },
      {
        label: "Review team readiness",
        description: "Spot team or ownership gaps that could affect storefront operations",
        capability: "view_storefront",
        taskType: "analysis" as const,
        prompt:
          "Based on the visible storefront context, tell me whether team readiness, response ownership, or staffing could create issues for this public experience.",
      },
      {
        label: "Check settings readiness",
        description: "Look for obvious storefront setup gaps or stale configuration",
        capability: "view_storefront",
        taskType: "analysis" as const,
        prompt:
          "Review the visible storefront setup and call out any settings or configuration areas that look incomplete, stale, or risky.",
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
    skills: [
      {
        label: "Report an issue",
        description: "Report a bug or give feedback",
        capability: null,
        prompt: "I'd like to report an issue or give feedback about this page.",
      },
    ],
  },

  "/performance": PERFORMANCE_ROUTE_CONTEXT,

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
      "wiki_query",
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
      "wiki_query",
      "wiki_ingest",
      "list_wiki_overlay_drafts",
      "publish_wiki_overlay_pages",
      "fetch_public_website",
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
 * Longest prefix match, EXCEPT `exact` entries match only their own route (their
 * identity never leaks to a descendant — design spec 2026-08-05 §6.2/§8, the
 * runtime generalization of the BI-5457E216 inheritance guard). Falls back to
 * workspace. Merges universal skills into every route's skills array.
 */
export function resolveRouteContext(pathname: string): RouteContextDef {
  let best: RouteContextDef = FALLBACK_ROUTE_CONTEXT;
  let bestLen = 0;

  for (const [prefix, def] of Object.entries(ROUTE_CONTEXT_MAP)) {
    // An `exact` entry (e.g. /ops = "the delivery backlog") must NOT be
    // inherited by a descendant route; it only matches its own pathname. So
    // /ops/patches falls through to the next match instead of claiming to be
    // the backlog.
    if (def.match === "exact" && prefix !== pathname) continue;
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

  return {
    ...best,
    docsPath: resolveDocsPath(pathname) ?? best.docsPath,
    skills: mergedSkills,
  };
}
