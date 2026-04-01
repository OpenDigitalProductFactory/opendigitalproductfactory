// packages/db/src/seed.ts
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { prisma } from "./client.js";
import { parseRoleId, parseAgentTier, parseAgentType, parseAgentPortfolioSlug } from "./seed-helpers.js";
import { seedEaArchimate4 } from "./seed-ea-archimate4.js";
import { seedEaReferenceModels } from "./seed-ea-reference-models.js";
import { seedEaStructureRules } from "./seed-ea-structure-rules.js";
import { seedGovernanceReferenceData } from "./governance-seed.js";
import { seedWorkforceReferenceData } from "./workforce-seed.js";
import { seedStorefrontArchetypes } from "./seed-storefront-archetypes.js";
import { seedGeographicData } from "./seed-geographic-data.js";
import * as crypto from "crypto";
import bcrypt from "bcryptjs";

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

async function seedBusinessModels(): Promise<void> {
  const registry = readJson<{
    business_models: Array<{
      model_id: string;
      name: string;
      description?: string;
      is_built_in: boolean;
      roles: Array<{
        role_id: string;
        name: string;
        authority_domain?: string;
        it4it_alignment?: string;
        hitl_tier_default?: number;
        escalates_to?: string;
      }>;
    }>;
  }>("business_model_registry.json");

  let roleCount = 0;
  for (const m of registry.business_models) {
    const model = await prisma.businessModel.upsert({
      where: { modelId: m.model_id },
      update: { name: m.name, description: m.description ?? null, isBuiltIn: m.is_built_in },
      create: { modelId: m.model_id, name: m.name, description: m.description ?? null, isBuiltIn: m.is_built_in, status: "active" },
    });
    for (const r of m.roles) {
      await prisma.businessModelRole.upsert({
        where: { roleId: r.role_id },
        update: {
          name: r.name,
          authorityDomain: r.authority_domain ?? null,
          it4itAlignment: r.it4it_alignment ?? null,
          hitlTierDefault: r.hitl_tier_default ?? 2,
          escalatesTo: r.escalates_to ?? null,
          isBuiltIn: m.is_built_in,
        },
        create: {
          roleId: r.role_id,
          name: r.name,
          authorityDomain: r.authority_domain ?? null,
          it4itAlignment: r.it4it_alignment ?? null,
          hitlTierDefault: r.hitl_tier_default ?? 2,
          escalatesTo: r.escalates_to ?? null,
          isBuiltIn: m.is_built_in,
          status: "active",
          businessModelId: model.id,
        },
      });
      roleCount++;
    }
  }
  console.log(`Seeded ${registry.business_models.length} business models with ${roleCount} roles`);
}

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

  console.log("Seeded DPF Portal digital product");
}

// Epic/backlog seeding removed — managed separately via backup/restore process.
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
  const hash = await bcrypt.hash(password, 12);
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

async function seedMcpServers(): Promise<void> {
  // Default MCP servers bundled with the platform.
  // All are free, open-source (MIT license) from the official MCP project.
  // Status starts as "unconfigured" — admin activates via Platform > Integrations.
  //
  // SECURITY: Filesystem and PostgreSQL servers are marked sandbox-only.
  // They MUST execute inside the sandbox container (via docker exec), never as
  // child processes of the portal container. The portal container has production
  // credentials and file access — spawning stdio MCP servers there would bypass
  // sandbox isolation entirely. The executionScope field enforces this.
  const defaultServers = [
    {
      serverId: "codex-agent",
      name: "OpenAI Codex Agent",
      transport: "stdio",
      category: "coding",
      tags: ["code-generation", "code-review"],
      config: {
        command: "npx",
        args: ["-y", "codex", "mcp-server"],
        transport: "stdio",
        executionScope: "sandbox",
        tools: ["codex", "codex-reply"],
        linkedProviderId: "codex",
        defaults: {
          "approval-policy": "on-request",
          sandbox: "workspace-write",
        },
      },
    },
    {
      serverId: "mcp-filesystem",
      name: "Filesystem (MCP Official)",
      transport: "stdio",
      category: "development",
      tags: ["file-read", "file-write", "file-search", "sandbox"],
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        transport: "stdio",
        executionScope: "sandbox",
        notes: "Free, open-source (MIT). SANDBOX ONLY — runs inside sandbox container scoped to /workspace. Never runs in the portal container.",
      },
    },
    {
      serverId: "mcp-postgres",
      name: "PostgreSQL (MCP Official)",
      transport: "stdio",
      category: "database",
      tags: ["sql", "database", "schema-introspection", "query"],
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        transport: "stdio",
        executionScope: "sandbox",
        env: {
          // Points to the SANDBOX database, not production.
          // The sandbox has its own isolated PostgreSQL instance.
          POSTGRES_CONNECTION_STRING: "postgresql://dpf:dpf_sandbox@localhost:5432/dpf",
        },
        notes: "Free, open-source (MIT). SANDBOX ONLY — connects to the sandbox-isolated database, not production. Read-only by default.",
      },
    },
    {
      serverId: "mcp-github",
      name: "GitHub (MCP Official)",
      transport: "stdio",
      category: "development",
      tags: ["git", "pull-requests", "issues", "code-review", "repository"],
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        transport: "stdio",
        executionScope: "external",
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PAT}",
        },
        notes: "Free, open-source (MIT). Requires a free GitHub Personal Access Token. Safe for portal execution — communicates with external GitHub API only, no local file or DB access.",
      },
    },
    // Playwright is NOT needed as an MCP server — the platform already has a
    // dedicated Playwright Docker container (mcr.microsoft.com/playwright) with
    // built-in tools (generate_ux_test, run_ux_test) that shell into it directly.
  ];

  for (const server of defaultServers) {
    const existing = await prisma.mcpServer.findUnique({
      where: { serverId: server.serverId },
    });

    if (!existing) {
      await prisma.mcpServer.create({
        data: {
          serverId: server.serverId,
          name: server.name,
          transport: server.transport,
          category: server.category,
          tags: server.tags,
          config: server.config,
          status: "unconfigured",
        },
      });
      console.log(`Seeded MCP server: ${server.serverId}`);
    } else {
      console.log(`MCP server ${server.serverId} already exists — skipping (preserving admin config)`);
    }
  }
}

async function seedSandboxPool(): Promise<void> {
  const POOL_SIZE = Number(process.env.DPF_SANDBOX_POOL_SIZE) || 3;
  const BASE_PORT = 3036;

  // Slot 0 is the legacy dpf-sandbox-1 on port 3035
  const slots = [
    { slotIndex: 0, containerId: "dpf-sandbox-1", port: 3035 },
    ...Array.from({ length: POOL_SIZE - 1 }, (_, i) => ({
      slotIndex: i + 1,
      containerId: `dpf-sandbox-${i + 2}`,
      port: BASE_PORT + i + 1,
    })),
  ];

  for (const slot of slots) {
    const existing = await prisma.sandboxSlot.findUnique({
      where: { slotIndex: slot.slotIndex },
    });
    if (!existing) {
      await prisma.sandboxSlot.create({
        data: {
          slotIndex: slot.slotIndex,
          containerId: slot.containerId,
          port: slot.port,
          status: "available",
        },
      });
      console.log(`Seeded sandbox slot ${slot.slotIndex}: ${slot.containerId}:${slot.port}`);
    } else {
      console.log(`Sandbox slot ${slot.slotIndex} already exists — skipping`);
    }
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

/**
 * Discover and profile local LLM models from Docker Model Runner.
 * Runs at seed time so the routing system has endpoints immediately
 * without waiting for a page visit to trigger checkBundledProviders().
 */
async function seedLocalModels(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({
    where: { providerId: "ollama" },
  });
  if (!provider) return;

  const baseUrl = process.env.LLM_BASE_URL ?? provider.baseUrl ?? "http://model-runner.docker.internal/v1";
  const modelsUrl = baseUrl.includes("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;

  let models: Array<{ id: string }> = [];
  try {
    const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { console.log("  → Local LLM not reachable, skipping model discovery"); return; }
    const data = await res.json() as { data?: Array<{ id: string }> };
    models = data.data ?? [];
  } catch {
    console.log("  → Local LLM not reachable, skipping model discovery");
    return;
  }

  if (models.length === 0) { console.log("  → No local models found"); return; }

  // Activate provider and grant full sensitivity clearance (local = data never leaves machine)
  if (provider.status === "unconfigured" || (provider.sensitivityClearance as string[]).length === 0) {
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: {
        status: "active",
        sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      },
    });
  }

  let discovered = 0;
  for (const m of models) {
    // Upsert DiscoveredModel
    await prisma.discoveredModel.upsert({
      where: { providerId_modelId: { providerId: "ollama", modelId: m.id } },
      create: { providerId: "ollama", modelId: m.id, rawMetadata: m as any },
      update: { rawMetadata: m as any },
    });

    // Upsert a basic ModelProfile so routing has an endpoint
    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId: "ollama", modelId: m.id } },
    });
    if (!existing) {
      await prisma.modelProfile.create({
        data: {
          providerId: "ollama",
          modelId: m.id,
          friendlyName: m.id.replace("docker.io/ai/", ""),
          summary: "Local model via Docker Model Runner",
          capabilityTier: "basic",
          costTier: "free",
          bestFor: ["conversation", "general"],
          avoidFor: [],
          modelStatus: "active",
          generatedBy: "system:seed",
          profileSource: "seed",
          profileConfidence: "low",
          reasoning: 40, codegen: 30, toolFidelity: 20,
          instructionFollowingScore: 50, structuredOutputScore: 30,
          conversational: 60, contextRetention: 40,
          capabilities: { streaming: true } as any,
        },
      });
      discovered++;
    }
  }
  console.log(`  ✓ Discovered ${models.length} local model(s), ${discovered} new profile(s)`);
}

/**
 * Seed known Codex models. OAuth agent providers can't discover models
 * via /v1/models, so we seed them from the registry.
 */
async function seedCodexModels(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({ where: { providerId: "codex" } });
  if (!provider) return;

  // Codex agent model
  const agentModels = [
    {
      modelId: "codex-mini-latest",
      friendlyName: "Codex Mini",
      summary: "OpenAI Codex agentic coding model — sandboxed execution with tool use",
      modelClass: "agent",
      costTier: "$$",
      bestFor: ["coding", "agentic-tasks"] as string[],
      avoidFor: ["conversation"] as string[],
      reasoning: 70, codegen: 90, toolFidelity: 85,
      instructionFollowingScore: 80, structuredOutputScore: 70,
      conversational: 40, contextRetention: 60,
    },
  ];

  const allModels = [...agentModels];
  let created = 0;
  for (const m of allModels) {
    await prisma.discoveredModel.upsert({
      where: { providerId_modelId: { providerId: "codex", modelId: m.modelId } },
      create: { providerId: "codex", modelId: m.modelId, rawMetadata: { id: m.modelId } as any, lastSeenAt: new Date() },
      update: {},
    });
    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId: "codex", modelId: m.modelId } },
    });
    if (!existing) {
      await prisma.modelProfile.create({
        data: {
          providerId: "codex",
          modelId: m.modelId,
          friendlyName: m.friendlyName,
          summary: m.summary,
          capabilityTier: "advanced",
          costTier: m.costTier,
          bestFor: m.bestFor,
          avoidFor: m.avoidFor,
          modelClass: m.modelClass,
          modelStatus: "active",
          generatedBy: "system:seed",
          profileSource: "seed",
          profileConfidence: "medium",
          maxContextTokens: 128000,
          maxOutputTokens: 16384,
          reasoning: m.reasoning, codegen: m.codegen, toolFidelity: m.toolFidelity,
          instructionFollowingScore: m.instructionFollowingScore, structuredOutputScore: m.structuredOutputScore,
          conversational: m.conversational, contextRetention: m.contextRetention,
          supportsToolUse: true,
          capabilities: { toolUse: true, streaming: true, structuredOutput: true, imageInput: m.modelClass === "chat" } as any,
          inputModalities: m.modelClass === "chat" ? ["text", "image"] : ["text"],
          outputModalities: ["text"],
        },
      });
      created++;
    }
  }
  if (created > 0) console.log(`  Seeded ${created} Codex model profile(s)`);
}

/**
 * Seed ChatGPT (GPT-4o) models under the chatgpt provider.
 * These are chat models accessed via the same OpenAI OAuth as Codex.
 * The chatgpt provider is auto-activated when Codex OAuth completes.
 */
async function seedChatGPTModels(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({ where: { providerId: "chatgpt" } });
  if (!provider) return;

  const models = [
    {
      modelId: "gpt-5.4",
      friendlyName: "GPT-5.4 (ChatGPT Subscription)",
      summary: "OpenAI GPT-5.4 via ChatGPT subscription — conversation, coding, reasoning",
      bestFor: ["conversation", "coding", "general-purpose", "reasoning"] as string[],
      avoidFor: ["local-only-required"] as string[],
      reasoning: 85, codegen: 90, toolFidelity: 85,
      instructionFollowingScore: 85, structuredOutputScore: 80,
      conversational: 80, contextRetention: 75,
    },
  ];

  let created = 0;
  for (const m of models) {
    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId: "chatgpt", modelId: m.modelId } },
    });
    if (!existing) {
      await prisma.modelProfile.create({
        data: {
          providerId: "chatgpt",
          modelId: m.modelId,
          friendlyName: m.friendlyName,
          summary: m.summary,
          capabilityTier: "advanced",
          costTier: "subscription",
          bestFor: m.bestFor,
          avoidFor: m.avoidFor,
          modelClass: "chat",
          modelStatus: "disabled",  // ChatGPT SSE adapter returns empty; disabled until fixed
          generatedBy: "system:seed",
          profileSource: "seed",
          profileConfidence: "medium",
          maxContextTokens: 128000,
          maxOutputTokens: 16384,
          reasoning: m.reasoning, codegen: m.codegen, toolFidelity: m.toolFidelity,
          instructionFollowingScore: m.instructionFollowingScore, structuredOutputScore: m.structuredOutputScore,
          conversational: m.conversational, contextRetention: m.contextRetention,
          supportsToolUse: true,
          capabilities: { toolUse: true, streaming: true, structuredOutput: true, imageInput: true } as any,
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
        },
      });
      created++;
    }
  }
  if (created > 0) console.log(`  Seeded ${created} ChatGPT model profile(s)`);
}

async function seedAnthropicSubScope(): Promise<void> {
  await prisma.credentialEntry.upsert({
    where: { providerId: "anthropic-sub" },
    create: {
      providerId: "anthropic-sub",
      scope: "user:inference user:profile",
      status: "unconfigured",
    },
    update: {},  // preserve existing credentials on re-seed
  });
  console.log("Seeded anthropic-sub credential scope");
}

/**
 * Ensure model profiles are properly configured for Build Studio.
 * Seed known-good model profiles from exported JSON so fresh installs
 * start with profiled models immediately (no need to run eval pipeline).
 * Only creates profiles that don't already exist — won't overwrite
 * profiles that have been updated by live eval runs.
 */
async function seedModelProfiles(): Promise<void> {
  const profilePath = join(__dirname, "..", "data", "model-profiles.json");
  if (!existsSync(profilePath)) {
    console.log("  No model-profiles.json found — skipping profile seed");
    return;
  }
  const profiles = JSON.parse(readFileSync(profilePath, "utf-8")) as Record<string, unknown>[];
  let created = 0, skipped = 0;
  for (const p of profiles) {
    const providerId = p.providerId as string;
    const modelId = p.modelId as string;
    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId, modelId } },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }
    const { providerId: _pid, modelId: _mid, ...rest } = p;
    try {
      await prisma.modelProfile.create({ data: { providerId, modelId, ...rest } as never });
      created++;
    } catch { skipped++; }
  }
  console.log(`  Seeded ${created} model profiles (${skipped} already existed)`);
}

/**
 * The build-specialist agent requires a tool-capable model (Haiku 4.5+).
 * Haiku 3.0 cannot orchestrate multi-step tool calls.
 *
 * This runs on every seed to fix profiles that may have been incorrectly
 * set by model discovery or provider sync.
 */
async function ensureBuildStudioModelConfig(): Promise<void> {
  // Prefer Haiku 4.5 over 3.0 for anthropic-sub (subscription tier)
  const haiku45 = await prisma.modelProfile.findFirst({
    where: { modelId: "claude-haiku-4-5-20251001", providerId: "anthropic-sub" },
  });
  const haiku30 = await prisma.modelProfile.findFirst({
    where: { modelId: "claude-3-haiku-20240307", providerId: "anthropic-sub" },
  });

  if (haiku45) {
    await prisma.modelProfile.update({
      where: { id: haiku45.id },
      data: { modelStatus: "active", retiredAt: null },
    });
    console.log("  Haiku 4.5 set to active (tool-capable for Build Studio)");
  }

  if (haiku30 && haiku45) {
    // Disable 3.0 when 4.5 is available — 3.0 returns empty via OAuth subscription
    await prisma.modelProfile.update({
      where: { id: haiku30.id },
      data: { modelStatus: "disabled" },
    });
    console.log("  Haiku 3.0 disabled (returns empty via OAuth subscription)");
  }

  console.log("Ensured Build Studio model configuration");
}

/**
 * EP-INF-012: Seed factory-default agent model configuration.
 *
 * Every agent gets an explicit row in AgentModelConfig so the admin UI at
 * /platform/ai/model-assignment shows real values instead of implied
 * code-level defaults.  Admins can change any row without touching code.
 *
 * Uses upsert — existing admin overrides are NOT clobbered.
 */
async function seedAgentModelDefaults(): Promise<void> {
  const defaults: Array<{
    agentId: string;
    minimumTier: string;
    budgetClass: string;
    pinnedProviderId?: string;
    pinnedModelId?: string;
  }> = [
    { agentId: "build-specialist",    minimumTier: "moderate", budgetClass: "quality_first" },
    { agentId: "coo",                 minimumTier: "strong",   budgetClass: "balanced" },
    { agentId: "platform-engineer",   minimumTier: "strong",   budgetClass: "balanced" },
    { agentId: "admin-assistant",     minimumTier: "strong",   budgetClass: "balanced" },
    { agentId: "ops-coordinator",     minimumTier: "adequate", budgetClass: "balanced" },
    { agentId: "portfolio-advisor",   minimumTier: "adequate", budgetClass: "balanced" },
    { agentId: "inventory-specialist", minimumTier: "adequate", budgetClass: "balanced" },
    { agentId: "ea-architect",        minimumTier: "adequate", budgetClass: "balanced" },
    { agentId: "hr-specialist",       minimumTier: "adequate", budgetClass: "balanced" },
    { agentId: "customer-advisor",    minimumTier: "adequate", budgetClass: "balanced" },
    { agentId: "onboarding-coo",     minimumTier: "basic",    budgetClass: "minimize_cost" },
  ];

  let seeded = 0;
  let existed = 0;
  for (const d of defaults) {
    const existing = await prisma.agentModelConfig.findUnique({
      where: { agentId: d.agentId },
    });
    if (existing) {
      // Admin has already configured this agent — don't overwrite
      existed++;
      continue;
    }
    await prisma.agentModelConfig.create({
      data: {
        agentId: d.agentId,
        minimumTier: d.minimumTier,
        budgetClass: d.budgetClass,
        pinnedProviderId: d.pinnedProviderId ?? null,
        pinnedModelId: d.pinnedModelId ?? null,
        configuredAt: new Date(),
        // configuredById left null — system seed, not a user action
      },
    });
    seeded++;
  }
  console.log(`  Seeded ${seeded} agent model defaults (${existed} already configured)`);
}

async function main(): Promise<void> {
  console.log("Starting seed...");
  await seedGeographicData(prisma);
  await seedRoles();
  await seedGovernanceReferenceData(prisma);
  await seedWorkforceReferenceData(prisma);
  await seedPortfolios();
  await seedBusinessModels();
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
  await seedDefaultAdminUser();
  await seedMcpServers();
  await seedSandboxPool();
  await seedAnthropicSubScope();
  await seedCodexModels();
  await seedChatGPTModels();
  await seedLocalModels();
  await seedModelProfiles();
  await ensureBuildStudioModelConfig();
  await seedAgentModelDefaults();
  await seedPlatformConfig();
  await seedStorefrontArchetypes(prisma);
  console.log("Seed complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
