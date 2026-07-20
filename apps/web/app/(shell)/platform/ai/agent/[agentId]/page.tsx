// apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx
// EP-AI-WORKFORCE-001 (HRIS surface): the per-coworker "employee record" —
// a tabbed, reviewable surface that consolidates every facet of one AI
// coworker (identity, profession/WSID corpus coverage, capabilities, grants,
// model routing, voice, governance, performance, improvement loop, and
// decision/defer signals). Spec:
// docs/superpowers/specs/2026-06-13-ai-coworker-hris-management-surface-design.md
import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AgentModelRoutingCard } from "@/components/platform/AgentModelRoutingCard";
import { CapabilitiesEditor } from "@/components/platform/coworker-record/CapabilitiesEditor";
import { RecordActionsMenu } from "@/components/platform/coworker-record/RecordActionsMenu";
import { CoworkerPriorityControl } from "@/components/golden-triangle/CoworkerPriorityControl";
import { CoworkerProactivitySetting } from "@/components/platform/coworker-record/CoworkerProactivitySetting";
import { getCoworkerPostureInheritance } from "@/lib/actions/golden-triangle";
import { loadCoworkerRecord } from "@/lib/coworker-record/load-record";
import { loadFamilyCorpusSignals } from "@/lib/coworker-record/corpus-signals";
import {
  getCoworkerCapabilityNeedReview,
  type CoworkerCapabilityNeedReview,
} from "@/lib/coworker-self-assessment/review-service";
import { resolveInstallVariantContext } from "@/lib/decision-perspective/install-variant-context";
import { knownGrantKeys } from "@/lib/tak/agent-grants";
import {
  getWorkPatternReadModel,
  type WorkPatternReadModel,
} from "@/lib/tak/work-pattern-read-model";
import { assignTierFromModelId, TIER_LABELS as QUALITY_TIER_LABELS } from "@/lib/routing/quality-tiers";
import { CoworkerRecordTabs, type CoworkerTab } from "@/components/platform/coworker-record/CoworkerRecordTabs";
import {
  OverviewPanel,
  ProfessionPanel,
  CapabilitiesPanel,
  PriorityPanel,
  GovernancePanel,
  PerformancePanel,
  DecisionsPanel,
} from "@/components/platform/coworker-record/panels";
import { NeedsAndPlaybooksPanel } from "@/components/platform/coworker-record/NeedsAndPlaybooksPanel";
import { CooConversationalNameCard } from "@/components/platform/coworker-record/CooConversationalNameCard";
import { isStandingCooAgentId } from "@/lib/coworker-presentation/coo-name";

const BUDGET_CLASS_LABELS: Record<string, string> = {
  quality_first: "Quality first",
  balanced: "Balanced",
  minimize_cost: "Cost first",
};

const TIER_LABELS: Record<number, string> = {
  1: "Orchestrator",
  2: "Specialist",
  3: "Cross-cutting",
};

function emptyNeedReview(): CoworkerCapabilityNeedReview {
  return {
    summary: {
      total: 0,
      byStatus: {},
      bySeverity: {},
      byKind: {},
    },
    filterOptions: {
      statuses: [],
      severities: [],
      kinds: [],
    },
    needs: [],
  };
}

function emptyWorkPatternReadModel(now = new Date()): WorkPatternReadModel {
  return {
    generatedAt: now,
    window: {
      since: now,
      until: now,
    },
    summary: {
      totalPatterns: 0,
      totalObservedRuns: 0,
      openNeedCount: 0,
      readyForReviewCount: 0,
      candidateOnlyCount: 0,
    },
    patterns: [],
  };
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const record = await loadCoworkerRecord(agentId);
  if (!record) return notFound();
  const { agent, gaid, profession, decisions } = record;

  // WSID Phase 3: per-family runtime corpus signals (usage / misses / growth gaps)
  // for the Profession & Knowledge tab. Null when the coworker is unmapped.
  // The install's resolved archetype is shown so the operator sees which corpus
  // slice this coworker is served (the "noted at setup" surface).
  const [corpusSignals, installVariant, postureInheritance] = await Promise.all([
    profession.family ? loadFamilyCorpusSignals(profession.family.professionKey) : null,
    resolveInstallVariantContext(prisma),
    // WS4: the effective Golden-Triangle posture + its inheritance provenance,
    // keyed by the BUSINESS agentId (the per-agent posture map key). Session-gated
    // + fail-open inside the action, so a read failure renders the Balanced cold-start.
    getCoworkerPostureInheritance(agent.agentId),
  ]);

  // Model-routing card data (kept page-side: needs the live provider catalog).
  // WS2 adds: catalog skills already assigned to this coworker (SkillAssignment,
  // keyed by the BUSINESS agentId) and the full active SkillDefinition catalog
  // for the add-select. Tool grants come from the loaded record (agent.toolGrants).
  const [
    session,
    modelConfig,
    lastModelRows,
    activeProviders,
    assignedSkillRows,
    catalogSkillRows,
    allProviderStatuses,
    capabilityNeedReview,
    workPatternReadModel,
  ] =
    await Promise.all([
      auth(),
      prisma.agentModelConfig.findUnique({ where: { agentId: agent.agentId } }).catch(() => null),
      prisma.$queryRaw<Array<{ agentId: string; providerId: string }>>`
        SELECT DISTINCT ON ("agentId") "agentId", "providerId"
        FROM "AgentMessage"
        WHERE "role" = 'assistant' AND "agentId" = ${agent.agentId} AND "providerId" IS NOT NULL
        ORDER BY "agentId", "createdAt" DESC
        LIMIT 1
      `.catch(() => [] as Array<{ agentId: string; providerId: string }>),
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
      }).catch(() => []),
      prisma.skillAssignment
        .findMany({
          where: { agentId: agent.agentId, enabled: true },
          orderBy: { priority: "desc" },
          select: { skill: { select: { skillId: true, name: true, capability: true } } },
        })
        .catch(() => [] as Array<{ skill: { skillId: string; name: string; capability: string | null } }>),
      prisma.skillDefinition
        .findMany({
          where: { status: "active" },
          orderBy: { name: "asc" },
          select: { skillId: true, name: true, category: true, riskBand: true },
        })
        .catch(() => [] as Array<{ skillId: string; name: string; category: string; riskBand: string }>),
      // Provider statuses for the summary health chip (mirrors roster.ts logic).
      prisma.modelProvider.findMany({ select: { providerId: true, status: true } }).catch(() => []),
      getCoworkerCapabilityNeedReview({ agentId: agent.agentId }).catch(() => emptyNeedReview()),
      getWorkPatternReadModel({ agentId: agent.agentId }).catch(() => emptyWorkPatternReadModel()),
    ]);

  const canWrite = !!session?.user && can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_platform",
  );
  const cooNamePreference = isStandingCooAgentId(agent.agentId)
    ? await prisma.organization.findFirst({ select: { cooConversationalName: true } }).catch(() => null)
    : null;

  const providerNames: Record<string, string> = {};
  for (const p of activeProviders) providerNames[p.providerId] = p.name;
  const lastModelRow = lastModelRows[0];
  const lastModelLabel = lastModelRow
    ? `${lastModelRow.providerId} (${providerNames[lastModelRow.providerId] ?? lastModelRow.providerId})`
    : null;

  // ── WS2 derived summary (model tier · priority · #skills · #tools · autonomy · health) ──
  const assignedSkills = assignedSkillRows.map((r) => r.skill);
  // Model tier: prefer the pinned model's tier, else the configured minimum tier.
  const modelTier = modelConfig?.pinnedModelId
    ? QUALITY_TIER_LABELS[assignTierFromModelId(modelConfig.pinnedModelId)]
    : QUALITY_TIER_LABELS[
        (modelConfig?.minimumTier as keyof typeof QUALITY_TIER_LABELS) ?? "adequate"
      ] ?? "Adequate";
  const priorityLabel = BUDGET_CLASS_LABELS[modelConfig?.budgetClass ?? "balanced"] ?? "Balanced";
  // Provider health: a pinned provider must be active; unpinned coworkers are
  // healthy by default (the router picks an active provider) — same rule as roster.ts.
  const providerStatusById = new Map(allProviderStatuses.map((p) => [p.providerId, p.status]));
  const pinnedProvider = modelConfig?.pinnedProviderId ?? null;
  const providerHealthy = !pinnedProvider || providerStatusById.get(pinnedProvider) === "active";

  const summary = {
    modelTier,
    priority: priorityLabel,
    skillCount: assignedSkills.length,
    toolCount: agent.toolGrants.length,
    hitlTier: agent.hitlTierDefault,
    providerHealthy,
  };

  const capabilitiesEditor = (
    <CapabilitiesEditor
      agentCuid={agent.id}
      agentBusinessId={agent.agentId}
      slugId={agent.slugId}
      heldGrants={agent.toolGrants.map((g) => g.grantKey)}
      allGrantKeys={knownGrantKeys()}
      assignedSkills={assignedSkills}
      catalogSkills={catalogSkillRows}
      canWrite={canWrite}
    />
  );

  const routingCard = (
    <AgentModelRoutingCard
      agentId={agent.agentId}
      minimumTier={modelConfig?.minimumTier ?? "adequate"}
      budgetClass={modelConfig?.budgetClass ?? "balanced"}
      pinnedProviderId={modelConfig?.pinnedProviderId ?? null}
      pinnedModelId={modelConfig?.pinnedModelId ?? null}
      lastModel={lastModelLabel}
      minimumCapabilities={(modelConfig?.minimumCapabilities as Record<string, boolean> | null) ?? {}}
      providers={activeProviders.map((p) => ({
        providerId: p.providerId,
        name: p.name,
        models: p.modelProfiles.map((m) => ({
          modelId: m.modelId,
          friendlyName: m.friendlyName ?? m.modelId,
          supportsToolUse: m.supportsToolUse ?? false,
        })),
      }))}
      canWrite={canWrite}
    />
  );

  // WS4: per-coworker priority control (client). Reads the effective posture +
  // inheritance resolved above; canWrite gates the editable presets/triangle and
  // the save/reset actions (read-only chip view otherwise).
  const priorityControl = (
    <CoworkerPriorityControl agentId={agent.agentId} inheritance={postureInheritance} canWrite={canWrite} />
  );

  const coveragePct =
    profession.coverage && profession.coverage.checklist.length > 0
      ? Math.min(100, Math.round((profession.coverage.pageCount / profession.coverage.checklist.length) * 100))
      : null;

  // WS4: a one-word badge on the Priority tab so an override is visible without
  // opening it ("set" = this coworker has its own override; otherwise inherited).
  const priorityBadge = postureInheritance.hasOwnOverride ? "set" : null;
  const needsAndPlaybooksCount =
    capabilityNeedReview.summary.total + workPatternReadModel.summary.totalPatterns;

  const tabs: CoworkerTab[] = [
    { id: "overview", label: "Overview" },
    { id: "profession", label: "Profession & Knowledge", badge: coveragePct !== null ? `${coveragePct}%` : profession.family ? null : "unmapped" },
    { id: "capabilities", label: "Capabilities", badge: String(agent.toolGrants.length) },
    { id: "priority", label: "Priority & Autonomy", badge: priorityBadge },
    { id: "governance", label: "Governance" },
    { id: "performance", label: "Performance" },
    { id: "needs-playbooks", label: "Needs & Playbooks", badge: needsAndPlaybooksCount > 0 ? String(needsAndPlaybooksCount) : null },
    { id: "decisions", label: "Decisions & Activity", badge: decisions.total > 0 ? String(decisions.total) : null },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16 }}>
        <Link href="/platform/ai" style={{ fontSize: 11, color: "var(--dpf-muted)", textDecoration: "none" }}>
          AI Workforce
        </Link>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)", margin: "0 6px" }}>/</span>
        <span style={{ fontSize: 11, color: "var(--dpf-text)" }}>{agent.displayName}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>{agent.displayName}</h1>
        <HeaderChip tone="muted">{agent.kind.charAt(0).toUpperCase() + agent.kind.slice(1)}</HeaderChip>
        <HeaderChip tone="accent">{TIER_LABELS[agent.tier] ?? `Tier ${agent.tier}`}</HeaderChip>
        {profession.family && <HeaderChip tone="accent">{profession.family.label}</HeaderChip>}
        {agent.valueStream && <HeaderChip tone="success">{agent.valueStream}</HeaderChip>}
        <HeaderChip tone="muted">{agent.lifecycleStage}</HeaderChip>
        {/* WS2 Related Actions ("…") — the data-model edges as navigation. Pure
            read-only links; per-coworker editing lives in the tabs. */}
        <RecordActionsMenu
          actions={[
            { label: "Edit persona prompt", href: "/platform/ai/prompts" },
            { label: "Skills catalog", href: "/platform/ai/skills" },
            { label: "Model & priority grid", href: "/platform/ai/assignments" },
            { label: "Authority & audit", href: "/platform/audit" },
            ...(profession.profileId
              ? [{ label: "Open Needs you", href: "/workspace/inbox" }]
              : []),
          ]}
        />
      </div>

      {agent.description && (
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 10, maxWidth: 720 }}>{agent.description}</p>
      )}

      <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 20 }}>
        <span>ID: <code style={{ fontSize: 10 }}>{agent.agentId}</code></span>
        {gaid && <span style={{ marginLeft: 12 }}>GAID: <code style={{ fontSize: 10 }}>{gaid}</code></span>}
        {agent.slugId && <span style={{ marginLeft: 12 }}>Slug: <code style={{ fontSize: 10 }}>{agent.slugId}</code></span>}
      </div>

      {isStandingCooAgentId(agent.agentId) && (
        <CooConversationalNameCard
          initialName={cooNamePreference?.cooConversationalName ?? null}
          canWrite={canWrite}
        />
      )}

      <CoworkerRecordTabs tabs={tabs}>
        <OverviewPanel record={record} summary={summary} />
        <ProfessionPanel record={record} corpusSignals={corpusSignals} installArchetype={installVariant.archetype ?? null} />
        <CapabilitiesPanel record={record} routingCard={routingCard} capabilitiesEditor={capabilitiesEditor} />
        <PriorityPanel
          priorityControl={priorityControl}
          proactivitySection={<CoworkerProactivitySetting agentId={agent.agentId} />}
        />
        <GovernancePanel record={record} />
        <PerformancePanel record={record} />
        <NeedsAndPlaybooksPanel
          needs={capabilityNeedReview}
          workPatterns={workPatternReadModel}
          canWrite={canWrite}
        />
        <DecisionsPanel record={record} />
      </CoworkerRecordTabs>
    </div>
  );
}

function HeaderChip({ children, tone }: { children: React.ReactNode; tone: "accent" | "success" | "muted" }) {
  const toneVar = { accent: "var(--dpf-accent)", success: "var(--dpf-success)", muted: "var(--dpf-muted)" }[tone];
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: `1px solid ${toneVar}`, color: toneVar }}>
      {children}
    </span>
  );
}
