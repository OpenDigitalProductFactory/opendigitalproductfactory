// apps/web/lib/storefront/dispatch-board-data.ts
//
// EP-3516E23D field-service dispatch — read model for the dispatch board. Reads
// the field-service-job WorkItems on a storefront's dispatch queue and groups
// them into the board columns an operator works from. The grouping is pure so it
// is unit-tested without a DB.

import { dispatchQueueId } from "@/lib/queue/bridges/booking-bridge";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export interface DispatchJobView {
  itemId: string;
  title: string;
  status: string;
  urgency: string;
  dueAt: string | null;
  createdAt: string;
}

/** The board's columns, in operator workflow order. */
export const DISPATCH_COLUMNS = [
  { key: "queued", label: "Unassigned" },
  { key: "assigned", label: "Assigned" },
  { key: "in-progress", label: "In progress" },
  { key: "awaiting-input", label: "Needs input" },
  { key: "completed", label: "Completed" },
] as const;

export type DispatchColumnKey = (typeof DISPATCH_COLUMNS)[number]["key"];

export interface DispatchBoard {
  columns: Array<{ key: string; label: string; jobs: DispatchJobView[] }>;
  total: number;
}

/** Map a raw WorkItem status to its board column (others fold into "in-progress"). */
export function columnForStatus(status: string): DispatchColumnKey {
  switch (status) {
    case "queued":
      return "queued";
    case "assigned":
      return "assigned";
    case "awaiting-input":
    case "awaiting-approval":
      return "awaiting-input";
    case "completed":
      return "completed";
    default:
      return "in-progress";
  }
}

/** Group job views into the fixed board columns. Pure. */
export function groupDispatchJobs(jobs: readonly DispatchJobView[]): DispatchBoard {
  const byColumn = new Map<string, DispatchJobView[]>();
  for (const col of DISPATCH_COLUMNS) byColumn.set(col.key, []);
  for (const job of jobs) {
    byColumn.get(columnForStatus(job.status))!.push(job);
  }
  return {
    columns: DISPATCH_COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      jobs: byColumn.get(col.key)!,
    })),
    total: jobs.length,
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
  return {
    itemId: String(row["itemId"] ?? ""),
    title: String(row["title"] ?? ""),
    status: String(row["status"] ?? "queued"),
    urgency: String(row["urgency"] ?? "routine"),
    dueAt: iso(row["dueAt"]),
    createdAt: iso(row["createdAt"]) ?? "",
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
        sourceType: "field-service-job",
        queue: { is: { queueId: dispatchQueueId(storefrontId) } },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
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
