// apps/web/lib/actions/skills-observatory.ts
// Data fetchers for the TAK Skills Observatory (/platform/ai/skills).
// Collects skills from route context map, build activities, and tool executions.
"use server";

import { prisma } from "@dpf/db";
import { ROUTE_CONTEXT_MAP, UNIVERSAL_SKILLS } from "@/lib/tak/route-context-map";
import { SPECIALIST_AGENT_IDS } from "@/lib/integrate/specialist-prompts";

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
};

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
    select: { id: true, agentId: true, toolName: true, success: true, durationMs: true, routeContext: true, createdAt: true },
  });

  return executions.map((e) => ({
    id: e.id,
    agentId: e.agentId,
    toolName: e.toolName,
    success: e.success,
    durationMs: e.durationMs,
    routeContext: e.routeContext,
    createdAt: e.createdAt.toISOString(),
  }));
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
