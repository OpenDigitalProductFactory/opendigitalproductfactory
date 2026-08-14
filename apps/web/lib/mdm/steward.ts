/**
 * MDM steward queue + staleness sweep (BI-FEA49EC1 / BI-28577CD1).
 *
 * The batch scan (batch-scan.ts) computes duplicate pairs on demand; this
 * module is the WORKFLOW around data quality: persisted MdmStewardTask rows a
 * human reviews and resolves. Two producers —
 *   - the duplicate sweep persists scan pairs as `duplicate` tasks;
 *   - the staleness sweep flags active records not updated in
 *     `staleAfterDays` (match-config) as `stale` tasks —
 * and one consumer: the /admin/data-stewardship surface (+ coworker tools).
 *
 * Tasks are idempotent per (domain, kind, subjectId, candidateId): re-running
 * a sweep refreshes scores on open tasks and never duplicates resolved ones
 * (a pair marked distinct stays resolved until an operator reopens it).
 */
import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { scanCustomerAccountDuplicates, scanCustomerContactDuplicates } from "./batch-scan";
import { loadMatchConfig } from "./match-config";

export type StewardTaskKind = "duplicate" | "stale" | "enrichment";
export type StewardResolution =
  | "resolved_merged"
  | "resolved_distinct"
  | "resolved_refreshed"
  | "resolved_enriched"
  | "dismissed";

export type SweepSummary = {
  duplicatesFound: number;
  duplicateTasksOpened: number;
  staleFound: number;
  staleTasksOpened: number;
};

function newTaskId(): string {
  return `STEW-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/** Upsert an open steward task; refresh score/reasons if already open. */
async function upsertTask(args: {
  domain: string;
  kind: StewardTaskKind;
  subjectId: string;
  candidateId: string; // "" for single-record (stale/enrichment) tasks
  score?: number | null;
  reasons?: unknown;
  note?: string | null;
}): Promise<boolean> {
  const existing = await prisma.mdmStewardTask.findUnique({
    where: {
      domain_kind_subjectId_candidateId: {
        domain: args.domain,
        kind: args.kind,
        subjectId: args.subjectId,
        candidateId: args.candidateId,
      },
    },
  });
  if (existing) {
    if (existing.status === "open") {
      await prisma.mdmStewardTask.update({
        where: { id: existing.id },
        data: {
          score: args.score ?? existing.score,
          reasons: (args.reasons as object) ?? existing.reasons ?? undefined,
        },
      });
    }
    return false; // not newly opened
  }
  await prisma.mdmStewardTask.create({
    data: {
      taskId: newTaskId(),
      domain: args.domain,
      kind: args.kind,
      subjectId: args.subjectId,
      candidateId: args.candidateId,
      score: args.score ?? null,
      reasons: (args.reasons as object) ?? undefined,
      note: args.note ?? null,
    },
  });
  return true;
}

/** Run both sweeps (duplicates + staleness) and persist steward tasks. */
export async function runStewardSweep(): Promise<SweepSummary> {
  const summary: SweepSummary = {
    duplicatesFound: 0,
    duplicateTasksOpened: 0,
    staleFound: 0,
    staleTasksOpened: 0,
  };

  // Duplicate sweep — pairs ordered (a.id < b.id) by the scan, so the
  // idempotency key is stable across runs.
  const [accountPairs, contactPairs] = await Promise.all([
    scanCustomerAccountDuplicates(),
    scanCustomerContactDuplicates(),
  ]);
  for (const [domain, pairs] of [
    ["customer-account", accountPairs],
    ["customer-contact", contactPairs],
  ] as const) {
    for (const pair of pairs) {
      summary.duplicatesFound += 1;
      const opened = await upsertTask({
        domain,
        kind: "duplicate",
        subjectId: pair.a.id,
        candidateId: pair.b.id,
        score: pair.score,
        reasons: pair.reasons,
        note: `${pair.a.label} ↔ ${pair.b.label} (${pair.recommendation})`,
      });
      if (opened) summary.duplicateTasksOpened += 1;
    }
  }

  // Staleness sweep — active records whose updatedAt predates the domain's
  // staleAfterDays window (BI-28577CD1: "Ian may leave Emma3D" nobody notices).
  const accountConfig = await loadMatchConfig("customer-account");
  const cutoff = new Date(Date.now() - accountConfig.staleAfterDays * 24 * 60 * 60 * 1000);

  const staleAccounts = await prisma.customerAccount.findMany({
    where: {
      status: { in: ["active", "at_risk", "onboarding"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, name: true, updatedAt: true },
    take: 200,
  });
  for (const account of staleAccounts) {
    summary.staleFound += 1;
    const opened = await upsertTask({
      domain: "customer-account",
      kind: "stale",
      subjectId: account.id,
      candidateId: "",
      note: `"${account.name}" not updated since ${account.updatedAt.toISOString().slice(0, 10)} — confirm details are still current`,
    });
    if (opened) summary.staleTasksOpened += 1;
  }

  const staleContacts = await prisma.customerContact.findMany({
    where: { isActive: true, mergedIntoId: null, updatedAt: { lt: cutoff } },
    select: { id: true, name: true, email: true, updatedAt: true },
    take: 200,
  });
  for (const contact of staleContacts) {
    summary.staleFound += 1;
    const opened = await upsertTask({
      domain: "customer-contact",
      kind: "stale",
      subjectId: contact.id,
      candidateId: "",
      note: `${contact.name ?? contact.email} not updated since ${contact.updatedAt.toISOString().slice(0, 10)} — still at this company / role?`,
    });
    if (opened) summary.staleTasksOpened += 1;
  }

  return summary;
}

/** Resolve a steward task with an explicit outcome. */
export async function resolveStewardTask(
  taskId: string,
  resolution: StewardResolution,
  resolvedBy: string | null,
  note?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const task = await prisma.mdmStewardTask.findUnique({ where: { taskId } });
  if (!task) return { ok: false, message: `No steward task ${taskId}.` };
  if (task.status !== "open") return { ok: false, message: `${taskId} is already ${task.status}.` };
  await prisma.mdmStewardTask.update({
    where: { id: task.id },
    data: {
      status: resolution,
      resolvedBy,
      resolvedAt: new Date(),
      ...(note ? { note } : {}),
    },
  });
  // A stale task resolved as refreshed touches the record so the next sweep
  // window restarts from now.
  if (task.kind === "stale" && resolution === "resolved_refreshed") {
    const model = task.domain === "customer-account" ? "customerAccount" : "customerContact";
    const delegate = (prisma as unknown as Record<string, { update: (a: unknown) => Promise<unknown> }>)[model];
    try {
      await delegate!.update({ where: { id: task.subjectId }, data: { updatedAt: new Date() } });
    } catch {
      // Record may have been merged/removed since the sweep — task is resolved either way.
    }
  }
  return { ok: true };
}

/** Open tasks for the steward surface, enriched with display labels. */
export async function listOpenStewardTasks(take = 100) {
  const tasks = await prisma.mdmStewardTask.findMany({
    where: { status: "open" },
    orderBy: [{ kind: "asc" }, { score: "desc" }, { createdAt: "asc" }],
    take,
  });

  const accountIds = new Set<string>();
  const contactIds = new Set<string>();
  for (const t of tasks) {
    const bucket = t.domain === "customer-account" ? accountIds : contactIds;
    bucket.add(t.subjectId);
    if (t.candidateId) bucket.add(t.candidateId);
  }
  const [accounts, contacts] = await Promise.all([
    accountIds.size
      ? prisma.customerAccount.findMany({
          where: { id: { in: [...accountIds] } },
          select: { id: true, name: true, status: true },
        })
      : Promise.resolve([]),
    contactIds.size
      ? prisma.customerContact.findMany({
          where: { id: { in: [...contactIds] } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);
  const labels = new Map<string, string>();
  for (const a of accounts) labels.set(a.id, `${a.name} (${a.status})`);
  for (const c of contacts) labels.set(c.id, c.name ?? c.email);

  return tasks.map((t) => ({
    taskId: t.taskId,
    domain: t.domain,
    kind: t.kind as StewardTaskKind,
    subjectId: t.subjectId,
    subjectLabel: labels.get(t.subjectId) ?? t.subjectId,
    candidateId: t.candidateId,
    candidateLabel: t.candidateId ? (labels.get(t.candidateId) ?? t.candidateId) : null,
    score: t.score,
    note: t.note,
    createdAt: t.createdAt,
  }));
}
