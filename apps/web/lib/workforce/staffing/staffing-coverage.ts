// Canonical staffing-coverage read model shared by the staffing MCP lens and
// workforce decision flows. Keeping the query here prevents a business-domain
// caller from importing an MCP adapter or copying its coverage arithmetic.

export type StaffingCoverageRow = {
  demandId: string;
  required: number;
  assigned: number;
  covered: boolean;
  status: string;
};

export type StaffingCoverageResult = {
  coverage: StaffingCoverageRow[];
  uncoveredCount: number;
};

export type StaffingCoverageClient = {
  staffingDemand: {
    findMany(args: Record<string, unknown>): Promise<Array<{
      demandId: string;
      minQuantity: number;
      targetQuantity: number | null;
      status: string;
      shifts: Array<{
        requiredQuantity: number;
        assignments: Array<{ id: string }>;
      }>;
    }>>;
  };
};

export async function getStaffingCoverage(
  db: StaffingCoverageClient,
  input: { organizationId: string; startDate?: Date; endDate?: Date },
): Promise<StaffingCoverageResult> {
  const dateWindow =
    input.startDate && input.endDate
      ? { startAt: { lte: input.endDate }, endAt: { gte: input.startDate } }
      : {};
  const demands = await db.staffingDemand.findMany({
    where: {
      organizationId: input.organizationId,
      status: { not: "cancelled" },
      ...dateWindow,
    },
    select: {
      demandId: true,
      minQuantity: true,
      targetQuantity: true,
      status: true,
      shifts: {
        select: {
          requiredQuantity: true,
          assignments: {
            where: { lifecycle: { in: ["confirmed", "completed"] } },
            select: { id: true },
          },
        },
      },
    },
  });

  const coverage = demands.map((d) => {
    const assigned = d.shifts.reduce((sum, shift) => sum + shift.assignments.length, 0);
    const required = d.targetQuantity ?? d.minQuantity;
    return {
      demandId: d.demandId,
      required,
      assigned,
      covered: assigned >= required,
      status: d.status,
    };
  });

  return {
    coverage,
    uncoveredCount: coverage.filter((row) => !row.covered).length,
  };
}
