// BI-9CC44DC7 — requisition list for the recruiting pipeline page's filter.
//
// The pipeline read model (getRecruitingPipeline) filters by requisitionId but
// never enumerates requisitions. This is the small companion read the page uses
// to populate its requisition <select>. Read-only; open requisitions first so
// the operator narrows to live roles by default.

export interface RequisitionOption {
  /** Native JobRequisition id (the value passed back as requisitionId). */
  id: string;
  /** Human requisition reference, e.g. "REQ-1042". */
  reqId: string;
  title: string;
  status: string;
}

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type RequisitionsReadClient = {
  jobRequisition: {
    findMany: (args: unknown) => Promise<
      Array<{ id: string; reqId: string; title: string; status: string }>
    >;
  };
};

// Open/active requisitions lead the list; closed/filled fall to the bottom.
const STATUS_ORDER: Record<string, number> = {
  open: 0,
  pending_approval: 1,
  on_hold: 2,
  draft: 3,
  filled: 4,
  closed: 5,
};

/**
 * List requisitions for the pipeline filter — live roles first, then by title.
 */
export async function listRecruitingRequisitions(
  db: RequisitionsReadClient,
): Promise<RequisitionOption[]> {
  const rows = await db.jobRequisition.findMany({
    select: { id: true, reqId: true, title: true, status: true },
  });

  return [...rows].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.title.localeCompare(b.title);
  });
}
