// apps/web/lib/coworker-record/roster.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — the AI-workforce directory. Loads every
// coworker annotated with its profession family, corpus-coverage %, and
// fitness signals (profile bound, provider health, open capability blockers,
// defer rate) so the roster can filter by family / competency / jurisdiction /
// lifecycle / coverage-gap and flag fitness-for-duty at a glance. Spec §7.
//
// Rows are plain JSON (no Date/Prisma objects) so they cross to the client
// RosterView without serialization hazards.

import { prisma } from "@dpf/db";
import {
  COWORKER_SLUG_TO_CANONICAL_AGENT_ID,
  resolveAgentIdentity,
  resolveCanonicalAgentId,
} from "@dpf/db/agent-identity";
import {
  PROFESSION_REGISTRY,
  findProfessionFamilyForAgentIdentity,
  professionProfileId,
} from "@/lib/decision-perspective/resolve-profession-profile";
import {
  projectCoworkerAuthority,
  type CoworkerAuthorityProjection,
} from "@/lib/coworker-service-catalog/authority-projection";
import {
  type CoworkerAvailabilityProjection,
} from "@/lib/coworker-service-catalog/availability-projection";
import { loadCoworkerDiscoveryServices } from "@/lib/coworker-service-catalog/catalog";
import { normalizeVariantAxes } from "./variant-axes";
import { loadInstallAvailabilityContext } from "./availability-context";
import type { OwnerFacingArea } from "./owner-areas";
import {
  COWORKER_BLOCKING_CAPABILITY_NEED_STATUSES,
  projectCoworkerDiscovery,
  type CoworkerInteractionProjection,
  type RosterServiceEvidence,
} from "./roster-presentation";

// BI-74FD6420: roster collapses dual-seed slug + AGT-* pairs for display only.
// Seed still creates slug agentId rows for FK consumers (service catalog, etc.).

export type RosterRow = {
  agentId: string;
  slugId: string | null;
  name: string;
  displayName: string;
  kind: string;
  tier: number;
  valueStream: string | null;
  lifecycleStage: string;
  plainJob: string;
  area: OwnerFacingArea;
  areas: OwnerFacingArea[];
  interaction: CoworkerInteractionProjection;
  availability: CoworkerAvailabilityProjection;
  authority: CoworkerAuthorityProjection;
  familyKey: string | null;
  familyLabel: string | null;
  /** Corpus pages / coverage-checklist size, capped at 100; null when unmapped. */
  coveragePct: number | null;
  jurisdictions: string[];
  competencies: string[];
  profileBound: boolean;
  emptyCorpus: boolean;
  providerHealthy: boolean;
  openBlockers: number;
  deferRate: number;
  /** True when the role binds to no profession family (registry-lint gap). */
  unmapped: boolean;
  /** ISO timestamp of the coworker's most recent visible work (last assistant
   *  message or tool execution); null when it has never acted. Plain string so
   *  the row crosses to the client without serialization hazards. */
  lastActiveAt: string | null;
};

export type RosterFacets = {
  families: { key: string; label: string }[];
  valueStreams: string[];
  jurisdictions: string[];
  competencies: string[];
  lifecycleStages: string[];
};

type FamilyCoverage = {
  pageCount: number;
  jurisdictions: Set<string>;
  competencies: Set<string>;
};

const DECISION_WINDOW_DAYS = 30;

/**
 * Drop legacy dual-seed alias rows when their canonical AGT-* twin is present
 * (BI-74FD6420). Pure + exported for unit tests — seed retires the alias rows
 * long-term; this is the belt-and-suspenders roster filter for installs that
 * have not re-seeded yet.
 */
export function dropDualSeedAliasAgents<T extends { agentId: string }>(
  agents: T[],
  slugToCanonical: Readonly<Record<string, string>> = COWORKER_SLUG_TO_CANONICAL_AGENT_ID,
): T[] {
  const present = new Set(agents.map((a) => a.agentId));
  return agents.filter((a) => {
    const canonical = slugToCanonical[a.agentId];
    if (canonical && canonical !== a.agentId && present.has(canonical)) return false;
    return true;
  });
}

/** One query over all profession corpus pages, bucketed by family key. */
async function loadAllCoverage(): Promise<Map<string, FamilyCoverage>> {
  const pages = (await prisma.wikiPage
    .findMany({
      where: { slug: { startsWith: "professions/" }, status: "published" },
      select: { slug: true, metadata: true },
    })
    .catch(() => [])) as Array<{ slug: string; metadata: unknown }>;

  const byFamily = new Map<string, FamilyCoverage>();
  for (const page of pages) {
    const familyKey = page.slug.split("/")[1];
    if (!familyKey) continue;
    let cov = byFamily.get(familyKey);
    if (!cov) {
      cov = { pageCount: 0, jurisdictions: new Set(), competencies: new Set() };
      byFamily.set(familyKey, cov);
    }
    const { jurisdictions, level } = normalizeVariantAxes(page.metadata);
    cov.pageCount += 1;
    for (const j of jurisdictions) cov.jurisdictions.add(j);
    cov.competencies.add(level);
  }
  return byFamily;
}

/** Defer rate per profession profileId over the decision window. */
async function loadDeferRates(profileIds: string[]): Promise<Map<string, number>> {
  if (profileIds.length === 0) return new Map();
  const since = new Date(Date.now() - DECISION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.decisionInteraction
    .groupBy({
      by: ["profileId", "outcomeType"],
      where: { profileId: { in: profileIds }, createdAt: { gte: since } },
      _count: { _all: true },
    })
    .catch(() => [] as Array<{ profileId: string; outcomeType: string; _count: { _all: number } }>);

  const totals = new Map<string, number>();
  const defers = new Map<string, number>();
  for (const r of rows) {
    totals.set(r.profileId, (totals.get(r.profileId) ?? 0) + r._count._all);
    if (r.outcomeType === "defer") defers.set(r.profileId, (defers.get(r.profileId) ?? 0) + r._count._all);
  }
  const rate = new Map<string, number>();
  for (const [pid, total] of totals) rate.set(pid, total > 0 ? (defers.get(pid) ?? 0) / total : 0);
  return rate;
}

/** Most recent visible work per agent — one grouped query over assistant
 *  messages plus one over tool executions, folded to the max timestamp. */
async function loadLastActivity(): Promise<Map<string, Date>> {
  const [messageRows, toolRows] = await Promise.all([
    prisma.agentMessage
      .groupBy({
        by: ["agentId"],
        where: { role: "assistant", agentId: { not: null } },
        _max: { createdAt: true },
      })
      .catch(() => [] as Array<{ agentId: string | null; _max: { createdAt: Date | null } }>),
    prisma.toolExecution
      .groupBy({
        by: ["agentId"],
        _max: { createdAt: true },
      })
      .catch(() => [] as Array<{ agentId: string; _max: { createdAt: Date | null } }>),
  ]);
  const latest = new Map<string, Date>();
  for (const row of [...messageRows, ...toolRows]) {
    if (!row.agentId || !row._max.createdAt) continue;
    const prev = latest.get(row.agentId);
    if (!prev || row._max.createdAt > prev) latest.set(row.agentId, row._max.createdAt);
  }
  return latest;
}

function addByCanonicalAgentId<T>(
  target: Map<string, T[]>,
  agentId: string,
  value: T,
) {
  const canonicalId = resolveCanonicalAgentId(agentId);
  const values = target.get(canonicalId) ?? [];
  values.push(value);
  target.set(canonicalId, values);
}

function setByCanonicalAgentId<T>(
  target: Map<string, T>,
  agentId: string,
  value: T,
) {
  target.set(resolveCanonicalAgentId(agentId), value);
}

export async function loadRoster(): Promise<{ rows: RosterRow[]; facets: RosterFacets }> {
  const [
    agentsRaw,
    coverage,
    modelConfigs,
    providers,
    blockerRows,
    lastActivity,
    services,
    installAvailability,
  ] = await Promise.all([
    prisma.agent.findMany({
      // Exclude archived / retired dual-seed alias rows (BI-74FD6420).
      where: { archived: false, lifecycleStage: { not: "retirement" } },
      orderBy: [{ tier: "asc" }, { displayName: "asc" }],
      select: {
        agentId: true,
        slugId: true,
        name: true,
        displayName: true,
        description: true,
        kind: true,
        tier: true,
        valueStream: true,
        lifecycleStage: true,
        hitlTierDefault: true,
        governanceProfile: { select: { id: true, hitlPolicy: true } },
      },
    }),
    loadAllCoverage(),
    prisma.agentModelConfig.findMany({ select: { agentId: true, pinnedProviderId: true } }),
    prisma.modelProvider.findMany({ select: { providerId: true, status: true } }),
    prisma.coworkerCapabilityNeed
      .groupBy({
        by: ["agentId"],
        where: {
          status: { in: [...COWORKER_BLOCKING_CAPABILITY_NEED_STATUSES] },
        },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ agentId: string; _count: { _all: number } }>),
    loadLastActivity(),
    loadCoworkerDiscoveryServices().catch(() => []),
    loadInstallAvailabilityContext(),
  ]);

  // Belt-and-suspenders: drop any residual dual-seed alias twin still active.
  const agents = dropDualSeedAliasAgents(agentsRaw);

  const providerStatus = new Map(providers.map((p) => [p.providerId, p.status]));
  const pinnedByAgent = new Map<string, string | null>();
  for (const config of modelConfigs) {
    setByCanonicalAgentId(
      pinnedByAgent,
      config.agentId,
      config.pinnedProviderId,
    );
  }
  const blockersByAgent = new Map<string, number>();
  for (const blocker of blockerRows) {
    const canonicalId = resolveCanonicalAgentId(blocker.agentId);
    blockersByAgent.set(
      canonicalId,
      (blockersByAgent.get(canonicalId) ?? 0) + blocker._count._all,
    );
  }
  const servicesByAgent = new Map<string, RosterServiceEvidence[]>();
  for (const service of services) {
    addByCanonicalAgentId(
      servicesByAgent,
      service.providerAgentId,
      service,
    );
  }
  const activityByAgent = new Map<string, Date>();
  for (const [agentId, timestamp] of lastActivity) {
    const canonicalId = resolveCanonicalAgentId(agentId);
    const existing = activityByAgent.get(canonicalId);
    if (!existing || timestamp > existing) {
      activityByAgent.set(canonicalId, timestamp);
    }
  }

  // Distinct families present across the roster → their profile ids for defer rates.
  const presentFamilies = new Set<string>();
  for (const agent of agents) {
    const fam = findProfessionFamilyForAgentIdentity(agent);
    if (fam) presentFamilies.add(fam.professionKey);
  }
  const deferRates = await loadDeferRates([...presentFamilies].map(professionProfileId));

  const rows: RosterRow[] = agents.map((agent) => {
    const fam = findProfessionFamilyForAgentIdentity(agent);
    const cov = fam ? coverage.get(fam.professionKey) : undefined;
    const checklistSize = fam?.coverageChecklist.length ?? 0;
    const coveragePct =
      fam && checklistSize > 0
        ? Math.min(100, Math.round(((cov?.pageCount ?? 0) / checklistSize) * 100))
        : fam
          ? 0
          : null;
    const canonicalId = resolveCanonicalAgentId(agent.agentId);
    const pinned = pinnedByAgent.get(canonicalId) ?? null;
    const providerHealthy = !pinned || providerStatus.get(pinned) === "active";
    const profileId = fam ? professionProfileId(fam.professionKey) : null;
    const openBlockers = blockersByAgent.get(canonicalId) ?? 0;
    const agentServices = servicesByAgent.get(canonicalId) ?? [];
    const discovery = projectCoworkerDiscovery({
      agentDescription: agent.description,
      services: agentServices,
      install: installAvailability,
    });

    return {
      agentId: agent.agentId,
      slugId: agent.slugId,
      name: agent.name,
      // Resolve through agent-identity rather than trusting the persisted
      // column (BI-29F07F46). Agent.displayName is a SNAPSHOT taken at seed
      // time, so an identity correction only reached installs that happened to
      // be re-seeded afterwards — which is why the roster kept showing
      // "EA Architect" after the override was authored. Resolving at read time
      // makes agent-identity.ts the single source of truth in fact and not just
      // by intent, and self-heals every existing install with no data migration.
      displayName: resolveAgentIdentity({
        agentId: agent.agentId,
        name: agent.name,
        slugId: agent.slugId,
        displayName: agent.displayName,
        kind: agent.kind,
        tier: agent.tier ? String(agent.tier) : undefined,
      }).displayName,
      kind: agent.kind,
      tier: agent.tier,
      valueStream: agent.valueStream,
      lifecycleStage: agent.lifecycleStage,
      plainJob: discovery.plainJob,
      area: discovery.area,
      areas: discovery.areas,
      interaction: discovery.interaction,
      availability: discovery.availability,
      authority: projectCoworkerAuthority({
        scope: { kind: "default-posture" },
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
      }),
      familyKey: fam?.professionKey ?? null,
      familyLabel: fam?.label ?? null,
      coveragePct,
      jurisdictions: cov ? [...cov.jurisdictions] : [],
      competencies: cov ? [...cov.competencies] : [],
      profileBound: !!fam, // a registered family => a seeded WSID profile id exists by convention
      emptyCorpus: !cov || cov.pageCount === 0,
      providerHealthy,
      openBlockers,
      deferRate: profileId ? (deferRates.get(profileId) ?? 0) : 0,
      unmapped: !fam,
      lastActiveAt:
        (
          activityByAgent.get(canonicalId)
        )?.toISOString() ?? null,
    };
  });

  const facets: RosterFacets = {
    families: PROFESSION_REGISTRY.families
      .map((f) => ({ key: f.professionKey, label: f.label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    valueStreams: [...new Set(agents.map((a) => a.valueStream).filter((v): v is string => !!v))].sort(),
    jurisdictions: [...new Set(rows.flatMap((r) => r.jurisdictions))].sort(),
    competencies: [...new Set(rows.flatMap((r) => r.competencies))].sort(),
    lifecycleStages: [...new Set(agents.map((a) => a.lifecycleStage))].sort(),
  };

  return { rows, facets };
}
