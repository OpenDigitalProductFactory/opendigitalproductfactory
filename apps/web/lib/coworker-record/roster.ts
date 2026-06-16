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
  PROFESSION_REGISTRY,
  findProfessionFamilyForAgentIdentity,
  professionProfileId,
} from "@/lib/decision-perspective/resolve-profession-profile";
import { normalizeVariantAxes } from "./variant-axes";

export type RosterRow = {
  agentId: string;
  slugId: string | null;
  name: string;
  tier: number;
  valueStream: string | null;
  lifecycleStage: string;
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

export async function loadRoster(): Promise<{ rows: RosterRow[]; facets: RosterFacets }> {
  const [agents, coverage, modelConfigs, providers, blockerRows] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      select: {
        agentId: true,
        slugId: true,
        name: true,
        tier: true,
        valueStream: true,
        lifecycleStage: true,
      },
    }),
    loadAllCoverage(),
    prisma.agentModelConfig.findMany({ select: { agentId: true, pinnedProviderId: true } }),
    prisma.modelProvider.findMany({ select: { providerId: true, status: true } }),
    prisma.coworkerCapabilityNeed
      .groupBy({
        by: ["agentId"],
        where: { status: { in: ["submitted", "blocked"] } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ agentId: string; _count: { _all: number } }>),
  ]);

  const providerStatus = new Map(providers.map((p) => [p.providerId, p.status]));
  const pinnedByAgent = new Map(modelConfigs.map((c) => [c.agentId, c.pinnedProviderId]));
  const blockersByAgent = new Map(blockerRows.map((b) => [b.agentId, b._count._all]));

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
    const pinned = pinnedByAgent.get(agent.slugId ?? agent.agentId) ?? pinnedByAgent.get(agent.agentId) ?? null;
    const providerHealthy = !pinned || providerStatus.get(pinned) === "active";
    const profileId = fam ? professionProfileId(fam.professionKey) : null;

    return {
      agentId: agent.agentId,
      slugId: agent.slugId,
      name: agent.name,
      tier: agent.tier,
      valueStream: agent.valueStream,
      lifecycleStage: agent.lifecycleStage,
      familyKey: fam?.professionKey ?? null,
      familyLabel: fam?.label ?? null,
      coveragePct,
      jurisdictions: cov ? [...cov.jurisdictions] : [],
      competencies: cov ? [...cov.competencies] : [],
      profileBound: !!fam, // a registered family => a seeded WSID profile id exists by convention
      emptyCorpus: !cov || cov.pageCount === 0,
      providerHealthy,
      openBlockers: blockersByAgent.get(agent.agentId) ?? 0,
      deferRate: profileId ? (deferRates.get(profileId) ?? 0) : 0,
      unmapped: !fam,
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
