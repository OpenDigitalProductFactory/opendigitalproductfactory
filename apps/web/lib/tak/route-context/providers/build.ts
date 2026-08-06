// apps/web/lib/tak/route-context/providers/build.ts
// Build Studio page-context providers (capsule + build list).
// Extracted verbatim from route-context.ts (page-owned context contract,
// design spec 2026-08-05 Phase 2 PR 2). Behavior unchanged.

import { prisma } from "@dpf/db";

// Scoped context for a specific work capsule page (/build/work/<capsuleId>).
// The generic getBuildContext lists all 10 recent builds; on a capsule page
// that leaks every other active build's tasks into the coworker prompt.
export async function getCapsuleBuildContext(_userId: string, routeContext: string): Promise<string> {
  const capsuleMatch = routeContext.match(/\/build\/work\/(WC-[A-Z0-9]+)/);
  if (!capsuleMatch) return "\nPAGE DATA — Work Capsule:\nNo capsule identified in route.";

  const capsuleId = capsuleMatch[1];
  const capsule = await prisma.workCapsule.findUnique({
    where: { capsuleId },
    select: { title: true, status: true, featureBuildId: true },
  });

  if (!capsule) return `\nPAGE DATA — Work Capsule:\nCapsule ${capsuleId} not found.`;

  const lines = [
    "\nPAGE DATA — Work Capsule:",
    `Capsule: ${capsuleId} — ${capsule.title} (status: ${capsule.status})`,
  ];

  if (capsule.featureBuildId) {
    const build = await prisma.featureBuild.findUnique({
      where: { id: capsule.featureBuildId },
      select: { buildId: true, title: true, phase: true, sandboxPort: true },
    });
    if (build) {
      lines.push(
        `Linked build: ${build.buildId}: ${build.title} [${build.phase}]${build.sandboxPort ? ` (sandbox: port ${build.sandboxPort})` : ""}`,
      );
    } else {
      lines.push("Linked build record not found.");
    }
  } else {
    lines.push("No build linked to this capsule yet.");
  }

  return lines.join("\n");
}
export async function getBuildContext(userId: string): Promise<string> {
  const builds = await prisma.featureBuild.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    select: { buildId: true, title: true, phase: true, sandboxPort: true },
    take: 10,
  });

  if (builds.length === 0) return "\nPAGE DATA — Build Studio:\nNo builds yet. Create one to get started.";

  return [
    "\nPAGE DATA — Build Studio:",
    `${builds.length} builds:`,
    ...builds.map((b) => `- ${b.buildId}: ${b.title} [${b.phase}]${b.sandboxPort ? ` (sandbox: port ${b.sandboxPort})` : ""}`),
  ].join("\n");
}
