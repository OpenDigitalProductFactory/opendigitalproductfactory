// apps/web/lib/coworker-record/load-record.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — the per-coworker "employee record"
// aggregator. One server-side function that assembles every facet of a single
// AI coworker into a reviewable record. Spec:
// docs/superpowers/specs/2026-06-13-ai-coworker-hris-management-surface-design.md
//
// Relationship to loadCoworkerProfile (apps/web/lib/mcp-tools.ts): that helper
// serves the MCP JSON contract an LLM consumes (lighter relation set). This
// aggregator serves the management UI (richer relations: executionConfig,
// governanceProfile, performanceProfiles, degradationMappings, promptContext)
// and consolidates what was previously an inline query in the agent detail
// page — so the UI path has one source, not a per-page query. The two share
// the same Agent/skills/grants facets but intentionally serve different
// consumers; they are not duplicated query *shapes* that can silently diverge.

import { prisma } from "@dpf/db";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";
import {
  findProfessionFamilyForAgentIdentity,
  resolveProfessionProfile,
  professionProfileId,
  type ProfessionFamily,
  type ProfessionProfileClient,
} from "@/lib/decision-perspective/resolve-profession-profile";
import type { DecisionPerspectiveProfile } from "@/lib/decision-perspective/types";
import { loadProfessionCoverage, type ProfessionCoverage } from "./coverage";

/** Recommend / arbitrate / escalate / defer tally for a coworker's profile. */
export type DecisionSignal = {
  total: number;
  byOutcome: Record<string, number>;
  /** defer count / total — the corpus-gap demand signal (WSID §4.11 rule 2). */
  deferRate: number;
};

export type CoworkerVoice = {
  status: string;
  provider: string;
  language: string;
  qualityScore: number | null;
} | null;

export type CoworkerProfessionFacet = {
  family: ProfessionFamily | null;
  /** Bound DecisionPerspectiveProfile (kind="profession"), or null if unseeded. */
  profile: DecisionPerspectiveProfile | null;
  profileId: string | null;
  coverage: ProfessionCoverage | null;
};

export type CoworkerRecord = {
  agent: NonNullable<Awaited<ReturnType<typeof loadAgentWithRelations>>>;
  gaid: string | null;
  profession: CoworkerProfessionFacet;
  voice: CoworkerVoice;
  decisions: DecisionSignal;
};

const DECISION_WINDOW_DAYS = 30;

async function loadAgentWithRelations(idOrSlug: string) {
  return prisma.agent.findFirst({
    where: { OR: [{ agentId: idOrSlug }, { slugId: idOrSlug }] },
    include: {
      executionConfig: true,
      skills: { orderBy: { sortOrder: "asc" } },
      toolGrants: { orderBy: { grantKey: "asc" } },
      performanceProfiles: { orderBy: { taskType: "asc" } },
      degradationMappings: { orderBy: { featureRoute: "asc" } },
      promptContext: true,
      coworkerAssessments: { orderBy: { createdAt: "desc" }, take: 10 },
      governanceProfile: {
        include: { capabilityClass: true, directivePolicyClass: true },
      },
      portfolio: { select: { slug: true, name: true } },
      ownerships: {
        where: { responsibility: "owning_team" },
        select: { team: { select: { name: true } } },
        take: 1,
      },
    },
  });
}

async function loadDecisionSignal(profileId: string): Promise<DecisionSignal> {
  const since = new Date(Date.now() - DECISION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.decisionInteraction
    .groupBy({
      by: ["outcomeType"],
      where: { profileId, createdAt: { gte: since } },
      _count: { _all: true },
    })
    .catch(() => [] as Array<{ outcomeType: string; _count: { _all: number } }>);

  const byOutcome: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const n = row._count._all;
    byOutcome[row.outcomeType] = n;
    total += n;
  }
  const defer = byOutcome["defer"] ?? 0;
  return { total, byOutcome, deferRate: total > 0 ? defer / total : 0 };
}

/**
 * Assemble the full coworker record for a coworker detail page. Returns null
 * when no agent matches the id/slug (the page renders notFound()).
 */
export async function loadCoworkerRecord(
  idOrSlug: string,
): Promise<CoworkerRecord | null> {
  const decoded = decodeURIComponent(idOrSlug);
  const agent = await loadAgentWithRelations(decoded);
  if (!agent) return null;

  const family = findProfessionFamilyForAgentIdentity(agent);

  const profileId = family ? professionProfileId(family.professionKey) : null;

  const [gaid, profile, coverage, voiceRow, decisions] = await Promise.all([
    getAgentGaidMap([agent.agentId]).then((m) => m.get(agent.agentId) ?? null),
    family
      ? resolveProfessionProfile({
          // Prisma's overloaded delegate isn't structurally assignable to the
          // narrow injected-client type (which tests satisfy with a fake); the
          // runtime shape matches exactly.
          db: prisma as unknown as ProfessionProfileClient,
          agentId: agent.agentId,
          agentName: agent.name,
          slugId: agent.slugId,
        }).catch(() => null)
      : Promise.resolve(null),
    family ? loadProfessionCoverage(family.professionKey).catch(() => null) : Promise.resolve(null),
    profileId
      ? prisma.voiceProfile
          .findUnique({
            where: { profileId },
            select: { status: true, provider: true, language: true, qualityScore: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    profileId ? loadDecisionSignal(profileId) : Promise.resolve({ total: 0, byOutcome: {}, deferRate: 0 }),
  ]);

  return {
    agent,
    gaid,
    profession: { family: family ?? null, profile, profileId, coverage },
    voice: voiceRow
      ? {
          status: voiceRow.status,
          provider: voiceRow.provider,
          language: voiceRow.language,
          qualityScore: voiceRow.qualityScore,
        }
      : null,
    decisions,
  };
}
