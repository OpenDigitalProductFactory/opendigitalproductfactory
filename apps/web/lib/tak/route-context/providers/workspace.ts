// apps/web/lib/tak/route-context/providers/workspace.ts
// Workspace-overview & employee page-context providers.
// Extracted verbatim from route-context.ts (page-owned context contract,
// design spec 2026-08-05 Phase 2 PR 2). Behavior unchanged.

import { prisma } from "@dpf/db";

export async function getWorkspaceContext(): Promise<string> {
  const [itemCount, openItems, epicCount, buildCount, productCount, providerCount] = await Promise.all([
    prisma.backlogItem.count(),
    prisma.backlogItem.count({ where: { status: { in: ["open", "in-progress"] } } }),
    prisma.epic.count(),
    prisma.featureBuild.count({ where: { phase: { notIn: ["complete", "failed", "abandoned"] } } }),
    prisma.digitalProduct.count(),
    prisma.modelProvider.count({ where: { status: "active" } }),
  ]);

  return [
    "\nPAGE DATA — Workspace Overview:",
    `Backlog: ${itemCount} items total, ${openItems} open/in-progress across ${epicCount} epics`,
    `Products: ${productCount} digital products registered`,
    `Builds: ${buildCount} active feature builds`,
    `AI: ${providerCount} active providers`,
  ].join("\n");
}
export async function getEmployeeContext(): Promise<string> {
  const employees = await prisma.employeeProfile.findMany({
    orderBy: { displayName: "asc" },
    select: { displayName: true, position: { select: { title: true } }, department: { select: { name: true } } },
    take: 30,
  });

  return [
    "\nPAGE DATA — Employees:",
    `${employees.length} employee profiles`,
    "",
    ...employees.map((e) => `- ${e.displayName}: ${e.position?.title ?? "no title"}, ${e.department?.name ?? "no dept"}`),
  ].join("\n");
}
