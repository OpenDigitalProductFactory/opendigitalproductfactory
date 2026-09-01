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
import { can, getGrantedCapabilities } from "@/lib/permissions";
import { AgentModelRoutingCard } from "@/components/platform/AgentModelRoutingCard";
import { CapabilitiesEditor } from "@/components/platform/coworker-record/CapabilitiesEditor";
import { RecordActionsMenu } from "@/components/platform/coworker-record/RecordActionsMenu";
import { CoworkerPriorityControl } from "@/components/golden-triangle/CoworkerPriorityControl";
import { CoworkerProactivityNote } from "@/components/platform/coworker-record/CoworkerProactivityNote";
import { getCoworkerPostureInheritance } from "@/lib/actions/golden-triangle";
import {
  loadCoworkerRecord,
} from "@/lib/coworker-record/load-record";
import { safeRosterReturnTo } from "@/lib/coworker-record/roster-filter";
import { loadFamilyCorpusSignals } from "@/lib/coworker-record/corpus-signals";
import { getCoworkerBacklogSlice } from "@/lib/coworker-record/surface-backlog";
import {
  getCoworkerCapabilityNeedReview,
  type CoworkerCapabilityNeedReview,
} from "@/lib/coworker-self-assessment/review-service";
import { resolveInstallVariantContext } from "@/lib/decision-perspective/install-variant-context";
import { knownGrantKeys } from "@/lib/tak/agent-grants";
import {
  evaluateCoworkerServiceReadiness,
} from "@/lib/coworker-service-catalog/service-readiness";
import {
  loadCoworkerRoutingReadinessSnapshot,
  parseCoworkerServiceReadinessProbe,
  projectCoworkerRouteReadiness,
} from "@/lib/coworker-service-catalog/route-readiness";
import { evaluateLifecycleGate } from "@/lib/coworker-lifecycle/lifecycle-gate";
import { availabilityRecoveryTarget } from "@/lib/coworker-record/availability-recovery";
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
import { CapabilityCompletenessPanel } from "@/components/platform/coworker-record/CapabilityCompletenessPanel";
import { MySurfaceBacklogPanel } from "@/components/platform/coworker-record/MySurfaceBacklogPanel";
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
import { CoworkerShapePanel } from "@/components/platform/coworker-record/CoworkerShapePanel";
import { projectCoworkerShape } from "@/lib/work-management/coworker-shape-projection";

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
    routingReadinessSnapshot,
    capabilityNeedReview,
    workPatternReadModel,
  ] =
    await Promise.all([
      auth(),
      prisma.agentModelConfig.findUnique({ where: { agentId: record.runtime.agentId } }).catch(() => null),
      prisma.$queryRaw<Array<{ agentId: string; providerId: string }>>`
        SELECT DISTINCT ON ("agentId") "agentId", "providerId"
        FROM "AgentMessage"
        WHERE "role" = 'assistant' AND "agentId" = ${record.runtime.agentId} AND "providerId" IS NOT NULL
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
      loadCoworkerRoutingReadinessSnapshot(
        [record.runtime.agentId],
        record.services
          .map((service) =>
            parseCoworkerServiceReadinessProbe(service.metadata),
          )
          .filter((probe) => probe !== null)
          .map((probe) => probe.taskType),
      ),
      getCoworkerCapabilityNeedReview({ agentId: record.runtime.agentId }).catch(() => emptyNeedReview()),
      getWorkPatternReadModel({ agentId: record.runtime.agentId }).catch(() => emptyWorkPatternReadModel()),
    ]);

  // BI-012C0B58: the coworker's own identity-scoped backlog slice (surface +
  // occupation + owned), shared with the list_my_backlog tool. Fail-open so a
  // read hiccup renders an empty-state panel rather than 500-ing the record.
  const backlogSlice = await getCoworkerBacklogSlice(record.runtime.agentId).catch(() => null);

  // BI-DB302392: the coworker's own shape — its governed tool use, rendered
  // with the same grammar the Workroom uses. Failure to load is not a reason to
  // fail the page: an empty shape is honest, a thrown page is not.
  // A rejected promise is not the only failure mode: a client without this
  // delegate throws synchronously on property access, so the whole call is
  // wrapped rather than only its promise.
  const coworkerToolCalls = await (async () => {
    try {
      return await prisma.toolExecution.findMany({
        where: { agentId: record.runtime.agentId },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, toolName: true, success: true, auditClass: true, createdAt: true },
      });
    } catch {
      return [] as Array<{ id: string; toolName: string; success: boolean; auditClass: string | null; createdAt: Date }>;
    }
  })();
  const coworkerShape = projectCoworkerShape({
    agentId: record.runtime.agentId,
    // "Established" here means live and summonable, which is what the agent
    // row's own lifecycle stage says — not a status the page infers.
    established: agent.lifecycleStage !== "retired" && agent.lifecycleStage !== "draft",
    toolCalls: coworkerToolCalls.map((call) => ({
      id: call.id,
      toolName: call.toolName,
      success: call.success,
      auditClass: call.auditClass,
      createdAt: call.createdAt ? call.createdAt.toISOString() : null,
    })),
  });

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
  const routeConfiguration = {
      agentId: record.runtime.agentId,
      sensitivity: agent.sensitivity,
      minimumTier: modelConfig?.minimumTier ?? "adequate",
      pinnedProviderId: modelConfig?.pinnedProviderId ?? null,
      pinnedModelId: modelConfig?.pinnedModelId ?? null,
      budgetClass: modelConfig?.budgetClass ?? "balanced",
      minimumCapabilities: modelConfig?.minimumCapabilities ?? null,
      minimumContextTokens: modelConfig?.minimumContextTokens ?? null,
    };
  const lifecycleVerdict = await evaluateLifecycleGate(
    record.runtime.agentId,
    { purpose: "chat" },
  );
  const routeReadinessByServiceId = new Map(
    await Promise.all(
      record.services.map(async (service) => {
        const probe = parseCoworkerServiceReadinessProbe(service.metadata);
        const readiness = probe
          ? await projectCoworkerRouteReadiness(
              routeConfiguration,
              routingReadinessSnapshot,
              probe,
            )
          : {
              ready: false,
              reason:
                "No representative service task is declared for readiness.",
            };
        return [service.serviceId, readiness] as const;
      }),
    ),
  );
  const discovery = projectCoworkerDiscovery({
    agentDescription: agent.description,
    services: record.services,
    install: record.installAvailability,
    readinessByServiceId: new Map(
      record.services.map((service) => {
        const routeReadiness = routeReadinessByServiceId.get(
          service.serviceId,
        )!;
        return [
          service.serviceId,
          evaluateCoworkerServiceReadiness(service, {
            assignedSkillIds: record.runtime.assignedSkillIds,
            registeredToolNames: VERIFIED_COWORKER_SERVICE_TOOL_NAMES,
            heldGrantKeys: record.runtime.heldGrantKeys,
            probeDefined:
              parseCoworkerServiceReadinessProbe(service.metadata) !== null,
            lifecycleReady: lifecycleVerdict.allowed,
            lifecycleBlockerReason: lifecycleVerdict.allowed
              ? undefined
              : lifecycleVerdict.reason,
            routeReady: routeReadiness.ready,
            routeBlockerReason: routeReadiness.ready
              ? undefined
              : routeReadiness.reason,
            blockingCapabilityNeedCount:
              capabilityNeedReview.summary.byStatus["blocked"] ?? 0,
          }),
        ] as const;
      }),
    ),
  });
  const {
    area,
    interaction,
    availability,
    canStartConversation,
    plainJob,
    primaryService,
  } = discovery;
  const summary = {
    modelTier,
    priority: priorityLabel,
    skillCount: assignedSkills.length,
    toolCount: record.runtime.heldGrantKeys.length,
    hitlTier: agent.hitlTierDefault,
    conversationReady: canStartConversation,
  };
  const interactionLabel = interaction.labels.join(", ");
  const detailRoute = `/platform/ai/agent/${encodeURIComponent(agent.agentId)}`;
  const recovery = availabilityRecoveryTarget(
    availability,
    `${detailRoute}?returnTo=${encodeURIComponent(returnTo)}`,
    new Set(
      session?.user
        ? getGrantedCapabilities({
            platformRole: session.user.platformRole,
            isSuperuser: session.user.isSuperuser,
          })
        : [],
    ),
  );
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
    {
      id: "backlog",
      label: "Backlog",
      badge:
        backlogSlice && backlogSlice.summary.open > 0
          ? String(backlogSlice.summary.open)
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

      <CoworkerShapePanel graph={coworkerShape} />

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
            {primaryService && (
              <p className="mt-1 text-xs font-medium text-[var(--dpf-muted)]">
                Ready work: {primaryService.name}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canStartConversation && (
              <AskCoworkerButton
                routeContext={detailRoute}
                label={`Ask ${agent.displayName}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-accent-contrast)] hover:brightness-95"
              >
                <MessageSquare aria-hidden className="h-4 w-4" />
                <span>{`Ask ${agent.displayName}`}</span>
              </AskCoworkerButton>
            )}
            {recovery && (
              <Link
                href={recovery.href}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
              >
                <Settings2 aria-hidden className="h-4 w-4" />
                {recovery.label}
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
            detail={
              canStartConversation
                ? "Interaction for currently available work."
                : "Interaction declared for this coworker's best-matching work."
            }
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
          <CapabilityCompletenessPanel agentId={agent.agentId} />
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
              <CoworkerProactivityNote />
            }
          />
          <GovernancePanel record={record} />
        </div>
        <div className="space-y-6">
          <PerformancePanel record={record} />
          <DecisionsPanel record={record} />
        </div>
        <MySurfaceBacklogPanel slice={backlogSlice} displayName={agent.displayName} />
      </CoworkerRecordTabs>
    </div>
  );
}
