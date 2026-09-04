// apps/web/app/(shell)/platform/ai/assignments/page.tsx
// EP-INF-012: Admin UI for AI Coworker Model Assignment.
// EP-GOLDEN-TRIANGLE surface consolidation: this is now the single "Coworker
// Priority & Models" surface. It hosts BOTH the everyday Cost/Quality/Time
// priority (the platform default — formerly its own /platform/ai/priority tab,
// which now redirects here) and the advanced per-coworker guardrails below it.
// One surface to tune how coworkers work, instead of two competing tabs.

import Link from "next/link";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { GoldenTrianglePriorityPanel } from "@/components/golden-triangle/GoldenTrianglePriorityPanel";
import { getGoldenTrianglePosture } from "@/lib/golden-triangle/persistence";
import { WorkroomDefaultControl } from "@/components/golden-triangle/WorkroomDefaultControl";
import { getWorkroomPostureDefault } from "@/lib/work-management/workroom-posture-defaults";
import { BindingBootstrapPanel } from "@/components/platform/authority/BindingBootstrapPanel";
import { BootstrapBindingsButton } from "@/components/platform/authority/BootstrapBindingsButton";
import { BindingDetailDrawer } from "@/components/platform/authority/BindingDetailDrawer";
import { BindingFilters } from "@/components/platform/authority/BindingFilters";
import { BindingList } from "@/components/platform/authority/BindingList";
import {
  getAuthorityBinding,
  getAuthorityBindingEvidence,
  getAuthorityBindingFilterOptions,
  listAuthorityBindingRecords,
  parseAuthorityBindingFilters,
} from "@/lib/authority/bindings";
import { getAuthorityBindingBootstrapState } from "@/lib/authority/bootstrap-rollout";
import { can } from "@/lib/permissions";
import { AgentModelAssignmentTable } from "@/components/platform/AgentModelAssignmentTable";
import { listAuthorityBindings } from "@/lib/authority/bindings";
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
  "inventory-specialist": "Digital Product Estate Specialist",
  "ea-architect":         "Enterprise Architect",
  "ops-coordinator":      "Scrum Master",
  "onboarding-coo":       "Onboarding COO",
  "doc-specialist":       "Documentation Specialist",
  "data-architect":       "Data Architect",
};

type Props = {
  searchParams: Promise<{
    binding?: string;
    status?: string;
    resource?: string;
    coworker?: string;
    subject?: string;
  }>;
};

export default async function AssignmentsPage({ searchParams }: Props) {
  const query = await searchParams;
  const activeBindingId = typeof query.binding === "string" ? query.binding : null;
  const currentFilters = {
    status: typeof query.status === "string" ? query.status : undefined,
    resource: typeof query.resource === "string" ? query.resource : undefined,
    coworker: typeof query.coworker === "string" ? query.coworker : undefined,
    subject: typeof query.subject === "string" ? query.subject : undefined,
  };
  const parsedFilters = parseAuthorityBindingFilters(currentFilters);
  const hasActiveFilters = Object.keys(parsedFilters).length > 0;
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_platform",
  );
  const bootstrapState = await getAuthorityBindingBootstrapState({
    canWrite,
    hasActiveFilters,
  });
  const bootstrapAction = canWrite && !bootstrapState.report ? <BootstrapBindingsButton /> : null;

  // Fetch data in parallel
  const [dbConfigs, providers, lastModels, toolGrantGroups, bindingRecords, bindingList, activeBinding, activeBindingEvidence] = await Promise.all([
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
    listAuthorityBindingRecords(),
    listAuthorityBindings({ pivot: "coworker", filters: parsedFilters }),
    activeBindingId ? getAuthorityBinding(activeBindingId) : Promise.resolve(null),
    activeBindingId ? getAuthorityBindingEvidence(activeBindingId) : Promise.resolve([]),
  ]);
  const bindingFilterOptions = getAuthorityBindingFilterOptions(bindingRecords);

  // EP-GOLDEN-TRIANGLE: the everyday Cost/Quality/Time platform default, seeded
  // into the priority panel embedded at the top of this surface. Fail-open.
  const platformPosture = await getGoldenTrianglePosture({ kind: "platform" }).catch(() => null);
  const workroomDefault = await getWorkroomPostureDefault();

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
    <div className="space-y-6">
      {activeBinding ? (
        <section className="space-y-3 rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Editing binding {activeBinding.bindingId}</h2>
            <p className="text-xs text-[var(--dpf-muted)]">
              Coworker-first edit surface for the shared authority binding record.
            </p>
          </div>
          <BindingDetailDrawer binding={activeBinding} evidence={activeBindingEvidence} />
        </section>
      ) : null}

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          AI Coworker Priority &amp; Models
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2, maxWidth: 760, lineHeight: 1.5 }}>
          One place to tune how AI coworkers work. Set the everyday Cost / Quality / Time priority — the platform
          default every coworker inherits — then set the hard per-coworker guardrails below: a minimum-quality{" "}
          <strong>floor</strong>, an optional pinned model, and capability requirements. Each coworker can raise its
          own priority <em>above</em> the floor from the triangle at its composer. Changes take effect on the next
          routing decision.
        </p>
      </div>

      {/* Everyday priority — the platform default (Cost / Quality / Time). */}
      <section className="space-y-3">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Everyday priority</h2>
            <p className="text-xs text-[var(--dpf-muted)]">
              The platform-default Cost / Quality / Time posture. The platform compiles it into the right model,
              effort, verification, and review/debate — shown below in plain language.
            </p>
          </div>
          <Link
            href="/platform/ai/priority/outcomes"
            style={{ flex: "0 0 auto", fontSize: 12, color: "var(--dpf-accent)", whiteSpace: "nowrap", marginTop: 2 }}
          >
            See outcomes →
          </Link>
        </div>
        <GoldenTrianglePriorityPanel initial={platformPosture ?? undefined} />
      </section>

      {/* EP-WORK-POSTURE — how ROOMS behave, which the coworker controls above
          do not answer. A room and a coworker are different questions, and only
          the first was settable until now. */}
      <section className="space-y-3">
        <WorkroomDefaultControl
          currentPace={workroomDefault?.proactivityLevel ?? null}
          currentAuthority={workroomDefault?.actionBoundary ?? null}
        />
      </section>

      {/* Advanced guardrails — the hard per-coworker floor / pinned model. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Advanced guardrails per coworker</h2>
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
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Resource Bindings</h2>
          <p className="text-xs text-[var(--dpf-muted)]">
            Coworker-first view of where each coworker is applied and which subjects can reach that governed context.
          </p>
        </div>
        {bootstrapState.report ? (
          <BindingBootstrapPanel
            autoApplied={bootstrapState.autoApplied}
            totalBindings={bootstrapState.totalBindings}
            report={bootstrapState.report}
            detailQueryBase="/platform/ai/assignments"
          />
        ) : null}
        <BindingFilters
          actionHref="/platform/ai/assignments"
          currentFilters={currentFilters}
          options={bindingFilterOptions}
          resultCount={bindingList.rows.length}
          actions={bootstrapAction}
        />
        <BindingList
          pivot="coworker"
          rows={bindingList.rows}
          emptyMessage="No coworker authority bindings have been configured yet."
          detailQueryBase="/platform/ai/assignments"
        />
      </section>
    </div>
  );
}
