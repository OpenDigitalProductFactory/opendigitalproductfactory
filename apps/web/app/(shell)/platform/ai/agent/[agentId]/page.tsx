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
import { MessageSquare, Settings2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AgentModelRoutingCard } from "@/components/platform/AgentModelRoutingCard";
import { CapabilitiesEditor } from "@/components/platform/coworker-record/CapabilitiesEditor";
import { RecordActionsMenu } from "@/components/platform/coworker-record/RecordActionsMenu";
import { CoworkerPriorityControl } from "@/components/golden-triangle/CoworkerPriorityControl";
import { CoworkerProactivitySetting } from "@/components/platform/coworker-record/CoworkerProactivitySetting";
import { getCoworkerPostureInheritance } from "@/lib/actions/golden-triangle";
import {
  loadCoworkerRecord,
} from "@/lib/coworker-record/load-record";
import { safeRosterReturnTo } from "@/lib/coworker-record/roster-filter";
import { loadFamilyCorpusSignals } from "@/lib/coworker-record/corpus-signals";
import {
  getCoworkerCapabilityNeedReview,
  type CoworkerCapabilityNeedReview,
} from "@/lib/coworker-self-assessment/review-service";
import { resolveInstallVariantContext } from "@/lib/decision-perspective/install-variant-context";
import { knownGrantKeys } from "@/lib/tak/agent-grants";
import {
  evaluateCoworkerServicesReadiness,
  hasHealthyCoworkerProvider,
} from "@/lib/coworker-service-catalog/service-readiness";
import { VERIFIED_COWORKER_SERVICE_TOOL_NAMES } from "@/lib/coworker-service-catalog/registered-service-tools";
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
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import {
  activeRosterServices,
  projectCoworkerDiscovery,
  projectCoworkerServiceAuthority,
} from "@/lib/coworker-record/roster-presentation";
import {
  AdvancedDetail,
  AvailabilityPanel,
  HeaderChip,
  OwnerStatus,
  WorkHighlights,
  WorkOfferedPanel,
} from "@/components/platform/coworker-record/OwnerCoworkerPanels";

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
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const { agentId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const returnTo = safeRosterReturnTo(resolvedSearchParams.returnTo);
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
      prisma.agentModelConfig.findUnique({ where: { agentId: record.runtime.agentId } }).catch(() => null),
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
          where: { agentId: record.runtime.agentId, enabled: true },
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
      prisma.modelProvider.findMany({
        select: {
          providerId: true,
          status: true,
          modelProfiles: {
            where: { modelStatus: "active", supportsToolUse: true },
            select: { modelId: true },
          },
        },
      }).catch(() => []),
      getCoworkerCapabilityNeedReview({ agentId: record.runtime.agentId }).catch(() => emptyNeedReview()),
      getWorkPatternReadModel({ agentId: record.runtime.agentId }).catch(() => emptyWorkPatternReadModel()),
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
  const pinnedProvider = modelConfig?.pinnedProviderId ?? null;
  const providerHealthy = hasHealthyCoworkerProvider(
    pinnedProvider,
    allProviderStatuses.map((provider) => ({
      providerId: provider.providerId,
      status: provider.status,
      activeToolModelCount: provider.modelProfiles.length,
    })),
  );

  const summary = {
    modelTier,
    priority: priorityLabel,
    skillCount: assignedSkills.length,
    toolCount: record.runtime.heldGrantKeys.length,
    hitlTier: agent.hitlTierDefault,
    providerHealthy,
  };
  const discovery = projectCoworkerDiscovery({
    agentDescription: agent.description,
    services: record.services,
    install: record.installAvailability,
    readinessByServiceId: evaluateCoworkerServicesReadiness(record.services, {
      assignedSkillIds: record.runtime.assignedSkillIds,
      registeredToolNames: VERIFIED_COWORKER_SERVICE_TOOL_NAMES,
      heldGrantKeys: record.runtime.heldGrantKeys,
      providerHealthy,
      blockingCapabilityNeedCount:
        capabilityNeedReview.summary.byStatus["blocked"] ?? 0,
    }),
  });
  const {
    area,
    interaction,
    availability,
    canStartConversation,
    plainJob,
  } = discovery;
  const interactionLabel = interaction.labels.join(", ");
  const coverageSetupHref = availability.reason
    .toLowerCase()
    .includes("business type")
    ? "/storefront/settings/business"
    : "/platform/ai/readiness";
  const authority = projectCoworkerServiceAuthority({
    agent: {
      agentId: agent.agentId,
      hitlTierDefault: agent.hitlTierDefault,
    },
    governance: agent.governanceProfile
      ? {
          state: "evaluated",
          profileId: agent.governanceProfile.id,
          hitlPolicy: agent.governanceProfile.hitlPolicy,
        }
      : { state: "not-configured" },
    services: record.services,
  });
  const detailRoute = `/platform/ai/agent/${encodeURIComponent(agent.agentId)}`;

  const capabilitiesEditor = (
    <CapabilitiesEditor
      agentCuid={record.runtime.id}
      agentBusinessId={record.runtime.agentId}
      slugId={record.runtime.slugId}
      heldGrants={record.runtime.heldGrantKeys}
      allGrantKeys={knownGrantKeys()}
      assignedSkills={assignedSkills}
      catalogSkills={catalogSkillRows}
      canWrite={canWrite}
    />
  );

  const routingCard = (
    <AgentModelRoutingCard
      agentId={record.runtime.agentId}
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

  // WS4: a one-word badge on the Priority tab so an override is visible without
  // opening it ("set" = this coworker has its own override; otherwise inherited).
  const priorityBadge = postureInheritance.hasOwnOverride ? "set" : null;
  const needsAndPlaybooksCount =
    capabilityNeedReview.summary.total + workPatternReadModel.summary.totalPatterns;

  const tabs: CoworkerTab[] = [
    { id: "overview", label: "Overview" },
    {
      id: "work-offered",
      label: "Work Offered",
      badge: activeRosterServices(record.services).length
        ? String(activeRosterServices(record.services).length)
        : null,
    },
    { id: "availability", label: "Availability" },
    {
      id: "capabilities",
      label: "Capabilities",
      badge: String(record.runtime.heldGrantKeys.length),
    },
    {
      id: "autonomy",
      label: "Autonomy & Governance",
      badge: priorityBadge,
    },
    {
      id: "activity",
      label: "Activity",
      badge:
        decisions.total + needsAndPlaybooksCount > 0
          ? String(decisions.total + needsAndPlaybooksCount)
          : null,
    },
  ];

  return (
    <div>
      <div className="mb-4 text-xs">
        <Link
          href={returnTo}
          className="text-[var(--dpf-muted)] no-underline hover:text-[var(--dpf-text)]"
        >
          AI Workforce
        </Link>
        <span className="mx-2 text-[var(--dpf-muted)]">/</span>
        <span className="text-[var(--dpf-text)]">{agent.displayName}</span>
      </div>

      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-[var(--dpf-text)]">
                {agent.displayName}
              </h1>
              <HeaderChip tone="accent">{area.label}</HeaderChip>
              <HeaderChip tone="muted">
                {agent.kind.charAt(0).toUpperCase() + agent.kind.slice(1)}
              </HeaderChip>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-5 text-[var(--dpf-text-secondary)]">
              {plainJob}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canStartConversation && (
              <AskCoworkerButton
                routeContext={detailRoute}
                label={`Ask ${agent.displayName}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
              >
                <MessageSquare aria-hidden className="h-4 w-4" />
                <span>{`Ask ${agent.displayName}`}</span>
              </AskCoworkerButton>
            )}
            {availability.state === "setup-needed" && (
              <Link
                href={`${detailRoute}#capabilities`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
              >
                <Settings2 aria-hidden className="h-4 w-4" />
                Review capabilities
              </Link>
            )}
            {availability.state === "needs-attention" && (
              <Link
                href="/platform/ai/readiness"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
              >
                <Settings2 aria-hidden className="h-4 w-4" />
                Review AI readiness
              </Link>
            )}
            {availability.state === "coverage-not-defined" && (
              <Link
                href={coverageSetupHref}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
              >
                <Settings2 aria-hidden className="h-4 w-4" />
                Review availability
              </Link>
            )}
            <RecordActionsMenu
              actions={[
                { label: "Edit persona prompt", href: "/platform/ai/prompts" },
                { label: "Skills catalog", href: "/platform/ai/skills" },
                {
                  label: "Model & priority grid",
                  href: "/platform/ai/assignments",
                },
                { label: "Authority & audit", href: "/platform/audit" },
                ...(profession.profileId
                  ? [{ label: "Open Needs you", href: "/workspace/inbox" }]
                  : []),
              ]}
            />
          </div>
        </div>

        <dl className="mt-5 grid border-y border-[var(--dpf-border)] sm:grid-cols-3 sm:divide-x sm:divide-[var(--dpf-border)]">
          <OwnerStatus
            label="Work includes"
            value={interactionLabel}
            detail="Interaction across this coworker's declared services."
          />
          <OwnerStatus
            label="Availability"
            value={availability.label}
            detail={availability.reason}
          />
          <OwnerStatus
            label="Approval and autonomy"
            value={authority.label}
            detail={authority.summary}
          />
        </dl>

        <details className="mt-2 border-b border-[var(--dpf-border)] pb-2">
          <summary className="min-h-11 cursor-pointer py-2 text-xs font-medium text-[var(--dpf-muted)]">
            Technical identity
          </summary>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pb-2 text-xs text-[var(--dpf-muted)]">
            <span>
              ID: <code>{agent.agentId}</code>
            </span>
            {gaid && (
              <span>
                GAID: <code>{gaid}</code>
              </span>
            )}
            {agent.slugId && (
              <span>
                Slug: <code>{agent.slugId}</code>
              </span>
            )}
            <span>{TIER_LABELS[agent.tier] ?? `Tier ${agent.tier}`}</span>
            <span>{agent.lifecycleStage}</span>
          </div>
        </details>
      </header>

      {isStandingCooAgentId(agent.agentId) && (
        <CooConversationalNameCard
          initialName={cooNamePreference?.cooConversationalName ?? null}
          canWrite={canWrite}
        />
      )}

      <CoworkerRecordTabs tabs={tabs}>
        <div className="space-y-5">
          <section>
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Ready work
            </h2>
            <div className="mt-2">
              <WorkHighlights
                services={record.services}
                serviceAvailability={discovery.serviceAvailability}
              />
            </div>
          </section>
          <AdvancedDetail summary="Operational profile">
            <OverviewPanel record={record} summary={summary} />
          </AdvancedDetail>
        </div>
        <WorkOfferedPanel
          services={record.services}
          serviceAvailability={discovery.serviceAvailability}
        />
        <AvailabilityPanel
          availability={availability}
          serviceAvailability={discovery.serviceAvailability}
          authority={authority}
          interactionLabel={interactionLabel}
          installArchetypeId={
            record.installAvailability.install?.archetypeId ?? null
          }
        />
        <div className="space-y-6">
          <ProfessionPanel
            record={record}
            corpusSignals={corpusSignals}
            installArchetype={installVariant.archetype ?? null}
          />
          <CapabilitiesPanel
            record={record}
            routingCard={routingCard}
            capabilitiesEditor={capabilitiesEditor}
          />
          <NeedsAndPlaybooksPanel
            needs={capabilityNeedReview}
            workPatterns={workPatternReadModel}
            canWrite={canWrite}
          />
        </div>
        <div className="space-y-6">
          <PriorityPanel
            priorityControl={priorityControl}
            proactivitySection={
              <CoworkerProactivitySetting agentId={agent.agentId} />
            }
          />
          <GovernancePanel record={record} />
        </div>
        <div className="space-y-6">
          <PerformancePanel record={record} />
          <DecisionsPanel record={record} />
        </div>
      </CoworkerRecordTabs>
    </div>
  );
}
