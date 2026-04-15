// apps/web/app/(shell)/platform/ai/assignments/page.tsx
// EP-INF-012: Admin UI for AI Coworker Model Assignment

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AgentModelAssignmentTable } from "@/components/platform/AgentModelAssignmentTable";
import { satisfiesMinimumCapabilities, DEFAULT_MINIMUM_CAPABILITIES } from "@/lib/routing/agent-capability-types";
import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";
import { EMPTY_CAPABILITIES } from "@/lib/routing/model-card-types";

// Agent defaults — used when no DB config row exists.
// Must match the defaultMinimumTier/defaultBudgetClass in agent-routing.ts ROUTE_AGENT_MAP.
const AGENT_DEFAULTS: Record<string, { minimumTier: string; budgetClass: string }> = {
  "build-specialist":     { minimumTier: "strong",   budgetClass: "quality_first" },
  "coo":                  { minimumTier: "strong",   budgetClass: "balanced" },
  "admin-assistant":      { minimumTier: "strong",   budgetClass: "balanced" },
  "platform-engineer":    { minimumTier: "strong",   budgetClass: "balanced" },
  "compliance-officer":   { minimumTier: "strong",   budgetClass: "balanced" },
  "finance-controller":   { minimumTier: "strong",   budgetClass: "balanced" },
  "hr-specialist":        { minimumTier: "adequate", budgetClass: "balanced" },
  "customer-advisor":     { minimumTier: "adequate", budgetClass: "balanced" },
  "portfolio-advisor":    { minimumTier: "adequate", budgetClass: "balanced" },
  "inventory-specialist": { minimumTier: "adequate", budgetClass: "balanced" },
  "ea-architect":         { minimumTier: "adequate", budgetClass: "balanced" },
  "ops-coordinator":      { minimumTier: "adequate", budgetClass: "balanced" },
  "onboarding-coo":       { minimumTier: "basic",    budgetClass: "minimize_cost" },
  "doc-specialist":       { minimumTier: "adequate", budgetClass: "balanced" },
  "data-architect":       { minimumTier: "adequate", budgetClass: "balanced" },
};

// Agent display names
const AGENT_NAMES: Record<string, string> = {
  "build-specialist":     "Software Engineer",
  "coo":                  "COO",
  "admin-assistant":      "System Admin",
  "platform-engineer":    "AI Ops Engineer",
  "compliance-officer":   "Compliance Officer",
  "finance-controller":   "Finance Controller",
  "hr-specialist":        "HR Director",
  "customer-advisor":     "Customer Success Manager",
  "portfolio-advisor":    "Portfolio Analyst",
  "inventory-specialist": "Product Manager",
  "ea-architect":         "Enterprise Architect",
  "ops-coordinator":      "Scrum Master",
  "onboarding-coo":       "Onboarding COO",
  "doc-specialist":       "Documentation Specialist",
  "data-architect":       "Data Architect",
};

export default async function AssignmentsPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_platform",
  );

  // Fetch data in parallel
  const [dbConfigs, providers, lastModels, toolGrantGroups] = await Promise.all([
    prisma.agentModelConfig.findMany().catch(() => [] as any[]),
    prisma.modelProvider.findMany({
      where: { status: { in: ["active", "degraded"] } },
      orderBy: { name: "asc" },
      select: {
        providerId: true,
        name: true,
        modelProfiles: {
          where: { modelStatus: "active" },
          select: { modelId: true, friendlyName: true, supportsToolUse: true },
          orderBy: { friendlyName: "asc" },
        },
      },
    }),
    // Get the most recent assistant message per agent for "Current Model"
    prisma.$queryRaw<Array<{ agentId: string; providerId: string }>>`
      SELECT DISTINCT ON ("agentId") "agentId", "providerId"
      FROM "AgentMessage"
      WHERE "role" = 'assistant' AND "agentId" IS NOT NULL AND "providerId" IS NOT NULL
      ORDER BY "agentId", "createdAt" DESC
    `.catch(() => [] as Array<{ agentId: string; providerId: string }>),
    // Get tool grant counts per agent to know which agents actively use tools
    prisma.agentToolGrant.groupBy({
      by: ["agentId"],
      _count: { grantKey: true },
    }).catch(() => [] as any[]),
  ]);

  // Build provider name lookup
  const providerNames: Record<string, string> = {};
  for (const p of providers) {
    providerNames[p.providerId] = p.name;
  }

  // Build last-model lookup
  const lastModelMap: Record<string, string> = {};
  for (const lm of lastModels) {
    lastModelMap[lm.agentId] = providerNames[lm.providerId] ?? lm.providerId;
  }

  // Build DB config lookup
  const dbConfigMap: Record<string, typeof dbConfigs[0]> = {};
  for (const c of dbConfigs) {
    dbConfigMap[c.agentId] = c;
  }

  // Build tool grant count lookup: agentId → count
  const toolGrantCounts: Record<string, number> = {};
  for (const g of toolGrantGroups) {
    toolGrantCounts[g.agentId] = g._count.grantKey;
  }

  // Merge defaults with DB configs
  const agentIds = Object.keys(AGENT_DEFAULTS);
  const agents = agentIds.map((agentId) => {
    const dbCfg = dbConfigMap[agentId];
    const defaults = AGENT_DEFAULTS[agentId]!;
    return {
      agentId,
      agentName: AGENT_NAMES[agentId] ?? agentId,
      minimumTier: dbCfg?.minimumTier ?? defaults.minimumTier,
      budgetClass: dbCfg?.budgetClass ?? defaults.budgetClass,
      pinnedProviderId: dbCfg?.pinnedProviderId ?? null,
      pinnedModelId: dbCfg?.pinnedModelId ?? null,
      lastModel: lastModelMap[agentId] ?? null,
      isDbConfig: !!dbCfg,
      hasToolGrants: (toolGrantCounts[agentId] ?? 0) > 0,
      minimumCapabilities: (dbCfg?.minimumCapabilities ?? null) as AgentMinimumCapabilities | null,
    };
  });

  // EP-AGENT-CAP-002: Identify agents with no eligible endpoints for their capability floor.
  // Build a flat list of all active model profiles across active/degraded providers.
  // ModelProfile only carries supportsToolUse; other capability flags default to EMPTY_CAPABILITIES.
  const activeModelProfiles = providers.flatMap((p) =>
    p.modelProfiles.map((m) => ({
      supportsToolUse: m.supportsToolUse ?? false,
      capabilities: EMPTY_CAPABILITIES,
    })),
  );

  const capabilityGapAgents = agents.filter((agent) => {
    const floor: AgentMinimumCapabilities =
      (agent.minimumCapabilities as AgentMinimumCapabilities | null) ?? DEFAULT_MINIMUM_CAPABILITIES;
    if (Object.keys(floor).length === 0) return false; // passive agent — no gap possible
    return !activeModelProfiles.some(
      (m) => satisfiesMinimumCapabilities(m, floor).satisfied,
    );
  });

  const providerList = providers.map((p) => ({
    providerId: p.providerId,
    name: p.name,
    models: p.modelProfiles.map((m: { modelId: string; friendlyName: string; supportsToolUse: boolean | null }) => ({
      modelId: m.modelId,
      friendlyName: m.friendlyName,
      supportsToolUse: m.supportsToolUse ?? false,
    })),
  }));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          AI Coworker Model Assignment
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Configure minimum quality tier and budget posture per agent. Changes take effect on the next routing decision.
        </p>
      </div>

      <div
        style={{
          background: "var(--dpf-surface-1)",
          borderRadius: 8,
          border: "1px solid var(--dpf-border)",
          padding: 16,
        }}
      >
        <AgentModelAssignmentTable
          agents={agents}
          providers={providerList}
          canWrite={canWrite}
          capabilityGapCount={capabilityGapAgents.length}
        />
      </div>
    </div>
  );
}
