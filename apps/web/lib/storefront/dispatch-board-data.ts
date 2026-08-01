// apps/web/lib/storefront/dispatch-board-data.ts
//
// EP-3516E23D field-service dispatch — read model for the dispatch board. Reads
// the field-service-job WorkItems on a storefront's dispatch queue and groups
// them into the board columns an operator works from. The grouping is pure so it
// is unit-tested without a DB.

import { dispatchQueueId } from "@/lib/queue/bridges/booking-bridge";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  FIELD_DISPATCH_JOB_STATUS_LABEL,
  FIELD_DISPATCH_SOURCE_TYPE,
  collectPartsUsed,
  isTerminalStatus,
  needsDispatcherAttention,
  parseFieldDispatchEvidence,
  parseFieldDispatchStatus,
  type FieldDispatchJobStatus,
} from "@dpf/validators";

export interface DispatchJobView {
  itemId: string;
  title: string;
  status: FieldDispatchJobStatus;
  statusLabel: string;
  urgency: string;
  dueAt: string | null;
  createdAt: string;
  assigned: boolean;
  assignmentLabel: string;
  partsUsed: number;
  attentionReasons: string[];
}

/** The board's operational lanes, in dispatcher workflow order. */
export const DISPATCH_COLUMNS = [
  { key: "needs-dispatch", label: "Needs dispatch" },
  { key: "ready", label: "Ready" },
  { key: "active", label: "En route / on site" },
  { key: "complete", label: "Work done" },
  { key: "settled", label: "Billed / paid" },
] as const;

export type DispatchColumnKey = (typeof DISPATCH_COLUMNS)[number]["key"];

export interface DispatchBoardSummary {
  needsAttention: number;
  unassigned: number;
  active: number;
  readyToInvoice: number;
  partsUsed: number;
}

export interface DispatchBoard {
  columns: Array<{ key: DispatchColumnKey; label: string; jobs: DispatchJobView[] }>;
  total: number;
  summary: DispatchBoardSummary;
  nextJob: DispatchJobView | null;
  routeStops: DispatchJobView[];
}

const ASSIGNABLE: ReadonlySet<FieldDispatchJobStatus> = new Set(["scheduled", "confirmed"]);
const ACTIVE: ReadonlySet<FieldDispatchJobStatus> = new Set(["en-route", "on-site"]);

function assertNeverStatus(status: never): never {
  throw new Error(`Unhandled field-dispatch status: ${status}`);
}

/** Map a raw WorkItem status to its board lane through the field-dispatch contract. */
export function columnForStatus(status: string): DispatchColumnKey {
  const parsed = parseFieldDispatchStatus(status);
  switch (parsed) {
    case "quoted":
    case "scheduled":
    case "needs-review":
      return "needs-dispatch";
    case "confirmed":
      return "ready";
    case "en-route":
    case "on-site":
      return "active";
    case "complete":
      return "complete";
    case "invoiced":
    case "paid":
    case "cancelled":
      return "settled";
  }
  return assertNeverStatus(parsed);
}

function isAssigned(row: Record<string, unknown>): boolean {
  return Boolean(row["assignedToUserId"] || row["assignedToAgentId"] || row["assignedToType"]);
}

function assignmentLabel(row: Record<string, unknown>, assigned: boolean): string {
  if (!assigned) return "Needs assignment";
  if (row["assignedToUserId"]) return "Assigned to employee";
  if (row["assignedToAgentId"]) return "Assigned to AI coworker";
  return "Assigned";
}

function attentionReasons(job: Pick<DispatchJobView, "status" | "assigned">): string[] {
  const reasons: string[] = [];
  if (job.status === "needs-review") reasons.push("No valid dispatch state");
  if (job.status === "quoted") reasons.push("Quote awaiting scheduling");
  if (job.status === "scheduled") reasons.push("Scheduled but not confirmed");
  if (ASSIGNABLE.has(job.status) && !job.assigned) reasons.push("Needs assignment");
  return reasons;
}

function dueOrder(job: DispatchJobView): number {
  if (!job.dueAt) return Number.MAX_SAFE_INTEGER;
  const t = Date.parse(job.dueAt);
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function buildSummary(jobs: readonly DispatchJobView[]): DispatchBoardSummary {
  return {
    needsAttention: jobs.filter((j) => j.attentionReasons.length > 0 || needsDispatcherAttention(j.status)).length,
    unassigned: jobs.filter((j) => ASSIGNABLE.has(j.status) && !j.assigned).length,
    active: jobs.filter((j) => ACTIVE.has(j.status)).length,
    readyToInvoice: jobs.filter((j) => j.status === "complete").length,
    partsUsed: jobs.reduce((sum, j) => sum + j.partsUsed, 0),
  };
}

/** Group job views into fixed operational lanes. Pure. */
export function groupDispatchJobs(jobs: readonly DispatchJobView[]): DispatchBoard {
  const normalized = jobs.map((j) => ({
    ...j,
    attentionReasons: j.attentionReasons.length > 0 ? j.attentionReasons : attentionReasons(j),
  }));
  const byColumn = new Map<DispatchColumnKey, DispatchJobView[]>();
  for (const col of DISPATCH_COLUMNS) byColumn.set(col.key, []);
  for (const job of normalized) {
    byColumn.get(columnForStatus(job.status))!.push(job);
  }
  const routeStops = [...normalized]
    .filter((j) => j.dueAt && !isTerminalStatus(j.status))
    .sort((a, b) => dueOrder(a) - dueOrder(b))
    .slice(0, 8);
  return {
    columns: DISPATCH_COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      jobs: byColumn.get(col.key)!,
    })),
    total: normalized.length,
    summary: buildSummary(normalized),
    nextJob: routeStops[0] ?? null,
    routeStops,
  };
}

/** Minimal Prisma delegate contract this reader touches. */
export interface DispatchWorkItemFinder {
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy?: unknown;
    select?: unknown;
    take?: number;
  }) => Promise<Array<Record<string, unknown>>>;
}

export interface DispatchBoardDeps {
  getFinder?: () => Promise<DispatchWorkItemFinder>;
}

function toView(row: Record<string, unknown>): DispatchJobView {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  const status = parseFieldDispatchStatus(row["status"]);
  const assigned = isAssigned(row);
  const evidence = parseFieldDispatchEvidence(row["evidence"]);
  const view = {
    itemId: String(row["itemId"] ?? ""),
    title: String(row["title"] ?? ""),
    status,
    statusLabel: FIELD_DISPATCH_JOB_STATUS_LABEL[status],
    urgency: String(row["urgency"] ?? "routine"),
    dueAt: iso(row["dueAt"]),
    createdAt: iso(row["createdAt"]) ?? "",
    assigned,
    assignmentLabel: assignmentLabel(row, assigned),
    partsUsed: collectPartsUsed(evidence).reduce((sum, part) => sum + Math.max(part.quantity, 0), 0),
    attentionReasons: [] as string[],
  };
  return {
    ...view,
    attentionReasons: attentionReasons(view),
  };
}

async function defaultGetFinder(): Promise<DispatchWorkItemFinder> {
  const { prisma } = await import("@dpf/db");
  return prisma.workItem as unknown as DispatchWorkItemFinder;
}

/**
 * Load the dispatch board for a storefront. Returns an empty board (never
 * throws) so a page render is never broken by a read failure.
 */
export async function getDispatchBoard(
  storefrontId: string,
  deps?: DispatchBoardDeps,
): Promise<DispatchBoard> {
  try {
    const getFinder = deps?.getFinder ?? defaultGetFinder;
    const finder = await getFinder();
    const rows = await finder.findMany({
      where: {
        sourceType: FIELD_DISPATCH_SOURCE_TYPE,
        queue: { is: { queueId: dispatchQueueId(storefrontId) } },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      select: {
        itemId: true,
        sourceType: true,
        title: true,
        status: true,
        urgency: true,
        dueAt: true,
        createdAt: true,
        assignedToType: true,
        assignedToUserId: true,
        assignedToAgentId: true,
        evidence: true,
      },
      take: 200,
    });
    return groupDispatchJobs(rows.map(toView));
  } catch (err) {
    console.warn(
      `[dispatch-board] read failed: ${getErrorMessage(err)}`,
    );
    return groupDispatchJobs([]);
  }
}
