// apps/web/lib/tak/route-context/providers/ops.ts
// Operations page-context providers (backlog + dev-loop runtime map).
// Extracted verbatim from route-context.ts (page-owned context contract,
// design spec 2026-08-05 Phase 2 PR 2). Behavior unchanged.

import { prisma } from "@dpf/db";

export async function getOpsContext(): Promise<string> {
  const [epics, items] = await Promise.all([
    prisma.epic.findMany({
      where: { status: "open" },
      select: { epicId: true, title: true, id: true },
    }),
    prisma.backlogItem.findMany({
      orderBy: [{ priority: "asc" }, { status: "asc" }],
      select: { itemId: true, title: true, status: true, type: true, priority: true, epicId: true },
      take: 60,
    }),
  ]);

  const epicMap = new Map(epics.map((e) => [e.id, e]));
  const assigned = items.filter((i) => i.epicId);
  const unassigned = items.filter((i) => !i.epicId);

  const epicLines = epics.map((e) => {
    const epicItems = items.filter((i) => i.epicId === e.id);
    return `- ${e.epicId}: ${e.title} (${epicItems.length} items)`;
  });

  const itemLines = items.map((i) => {
    const epic = i.epicId ? epicMap.get(i.epicId) : null;
    return `- ${i.itemId} [${i.status}] ${i.title}${epic ? ` (epic: ${epic.epicId})` : " (NO EPIC)"}`;
  });

  return [
    "\nPAGE DATA — Operations Backlog:",
    `${items.length} backlog items (${assigned.length} assigned to epics, ${unassigned.length} unassigned):`,
    "",
    "EPICS:",
    ...epicLines,
    "",
    "ALL BACKLOG ITEMS:",
    ...itemLines,
  ].join("\n");
}
// /ops/dev-loop — the runtime coordination map. Mirrors the data the page
// renders (apps/web/app/(shell)/ops/dev-loop/page.tsx getData): RuntimeTargets
// grouped by lifecycle + active NonProductionEnvironmentLeases, plus the janitor
// rules so the coworker can reason about staleness (e.g. why several targets
// show "running" on the same port — stale ones await the 2h-no-heartbeat sweep).
// BI-FD7E4D72 / BI-AD949172.
export async function getDevLoopContext(): Promise<string> {
  const [targets, leases] = await Promise.all([
    prisma.runtimeTarget.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        targetId: true,
        kind: true,
        status: true,
        hostUrl: true,
        lastHeartbeatAt: true,
        expiresAt: true,
        updatedAt: true,
        workCapsule: { select: { headBranch: true } },
        featureBuild: { select: { buildId: true } },
      },
    }),
    prisma.nonProductionEnvironmentLease.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        leaseId: true,
        environmentKey: true,
        status: true,
        ownerProvider: true,
        purpose: true,
        branchName: true,
        worktreePath: true,
        expiresAt: true,
        releasedAt: true,
      },
    }),
  ]);

  const now = Date.now();
  const ageHours = (d: Date | null): string =>
    d ? `${Math.round(((now - d.getTime()) / 3_600_000) * 10) / 10}h ago` : "never";

  const ACTIVE = ["running", "starting", "verifying", "assigned"];
  const STALE = ["expired", "failed"];
  const INACTIVE = ["planned", "verified", "released"];

  const fmtTarget = (t: (typeof targets)[number]): string => {
    const branch = t.workCapsule?.headBranch ? ` branch=${t.workCapsule.headBranch}` : "";
    const build = t.featureBuild?.buildId ? ` build=${t.featureBuild.buildId}` : "";
    const url = t.hostUrl ? ` url=${t.hostUrl}` : "";
    return `- ${t.targetId} [${t.kind}/${t.status}]${url} lastHeartbeat=${ageHours(t.lastHeartbeatAt)}${branch}${build}`;
  };

  const active = targets.filter((t) => ACTIVE.includes(t.status));
  const stale = targets.filter((t) => STALE.includes(t.status));
  const inactive = targets.filter((t) => INACTIVE.includes(t.status));
  const activeLeases = leases.filter((l) => l.status === "active" && !l.releasedAt);

  const leaseLines = activeLeases.map(
    (l) =>
      `- ${l.environmentKey} (${l.leaseId}) provider=${l.ownerProvider}` +
      `${l.branchName ? ` branch=${l.branchName}` : ""} purpose="${l.purpose}" expires=${ageHours(l.expiresAt).replace(" ago", " from update")}`,
  );

  return [
    "\nPAGE DATA — Dev Loop (runtime coordination map):",
    "This page shows governed RuntimeTargets and non-prod environment leases, not the backlog.",
    "",
    `ACTIVE RUNTIME TARGETS (${active.length}) — status in running/starting/verifying/assigned:`,
    ...(active.length ? active.map(fmtTarget) : ["- (none)"]),
    "",
    `STALE / FAILED TARGETS (${stale.length}) — status expired/failed:`,
    ...(stale.length ? stale.map(fmtTarget) : ["- (none)"]),
    "",
    `INACTIVE TARGETS (${inactive.length}) — status planned/verified/released:`,
    ...(inactive.length ? inactive.map(fmtTarget) : ["- (none)"]),
    "",
    `ACTIVE NON-PROD LEASES (${activeLeases.length}):`,
    ...(leaseLines.length ? leaseLines : ["- (none)"]),
    "",
    "JANITOR RULES (runtimeTargetJanitor, BI-AD949172): running/starting + no heartbeat for 2h → expired; planned + no consumer for 7 days → released; lease past expiresAt → expired. So several targets can show the SAME status (e.g. running) and even the same URL/port concurrently — multiple build sandboxes register their own target on the shared sandbox port; a 'running' target whose lastHeartbeat is hours/days old is stale and simply has not been swept to 'expired' yet. Cross-check status against lastHeartbeat before assuming a target is live. Use get_runtime_coordination_map for the full live record (verifications, capsule/build linkage).",
  ].join("\n");
}
