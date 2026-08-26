// apps/web/lib/actions/skills-observatory.ts
// Data fetchers for the TAK Skills Observatory (/platform/ai/skills).
// Collects skills from route context map, build activities, and tool executions.
"use server";

import { prisma } from "@dpf/db";
import { ROUTE_CONTEXT_MAP, UNIVERSAL_SKILLS } from "@/lib/tak/route-context-map";
import { SPECIALIST_AGENT_IDS } from "@/lib/build/specialist-prompts";
import type {
  SkillEvidenceResult,
  SkillEvidenceSearchInput,
} from "@/lib/skills/evidence-search";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SkillEntry = {
  label: string;
  description: string;
  capability: string | null;
  prompt: string;
  taskType: string;
  route: string;
  audience: "user" | "universal" | "specialist-internal";
};

export type FinishingPassEntry = {
  id: string;
  buildId: string;
  tool: string;
  summary: string;
  createdAt: string;
  passType: string | null;
};

export type SkillExecutionEntry = {
  id: string;
  agentId: string;
  toolName: string;
  success: boolean;
  durationMs: number | null;
  routeContext: string | null;
  createdAt: string;
  /**
   * Governed Hermes learning Slice 1: business skill id when this tool call
   * was attributed to an active coworker skill. Null for tool calls outside
   * an explicit skill invocation.
   */
  skillId: string | null;
};

export type SkillTelemetrySummary = {
  totalUsageEvents: number;
  eligibleEvents: number;
  loadedEvents: number;
  invokedEvents: number;
  completedEvents: number;
  failedEvents: number;
  metricRowCount: number;
  /** Distinct (skillId, agentId) pairs that have recorded usage in the current period. */
  activeSkillCount: number;
  /** Period key of the latest SkillMetric row, or null if SkillMetric is empty. */
  latestMetricPeriod: string | null;
};

export type SkillSeedWarningEntry = {
  id: string;
  warningId: string;
  skillId: string;
  warningType: string;
  message: string;
  legacyPath: string | null;
  pluginPath: string | null;
  sourceType: string;
  createdAt: string;
};

export type SkillReviewEvidenceScope = Pick<
  SkillEvidenceSearchInput,
  "threadId" | "taskRunId" | "routeContext" | "query" | "limit"
>;

// ─── Fetchers ───────────────────────────────────────────────────────────────

/** Collects all skills: universal, route-specific user-facing, and specialist-internal. */
export async function getSkillsCatalog(): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];

  for (const s of UNIVERSAL_SKILLS) {
    skills.push({
      label: s.label,
      description: s.description,
      capability: s.capability,
      prompt: s.prompt,
      taskType: s.taskType ?? "conversation",
      route: "*",
      audience: "universal",
    });
  }

  for (const [route, ctx] of Object.entries(ROUTE_CONTEXT_MAP)) {
    for (const s of ctx.skills) {
      skills.push({
        label: s.label,
        description: s.description,
        capability: s.capability,
        prompt: s.prompt,
        taskType: s.taskType ?? "conversation",
        route,
        audience: "user",
      });
    }
  }

  // Specialist-internal finishing passes (defined in AGT-BUILD-FE prompt)
  const FINISHING_PASSES = [
    { label: "Design Token Compliance", description: "Scan for hardcoded hex colors, replace with var(--dpf-*) tokens" },
    { label: "Accessibility Pass", description: "Verify aria-labels, real buttons, focus rings, tab panel ARIA" },
    { label: "Loading & Empty States", description: "Ensure every async op has spinner/skeleton, empty lists have messages" },
    { label: "Responsive & Polish", description: "Check breakpoints, hover states, animations, touch targets" },
  ];
  for (const fp of FINISHING_PASSES) {
    skills.push({
      label: fp.label,
      description: fp.description,
      capability: null,
      prompt: "(specialist-internal -- runs automatically during build phase)",
      taskType: "code_generation",
      route: "/build",
      audience: "specialist-internal",
    });
  }

  return skills;
}

/** Fetches recent finishing pass activity from BuildActivity logs. */
export async function getFinishingPassActivity(limit = 50): Promise<FinishingPassEntry[]> {
  const activities = await prisma.buildActivity.findMany({
    where: {
      tool: { in: ["uxAccessibilityAudit", "runBuildPipeline", "generate_code"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, buildId: true, tool: true, summary: true, createdAt: true },
  });

  return activities.map((a) => ({
    id: a.id,
    buildId: a.buildId,
    tool: a.tool,
    summary: a.summary,
    createdAt: a.createdAt.toISOString(),
    passType: inferPassType(a.tool, a.summary),
  }));
}

function inferPassType(tool: string, summary: string): string | null {
  if (tool === "uxAccessibilityAudit") return "accessibility";
  const lower = summary.toLowerCase();
  if (lower.includes("token") || lower.includes("color")) return "design-tokens";
  if (lower.includes("responsive") || lower.includes("breakpoint")) return "responsive";
  if (lower.includes("loading") || lower.includes("skeleton")) return "loading-states";
  return null;
}

/** Fetches recent tool executions by build specialists. */
export async function getSpecialistExecutions(limit = 100): Promise<SkillExecutionEntry[]> {
  const specialistIds = Object.values(SPECIALIST_AGENT_IDS);

  const executions = await prisma.toolExecution.findMany({
    where: { agentId: { in: specialistIds } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      agentId: true,
      toolName: true,
      success: true,
      durationMs: true,
      routeContext: true,
      createdAt: true,
      skillId: true,
    },
  });

  return executions.map((e) => ({
    id: e.id,
    agentId: e.agentId,
    toolName: e.toolName,
    success: e.success,
    durationMs: e.durationMs,
    routeContext: e.routeContext,
    createdAt: e.createdAt.toISOString(),
    skillId: e.skillId,
  }));
}

/**
 * Governed Hermes learning Slice 3: per-skill detail bundle for the
 * proposals/revisions/seed-drift panel. Returns null when the skill does
 * not exist so the caller can render a clean empty state.
 */
export async function getSkillReviewDetail(
  skillId: string,
  evidenceScope: SkillReviewEvidenceScope = {},
): Promise<{
  skillId: string;
  skillMdContent: string;
  category: string;
  proposals: Awaited<ReturnType<typeof import("@/lib/skills/proposals").listSkillProposals>>;
  revisions: Awaited<ReturnType<typeof import("@/lib/skills/proposals").listSkillRevisions>>;
  seedDrift: Awaited<ReturnType<typeof import("@/lib/skills/seed-parity").getSkillSeedDrift>>;
  evidence: SkillEvidenceResult[];
} | null> {
  const skill = await prisma.skillDefinition.findUnique({
    where: { skillId },
    select: { skillId: true, skillMdContent: true, category: true },
  });
  if (!skill) return null;

  const { listSkillProposals, listSkillRevisions } = await import("@/lib/skills/proposals");
  const { getSkillSeedDrift } = await import("@/lib/skills/seed-parity");
  const { searchSkillEvidence } = await import("@/lib/skills/evidence-search");
  const [proposals, revisions, seedDrift, evidence] = await Promise.all([
    listSkillProposals(skillId),
    listSkillRevisions(skillId),
    getSkillSeedDrift(skillId),
    searchSkillEvidence({
      skillId,
      threadId: evidenceScope.threadId,
      taskRunId: evidenceScope.taskRunId,
      routeContext: evidenceScope.routeContext,
      query: evidenceScope.query,
      limit: evidenceScope.limit ?? 25,
    }),
  ]);

  return {
    skillId: skill.skillId,
    skillMdContent: skill.skillMdContent,
    category: skill.category,
    proposals,
    revisions,
    seedDrift,
    evidence,
  };
}

/**
 * Governed Hermes learning Slice 4: shape SkillDefinition.lifecycleState for
 * a single skill so the operator UI can render lifecycle controls. Returns
 * null when the skill does not exist.
 */
export async function getSkillLifecycleState(skillId: string): Promise<{
  skillId: string;
  lifecycleState: string;
} | null> {
  const row = await prisma.skillDefinition.findUnique({
    where: { skillId },
    select: { skillId: true, lifecycleState: true },
  });
  return row;
}

/**
 * Governed Hermes learning Slice 4: read the latest curator report. Delegates
 * to apps/web/lib/skills/curator.ts so this action layer stays free of
 * artifact-shape knowledge.
 */
export async function getLatestSkillCuratorReport() {
  const { getLatestCuratorReport } = await import("@/lib/skills/curator");
  return getLatestCuratorReport();
}

/** Pending seed-time conflicts that need operator migration follow-up. */
export async function getSkillSeedWarnings(limit = 25): Promise<SkillSeedWarningEntry[]> {
  const rows = await prisma.skillSeedWarning.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      warningId: true,
      skillId: true,
      warningType: true,
      message: true,
      legacyPath: true,
      pluginPath: true,
      sourceType: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Governed Hermes learning Slice 1: shape SkillUsageEvent + SkillMetric for
 * the observatory's telemetry tab. Returns aggregate counts only — per-row
 * inspection lives in the Skills detail view (later slice).
 */
export async function getSkillTelemetrySummary(): Promise<SkillTelemetrySummary> {
  const [grouped, metricCount, latestMetric, activeAgg] = await Promise.all([
    prisma.skillUsageEvent.groupBy({ by: ["phase"], _count: { _all: true } }),
    prisma.skillMetric.count(),
    prisma.skillMetric.findFirst({ orderBy: { period: "desc" }, select: { period: true } }),
    prisma.skillMetric.groupBy({ by: ["skillId", "agentId"], _count: { _all: true } }),
  ]);

  const byPhase = new Map(grouped.map((g) => [g.phase, g._count._all]));
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0);

  return {
    totalUsageEvents: total,
    eligibleEvents: byPhase.get("eligible") ?? 0,
    loadedEvents: byPhase.get("loaded") ?? 0,
    invokedEvents: byPhase.get("invoked") ?? 0,
    completedEvents: byPhase.get("completed") ?? 0,
    failedEvents: byPhase.get("failed") ?? 0,
    metricRowCount: metricCount,
    activeSkillCount: activeAgg.length,
    latestMetricPeriod: latestMetric?.period ?? null,
  };
}

/** Summary stats for the observatory header. */
export async function getSkillsObservatoryStats() {
  const catalog = await getSkillsCatalog();
  const [toolExecCount, buildActivityCount] = await Promise.all([
    prisma.toolExecution.count({ where: { agentId: { in: Object.values(SPECIALIST_AGENT_IDS) } } }),
    prisma.buildActivity.count(),
  ]);

  return {
    totalSkills: catalog.length,
    userFacing: catalog.filter((s) => s.audience === "user").length,
    universal: catalog.filter((s) => s.audience === "universal").length,
    specialistInternal: catalog.filter((s) => s.audience === "specialist-internal").length,
    routes: new Set(catalog.map((s) => s.route)).size,
    totalToolExecutions: toolExecCount,
    totalBuildActivities: buildActivityCount,
  };
}

/**
 * Pending skill proposals, projected as attention items so the catalog can link
 * straight to the decision (BI-2F9EE2E9). The catalog previously gave no sign a
 * proposal existed, and its detail view is reachable only via `?skill=`.
 */
export async function getPendingSkillProposals() {
  const { loadSkillProposalItems } = await import("@/lib/attention/sources/skill-proposal");
  return loadSkillProposalItems(prisma);
}
