// packages/db/src/seed.ts
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "./client.js";
import { parseRoleId, parseAgentTier, parseAgentType, parseAgentPortfolioSlug } from "./seed-helpers.js";
import * as crypto from "crypto";

// Repo root: prefer DPF_DATA_ROOT env var (needed when running from a worktree),
// otherwise fall back to 4 levels up (packages/db/src → packages/db → packages → repo root → data root)
const REPO_ROOT = process.env.DPF_DATA_ROOT ?? join(__dirname, "..", "..", "..", "..");

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), "utf-8")) as T;
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
  }>("ROLES/role_registry.json");

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
  }>("AGENTS/agent_registry.json");

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
  }>("MODEL/portfolio_registry.json");

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
  }>("MODEL/digital_product_registry.json");

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
    { itemId: "BI-PROD-001", title: "Phase 5A — Backlog CRUD in /ops",                                    status: "in-progress", priority: 1 },
    { itemId: "BI-PROD-002", title: "Phase 5B — DPF self-registration as managed digital product",        status: "in-progress", priority: 2 },
    { itemId: "BI-PROD-003", title: "Phase 2B — Live Agent counts and Health metrics in portfolio panels", status: "open",        priority: 3 },
  ];

  for (const item of productItems) {
    await prisma.backlogItem.upsert({
      where:  { itemId: item.itemId },
      update: { title: item.title, status: item.status, priority: item.priority, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxonomyNode.id },
      create: { itemId: item.itemId, title: item.title, status: item.status, priority: item.priority, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxonomyNode.id },
    });
  }

  console.log("Seeded DPF Portal digital product and 7 backlog items");
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

  const hash = crypto.createHash("sha256").update("changeme123").digest("hex");
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

async function main(): Promise<void> {
  console.log("Starting seed...");
  await seedRoles();
  await seedPortfolios();
  await seedAgents();
  await seedTaxonomyNodes();
  await seedDigitalProducts();
  await seedDpfSelfRegistration();
  await seedDefaultAdminUser();
  console.log("Seed complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
