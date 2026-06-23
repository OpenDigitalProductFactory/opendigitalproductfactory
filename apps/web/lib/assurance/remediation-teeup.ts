// apps/web/lib/assurance/remediation-teeup.ts
//
// P1 of the assurance remediation loop (BI-7C121CCF): get auto-filed assurance
// findings WORKED, not just created. The assurance gate (PR #2290) auto-files
// genuine high/critical findings as backlog items in status=triaging — but the
// general governed tee-up only promotes status=open + triageOutcome=build items
// at a fixed 14:00 cron, so the auto-filed BIs sit unworked.
//
// This is a DEDICATED off-hours, budget-capped lane that promotes them into
// Build Studio (which builds the dependency-override bump → PR). NO auto-merge
// here — that is P2 (WWMD-gated). Founder rails: off-hours/flexible, incremental,
// budget cap. Reuses promoteBacklogItemToBuildDraft (don't reinvent) + the
// self-upgrade off-hours window primitives.

import type { MaintenanceWindow } from "@/lib/self-upgrade/config";
import { isWithinWindows } from "@/lib/self-upgrade/windows-eval";
import { promoteBacklogItemToBuildDraft } from "@/lib/governed-backlog-tee-up";

/** Body marker the shared backlog front door stamps on assurance-gate auto-files. */
export const ASSURANCE_ORIGIN_MARKER = "[origin:assuranceFinding:";

// Platform off-hours (UTC). An hourly cron acts only inside this window, so the
// lane runs "off-hours, flexible, not a single fixed slot" (founder rail). The
// dispatcher itself is light (DB writes + an event); the builds it triggers are
// concurrency-capped by the build pipeline, so window overlap with maintenance
// is acceptable.
const PLATFORM_OFFHOURS_UTC: MaintenanceWindow = {
  dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startTime: "02:00",
  endTime: "06:00",
};

/** True when `now` is inside the platform off-hours window (evaluated in UTC). */
export function isAssuranceRemediationWindowOpen(now: Date): boolean {
  return isWithinWindows([PLATFORM_OFFHOURS_UTC], now, "UTC");
}

/** Default per-run budget: how many remediations to promote on one tick. */
export const DEFAULT_ASSURANCE_REMEDIATION_BUDGET = 2;

/** Per-run budget cap (founder rail: budget control). Env-tunable; a richer
 *  spend-based budget (spend-intelligence) is a later phase. */
export function resolveRemediationBudget(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.ASSURANCE_REMEDIATION_BUDGET;
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_ASSURANCE_REMEDIATION_BUDGET;
}

export interface RemediationCandidate {
  id: string;
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  proposedOutcome: string | null;
  activeBuildId: string | null;
  effortSize: string | null;
  createdAt: Date;
}

/** Severity rank parsed from the auto-file body ("Severity: HIGH"); lower = first. */
function severityRank(body: string | null): number {
  const m = /Severity:\s*(CRITICAL|HIGH|MEDIUM|LOW)/i.exec(body ?? "");
  switch ((m?.[1] ?? "").toUpperCase()) {
    case "CRITICAL":
      return 0;
    case "HIGH":
      return 1;
    case "MEDIUM":
      return 2;
    default:
      return 3;
  }
}

function isEligible(item: RemediationCandidate): boolean {
  return (
    item.status === "triaging" &&
    item.proposedOutcome === "build" &&
    item.activeBuildId == null &&
    typeof item.body === "string" &&
    item.body.includes(ASSURANCE_ORIGIN_MARKER)
  );
}

/**
 * Rank eligible assurance-remediation candidates (critical first, then oldest,
 * then id for determinism) and cap at the budget. Pure — the heart of the lane.
 */
export function selectAssuranceRemediationCandidates(
  items: RemediationCandidate[],
  budget: number,
): RemediationCandidate[] {
  if (budget <= 0) return [];
  return items
    .filter(isEligible)
    .sort((a, b) => {
      const sev = severityRank(a.body) - severityRank(b.body);
      if (sev !== 0) return sev;
      const created = a.createdAt.getTime() - b.createdAt.getTime();
      if (created !== 0) return created;
      return a.itemId.localeCompare(b.itemId);
    })
    .slice(0, budget);
}

// ── orchestration ───────────────────────────────────────────────────────────

type PromoteResult = Awaited<ReturnType<typeof promoteBacklogItemToBuildDraft>>;
type PromoteTx = Parameters<typeof promoteBacklogItemToBuildDraft>[0]["tx"];

// `any` args mirror the proven governed-backlog-tee-up.ts prisma shim so the real
// PrismaClient is assignable when the inngest fn passes it; returns stay typed.
type RemediationPrisma = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platformDevConfig: { findUnique(args: any): Promise<{ governedBacklogEnabled: boolean | null } | null> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  backlogItem: { findMany(args: any): Promise<RemediationCandidate[]> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction<T>(cb: (tx: any) => Promise<T>): Promise<T>;
};

export type PromoteRemediationItem = (args: {
  prisma: RemediationPrisma;
  itemId: string;
  userId: string;
}) => Promise<PromoteResult>;

// Default promote: set the triaging auto-file BI to open + triageOutcome=build
// (the governed triage decision for this lane), then reuse the shared promote
// path — ATOMICALLY, so a promote failure rolls the triage transition back and
// never leaves an orphaned open+build BI the general 14:00 tee-up could grab.
const defaultPromote: PromoteRemediationItem = ({ prisma, itemId, userId }) =>
  prisma.$transaction(async (tx) => {
    const t = tx as PromoteTx;
    await t.backlogItem.update({
      where: { itemId },
      data: { status: "open", triageOutcome: "build" },
    });
    return promoteBacklogItemToBuildDraft({
      tx: t,
      itemId,
      userId,
      governedBacklogEnabled: true,
      activity: {
        tool: "assurance_remediation_tee_up",
        summary: `Auto-promoted assurance remediation ${itemId} (off-hours lane).`,
      },
    });
  });

export interface RunAssuranceRemediationTeeUpResult {
  enabled: boolean;
  selectedCount: number;
  promotedCount: number;
  skippedCount: number;
  builds: Array<{ backlogItemId: string; buildId: string }>;
}

/**
 * Select + promote a budgeted batch of auto-filed assurance remediations into
 * Build Studio. Gated on governedBacklogEnabled (the same opt-in the general
 * tee-up uses). The caller gates the off-hours window + quiescence.
 */
export async function runAssuranceRemediationTeeUp(input: {
  prisma: RemediationPrisma;
  userId: string;
  budget: number;
  promote?: PromoteRemediationItem;
}): Promise<RunAssuranceRemediationTeeUpResult> {
  const { prisma, userId, budget } = input;
  const promote = input.promote ?? defaultPromote;

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { governedBacklogEnabled: true },
  });
  if (config?.governedBacklogEnabled !== true || budget <= 0) {
    return { enabled: false, selectedCount: 0, promotedCount: 0, skippedCount: 0, builds: [] };
  }

  const items = await prisma.backlogItem.findMany({
    where: {
      status: "triaging",
      proposedOutcome: "build",
      activeBuildId: null,
      body: { contains: ASSURANCE_ORIGIN_MARKER },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      itemId: true,
      title: true,
      body: true,
      status: true,
      proposedOutcome: true,
      activeBuildId: true,
      effortSize: true,
      createdAt: true,
    },
  });

  const selected = selectAssuranceRemediationCandidates(items, budget);
  const builds: Array<{ backlogItemId: string; buildId: string }> = [];
  let skippedCount = 0;

  for (const item of selected) {
    const result = await promote({ prisma, itemId: item.itemId, userId });
    if (result.kind === "success") {
      builds.push({ backlogItemId: result.backlogItemId, buildId: result.build.buildId });
    } else {
      skippedCount += 1;
    }
  }

  return {
    enabled: true,
    selectedCount: selected.length,
    promotedCount: builds.length,
    skippedCount,
    builds,
  };
}
