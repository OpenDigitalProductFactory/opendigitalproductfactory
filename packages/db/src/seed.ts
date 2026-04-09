// packages/db/src/seed.ts
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { prisma } from "./client.js";
import { parseRoleId, parseAgentTier, parseAgentType, parseAgentPortfolioSlug } from "./seed-helpers.js";
import { seedEaArchimate4 } from "./seed-ea-archimate4.js";
import { seedEaBpmn20 } from "./seed-ea-bpmn20.js";
import { seedEaCrossNotation } from "./seed-ea-cross-notation.js";
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

// Registry agent type for seedAgents
interface RegistryAgent {
  agent_id: string;
  agent_name: string;
  tier?: string;
  value_stream?: string;
  capability_domain?: string;
  status?: string;
  human_supervisor_id?: string;
  hitl_tier_default?: number;
  delegates_to?: string[];
  escalates_to?: string;
  it4it_sections?: string[];
  config_profile?: {
    model_binding?: {
      model_id?: string;
      temperature?: number;
      max_tokens?: number;
    };
    execution_runtime?: {
      type?: string;
      timeout_seconds?: number;
    };
    token_budget?: {
      daily_limit?: number;
      per_task_limit?: number;
    };
    tool_grants?: string[];
    memory?: {
      type?: string;
      backend?: string | null;
    };
    concurrency_limit?: number;
  };
}

async function seedAgents(): Promise<void> {
  const registry = readJson<{ agents: RegistryAgent[] }>("agent_registry.json");

  // Build portfolio slug → cuid lookup (portfolios must already be seeded)
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, slug: true } });
  const portfolioIdBySlug = new Map(portfolios.map((p) => [p.slug, p.id]));

  // Track seen agent_ids to skip duplicates (keep first occurrence)
  const seen = new Set<string>();

  for (const a of registry.agents) {
    if (seen.has(a.agent_id)) {
      console.warn(`  → Skipping duplicate agent ${a.agent_id}`);
      continue;
    }
    seen.add(a.agent_id);

    const portfolioSlug = parseAgentPortfolioSlug(a.human_supervisor_id ?? "");
    const portfolioId = portfolioSlug ? (portfolioIdBySlug.get(portfolioSlug) ?? null) : null;

    const unifiedFields = {
      name: a.agent_name,
      tier: parseAgentTier(a.agent_id),
      type: parseAgentType(a.agent_id),
      description: a.capability_domain ?? null,
      status: "active",
      portfolioId,
      // EP-AI-WORKFORCE-001: Unified lifecycle fields
      valueStream: a.value_stream ?? null,
      it4itSections: a.it4it_sections ?? [],
      humanSupervisorId: a.human_supervisor_id ?? null,
      hitlTierDefault: a.hitl_tier_default ?? 3,
      escalatesTo: a.escalates_to ?? null,
      delegatesTo: a.delegates_to ?? [],
      sensitivity: "internal" as const,
    };

    const agent = await prisma.agent.upsert({
      where: { agentId: a.agent_id },
      update: unifiedFields,
      create: { agentId: a.agent_id, ...unifiedFields },
    });

    // Seed AgentExecutionConfig from config_profile
    const cp = a.config_profile;
    if (cp) {
      await prisma.agentExecutionConfig.upsert({
        where: { agentId: agent.id },
        update: {
          defaultModelId: cp.model_binding?.model_id ?? null,
          temperature: cp.model_binding?.temperature ?? 0.3,
          maxTokens: cp.model_binding?.max_tokens ?? 4096,
          executionType: cp.execution_runtime?.type ?? "in_process",
          timeoutSeconds: cp.execution_runtime?.timeout_seconds ?? 120,
          concurrencyLimit: cp.concurrency_limit ?? 4,
          dailyTokenLimit: cp.token_budget?.daily_limit ?? 200000,
          perTaskTokenLimit: cp.token_budget?.per_task_limit ?? 20000,
          memoryType: cp.memory?.type ?? "session",
          memoryBackend: cp.memory?.backend ?? null,
        },
        create: {
          agentId: agent.id,
          defaultModelId: cp.model_binding?.model_id ?? null,
          temperature: cp.model_binding?.temperature ?? 0.3,
          maxTokens: cp.model_binding?.max_tokens ?? 4096,
          executionType: cp.execution_runtime?.type ?? "in_process",
          timeoutSeconds: cp.execution_runtime?.timeout_seconds ?? 120,
          concurrencyLimit: cp.concurrency_limit ?? 4,
          dailyTokenLimit: cp.token_budget?.daily_limit ?? 200000,
          perTaskTokenLimit: cp.token_budget?.per_task_limit ?? 20000,
          memoryType: cp.memory?.type ?? "session",
          memoryBackend: cp.memory?.backend ?? null,
        },
      });

      // Seed AgentToolGrant rows from tool_grants array
      if (cp.tool_grants) {
        for (const grantKey of cp.tool_grants) {
          await prisma.agentToolGrant.upsert({
            where: { agentId_grantKey: { agentId: agent.id, grantKey } },
            update: {},
            create: { agentId: agent.id, grantKey },
          });
        }
      }
    }
  }
  console.log(`Seeded ${seen.size} agents (skipped ${registry.agents.length - seen.size} duplicates)`);
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
      description?: string;
      portfolio_id?: string;
      taxonomy_node_id?: string;
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
    // Resolve taxonomy node for portfolio tree placement
    let taxonomyNodeDbId: string | undefined;
    if (p.taxonomy_node_id) {
      const node = await prisma.taxonomyNode.findUnique({ where: { nodeId: p.taxonomy_node_id } });
      taxonomyNodeDbId = node?.id;
    }
    // Treat registry stage_status as the operational lifecycleStatus.
    // All registry products are assumed to be in production.
    const lifecycleStatus = p.lifecycle?.stage_status ?? "active";

    await prisma.digitalProduct.upsert({
      where: { productId: p.product_id },
      update: {
        name: p.name,
        description: p.description ?? null,
        lifecycleStage: "production",
        lifecycleStatus,
        portfolioId: portfolioDbId ?? null,
        taxonomyNodeId: taxonomyNodeDbId ?? undefined,
      },
      create: {
        productId: p.product_id,
        name: p.name,
        description: p.description ?? null,
        lifecycleStage: "production",
        lifecycleStatus,
        portfolioId: portfolioDbId ?? null,
        taxonomyNodeId: taxonomyNodeDbId ?? null,
      },
    });
  }
  console.log(`Seeded ${products.length} digital products`);
}

async function seedDpfSelfRegistration(): Promise<void> {
  // The portal is a platform service under Foundational — it's the user-facing
  // web application that provides lifecycle views for all digital products.
  const portfolio = await prisma.portfolio.findUnique({
    where: { slug: "foundational" },
  });
  if (!portfolio) throw new Error("foundational portfolio not seeded");

  // Try the specific platform services node first, fall back to portfolio root
  let taxonomyNode = await prisma.taxonomyNode.findUnique({
    where: { nodeId: "foundational/platform_services" },
  });
  if (!taxonomyNode) {
    taxonomyNode = await prisma.taxonomyNode.findUnique({
      where: { nodeId: "foundational" },
    });
  }
  if (!taxonomyNode) throw new Error("foundational taxonomy node not seeded");

  // Register DPF Portal as a DigitalProduct
  await prisma.digitalProduct.upsert({
    where: { productId: "dpf-portal" },
    update: {
      name:            "Digital Product Factory Portal",
      description:     "The Digital Product Factory platform — portal application, AI workforce, monitoring, and administration.",
      lifecycleStage:  "production",
      lifecycleStatus: "active",
      portfolioId:     portfolio.id,
      taxonomyNodeId:  taxonomyNode.id,
    },
    create: {
      productId:       "dpf-portal",
      name:            "Digital Product Factory Portal",
      description:     "The Digital Product Factory platform — portal application, AI workforce, monitoring, and administration.",
      lifecycleStage:  "production",
      lifecycleStatus: "active",
      portfolioId:     portfolio.id,
      taxonomyNodeId:  taxonomyNode.id,
    },
    select: { id: true },
  });

  console.log("Seeded DPF Portal digital product (foundational/platform_services)");
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

  // ── BPMN 2.0 viewpoints ───────────────────────────────────────────────
  const bpmnNotation = await prisma.eaNotation.findUnique({
    where: { slug: "bpmn20" },
    select: { id: true },
  });
  if (bpmnNotation) {
    const bpmnNId = bpmnNotation.id;
    async function resolveBpmnElementSlugs(slugs: string[]): Promise<string[]> {
      for (const slug of slugs) {
        await prisma.eaElementType.findUniqueOrThrow({
          where: { notationId_slug: { notationId: bpmnNId, slug } },
          select: { id: true },
        });
      }
      return slugs;
    }
    async function resolveBpmnRelSlugs(slugs: string[]): Promise<string[]> {
      for (const slug of slugs) {
        await prisma.eaRelationshipType.findUniqueOrThrow({
          where: { notationId_slug: { notationId: bpmnNId, slug } },
          select: { id: true },
        });
      }
      return slugs;
    }

    const bpmnViewpoints = [
      {
        name: "Process Architecture",
        description: "BPMN process flows with activities, gateways, events, and swimlanes. Shows who does what (AI coworker or human) and where decisions branch.",
        elementSlugs: [
          "bpmn_process", "bpmn_sub_process", "bpmn_service_task", "bpmn_user_task",
          "bpmn_manual_task", "bpmn_script_task", "bpmn_business_rule_task",
          "bpmn_exclusive_gateway", "bpmn_parallel_gateway", "bpmn_inclusive_gateway",
          "bpmn_start_event", "bpmn_end_event", "bpmn_intermediate_throw_event", "bpmn_intermediate_catch_event",
          "bpmn_pool", "bpmn_lane",
          "bpmn_data_object", "bpmn_data_input", "bpmn_data_output",
        ],
        relSlugs: ["sequence_flow", "message_flow", "data_association", "conditional_flow", "default_flow", "association"],
      },
    ];

    for (const vp of bpmnViewpoints) {
      const allowedElementTypeSlugs = await resolveBpmnElementSlugs(vp.elementSlugs);
      const allowedRelTypeSlugs = await resolveBpmnRelSlugs(vp.relSlugs);
      await prisma.viewpointDefinition.upsert({
        where: { name: vp.name },
        update: { description: vp.description, allowedElementTypeSlugs, allowedRelTypeSlugs },
        create: { name: vp.name, description: vp.description, allowedElementTypeSlugs, allowedRelTypeSlugs },
      });
    }
    console.log("Seeded 1 BPMN viewpoint definition");
  }
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
    {
      serverId: "mcp-browser-use",
      name: "Browser-Use (AI Browser Automation)",
      transport: "http",
      category: "development",
      tags: ["browser-automation", "web-interaction", "ui-testing", "qa", "data-extraction"],
      config: {
        url: "http://browser-use:8500/mcp",
        transport: "http",
        executionScope: "external",
        notes: "Free, open-source (MIT). AI-powered browser automation via browser-use. Replaces Playwright with LLM-driven navigation, self-healing selectors, and evidence capture. Requires --profile browser-use to start.",
      },
    },
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
  // EP-AI-WORKFORCE-001: Coworker agents with canonical AGT-UI-xxx IDs and slugId aliases
  const coworkers = [
    { agentId: "portfolio-advisor", slugId: "portfolio-advisor", name: "Portfolio Analyst", tier: 1, type: "coworker", description: "Investment, risk, and portfolio health analysis", valueStream: "evaluate", sensitivity: "internal" },
    { agentId: "inventory-specialist", slugId: "inventory-specialist", name: "Product Manager", tier: 2, type: "coworker", description: "Product lifecycle, maturity, and market fit analysis", valueStream: "explore", sensitivity: "internal" },
    { agentId: "ea-architect", slugId: "ea-architect", name: "Enterprise Architect", tier: 2, type: "coworker", description: "Structural analysis, dependency tracing, and architecture governance", valueStream: "cross-cutting", sensitivity: "internal" },
    { agentId: "hr-specialist", slugId: "hr-specialist", name: "HR Director", tier: 2, type: "coworker", description: "People, roles, accountability chains, and governance compliance", valueStream: "cross-cutting", sensitivity: "confidential" },
    { agentId: "customer-advisor", slugId: "customer-advisor", name: "Customer Success Manager", tier: 2, type: "coworker", description: "Customer journey, service adoption, and satisfaction analysis", valueStream: "consume", sensitivity: "confidential" },
    { agentId: "ops-coordinator", slugId: "ops-coordinator", name: "Scrum Master", tier: 2, type: "coworker", description: "Delivery flow, backlog prioritization, and blocker removal", valueStream: "integrate", sensitivity: "internal" },
    { agentId: "platform-engineer", slugId: "platform-engineer", name: "AI Ops Engineer", tier: 2, type: "coworker", description: "AI infrastructure, provider management, and cost optimization", valueStream: "operate", sensitivity: "confidential" },
    { agentId: "build-specialist", slugId: "build-specialist", name: "Software Engineer", tier: 2, type: "coworker", description: "Feature development, code generation, and implementation", valueStream: "integrate", sensitivity: "internal" },
    { agentId: "data-architect", slugId: "data-architect", name: "Data Architect", tier: 2, type: "coworker", description: "Schema design, data modeling (3NF/DAMA-DMBOK), migration validation, inverse relation checks, and index optimization. Validates all Prisma schema changes before migration.", valueStream: "integrate", sensitivity: "internal" },
    { agentId: "admin-assistant", slugId: "admin-assistant", name: "System Admin", tier: 2, type: "coworker", description: "Access control, security posture, and platform configuration", valueStream: "operate", sensitivity: "restricted" },
    { agentId: "coo", slugId: "coo", name: "COO", tier: 1, type: "coworker", description: "Cross-cutting oversight, workforce orchestration, and strategic priorities", valueStream: "cross-cutting", sensitivity: "confidential" },
    { agentId: "doc-specialist", slugId: "doc-specialist", name: "Documentation Specialist", tier: 2, type: "coworker", description: "Mermaid diagram creation/regeneration, documentation structure/consistency, spec and architecture document quality, renderer compatibility awareness", valueStream: "cross-cutting", sensitivity: "internal" },
  ];

  for (const cw of coworkers) {
    const { agentId, slugId, ...rest } = cw;
    await prisma.agent.upsert({
      where: { agentId },
      create: { agentId, slugId, ...rest, lifecycleStage: "production" },
      update: {
        slugId,
        name: rest.name,
        description: rest.description,
        valueStream: rest.valueStream,
        sensitivity: rest.sensitivity,
      },
    });
  }
  console.log(`Seeded ${coworkers.length} coworker agents`);
}

/** EP-AI-WORKFORCE-001: Seed skills for coworker agents */
async function seedCoworkerSkills(): Promise<void> {
  // Skills per agent slug — matches the skills from agent-routing.ts ROUTE_AGENT_MAP
  const agentSkills: Record<string, Array<{ label: string; description: string; capability?: string; prompt: string; sortOrder: number }>> = {
    "portfolio-advisor": [
      { label: "Health summary", description: "Analyze health metrics and flag risks", prompt: "Give me a health summary of the portfolio, highlighting any risks or issues.", sortOrder: 0 },
      { label: "Budget analysis", description: "Review budget allocations and spending", prompt: "Analyze the budget allocations across the portfolio and flag any concerns.", sortOrder: 1 },
      { label: "Find a product", description: "Search for a digital product", prompt: "Help me find a product in the portfolio.", sortOrder: 2 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 3 },
    ],
    "build-specialist": [
      { label: "Start a build", description: "Begin a new feature build", capability: "build_studio", prompt: "Help me start a new feature build.", sortOrder: 0 },
      { label: "Review code", description: "Review pending code changes", prompt: "Review the current code changes and suggest improvements.", sortOrder: 1 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 2 },
    ],
    "coo": [
      { label: "Platform health", description: "Overview of platform health and agent status", prompt: "Give me an overview of platform health, agent status, and any operational concerns.", sortOrder: 0 },
      { label: "Workforce status", description: "AI workforce operational summary", prompt: "Summarize the AI workforce status: which agents are active, degraded, or offline.", sortOrder: 1 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 2 },
    ],
    "doc-specialist": [
      { label: "Generate diagram", description: "Create a Mermaid diagram for a concept", prompt: "Generate a Mermaid diagram for the concept I describe. Choose the appropriate diagram type (flowchart, sequence, class, state, ER, C4) based on the subject.", sortOrder: 0 },
      { label: "Review doc structure", description: "Check document structural issues", prompt: "Review the structure of this document. Check heading hierarchy, cross-references, section completeness, and IT4IT alignment.", sortOrder: 1 },
      { label: "Regenerate diagrams", description: "Update diagrams to match current state", prompt: "Find and regenerate all Mermaid diagrams in this document to reflect the current codebase and architecture state.", sortOrder: 2 },
      { label: "Renderer compatibility", description: "Check diagram renderer compatibility", prompt: "Check this Mermaid diagram for compatibility issues across renderers (GitHub, VS Code, GitBook). Flag unsupported syntax.", sortOrder: 3 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 4 },
    ],
  };

  let count = 0;
  for (const [slugId, skills] of Object.entries(agentSkills)) {
    const agent = await prisma.agent.findFirst({ where: { OR: [{ agentId: slugId }, { slugId }] } });
    if (!agent) { console.warn(`  → Agent ${slugId} not found, skipping skills`); continue; }

    for (const skill of skills) {
      await prisma.agentSkillAssignment.upsert({
        where: { agentId_label: { agentId: agent.id, label: skill.label } },
        update: { description: skill.description, prompt: skill.prompt, sortOrder: skill.sortOrder, capability: skill.capability ?? null },
        create: { agentId: agent.id, label: skill.label, description: skill.description, prompt: skill.prompt, sortOrder: skill.sortOrder, capability: skill.capability ?? null },
      });
      count++;
    }
  }
  console.log(`Seeded ${count} agent skills`);
}

/** EP-AI-WORKFORCE-001: Seed prompt context for coworker agents */
async function seedAgentPromptContexts(): Promise<void> {
  const contexts: Record<string, { perspective: string; heuristics: string; interpretiveModel: string; domainTools: string[] }> = {
    "portfolio-advisor": {
      perspective: "You see the organization as a portfolio of investments. Every product is an asset with cost, value, risk, and return. You encode the world as financial health, investment ratios, and strategic alignment.",
      heuristics: "Start with portfolio-level health metrics, then drill into product-level concerns. Flag concentration risk, budget overruns, and misaligned investments.",
      interpretiveModel: "Optimize for risk-adjusted return on IT investment. A healthy portfolio balances innovation (new products) with stability (mature products).",
      domainTools: ["list_products", "get_product", "list_backlog_items", "search_products"],
    },
    "build-specialist": {
      perspective: "You see the platform as code to be written, tested, and shipped. Every request maps to files, functions, and tests. You encode the world as implementation tasks.",
      heuristics: "Read existing code before proposing changes. Search for patterns and reuse. Write tests alongside implementation. Make the smallest change that works.",
      interpretiveModel: "Optimize for working software delivered incrementally. Code is healthy when tests pass, types check, and the change is reviewable.",
      domainTools: ["search_project_files", "read_project_file", "write_sandbox_file", "generate_code", "run_sandbox_tests"],
    },
    "doc-specialist": {
      perspective: "You see the platform as a network of documents, diagrams, and cross-references. You encode the world as document completeness, structural consistency, diagram accuracy, and renderer compatibility.",
      heuristics: "Structure validation: does the document follow the platform spec template? Cross-reference integrity: do links resolve? Diagram accuracy: does Mermaid syntax render correctly? Renderer awareness: GitHub, VS Code, and GitBook each support different features. Completeness: are there TODOs or placeholder content?",
      interpretiveModel: "Optimize for documentation that is accurate, self-contained, and renderable. A document is healthy when a new developer can read it without questions, all diagrams render correctly, and all cross-references resolve.",
      domainTools: ["search_project_files", "read_project_file", "list_products"],
    },
    "coo": {
      perspective: "You see the organization as a system of systems. Every agent, product, and process is interconnected. You encode the world as operational health, strategic alignment, and workforce coordination.",
      heuristics: "Start with the big picture: what is the platform's overall health? Which agents are performing well? Where are bottlenecks? Delegate details to specialist agents.",
      interpretiveModel: "Optimize for organizational effectiveness. The platform is healthy when all value streams are flowing, agents are performing, and strategic priorities are advancing.",
      domainTools: ["list_products", "get_product", "list_backlog_items", "search_products"],
    },
  };

  let count = 0;
  for (const [slugId, ctx] of Object.entries(contexts)) {
    const agent = await prisma.agent.findFirst({ where: { OR: [{ agentId: slugId }, { slugId }] } });
    if (!agent) { console.warn(`  → Agent ${slugId} not found, skipping prompt context`); continue; }

    await prisma.agentPromptContext.upsert({
      where: { agentId: agent.id },
      update: ctx,
      create: { agentId: agent.id, ...ctx },
    });
    count++;
  }
  console.log(`Seeded ${count} agent prompt contexts`);
}

/** EP-AI-WORKFORCE-001: Seed feature degradation mappings */
async function seedFeatureDegradationMappings(): Promise<void> {
  const mappings: Array<{ agentSlug: string; featureRoute: string; featureName: string; requiredTier: string; degradationMode: string; userMessage: string }> = [
    { agentSlug: "build-specialist", featureRoute: "/build", featureName: "Build Studio code generation", requiredTier: "strong", degradationMode: "reduced", userMessage: "Code generation is running on a basic model. Complex implementations may need manual review." },
    { agentSlug: "doc-specialist", featureRoute: "/docs", featureName: "Documentation review", requiredTier: "adequate", degradationMode: "manual_only", userMessage: "Documentation review is temporarily unavailable. Manual review required." },
    { agentSlug: "doc-specialist", featureRoute: "/build", featureName: "Diagram generation in builds", requiredTier: "adequate", degradationMode: "reduced", userMessage: "Diagram generation is running on a basic model. Complex diagrams may have errors." },
    { agentSlug: "portfolio-advisor", featureRoute: "/portfolio", featureName: "Portfolio health analysis", requiredTier: "adequate", degradationMode: "reduced", userMessage: "Portfolio analysis is running on a basic model. Results may be less detailed." },
    { agentSlug: "ea-architect", featureRoute: "/ea", featureName: "Architecture governance", requiredTier: "adequate", degradationMode: "reduced", userMessage: "Architecture analysis is running on a basic model. Complex dependency analysis may be limited." },
  ];

  let count = 0;
  for (const m of mappings) {
    const agent = await prisma.agent.findFirst({ where: { OR: [{ agentId: m.agentSlug }, { slugId: m.agentSlug }] } });
    if (!agent) { console.warn(`  → Agent ${m.agentSlug} not found, skipping degradation mapping`); continue; }

    await prisma.featureDegradationMapping.upsert({
      where: { agentId_featureRoute: { agentId: agent.id, featureRoute: m.featureRoute } },
      update: { featureName: m.featureName, requiredTier: m.requiredTier, degradationMode: m.degradationMode, userMessage: m.userMessage },
      create: { agentId: agent.id, featureRoute: m.featureRoute, featureName: m.featureName, requiredTier: m.requiredTier, degradationMode: m.degradationMode, userMessage: m.userMessage },
    });
    count++;
  }
  console.log(`Seeded ${count} feature degradation mappings`);
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
 * Generate a stable anonymous client identity at first install.
 * Called every seed — only writes if clientId is not already set.
 *
 * Identity design for 10,000-client hive:
 * - name:  "dpf-agent"  — identical for every client (indistinguishable in upstream log)
 * - email: agent-<sha256(clientId)[:16]>@hive.dpf — unique per install, reveals nothing
 *
 * The SHA256 hash of the clientId means:
 * - The same install always produces the same email (stable across restarts)
 * - Two installs never collide (UUID entropy)
 * - The upstream repo sees a pseudonymous contributor, not a real identity
 * - The email cannot be reverse-engineered to reveal the client or their org
 */
async function seedClientIdentity(): Promise<void> {
  const existing = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { clientId: true, gitAgentEmail: true },
  });

  // Already initialized — never regenerate (would change git author history)
  if (existing?.clientId && existing?.gitAgentEmail) {
    console.log(`[seed] Client identity already set: ${existing.gitAgentEmail}`);
    return;
  }

  const clientId = crypto.randomUUID();
  const hash = crypto.createHash("sha256").update(clientId).digest("hex").slice(0, 16);
  const gitAgentEmail = `agent-${hash}@hive.dpf`;

  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      clientId,
      gitAgentEmail,
    },
    update: {
      clientId,
      gitAgentEmail,
    },
  });

  console.log(`[seed] Client identity generated: dpf-agent <${gitAgentEmail}>`);
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

    const codeModels = [
      {
        modelId: "gpt-5.3-codex",
        friendlyName: "GPT-5 Codex",
        summary: "OpenAI flagship Codex coding model — advanced coding, reasoning, and tool use",
        modelClass: "code",
        costTier: "$$$",
        bestFor: ["coding", "reasoning", "agentic-tasks"] as string[],
        avoidFor: ["conversation"] as string[],
        reasoning: 88, codegen: 96, toolFidelity: 90,
        instructionFollowingScore: 86, structuredOutputScore: 84,
        conversational: 50, contextRetention: 78,
      },
      {
        modelId: "codex-mini-latest",
        friendlyName: "Codex Mini",
        summary: "OpenAI Codex mini model — retained for catalog visibility, but disabled by default for platform routing",
        modelClass: "code",
        costTier: "$$",
        bestFor: ["coding", "agentic-tasks"] as string[],
        avoidFor: ["conversation"] as string[],
        reasoning: 70, codegen: 90, toolFidelity: 85,
        instructionFollowingScore: 80, structuredOutputScore: 70,
      conversational: 40, contextRetention: 60,
    },
  ];

    const allModels = [...codeModels];
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
          modelStatus: m.modelId === "codex-mini-latest" ? "disabled" : "active",
          generatedBy: "system:seed",
          profileSource: "seed",
          profileConfidence: "medium",
          maxContextTokens: 128000,
          maxOutputTokens: 16384,
          reasoning: m.reasoning, codegen: m.codegen, toolFidelity: m.toolFidelity,
          instructionFollowingScore: m.instructionFollowingScore, structuredOutputScore: m.structuredOutputScore,
          conversational: m.conversational, contextRetention: m.contextRetention,
          supportsToolUse: false,
          capabilities: { toolUse: false, streaming: true, structuredOutput: true, imageInput: m.modelClass === "chat" } as any,
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
   * Seed ChatGPT subscription models under the chatgpt provider.
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
          modelStatus: "active",
          generatedBy: "system:seed",
          profileSource: "seed",
          profileConfidence: "medium",
          maxContextTokens: 128000,
          maxOutputTokens: 16384,
          reasoning: m.reasoning, codegen: m.codegen, toolFidelity: m.toolFidelity,
          instructionFollowingScore: m.instructionFollowingScore, structuredOutputScore: m.structuredOutputScore,
          conversational: m.conversational, contextRetention: m.contextRetention,
          supportsToolUse: false,
          capabilities: { toolUse: false, streaming: true, structuredOutput: true, imageInput: true } as any,
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
   * Keep Anthropic subscription profiles in a healthy fallback state for
   * Build Studio and coworker flows when Codex is unavailable.
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
      { agentId: "build-specialist",    minimumTier: "strong",   budgetClass: "quality_first" },
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
    { agentId: "doc-specialist",     minimumTier: "adequate", budgetClass: "balanced" },
    { agentId: "data-architect",     minimumTier: "adequate", budgetClass: "balanced" },
  ];

  let seeded = 0;
  let existed = 0;
  for (const d of defaults) {
    const existing = await prisma.agentModelConfig.findUnique({
      where: { agentId: d.agentId },
    });
    if (existing) {
      // Admin has already configured this agent — don't overwrite tier/budget.
      // But DO apply pinned provider/model if the seed specifies them and
      // the existing row doesn't have them (prevents recurring routing bugs).
      if ((d.pinnedProviderId && !existing.pinnedProviderId) ||
          (d.pinnedModelId && !existing.pinnedModelId)) {
        await prisma.agentModelConfig.update({
          where: { agentId: d.agentId },
          data: {
            ...(d.pinnedProviderId && !existing.pinnedProviderId ? { pinnedProviderId: d.pinnedProviderId } : {}),
            ...(d.pinnedModelId && !existing.pinnedModelId ? { pinnedModelId: d.pinnedModelId } : {}),
          },
        });
        console.log(`  Updated pins for ${d.agentId}: provider=${d.pinnedProviderId}, model=${d.pinnedModelId}`);
      }
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

async function seedWorkQueues(): Promise<void> {
  await prisma.workQueue.upsert({
    where: { queueId: "triage-default" },
    create: {
      queueId: "triage-default",
      name: "Triage",
      queueType: "triage",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false, maxConcurrentPerWorker: 10 },
      isActive: true,
    },
    update: {},
  });

  await prisma.workQueue.upsert({
    where: { queueId: "escalation-default" },
    create: {
      queueId: "escalation-default",
      name: "Escalation",
      queueType: "escalation",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false, maxConcurrentPerWorker: 10 },
      isActive: true,
    },
    update: {},
  });

  console.log("  Work queues: triage-default, escalation-default");
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
  // EP-AI-WORKFORCE-001: Seed unified agent lifecycle data
  await seedCoworkerSkills();
  await seedAgentPromptContexts();
  await seedFeatureDegradationMappings();
  await seedTaxonomyNodes();
  await seedEaReferenceModels().catch((err: unknown) => {
    console.warn("[seed] EA reference models skipped:", err instanceof Error ? err.message : err);
  });
  await seedDigitalProducts();
  await seedEaArchimate4();
  await seedEaBpmn20();
  await seedEaCrossNotation();
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
  await seedClientIdentity();
  await seedStorefrontArchetypes(prisma);
  await seedWorkQueues();
  console.log("Seed complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
