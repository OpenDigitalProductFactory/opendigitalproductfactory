// Approval convergence probe run (BI-129EFFD1; AC-PROBE). Not implemented yet.
import type { ProbeRowResult, summarizeProbe } from "./approval-convergence-probe";

export const READ_ONLY_STATEMENT = "SET TRANSACTION READ ONLY";

export type ApprovalConvergenceProbeReport = {
  probedAt: string;
  summary: ReturnType<typeof summarizeProbe>;
  rows: ProbeRowResult[];
};

export async function withReadOnlyTransaction<T>(_db: unknown, _work: (tx: unknown) => Promise<T>): Promise<T> {
  throw new Error("not implemented");
}

export async function runApprovalConvergenceProbe(_db: unknown, _now: Date = new Date()): Promise<ApprovalConvergenceProbeReport> {
  throw new Error("not implemented");
}
