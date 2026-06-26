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
import { loadCoworkerRecord } from "@/lib/coworker-record/load-record";
import { loadFamilyCorpusSignals } from "@/lib/coworker-record/corpus-signals";
import { resolveInstallVariantContext } from "@/lib/decision-perspective/install-variant-context";
import { CoworkerRecordTabs, type CoworkerTab } from "@/components/platform/coworker-record/CoworkerRecordTabs";
import {
  OverviewPanel,
  ProfessionPanel,
  CapabilitiesPanel,
  GovernancePanel,
  PerformancePanel,
  DecisionsPanel,
} from "@/components/platform/coworker-record/panels";

const TIER_LABELS: Record<number, string> = {
  1: "Orchestrator",
  2: "Specialist",
  3: "Cross-cutting",
};

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
  const [corpusSignals, installVariant] = await Promise.all([
    profession.family ? loadFamilyCorpusSignals(profession.family.professionKey) : null,
    resolveInstallVariantContext(prisma),
  ]);

  // Model-routing card data (kept page-side: needs the live provider catalog).
  const [session, modelConfig, lastModelRows, activeProviders] = await Promise.all([
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
  ]);

  const canWrite = !!session?.user && can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_platform",
  );

  const providerNames: Record<string, string> = {};
  for (const p of activeProviders) providerNames[p.providerId] = p.name;
  const lastModelRow = lastModelRows[0];
  const lastModelLabel = lastModelRow
    ? `${lastModelRow.providerId} (${providerNames[lastModelRow.providerId] ?? lastModelRow.providerId})`
    : null;

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

  const coveragePct =
    profession.coverage && profession.coverage.checklist.length > 0
      ? Math.round((profession.coverage.pageCount / profession.coverage.checklist.length) * 100)
      : null;

  const tabs: CoworkerTab[] = [
    { id: "overview", label: "Overview" },
    { id: "profession", label: "Profession & Knowledge", badge: coveragePct !== null ? `${coveragePct}%` : profession.family ? null : "unmapped" },
    { id: "capabilities", label: "Capabilities", badge: String(agent.toolGrants.length) },
    { id: "governance", label: "Governance" },
    { id: "performance", label: "Performance" },
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
      </div>

      {agent.description && (
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 10, maxWidth: 720 }}>{agent.description}</p>
      )}

      <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 20 }}>
        <span>ID: <code style={{ fontSize: 10 }}>{agent.agentId}</code></span>
        {gaid && <span style={{ marginLeft: 12 }}>GAID: <code style={{ fontSize: 10 }}>{gaid}</code></span>}
        {agent.slugId && <span style={{ marginLeft: 12 }}>Slug: <code style={{ fontSize: 10 }}>{agent.slugId}</code></span>}
      </div>

      <CoworkerRecordTabs tabs={tabs}>
        <OverviewPanel record={record} />
        <ProfessionPanel record={record} corpusSignals={corpusSignals} installArchetype={installVariant.archetype ?? null} />
        <CapabilitiesPanel record={record} routingCard={routingCard} />
        <GovernancePanel record={record} />
        <PerformancePanel record={record} />
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
