// packages/db/src/seed.ts
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "./client.js";
import { parseRoleId, parseAgentTier, parseAgentType, parseAgentPortfolioSlug } from "./seed-helpers.js";
import { seedEaArchimate4 } from "./seed-ea-archimate4.js";
import { seedEaReferenceModels } from "./seed-ea-reference-models.js";
import { seedEaStructureRules } from "./seed-ea-structure-rules.js";
import { seedGovernanceReferenceData } from "./governance-seed.js";
import { seedWorkforceReferenceData } from "./workforce-seed.js";
import { seedStorefrontArchetypes } from "./seed-storefront-archetypes.js";
import * as crypto from "crypto";

const DATA_DIR = join(__dirname, "..", "data");

function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

async function seedRoles(): Promise<void> {
  const registry = readJson<{
    roles: Array<{
      role_id: string;
      role_name: string;
      authority_domain?: string;
      hitl_tier_min?: number;
      escalation_sla_hours?: number;
    }>;
  }>("role_registry.json");

  for (const r of registry.roles) {
    const slaDurationH =
      r.escalation_sla_hours !== undefined && r.escalation_sla_hours >= 0
        ? r.escalation_sla_hours
        : null;

    await prisma.platformRole.upsert({
      where: { roleId: parseRoleId(r.role_id) },
      update: {
        name: r.role_name,
        description: r.authority_domain ?? null,
        hitlTierMin: r.hitl_tier_min ?? 1,
        slaDurationH,
      },
      create: {
        roleId: parseRoleId(r.role_id),
        name: r.role_name,
        description: r.authority_domain ?? null,
        hitlTierMin: r.hitl_tier_min ?? 1,
        slaDurationH,
      },
    });
  }
  console.log(`Seeded ${registry.roles.length} platform roles`);
}

async function seedAgents(): Promise<void> {
  const registry = readJson<{
    agents: Array<{
      agent_id: string;
      agent_name: string;
      capability_domain?: string;
      status?: string;
      human_supervisor_id?: string;
    }>;
  }>("agent_registry.json");

  // Build portfolio slug → cuid lookup (portfolios must already be seeded)
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, slug: true } });
  const portfolioIdBySlug = new Map(portfolios.map((p) => [p.slug, p.id]));

  for (const a of registry.agents) {
    const portfolioSlug = parseAgentPortfolioSlug(a.human_supervisor_id ?? "");
    const portfolioId = portfolioSlug ? (portfolioIdBySlug.get(portfolioSlug) ?? null) : null;

    await prisma.agent.upsert({
      where: { agentId: a.agent_id },
      update: {
        name: a.agent_name,
        tier: parseAgentTier(a.agent_id),
        type: parseAgentType(a.agent_id),
        description: a.capability_domain ?? null,
        status: "active", // normalise: registry uses "defined" which means the same thing
        portfolioId,
      },
      create: {
        agentId: a.agent_id,
        name: a.agent_name,
        tier: parseAgentTier(a.agent_id),
        type: parseAgentType(a.agent_id),
        description: a.capability_domain ?? null,
        status: "active",
        portfolioId,
      },
    });
  }
  console.log(`Seeded ${registry.agents.length} agents`);
}

const PORTFOLIO_BUDGETS: Record<string, number> = {
  foundational: 2500,
  manufacturing_and_delivery: 1800,
  for_employees: 1200,
  products_and_services_sold: 3500,
};

async function seedPortfolios(): Promise<void> {
  const registry = readJson<{
    portfolios: Array<{
      id: string;
      name: string;
      description?: string;
    }>;
  }>("portfolio_registry.json");

  for (const p of registry.portfolios) {
    await prisma.portfolio.upsert({
      where: { slug: p.id },
      update: { name: p.name, description: p.description ?? null, budgetKUsd: PORTFOLIO_BUDGETS[p.id] ?? null },
      create: { slug: p.id, name: p.name, description: p.description ?? null, budgetKUsd: PORTFOLIO_BUDGETS[p.id] ?? null },
    });
  }
  console.log(`Seeded ${registry.portfolios.length} portfolios`);
}

async function seedTaxonomyNodes(): Promise<void> {
  const DATA_PATH = join(__dirname, "..", "data", "taxonomy_v2.json");
  type Row = { portfolio: string; portfolio_id: string; level_1: string; level_2: string; level_3: string };
  const rows: Row[] = JSON.parse(readFileSync(DATA_PATH, "utf-8"));

  function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  // Collect all unique nodes in insertion order (root → L1 → L2 → L3)
  const seen = new Set<string>();
  type NodeEntry = { nodeId: string; name: string; parentNodeId: string | null; portfolioId: string };

  const entries: NodeEntry[] = [];

  for (const row of rows) {
    const pid = row.portfolio_id;
    if (!seen.has(pid)) {
      seen.add(pid);
      entries.push({ nodeId: pid, name: row.portfolio, parentNodeId: null, portfolioId: pid });
    }
    if (!row.level_1) continue;
    const l1id = `${pid}/${slugify(row.level_1)}`;
    if (!seen.has(l1id)) {
      seen.add(l1id);
      entries.push({ nodeId: l1id, name: row.level_1, parentNodeId: pid, portfolioId: pid });
    }
    if (!row.level_2) continue;
    const l2id = `${l1id}/${slugify(row.level_2)}`;
    if (!seen.has(l2id)) {
      seen.add(l2id);
      entries.push({ nodeId: l2id, name: row.level_2, parentNodeId: l1id, portfolioId: pid });
    }
    if (!row.level_3) continue;
    const l3id = `${l2id}/${slugify(row.level_3)}`;
    if (!seen.has(l3id)) {
      seen.add(l3id);
      entries.push({ nodeId: l3id, name: row.level_3, parentNodeId: l2id, portfolioId: pid });
    }
  }

  // Look up Portfolio.id values by portfolioId slug
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, slug: true } });
  const portfolioIdMap = new Map<string, string>(); // portfolio slug → Portfolio.id
  for (const p of portfolios) {
    portfolioIdMap.set(p.slug, p.id);
  }

  // Insert in order so parent always exists before child
  const nodeIdToCuid = new Map<string, string>();
  for (const entry of entries) {
    const parentCuid = entry.parentNodeId ? (nodeIdToCuid.get(entry.parentNodeId) ?? null) : null;
    const portfolioCuid = portfolioIdMap.get(entry.portfolioId) ?? null;
    const node = await prisma.taxonomyNode.upsert({
      where: { nodeId: entry.nodeId },
      create: {
        nodeId:      entry.nodeId,
        name:        entry.name,
        parentId:    parentCuid,
        portfolioId: portfolioCuid,
        status:      "active",
      },
      update: {
        name:        entry.name,
        parentId:    parentCuid,
        portfolioId: portfolioCuid,
        status:      "active",
      },
      select: { id: true },
    });
    nodeIdToCuid.set(entry.nodeId, node.id);
  }

  console.log(`Seeded ${entries.length} taxonomy nodes`);
}

async function seedDigitalProducts(): Promise<void> {
  const registry = readJson<{
    digital_products: Array<{
      product_id: string;
      name: string;
      portfolio_id?: string;
      lifecycle?: { stage_status?: string };
    }>;
  }>("digital_product_registry.json");

  const products = registry.digital_products;
  for (const p of products) {
    let portfolioDbId: string | undefined;
    if (p.portfolio_id) {
      const portfolio = await prisma.portfolio.findUnique({ where: { slug: p.portfolio_id } });
      portfolioDbId = portfolio?.id;
    }
    // Treat registry stage_status as the operational lifecycleStatus.
    // All registry products are assumed to be in production.
    const lifecycleStatus = p.lifecycle?.stage_status ?? "active";

    await prisma.digitalProduct.upsert({
      where: { productId: p.product_id },
      update: { name: p.name, lifecycleStage: "production", lifecycleStatus, portfolioId: portfolioDbId ?? null },
      create: {
        productId: p.product_id,
        name: p.name,
        lifecycleStage: "production",
        lifecycleStatus,
        portfolioId: portfolioDbId ?? null,
      },
    });
  }
  console.log(`Seeded ${products.length} digital products`);
}

async function seedDpfSelfRegistration(): Promise<void> {
  // Resolve the manufacturing_and_delivery portfolio and taxonomy node
  const portfolio = await prisma.portfolio.findUnique({
    where: { slug: "manufacturing_and_delivery" },
  });
  if (!portfolio) throw new Error("manufacturing_and_delivery portfolio not seeded");

  const taxonomyNode = await prisma.taxonomyNode.findUnique({
    where: { nodeId: "manufacturing_and_delivery" },
  });
  if (!taxonomyNode) throw new Error("manufacturing_and_delivery taxonomy node not seeded");

  // Register DPF Portal as a DigitalProduct
  const dpfPortal = await prisma.digitalProduct.upsert({
    where: { productId: "dpf-portal" },
    update: {
      name:            "Digital Product Factory Portal",
      lifecycleStage:  "production",
      lifecycleStatus: "active",
      portfolioId:     portfolio.id,
      taxonomyNodeId:  taxonomyNode.id,
    },
    create: {
      productId:       "dpf-portal",
      name:            "Digital Product Factory Portal",
      lifecycleStage:  "production",
      lifecycleStatus: "active",
      portfolioId:     portfolio.id,
      taxonomyNodeId:  taxonomyNode.id,
    },
    select: { id: true },
  });

  // Portfolio-type backlog items — strategic, domain-wide
  const portfolioItems = [
    { itemId: "BI-PORT-001", title: "Establish Digital Product Factory in Manufacture and Delivery Portfolio", status: "done",        priority: 1 },
    { itemId: "BI-PORT-002", title: "Implement DPPM taxonomy — 481-node portfolio ownership graph",          status: "done",        priority: 2 },
    { itemId: "BI-PORT-003", title: "Portfolio route — browsable portfolio tree with node detail",           status: "done",        priority: 3 },
    { itemId: "BI-PORT-004", title: "Backlog system — portfolio and product context per IT4IT",              status: "in-progress", priority: 4 },
  ];

  for (const item of portfolioItems) {
    await prisma.backlogItem.upsert({
      where:  { itemId: item.itemId },
      update: { title: item.title, status: item.status, priority: item.priority, type: "portfolio", taxonomyNodeId: taxonomyNode.id },
      create: { itemId: item.itemId, title: item.title, status: item.status, priority: item.priority, type: "portfolio", taxonomyNodeId: taxonomyNode.id },
    });
  }

  // Product-type backlog items — linked to dpf-portal
  const productItems = [
    { itemId: "BI-PROD-001", title: "Phase 5A — Backlog CRUD in /ops",                                    status: "done",        priority: 1 },
    { itemId: "BI-PROD-002", title: "Phase 5B — DPF self-registration as managed digital product",        status: "done",        priority: 2 },
    { itemId: "BI-PROD-003", title: "Phase 2B — Live Agent counts and Health metrics in portfolio panels", status: "done",        priority: 3 },
    {
      itemId: "BI-PROD-004",
      title: "Add a resilient theme option library with branding presets from 10+ companies",
      status: "open",
      priority: 4,
      body: [
        "Branding source references:",
        "- ServiceNow",
        "- TeamLogicIT",
        "- The Open Group",
        "- state of TX",
        "- Rudys",
        "- Buccees",
        "- Great Clips",
        "- Dunkin' Donuts",
        "- Floyds Glass Co.",
        "- Atlassian",
        "- Adobe",
        "",
        "Acceptance criteria:",
        "- Theme presets are stored as structured JSON with palette, typography, spacing, and radius variables.",
        "- Users can switch themes at runtime and see immediate, consistent UI updates.",
        "- The application has graceful fallback defaults if a preset is missing one or more tokens.",
        "- Presets render correctly in dark and light modes where supported.",
        "- Preset selection is persisted per user and applied on next login.",
        "- New preset files can be added without code changes to core theme logic.",
      ].join("\n"),
    },
    {
      itemId: "BI-PROD-005",
      title: "Define theme token schema and preset packaging contract",
      status: "open",
      priority: 5,
      body: [
        "Scope:",
        "- Define a versioned JSON contract for theme presets (palette, typography, spacing, radius, shadows, surfaces, states).",
        "- Add validation to ensure required tokens exist before publish.",
        "- Store presets in a repo/config path and load through shared runtime service.",
        "- Provide migration path for old presets.",
        "",
        "Acceptance criteria:",
        "- Contract is documented and versioned (v1+).",
        "- CI validation rejects malformed preset objects.",
        "- No hard-coded theme constants remain outside preset source.",
      ].join("\n"),
    },
    {
      itemId: "BI-PROD-006",
      title: "Implement theme provider and runtime theme switching",
      status: "open",
      priority: 6,
      body: [
        "Scope:",
        "- Add a centralized ThemeProvider for app-wide CSS variable injection.",
        "- Render immediate switch between presets without full-page refresh.",
        "- Support both light and dark mode variants for every preset where available.",
        "",
        "Acceptance criteria:",
        "- Changing preset updates key surfaces within <300ms in normal conditions.",
        "- Preset fallbacks apply automatically on missing tokens.",
        "- No visual regression on default app pages.",
      ].join("\n"),
    },
    {
      itemId: "BI-PROD-007",
      title: "Persist theme preference per user and add admin preset management",
      status: "open",
      priority: 7,
      body: [
        "Scope:",
        "- Persist selected preset to user profile and restore on login.",
        "- Add admin UI/API to preview and enable/disable preset availability.",
        "- Add governance metadata (owner, approval, enabled, deprecation date).",
        "",
        "Acceptance criteria:",
        "- User selection is recovered after refresh and across sessions.",
        "- Admin can toggle preset visibility without redeploy.",
        "- Deactivated preset is never selectable by regular users.",
      ].join("\n"),
    },
    {
      itemId: "BI-PROD-008",
      title: "AI co-worker branding setup from admin prompt or website URL",
      status: "open",
      priority: 8,
      body: [
        "Scope:",
        "- Add an admin action where a user can provide either plain-language branding instructions or a public website URL.",
        "- Route that request through the co-worker layer to generate a draft branding configuration.",
        "- Populate theme tokens, logo candidates, and metadata with confidence indicators.",
        "- Keep a human-in-the-loop approval step before publishing any generated branding profile.",
        "",
        "Acceptance criteria:",
        "- Admin can submit either free-text instructions or URL input from the admin page.",
        "- Generated branding draft includes primary/secondary colors, accent, and logo recommendation.",
        "- Admin can review, edit, and approve the generated draft before it becomes active.",
        "- Rejected drafts remain saved with traceability for later revision.",
      ].join("\n"),
    },
  ];

  for (const item of productItems) {
    const backlogBody = item.body ?? null;
    await prisma.backlogItem.upsert({
      where:  { itemId: item.itemId },
      update: {
        title: item.title,
        status: item.status,
        priority: item.priority,
        body: backlogBody,
        type: "product",
        digitalProductId: dpfPortal.id,
        taxonomyNodeId: taxonomyNode.id,
      },
      create: {
        itemId: item.itemId,
        title: item.title,
        status: item.status,
        priority: item.priority,
        body: backlogBody,
        type: "product",
        digitalProductId: dpfPortal.id,
        taxonomyNodeId: taxonomyNode.id,
      },
    });
  }

  console.log(`Seeded DPF Portal digital product and ${portfolioItems.length + productItems.length} backlog items`);
}

async function seedThemeBrandingEpic(): Promise<void> {
  const portfolio = await prisma.portfolio.findUnique({ where: { slug: "manufacturing_and_delivery" } });
  if (!portfolio) throw new Error("manufacturing_and_delivery portfolio not seeded");

  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-UI-THEME-001" },
    update: {
      title: "Theme & Branding Modernization",
      description:
        "Create a resilient theme-system foundation with configurable color/branding presets from a curated set of company styles.",
      status: "open",
    },
    create: {
      epicId: "EP-UI-THEME-001",
      title: "Theme & Branding Modernization",
      description:
        "Create a resilient theme-system foundation with configurable color/branding presets from a curated set of company styles.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic.id, portfolioId: portfolio.id } },
    update: {},
    create: { epicId: epic.id, portfolioId: portfolio.id },
  });

  await prisma.backlogItem.update({
    where: { itemId: "BI-PROD-004" },
    data: { epicId: epic.id },
  });

  await Promise.all([
    prisma.backlogItem.update({ where: { itemId: "BI-PROD-005" }, data: { epicId: epic.id } }),
    prisma.backlogItem.update({ where: { itemId: "BI-PROD-006" }, data: { epicId: epic.id } }),
    prisma.backlogItem.update({ where: { itemId: "BI-PROD-007" }, data: { epicId: epic.id } }),
    prisma.backlogItem.update({ where: { itemId: "BI-PROD-008" }, data: { epicId: epic.id } }),
  ]);

  console.log(`Seeded theme epic ${epic.epicId} and linked BI-PROD-004/005/006/007/008`);
}

async function seedDarkThemeUsabilityEpic(): Promise<void> {
  const portfolio = await prisma.portfolio.findUnique({ where: { slug: "manufacturing_and_delivery" } });
  if (!portfolio) throw new Error("manufacturing_and_delivery portfolio not seeded");

  const dpfPortal = await prisma.digitalProduct.findUnique({ where: { productId: "dpf-portal" } });
  if (!dpfPortal) throw new Error("dpf-portal digital product not seeded");

  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-UI-A11Y-001" },
    update: {
      title: "Dark-Theme Usability & Accessibility Policy",
      description:
        "Establish and enforce WCAG 2.1 AA contrast standards, minimum font sizes, and surface separation rules tailored to the platform's dark theme. Applies to all future development and admin configuration screens.",
      status: "open",
    },
    create: {
      epicId: "EP-UI-A11Y-001",
      title: "Dark-Theme Usability & Accessibility Policy",
      description:
        "Establish and enforce WCAG 2.1 AA contrast standards, minimum font sizes, and surface separation rules tailored to the platform's dark theme. Applies to all future development and admin configuration screens.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic.id, portfolioId: portfolio.id } },
    update: {},
    create: { epicId: epic.id, portfolioId: portfolio.id },
  });

  const items = [
    {
      itemId: "BI-PROD-009",
      title: "Define dark-theme contrast standards — WCAG AA minimums for dark backgrounds",
      body: "Document colour contrast requirements: 4.5:1 for normal text, 3:1 for large text against #0f0f1a and #1a1a2e surfaces. Establish token palette: --dpf-muted (#8888a0, ~5:1), labels (#c0c0d8, ~7:1), secondary (#b0b0c8, ~6:1). No text may use colours below 4.5:1 on dark surfaces.",
      status: "done",
      priority: 1,
    },
    {
      itemId: "BI-PROD-010",
      title: "Establish minimum font-size policy — 10px floor for all UI text",
      body: "Audit all inline styles and Tailwind classes. No text element may be smaller than 10px. Form labels: 12px minimum. Form inputs and buttons: 13px minimum. Document in CLAUDE.md and component guidelines.",
      status: "done",
      priority: 2,
    },
    {
      itemId: "BI-PROD-011",
      title: "Audit and remediate existing admin/platform screens for contrast compliance",
      body: "Sweep all /platform, /admin, and /ea screens. Replace any remaining #555566 with #8888a0. Bump undersized text. Verify form inputs, buttons, and labels meet the new minimums.",
      status: "done",
      priority: 3,
    },
    {
      itemId: "BI-PROD-012",
      title: "Create dark-theme development guidelines for future feature work",
      body: "Write developer-facing guidelines covering: surface hierarchy rules (bg < surface-1 < surface-2), border contrast, focus indicators, disabled-state contrast, and how to validate with contrast-checker tools. Include in onboarding docs.",
      status: "open",
      priority: 4,
    },
    {
      itemId: "BI-PROD-013",
      title: "Add UX Accessibility AI Agent (AGT-903) to agent registry",
      body: "Register a cross-cutting UX accessibility agent that reviews UI work for WCAG compliance, contrast ratios, font sizing, and dark-theme usability. Agent should be invokable during code review to flag accessibility regressions.",
      status: "open",
      priority: 5,
    },
  ];

  for (const item of items) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: {
        title: item.title,
        status: item.status,
        priority: item.priority,
        body: item.body,
        type: "product",
        digitalProductId: dpfPortal.id,
        epicId: epic.id,
      },
      create: {
        itemId: item.itemId,
        title: item.title,
        status: item.status,
        priority: item.priority,
        body: item.body,
        type: "product",
        digitalProductId: dpfPortal.id,
        epicId: epic.id,
      },
    });
  }

  console.log(`Seeded dark-theme usability epic ${epic.epicId} with ${items.length} backlog items`);
}

async function seedMvpEpics(): Promise<void> {
  const mfgPortfolio = await prisma.portfolio.findUnique({ where: { slug: "manufacturing_and_delivery" } });
  const foundPortfolio = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!mfgPortfolio || !foundPortfolio) throw new Error("Required portfolios not seeded");

  const dpfPortal = await prisma.digitalProduct.findUnique({ where: { productId: "dpf-portal" } });
  if (!dpfPortal) throw new Error("dpf-portal digital product not seeded");

  const taxNode = await prisma.taxonomyNode.findUnique({ where: { nodeId: "manufacturing_and_delivery" } });
  if (!taxNode) throw new Error("manufacturing_and_delivery taxonomy node not seeded");

  // ── EP-LLM-LIVE-001 ──────────────────────────────────────────────────────
  const llmEpic = await prisma.epic.upsert({
    where: { epicId: "EP-LLM-LIVE-001" },
    update: {
      title: "Live LLM Conversations",
      description: "Replace canned responses in the co-worker panel with real AI inference via configured providers. Generalizes the existing profiling call infrastructure into a chat-capable inference pipeline.",
      status: "open",
    },
    create: {
      epicId: "EP-LLM-LIVE-001",
      title: "Live LLM Conversations",
      description: "Replace canned responses in the co-worker panel with real AI inference via configured providers. Generalizes the existing profiling call infrastructure into a chat-capable inference pipeline.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: llmEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: llmEpic.id, portfolioId: mfgPortfolio.id },
  });

  const llmItems = [
    { itemId: "BI-LLM-001", title: "PlatformConfig schema + AgentMessage providerId + callProvider inference module", priority: 1, body: "Extract the private callProviderForProfiling from lib/actions/ai-providers.ts into a shared lib/ai-inference.ts module. Generalize into callProvider(providerId, modelId, messages[], systemPrompt) supporting multi-turn chat. Return { content, inputTokens, outputTokens, inferenceMs }." },
    { itemId: "BI-LLM-002", title: "Define agent system prompts for all 9 route agents", priority: 2, body: "Extend RouteAgentEntry and AgentInfo types with systemPrompt field. Add prompts to ROUTE_AGENT_MAP for each of the 9 route agents describing role, capabilities, and context awareness." },
    { itemId: "BI-LLM-003", title: "Add platform default provider and model selection", priority: 3, body: "Add platform-level default provider+model config for agent conversations. Selection UI in /platform/ai with dropdown of active providers and discovered models. rankProvidersByCost (lib/ai-profiling.ts) provides auto-selection fallback." },
    { itemId: "BI-LLM-004", title: "Replace canned responses with live inference in sendMessage", priority: 4, body: "In sendMessage server action: check for active default provider, build messages array (system prompt + last 20 thread messages + user message), call callProvider, persist response. Fall back to generateCannedResponse when no provider active. Token counts logged via TokenUsage, not stored on AgentMessage." },
    { itemId: "BI-LLM-005", title: "Wire token usage logging into inference calls", priority: 5, body: "Extract private logTokenUsage from lib/actions/ai-providers.ts to shared module. Call after every successful inference with agentId, providerId, contextKey=coworker, token counts, and computed cost." },
  ];

  for (const item of llmItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: llmEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: llmEpic.id },
    });
  }

  // ── EP-DEPLOY-001 ─────────────────────────────────────────────────────────
  const deployEpic = await prisma.epic.upsert({
    where: { epicId: "EP-DEPLOY-001" },
    update: {
      title: "Standalone Docker Deployment with Managed Ollama",
      description: "Single docker compose up brings portal + Postgres + Ollama online. Platform UI manages Docker/Ollama directly with auto-detection of host GPU/RAM and zero-config model selection.",
      status: "open",
    },
    create: {
      epicId: "EP-DEPLOY-001",
      title: "Standalone Docker Deployment with Managed Ollama",
      description: "Single docker compose up brings portal + Postgres + Ollama online. Platform UI manages Docker/Ollama directly with auto-detection of host GPU/RAM and zero-config model selection.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: deployEpic.id, portfolioId: foundPortfolio.id } },
    update: {},
    create: { epicId: deployEpic.id, portfolioId: foundPortfolio.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: deployEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: deployEpic.id, portfolioId: mfgPortfolio.id },
  });

  const deployItems = [
    { itemId: "BI-DEPLOY-001", title: "Create portal Dockerfile and Docker Compose stack", priority: 1, body: "Multi-stage Dockerfile for Next.js standalone. Compose: portal (port 3000), db (Postgres 16, volume), ollama (GPU passthrough). Auto-run Prisma migrations on startup." },
    { itemId: "BI-DEPLOY-002", title: "Build Docker API client for container management", priority: 2, body: "Server-side module talking to Docker Engine API via /var/run/docker.sock. Scoped to Ollama container: status, start/stop/restart, pull image. Auth: manage_provider_connections." },
    { itemId: "BI-DEPLOY-003", title: "Add Ollama management UI in platform", priority: 3, body: "New section in /platform/ai: Ollama container status, start/stop/restart buttons, model list, pull new model by name, delete model, real-time pull progress." },
    { itemId: "BI-DEPLOY-004", title: "Implement host capability detection and auto-model selection", priority: 4, body: "Detect GPU (NVIDIA runtime), RAM. Selection: CPU <8GB -> phi3:mini, CPU 16GB+ -> llama3:8b, GPU 8GB -> llama3:8b, GPU 16GB+ -> llama3:70b-q4. Store as platform config." },
    { itemId: "BI-DEPLOY-005", title: "Auto-pull default model and auto-configure provider on first startup", priority: 5, body: "Startup: check Ollama reachable -> check models pulled -> if none, pull auto-selected -> set Ollama provider active -> set as default for agent conversations. Zero manual config." },
    { itemId: "BI-DEPLOY-006", title: "Add health check monitoring and status indicators", priority: 6, body: "Compose health checks on all services. Portal banner when Ollama unreachable. /api/health endpoint for external monitoring." },
  ];

  for (const item of deployItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: deployEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: deployEpic.id },
    });
  }

  // ── EP-AGENT-EXEC-001 ────────────────────────────────────────────────────
  const execEpic = await prisma.epic.upsert({
    where: { epicId: "EP-AGENT-EXEC-001" },
    update: {
      title: "Agent Task Execution with HITL Governance",
      description: "Agents propose real actions (create backlog items, modify products, update EA). Humans approve before execution. Audit-logged via AuthorizationDecisionLog for regulated industry compliance.",
      status: "open",
    },
    create: {
      epicId: "EP-AGENT-EXEC-001",
      title: "Agent Task Execution with HITL Governance",
      description: "Agents propose real actions (create backlog items, modify products, update EA). Humans approve before execution. Audit-logged via AuthorizationDecisionLog for regulated industry compliance.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: execEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: execEpic.id, portfolioId: mfgPortfolio.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: execEpic.id, portfolioId: foundPortfolio.id } },
    update: {},
    create: { epicId: execEpic.id, portfolioId: foundPortfolio.id },
  });

  const execItems = [
    { itemId: "BI-EXEC-001", title: "Design AgentActionProposal schema", priority: 1, body: "New Prisma migration. Model: proposalId (unique), threadId FK AgentThread, messageId FK AgentMessage, agentId, actionType enum, parameters Json, status (proposed|approved|rejected|executed|failed), proposedAt, decidedAt, decidedBy userId FK, executedAt, resultEntityId, resultError." },
    { itemId: "BI-EXEC-002", title: "Build proposal creation from agent inference", priority: 2, body: "Parse LLM tool-use responses into AgentActionProposal records. Define tool schemas: create_backlog_item, update_lifecycle, create_ea_element, etc. System prompts include available tools based on user capabilities." },
    { itemId: "BI-EXEC-003", title: "Create proposal card rendering in chat UX", priority: 3, body: "Structured content in AgentMessageBubble for messages with proposals. Card: action type label, key parameters, affected entity. Inline Approve/Reject/Edit buttons. Visual states for approved/rejected." },
    { itemId: "BI-EXEC-004", title: "Implement proposal execution engine", priority: 4, body: "On approval: map actionType + parameters to existing server actions (createBacklogItem, etc.). Execute with approving user auth context. Record executedAt, resultEntityId or resultError. Post confirmation in thread." },
    { itemId: "BI-EXEC-005", title: "Wire approval events into AuthorizationDecisionLog", priority: 5, body: "Every proposal approval/rejection writes to AuthorizationDecisionLog: actorRef (who), actionKey (what), objectRef (entity), decision, rationale. Satisfies regulated industry audit trail requirement." },
    { itemId: "BI-EXEC-006", title: "Add agent action history view in platform", priority: 6, body: "Table of AgentActionProposal records in /platform or /admin. Filter by status, agent, action type, date range. Detail view with full parameters, approval chain, execution result. Export for compliance audits." },
  ];

  for (const item of execItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: execEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: execEpic.id },
    });
  }

  console.log(`Seeded 3 MVP epics: ${llmEpic.epicId} (${llmItems.length} items), ${deployEpic.epicId} (${deployItems.length} items), ${execEpic.epicId} (${execItems.length} items)`);
}

async function seedMobileCompanionEpics(): Promise<void> {
  const foundPortfolio = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  const mfgPortfolio = await prisma.portfolio.findUnique({ where: { slug: "manufacturing_and_delivery" } });
  if (!foundPortfolio || !mfgPortfolio) throw new Error("Required portfolios not seeded");

  const dpfPortal = await prisma.digitalProduct.findUnique({ where: { productId: "dpf-portal" } });
  if (!dpfPortal) throw new Error("dpf-portal digital product not seeded");

  const taxNode = await prisma.taxonomyNode.findUnique({ where: { nodeId: "manufacturing_and_delivery" } });
  if (!taxNode) throw new Error("manufacturing_and_delivery taxonomy node not seeded");

  // ── EP-REST-API-001 — Platform REST API v1 ────────────────────────────────
  const restApiEpic = await prisma.epic.upsert({
    where: { epicId: "EP-REST-API-001" },
    update: {
      title: "Platform REST API v1",
      description:
        "Extract business logic from server actions into shared functions. Expose as versioned REST endpoints. JWT auth alongside existing session auth. OpenAPI spec generation.",
      status: "open",
    },
    create: {
      epicId: "EP-REST-API-001",
      title: "Platform REST API v1",
      description:
        "Extract business logic from server actions into shared functions. Expose as versioned REST endpoints. JWT auth alongside existing session auth. OpenAPI spec generation.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: restApiEpic.id, portfolioId: foundPortfolio.id } },
    update: {},
    create: { epicId: restApiEpic.id, portfolioId: foundPortfolio.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: restApiEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: restApiEpic.id, portfolioId: mfgPortfolio.id },
  });

  const restApiItems = [
    { itemId: "BI-REST-001", title: "Extract shared business logic from server actions into packages/api/", priority: 1, body: "Refactor existing server actions to separate business logic from Next.js-specific concerns. Create packages/api/ with shared functions callable from both server actions and REST route handlers." },
    { itemId: "BI-REST-002", title: "JWT auth middleware (issue, refresh, validate alongside NextAuth sessions, using ApiToken model for refresh tokens)", priority: 2, body: "Implement JWT middleware that issues and validates access tokens (15-min TTL) alongside existing NextAuth sessions. Use ApiToken model for refresh tokens (30-day TTL, rotated on refresh). Dual auth: check Bearer header first, fall back to session cookie." },
    { itemId: "BI-REST-003", title: "Auth endpoints (login, refresh, logout, me)", priority: 3, body: "POST /api/v1/auth/login (email+password → JWT pair), POST /api/v1/auth/refresh (rotate tokens), POST /api/v1/auth/logout (invalidate refresh token), GET /api/v1/auth/me (current user + role + capabilities)." },
    { itemId: "BI-REST-004", title: "Workspace endpoints (dashboard, activity)", priority: 4, body: "GET /api/v1/workspace/dashboard (tiles, metrics, calendar items), GET /api/v1/workspace/activity (recent activity feed). Cursor-based pagination." },
    { itemId: "BI-REST-005", title: "Portfolio endpoints (tree, detail, products)", priority: 5, body: "GET /api/v1/portfolio/tree (full hierarchy), GET /api/v1/portfolio/:id (detail + health), GET /api/v1/portfolio/:id/products (products under portfolio)." },
    { itemId: "BI-REST-006", title: "Ops endpoints (epics CRUD, backlog CRUD)", priority: 6, body: "GET/POST /api/v1/ops/epics, PATCH /api/v1/ops/epics/:id, GET/POST /api/v1/ops/backlog, PATCH/DELETE /api/v1/ops/backlog/:id. Filterable list with cursor pagination." },
    { itemId: "BI-REST-007", title: "Agent endpoints (message, thread, stream SSE, proposals)", priority: 7, body: "POST /api/v1/agent/message (send to specialist), GET /api/v1/agent/thread (conversation history), GET /api/v1/agent/stream (SSE real-time responses), GET /api/v1/agent/proposals (pending HITL proposals)." },
    { itemId: "BI-REST-008", title: "Governance endpoints (approvals, decisions)", priority: 8, body: "GET /api/v1/governance/approvals (AgentActionProposal where status=proposed), POST /api/v1/governance/approvals/:id (update status + decidedById/decidedAt), GET /api/v1/governance/decisions (AuthorizationDecisionLog audit trail)." },
    { itemId: "BI-REST-009", title: "Customer endpoints (accounts CRUD)", priority: 9, body: "GET /api/v1/customer/accounts (customer list), GET /api/v1/customer/accounts/:id (detail), PATCH /api/v1/customer/accounts/:id (update). Cursor-based pagination, capability-gated." },
    { itemId: "BI-REST-010", title: "Compliance endpoints (alerts, incidents, controls, regulations, audit findings, corrective actions)", priority: 10, body: "GET /api/v1/compliance/alerts, /incidents, /controls, /regulations, /audits/:id/findings, /corrective-actions. Read-only list endpoints for mobile field reference." },
    { itemId: "BI-REST-011", title: "Notification + push device DB models and endpoints", priority: 11, body: "Create Notification and PushDeviceRegistration Prisma models + migration. Endpoints: GET /api/v1/notifications (feed), PATCH /api/v1/notifications/:id/read, POST /api/v1/notifications/register-device (FCM/APNs token)." },
    { itemId: "BI-REST-012", title: "Dynamic content endpoints (forms, views — returns empty until builder exists)", priority: 12, body: "GET /api/v1/dynamic/forms, GET /api/v1/dynamic/forms/:id, POST /api/v1/dynamic/forms/:id/submit, GET /api/v1/dynamic/views, GET /api/v1/dynamic/views/:id/data. Returns empty arrays until portal form builder lands." },
    { itemId: "BI-REST-013", title: "OpenAPI spec generation + typed client in packages/api-client/", priority: 13, body: "Auto-generate OpenAPI 3.1 spec from route handlers. Generate typed TypeScript client in packages/api-client/ consumable by both web and mobile. Publish as internal package." },
    { itemId: "BI-REST-014", title: "Shared Zod validators in packages/validators/", priority: 14, body: "Create packages/validators/ with Zod schemas for all API request/response shapes. Shared between REST route handlers (server-side) and api-client (client-side). Single source of truth for validation." },
    { itemId: "BI-REST-015", title: "REST API test suite (Vitest + supertest, matching web test framework)", priority: 15, body: "Comprehensive test suite for all REST endpoints using Vitest + supertest. Test auth flows, CRUD operations, pagination, error responses, capability gates. Matches existing web test conventions." },
    { itemId: "BI-REST-016", title: "File upload endpoint (POST /api/v1/upload, multipart, 10MB limit, image/pdf)", priority: 16, body: "POST /api/v1/upload accepting multipart/form-data. Max 10MB per file, accepted types: image/jpeg, image/png, image/heic, application/pdf. Returns { fileId, url }. Used by camera and signature fields in dynamic forms." },
    { itemId: "BI-REST-017", title: "SSE stream migration (replace /api/agent/stream with /api/v1/agent/stream)", priority: 17, body: "Migrate SSE stream endpoint to /api/v1/agent/stream accepting both JWT and session auth. Deprecate old /api/agent/stream route. Ensure backward compatibility during migration period." },
  ];

  for (const item of restApiItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: restApiEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: restApiEpic.id },
    });
  }

  // ── EP-MOBILE-FOUND-001 — Mobile Companion App Foundation ─────────────────
  const mobileFoundEpic = await prisma.epic.upsert({
    where: { epicId: "EP-MOBILE-FOUND-001" },
    update: {
      title: "Mobile Companion App Foundation",
      description:
        "Expo project scaffold, auth flow, navigation shell, offline infrastructure, push notifications.",
      status: "open",
    },
    create: {
      epicId: "EP-MOBILE-FOUND-001",
      title: "Mobile Companion App Foundation",
      description:
        "Expo project scaffold, auth flow, navigation shell, offline infrastructure, push notifications.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: mobileFoundEpic.id, portfolioId: foundPortfolio.id } },
    update: {},
    create: { epicId: mobileFoundEpic.id, portfolioId: foundPortfolio.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: mobileFoundEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: mobileFoundEpic.id, portfolioId: mfgPortfolio.id },
  });

  const mobileFoundItems = [
    { itemId: "BI-MOB-001", title: "Expo project scaffold in apps/mobile/ with pnpm workspace integration", priority: 1, body: "Initialize Expo SDK 53+ managed workflow project in apps/mobile/. Configure pnpm workspace integration, TypeScript strict mode, path aliases. Link shared packages (types, api-client, validators)." },
    { itemId: "BI-MOB-002", title: "Expo Router tab navigation (Home, Ops, Portfolio, Customers, More)", priority: 2, body: "File-based routing with Expo Router. Bottom tab navigator with five tabs: Home (workspace), Ops, Portfolio, Customers, More. Stack navigators nested within each tab for drill-down screens." },
    { itemId: "BI-MOB-003", title: "Auth flow (login screen, JWT storage in Secure Storage, biometric unlock)", priority: 3, body: "Login screen with email+password. Store JWT access+refresh tokens in expo-secure-store with biometric access control (requireAuthentication: true). Auto-refresh on app open. Redirect to login when refresh token expired." },
    { itemId: "BI-MOB-004", title: "API client integration (packages/api-client/ consuming /api/v1/*)", priority: 4, body: "Integrate the typed REST client from packages/api-client/ into the mobile app. Configure base URL, auth header injection, automatic token refresh on 401, error handling." },
    { itemId: "BI-MOB-005", title: "Offline cache layer (SQLite for entities, MMKV for tokens/prefs)", priority: 5, body: "expo-sqlite for relational entity caching (dashboard, epics, backlog, customers). react-native-mmkv for key-value storage (tokens, preferences, cache schema version). Repository pattern for testable storage interfaces." },
    { itemId: "BI-MOB-006", title: "Push notification setup (expo-notifications, FCM/APNs, device registration)", priority: 6, body: "Configure expo-notifications for both iOS (APNs) and Android (FCM). Register device token via POST /api/v1/notifications/register-device. Handle notification permissions, token refresh, and foreground/background notification display." },
    { itemId: "BI-MOB-007", title: "Deep linking (notification tap → correct screen)", priority: 7, body: "Configure Expo Router deep linking so notification taps navigate to the correct screen using the deepLink field from Notification model. Handle cold start and warm start deep link scenarios." },
    { itemId: "BI-MOB-008", title: "Testing harness (jest-expo, RNTL, MSW, renderWithProviders, Maestro config)", priority: 8, body: "Set up jest-expo with React Native Testing Library. Configure MSW msw/native for API mocking. Create renderWithProviders test helper with Zustand stores and navigation context. Configure Maestro for E2E flows." },
    { itemId: "BI-MOB-009", title: "EAS Build + Submit configuration (eas.json, credentials, CI workflow)", priority: 9, body: "Configure eas.json with development, preview, and production build profiles. Set up EAS credentials for iOS code signing and Android keystore. GitHub Actions workflow for CI: type check, lint, Jest tests, then trigger EAS build." },
    { itemId: "BI-MOB-010", title: "App theming (match platform brand tokens, dark mode, typography)", priority: 10, body: "NativeWind v4 configuration matching platform brand tokens. Dark mode support matching web theme. Typography scale, spacing tokens, color palette. Minimum touch targets: 44x44pt iOS, 48x48dp Android." },
  ];

  for (const item of mobileFoundItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: mobileFoundEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: mobileFoundEpic.id },
    });
  }

  // ── EP-MOBILE-FEAT-001 — Mobile Companion App Features ────────────────────
  const mobileFeatEpic = await prisma.epic.upsert({
    where: { epicId: "EP-MOBILE-FEAT-001" },
    update: {
      title: "Mobile Companion App Features",
      description:
        "Core feature screens with full offline caching and test coverage.",
      status: "open",
    },
    create: {
      epicId: "EP-MOBILE-FEAT-001",
      title: "Mobile Companion App Features",
      description:
        "Core feature screens with full offline caching and test coverage.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: mobileFeatEpic.id, portfolioId: foundPortfolio.id } },
    update: {},
    create: { epicId: mobileFeatEpic.id, portfolioId: foundPortfolio.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: mobileFeatEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: mobileFeatEpic.id, portfolioId: mfgPortfolio.id },
  });

  const mobileFeatItems = [
    { itemId: "BI-MOB-011", title: "Workspace dashboard (tiles, calendar, activity feed, quick actions)", priority: 1, body: "Home tab screen displaying health metric tiles per area, calendar widget with upcoming items, recent activity feed, and quick action buttons (create item, approve, message agent). Cached in SQLite with 'Last synced' indicator." },
    { itemId: "BI-MOB-012", title: "Epic list + detail screen", priority: 2, body: "Ops tab epic list grouped and filterable by status/portfolio. Epic detail screen showing description, status, and linked backlog items. Pull-to-refresh with offline cache fallback." },
    { itemId: "BI-MOB-013", title: "Backlog item list + detail + create/edit", priority: 3, body: "Backlog item list within Ops tab, filterable by status/priority/epic. Detail screen with all fields. Create and edit forms with validation from packages/validators/. Mutations queued when offline." },
    { itemId: "BI-MOB-014", title: "Portfolio tree + node detail (read-only)", priority: 4, body: "Portfolio tab with collapsible hierarchy tree view. Node detail screen showing health metrics, budget info, and linked products. Product detail with read-only lifecycle view. Cached for offline browsing." },
    { itemId: "BI-MOB-015", title: "Customer list + detail + edit", priority: 5, body: "Customers tab with searchable, filterable customer list. Customer detail screen showing contacts, accounts, and history. Edit capability for customer fields with capability-gated access." },
    { itemId: "BI-MOB-016", title: "Agent co-worker FAB (route-aware specialist, SSE streaming, thread history)", priority: 6, body: "Floating action button persistent across all tabs. Routes to correct specialist based on current screen context (Ops → ops-coordinator, Portfolio → portfolio-advisor). Real-time SSE streaming in foreground. Push notification for background responses. Thread history synced with web." },
    { itemId: "BI-MOB-017", title: "Approvals queue + approve/reject flow", priority: 7, body: "More tab approvals screen showing AgentActionProposal records where status=proposed. Approve/reject with optional rationale. Updates reflected in real-time. Capability-gated to authorized users." },
    { itemId: "BI-MOB-018", title: "Compliance alerts + incident list", priority: 8, body: "More tab compliance section showing active regulatory alerts and compliance incidents. Read-only list with detail drill-down. Useful for field reference by compliance officers." },
    { itemId: "BI-MOB-019", title: "Notification history screen", priority: 9, body: "More tab notification history showing all notifications with read/unread status. Mark as read on tap. Deep link navigation to relevant screen on notification tap. Paginated with cursor-based loading." },
    { itemId: "BI-MOB-020", title: "Profile + settings screen", priority: 10, body: "More tab profile screen showing current user info, role, and capabilities. Settings for notification preferences, biometric unlock toggle, cache management (clear cache), and app version info." },
    { itemId: "BI-MOB-021", title: "Maestro E2E flows for all feature screens", priority: 11, body: "Maestro YAML E2E test flows: login, backlog CRUD, agent chat, approval flow, offline cache, customer view, deep link navigation. Runs on EAS Workflows — Android on Linux, iOS on macOS." },
  ];

  for (const item of mobileFeatItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: mobileFeatEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: mobileFeatEpic.id },
    });
  }

  // ── EP-MOBILE-DYN-001 — Mobile Dynamic Content Renderer ───────────────────
  const mobileDynEpic = await prisma.epic.upsert({
    where: { epicId: "EP-MOBILE-DYN-001" },
    update: {
      title: "Mobile Dynamic Content Renderer",
      description:
        "Schema-driven form and view rendering engine. Consumes definitions from /api/v1/dynamic/*.",
      status: "open",
    },
    create: {
      epicId: "EP-MOBILE-DYN-001",
      title: "Mobile Dynamic Content Renderer",
      description:
        "Schema-driven form and view rendering engine. Consumes definitions from /api/v1/dynamic/*.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: mobileDynEpic.id, portfolioId: foundPortfolio.id } },
    update: {},
    create: { epicId: mobileDynEpic.id, portfolioId: foundPortfolio.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: mobileDynEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: mobileDynEpic.id, portfolioId: mfgPortfolio.id },
  });

  const mobileDynItems = [
    { itemId: "BI-MOB-022", title: "Form renderer engine (field type → native component mapping)", priority: 1, body: "Core rendering engine that maps form field definitions to native React Native components. Reads DynamicForm schema from /api/v1/dynamic/forms/:id and renders appropriate input components. Handles form state, dirty tracking, and submit flow." },
    { itemId: "BI-MOB-023", title: "Form field types (text, select, date, camera, signature, location, lookup)", priority: 2, body: "Native component implementations for all field types: TextInput (text/textarea), BottomSheet picker (select), native date picker (date), expo-camera (camera), canvas drawing (signature), expo-location (location), searchable list (lookup), numeric input (number), Switch (checkbox/toggle), multi-select BottomSheet, radio button group." },
    { itemId: "BI-MOB-024", title: "Form validation engine (schema-driven, client-side)", priority: 3, body: "Client-side validation engine driven by form field definitions. Validates required fields, min/max constraints, type-specific rules. Shows inline error messages. Blocks submission until valid. Server validates again on submit." },
    { itemId: "BI-MOB-025", title: "Form offline submission queue (for offlineCapable forms)", priority: 4, body: "Forms marked offlineCapable: true pre-cache their schema and lookup data. Submissions queued in SQLite when offline with Pending badge. Automatic retry on reconnect. Queue management UI showing pending submissions." },
    { itemId: "BI-MOB-026", title: "View renderer engine (widget type → native component mapping)", priority: 5, body: "Core rendering engine that maps DynamicView layout definitions to native widget components. Reads view schema from /api/v1/dynamic/views/:id, fetches data from dataSource endpoint, and renders widget grid." },
    { itemId: "BI-MOB-027", title: "View widget types (stat-card, charts, list, map)", priority: 6, body: "Native widget implementations: stat-card (large number + label), bar-chart/pie-chart (react-native-chart-kit), scrollable list/table, map (react-native-maps with markers). Each widget handles its expected data shape." },
    { itemId: "BI-MOB-028", title: "Dynamic content caching (schema versioning, stale detection)", priority: 7, body: "Cache form and view schemas in SQLite with version tracking. Detect stale schemas on app open by comparing cached version with server version. Drop and re-fetch when version changes. Schema version stored in MMKV as cacheSchemaVersion." },
    { itemId: "BI-MOB-029", title: "Dynamic content test suite (renderer tests for all field/widget types)", priority: 8, body: "Jest + RNTL tests for form renderer (every field type renders correctly, validation fires, submit works), view renderer (every widget type renders, data binding works), and offline queue (enqueue, replay, error handling). MSW mocks for dynamic API endpoints." },
  ];

  for (const item of mobileDynItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: mobileDynEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: mobileDynEpic.id },
    });
  }

  console.log(`Seeded 4 mobile companion epics: ${restApiEpic.epicId} (${restApiItems.length} items), ${mobileFoundEpic.epicId} (${mobileFoundItems.length} items), ${mobileFeatEpic.epicId} (${mobileFeatItems.length} items), ${mobileDynEpic.epicId} (${mobileDynItems.length} items)`);
}

async function seedDefaultAdminUser(): Promise<void> {
  // Creates a default HR-000 user for initial access. Change password immediately.
  const adminRole = await prisma.platformRole.findUnique({ where: { roleId: "HR-000" } });
  if (!adminRole) throw new Error("HR-000 role not seeded");

  const existing = await prisma.user.findUnique({ where: { email: "admin@dpf.local" } });
  if (existing) {
    console.log("Default admin user already exists — skipping");
    return;
  }

  const password = process.env.ADMIN_PASSWORD ?? "changeme123";
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  const user = await prisma.user.create({
    data: {
      email: "admin@dpf.local",
      passwordHash: hash,
      isSuperuser: true,
      groups: { create: { platformRoleId: adminRole.id } },
    },
  });
  console.log(`Created default admin: ${user.email} (default password set — CHANGE THIS IMMEDIATELY)`);
}

async function seedEaViewpoints(): Promise<void> {
  // Resolve the ArchiMate notation id (seeded in seedEaNotations)
  const notation = await prisma.eaNotation.findUniqueOrThrow({
    where: { slug: "archimate4" },
    select: { id: true },
  });
  const nId = notation.id;

  // Helper: look up element type slugs → throws if not found
  async function resolveElementSlugs(slugs: string[]): Promise<string[]> {
    for (const slug of slugs) {
      await prisma.eaElementType.findUniqueOrThrow({
        where: { notationId_slug: { notationId: nId, slug } },
        select: { id: true },
      });
    }
    return slugs;
  }

  // Helper: look up rel type slugs → throws if not found
  async function resolveRelSlugs(slugs: string[]): Promise<string[]> {
    for (const slug of slugs) {
      await prisma.eaRelationshipType.findUniqueOrThrow({
        where: { notationId_slug: { notationId: nId, slug } },
        select: { id: true },
      });
    }
    return slugs;
  }

  const viewpoints = [
    {
      name: "Application Architecture",
      description: "Application components, services, data objects, and their relationships.",
      elementSlugs: ["application_component", "application_service", "data_object", "technology_node", "technology_service", "system_software"],
      relSlugs: ["realizes", "assigned_to", "composed_of", "associated_with"],
    },
    {
      name: "Business Architecture",
      description: "Business capabilities, roles, actors, and value streams.",
      elementSlugs: ["business_capability", "business_role", "business_actor", "business_object", "value_stream", "value_stream_stage"],
      relSlugs: ["realizes", "assigned_to", "influences", "composed_of", "associated_with"],
    },
    {
      name: "Technology Architecture",
      description: "Infrastructure nodes, services, and their deployment relationships.",
      elementSlugs: ["technology_node", "technology_service", "system_software", "application_component"],
      relSlugs: ["realizes", "assigned_to", "composed_of", "associated_with"],
    },
    {
      name: "Capability Map",
      description: "Business capability hierarchy.",
      elementSlugs: ["business_capability"],
      relSlugs: ["composed_of", "associated_with"],
    },
  ];

  for (const vp of viewpoints) {
    const allowedElementTypeSlugs = await resolveElementSlugs(vp.elementSlugs);
    const allowedRelTypeSlugs = await resolveRelSlugs(vp.relSlugs);
    await prisma.viewpointDefinition.upsert({
      where: { name: vp.name },
      update: { description: vp.description, allowedElementTypeSlugs, allowedRelTypeSlugs },
      create: { name: vp.name, description: vp.description, allowedElementTypeSlugs, allowedRelTypeSlugs },
    });
  }
  console.log("Seeded 4 viewpoint definitions");
}

async function seedEaViews(): Promise<void> {
  const notation = await prisma.eaNotation.findUniqueOrThrow({
    where: { slug: "archimate4" },
    select: { id: true },
  });
  const appVp = await prisma.viewpointDefinition.findUnique({
    where: { name: "Application Architecture" },
    select: { id: true },
  });
  const bizVp = await prisma.viewpointDefinition.findUnique({
    where: { name: "Business Architecture" },
    select: { id: true },
  });
  const views = [
    {
      name: "DPF Platform — Application Architecture",
      description: "Application components and services that make up the Digital Product Factory platform.",
      layoutType: "graph",
      scopeType: "portfolio",
      scopeRef: "foundational",
      viewpointId: appVp?.id ?? null,
    },
    {
      name: "Business Capability Map",
      description: "Top-level business capabilities across the organisation.",
      layoutType: "graph",
      scopeType: "custom",
      scopeRef: null,
      viewpointId: bizVp?.id ?? null,
    },
  ];
  for (const v of views) {
    const existing = await prisma.eaView.findFirst({ where: { name: v.name }, select: { id: true } });
    if (!existing) {
      await prisma.eaView.create({
        data: {
          notationId: notation.id,
          name: v.name,
          description: v.description,
          layoutType: v.layoutType,
          scopeType: v.scopeType,
          ...(v.scopeRef != null && { scopeRef: v.scopeRef }),
          ...(v.viewpointId != null && { viewpointId: v.viewpointId }),
          status: "draft",
        },
      });
    }
  }
  console.log(`Seeded ${views.length} EA views`);
}

async function seedScheduledJobs(): Promise<void> {
  await prisma.scheduledJob.upsert({
    where:  { jobId: "provider-registry-sync" },
    create: {
      jobId:     "provider-registry-sync",
      name:      "Provider registry sync",
      schedule:  "weekly",
      nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    update: {
      // Only reset schedule — preserve operational state on re-seed
      schedule: "weekly",
    },
  });
  await prisma.scheduledJob.upsert({
    where: { jobId: "provider-priority-optimizer" },
    update: {},
    create: {
      jobId: "provider-priority-optimizer",
      name: "Provider Priority Optimizer",
      schedule: "weekly",
      nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.scheduledJob.upsert({
    where: { jobId: "regulatory-monitor" },
    update: {},
    create: {
      jobId: "regulatory-monitor",
      name: "Monthly Regulatory Monitor Scan",
      schedule: "monthly",
      nextRunAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
    },
  });
  console.log("Seeded scheduled jobs");
}

async function seedMcpServers(): Promise<void> {
  const existing = await prisma.mcpServer.findUnique({
    where: { serverId: "codex-agent" },
  });

  if (!existing) {
    await prisma.mcpServer.create({
      data: {
        serverId: "codex-agent",
        name: "OpenAI Codex Agent",
        config: {
          command: "npx",
          args: ["-y", "codex", "mcp-server"],
          transport: "stdio",
          tools: ["codex", "codex-reply"],
          linkedProviderId: "codex",
          defaults: {
            "approval-policy": "on-request",
            sandbox: "workspace-write",
          },
        },
        status: "unconfigured",
      },
    });
    console.log("Seeded MCP server: codex-agent");
  } else {
    console.log("MCP server codex-agent already exists — skipping (preserving admin config)");
  }
}

async function seedCoworkerAgents(): Promise<void> {
  const coworkers = [
    { agentId: "portfolio-advisor", name: "Portfolio Analyst", tier: 1, type: "coworker", description: "Investment, risk, and portfolio health analysis" },
    { agentId: "inventory-specialist", name: "Product Manager", tier: 2, type: "coworker", description: "Product lifecycle, maturity, and market fit analysis" },
    { agentId: "ea-architect", name: "Enterprise Architect", tier: 2, type: "coworker", description: "Structural analysis, dependency tracing, and architecture governance" },
    { agentId: "hr-specialist", name: "HR Director", tier: 2, type: "coworker", description: "People, roles, accountability chains, and governance compliance" },
    { agentId: "customer-advisor", name: "Customer Success Manager", tier: 2, type: "coworker", description: "Customer journey, service adoption, and satisfaction analysis" },
    { agentId: "ops-coordinator", name: "Scrum Master", tier: 2, type: "coworker", description: "Delivery flow, backlog prioritization, and blocker removal" },
    { agentId: "platform-engineer", name: "AI Ops Engineer", tier: 2, type: "coworker", description: "AI infrastructure, provider management, and cost optimization" },
    { agentId: "build-specialist", name: "Software Engineer", tier: 2, type: "coworker", description: "Feature development, code generation, and implementation" },
    { agentId: "admin-assistant", name: "System Admin", tier: 2, type: "coworker", description: "Access control, security posture, and platform configuration" },
    { agentId: "coo", name: "COO", tier: 1, type: "coworker", description: "Cross-cutting oversight, workforce orchestration, and strategic priorities" },
  ];

  for (const cw of coworkers) {
    await prisma.agent.upsert({
      where: { agentId: cw.agentId },
      create: cw,
      update: { name: cw.name, description: cw.description },
    });
  }
  console.log(`Seeded ${coworkers.length} coworker agents`);
}

async function seedPlatformConfig(): Promise<void> {
  await prisma.platformConfig.upsert({
    where: { key: "USE_UNIFIED_COWORKER" },
    update: {},
    create: { key: "USE_UNIFIED_COWORKER", value: { enabled: false } },
  });
  console.log("Seeded platform config flags");
}

async function seedMobileAppReminder(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { isSuperuser: true } });
  if (!admin) return;
  const profile = await prisma.employeeProfile.findUnique({ where: { userId: admin.id }, select: { id: true } });
  if (!profile) {
    console.log("No employee profile for admin — skipping mobile app reminder");
    return;
  }
  await prisma.calendarEvent.upsert({
    where: { eventId: "CE-MOB-REMIND" },
    update: {},
    create: {
      eventId: "CE-MOB-REMIND",
      title: "Mobile Companion App — Review Next Steps",
      description: "Review mobile app implementation. Next: apply DB migration, seed epics, test on device, set up Apple/Google developer accounts, Firebase for push notifications, first EAS build. See docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md",
      startAt: new Date("2026-04-02T09:00:00"),
      endAt: new Date("2026-04-02T10:00:00"),
      allDay: false,
      eventType: "reminder",
      category: "project",
      ownerEmployeeId: profile.id,
      visibility: "private",
      color: "#818cf8",
    },
  });
  console.log("Seeded calendar reminder: Mobile Companion App review on 2026-04-02");
}

async function main(): Promise<void> {
  console.log("Starting seed...");
  await seedRoles();
  await seedGovernanceReferenceData(prisma);
  await seedWorkforceReferenceData(prisma);
  await seedPortfolios();
  await seedAgents();
  await seedCoworkerAgents();
  await seedTaxonomyNodes();
  await seedEaReferenceModels().catch((err: unknown) => {
    console.warn("[seed] EA reference models skipped:", err instanceof Error ? err.message : err);
  });
  await seedDigitalProducts();
  await seedEaArchimate4();
  await seedEaStructureRules();
  await seedEaViewpoints();
  await seedEaViews();
  await seedDpfSelfRegistration();
  await seedThemeBrandingEpic();
  await seedDarkThemeUsabilityEpic();
  await seedMvpEpics();
  await seedMobileCompanionEpics();
  await seedDefaultAdminUser();
  await seedMobileAppReminder();
  await seedScheduledJobs();
  await seedMcpServers();
  await seedPlatformConfig();
  await seedStorefrontArchetypes(prisma);
  await prisma.epic.upsert({
    where: { epicId: "EP-STORE-001" },
    create: {
      epicId: "EP-STORE-001",
      title: "Storefront Foundation",
      description: "Public-facing storefront with archetype-driven CTA, unified sign-in, and shell admin. Spec: docs/superpowers/specs/2026-03-19-storefront-foundation-design.md",
      status: "open",
    },
    update: {},
  });
  console.log("Seed complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
