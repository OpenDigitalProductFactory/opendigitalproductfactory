/**
 * Autonomous MDM stewardship engine (EP-4A12A7CB slice 4, BI-87C655D1).
 *
 * The steward queue (steward.ts) is the human workflow; THIS is the coworker
 * that works it down without being asked. Run on a schedule (the Inngest
 * mdm-steward-sweep cron) or on demand by the Data Steward coworker, it:
 *   1. runs the sweep (populates MdmStewardTask),
 *   2. auto-resolves account duplicates it is confident about — full autonomy
 *      incl. fuzzy matches (operator decision 2026-07-06),
 *   3. leaves genuinely ambiguous / higher-risk cases for a human.
 *
 * "Full autonomy" here is autonomous-AND-accountable, not blind:
 *   - every auto-merge writes an `account_auto_merged` Activity + attribute
 *     history, and is reversible via unmerge (the undo);
 *   - a per-run CAP bounds blast radius — a scoring regression can corrupt at
 *     most MAX_AUTO_MERGES_PER_RUN records before the overflow escalates;
 *   - a conflicting-domain guardrail escalates instead of merging: if a fuzzy
 *     name match has two DIFFERENT web domains, that is two real companies
 *     whose names collide, not a duplicate;
 *   - contact duplicates are identity-bearing (credentials, social identities)
 *     — a carve-out escalates them to a human even under full autonomy.
 * Everything auto-resolved surfaces in the retro-review digest.
 */
import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { runStewardSweep, type SweepSummary } from "./steward";
import { mergeRecords, MergeValidationFailure } from "./merge";

/** Blast-radius cap: at most this many auto-merges per run; rest escalate. */
export const MAX_AUTO_MERGES_PER_RUN = 25;

/** System actor id recorded on autonomous actions. */
export const DATA_STEWARD_ACTOR = "data-steward";

export type AutoMergeRecord = {
  taskId: string;
  survivorId: string;
  loserId: string;
  survivorLabel: string;
  loserLabel: string;
  reason: string;
};

export type AutoStewardSummary = {
  sweep: SweepSummary;
  autoMerged: AutoMergeRecord[];
  /** Duplicates left for a human, with why. */
  escalated: Array<{ taskId: string; reason: string }>;
  /** True when the per-run cap was hit (overflow escalated). */
  capped: boolean;
  dryRun: boolean;
};

type AccountForDecision = {
  id: string;
  name: string;
  status: string;
  domainNormalized: string;
  createdAt: Date;
  _count: { contacts: number; opportunities: number; invoices: number };
};

/** Relationship weight — a more-connected record is the better survivor. */
function relations(a: AccountForDecision): number {
  return a._count.contacts + a._count.opportunities + a._count.invoices;
}

/** Status rank — a real customer outranks a prospect as the survivor. */
const STATUS_RANK: Record<string, number> = {
  active: 4,
  at_risk: 3,
  onboarding: 3,
  qualified: 2,
  prospect: 1,
};
function statusRank(s: string): number {
  return STATUS_RANK[s] ?? 0;
}

/**
 * Deterministically pick which of two accounts survives a merge:
 * higher status → more relationships → older (the original). Total order, so
 * the choice is reproducible and defensible in the audit trail.
 */
export function chooseSurvivor(
  a: AccountForDecision,
  b: AccountForDecision,
): { survivor: AccountForDecision; loser: AccountForDecision; reason: string } {
  const byStatus = statusRank(b.status) - statusRank(a.status);
  if (byStatus !== 0) {
    const [survivor, loser] = byStatus > 0 ? [b, a] : [a, b];
    return { survivor, loser, reason: `kept ${survivor.status} over ${loser.status}` };
  }
  const byRel = relations(b) - relations(a);
  if (byRel !== 0) {
    const [survivor, loser] = byRel > 0 ? [b, a] : [a, b];
    return { survivor, loser, reason: `kept the more-connected record (${relations(survivor)} vs ${relations(loser)} related)` };
  }
  const [survivor, loser] = a.createdAt.getTime() <= b.createdAt.getTime() ? [a, b] : [b, a];
  return { survivor, loser, reason: "kept the older record" };
}

async function loadAccount(id: string): Promise<AccountForDecision | null> {
  return prisma.customerAccount.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      domainNormalized: true,
      createdAt: true,
      _count: { select: { contacts: true, opportunities: true, invoices: true } },
    },
  }) as Promise<AccountForDecision | null>;
}

/**
 * Run one autonomous stewardship pass. Idempotent through the sweep's task
 * dedup; safe to run on a schedule. `dryRun` decides nothing destructively —
 * it reports what WOULD auto-merge.
 */
export async function runAutonomousStewardship(
  opts: { dryRun?: boolean } = {},
): Promise<AutoStewardSummary> {
  const dryRun = opts.dryRun ?? false;
  const sweep = await runStewardSweep();

  const openDuplicates = await prisma.mdmStewardTask.findMany({
    where: { status: "open", kind: "duplicate" },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
  });

  const autoMerged: AutoMergeRecord[] = [];
  const escalated: Array<{ taskId: string; reason: string }> = [];
  let capped = false;

  for (const task of openDuplicates) {
    // Identity carve-out: contact merges combine credentials/social identities
    // — a human decides those even under full autonomy.
    if (task.domain !== "customer-account") {
      escalated.push({ taskId: task.taskId, reason: "contact identity merge — human review" });
      continue;
    }
    if (!task.candidateId) {
      escalated.push({ taskId: task.taskId, reason: "no candidate on task" });
      continue;
    }
    if (autoMerged.length >= MAX_AUTO_MERGES_PER_RUN) {
      capped = true;
      escalated.push({ taskId: task.taskId, reason: "per-run cap reached — deferred to next run / human" });
      continue;
    }

    const [a, b] = await Promise.all([loadAccount(task.subjectId), loadAccount(task.candidateId)]);
    if (!a || !b) {
      escalated.push({ taskId: task.taskId, reason: "a record no longer exists" });
      continue;
    }

    // Conflicting-domain guardrail: a fuzzy NAME match whose two records carry
    // DIFFERENT web domains is two real companies, not a duplicate. Escalate.
    if (a.domainNormalized && b.domainNormalized && a.domainNormalized !== b.domainNormalized) {
      escalated.push({
        taskId: task.taskId,
        reason: `different domains (${a.domainNormalized} vs ${b.domainNormalized}) — likely distinct companies`,
      });
      continue;
    }

    const { survivor, loser, reason } = chooseSurvivor(a, b);
    const record: AutoMergeRecord = {
      taskId: task.taskId,
      survivorId: survivor.id,
      loserId: loser.id,
      survivorLabel: survivor.name,
      loserLabel: loser.name,
      reason,
    };

    if (dryRun) {
      autoMerged.push(record);
      continue;
    }

    try {
      const result = await mergeRecords("customer-account", loser.id, survivor.id);
      await prisma.activity.create({
        data: {
          activityId: `ACT-${crypto.randomUUID()}`,
          type: "account_auto_merged",
          subject: `Data Steward auto-merged "${loser.name}" into "${survivor.name}"`,
          body: JSON.stringify({ ...result, autonomyReason: reason, taskId: task.taskId }),
          accountId: survivor.id,
          createdById: null,
        },
      });
      await prisma.mdmStewardTask.update({
        where: { id: task.id },
        data: {
          status: "resolved_merged",
          resolvedBy: DATA_STEWARD_ACTOR,
          resolvedAt: new Date(),
          note: `Auto-merged by Data Steward: ${reason}.`,
        },
      });
      autoMerged.push(record);
    } catch (err) {
      const why = err instanceof MergeValidationFailure ? err.reason : String(err);
      escalated.push({ taskId: task.taskId, reason: `merge failed (${why})` });
    }
  }

  return { sweep, autoMerged, escalated, capped, dryRun };
}

/** Recently auto-resolved actions for the retro-review digest surface. */
export async function listRecentAutoResolutions(sinceDays = 7, take = 50) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.activity.findMany({
    where: { type: "account_auto_merged", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take,
    select: { activityId: true, subject: true, body: true, accountId: true, createdAt: true },
  });
  return rows.map((r) => {
    let loserId: string | null = null;
    let reason: string | null = null;
    try {
      const parsed = JSON.parse(r.body ?? "{}") as { loserId?: string; autonomyReason?: string };
      loserId = parsed.loserId ?? null;
      reason = parsed.autonomyReason ?? null;
    } catch {
      // legacy/non-JSON body — leave nulls
    }
    return {
      activityId: r.activityId,
      subject: r.subject,
      survivorId: r.accountId,
      loserId,
      reason,
      at: r.createdAt,
    };
  });
}
