// Coworker Simulation & Eval Harness — dispatch process oracles (H1).
//
// Invariants the dispatch process must uphold across every scenario (O1–O7 in
// 2026-06-14-coworker-simulation-eval-harness-design.html §7.2). Each oracle is a
// pure predicate over a WorldSnapshot; a violation lists exactly what broke so a
// failing run is diagnosable. A harness whose oracles cannot catch a broken
// dispatcher is useless — the test suite proves they do.

import type { WorldSnapshot } from "./dispatch-sim";

export interface OracleResult {
  id: string;
  description: string;
  ok: boolean;
  violations: string[];
}

export type Oracle = (snapshot: WorldSnapshot) => OracleResult;

/** O1 — every job that went en-route has an on-my-way notification (attempted). */
export const O1_customerInformed: Oracle = (s) => {
  const violations: string[] = [];
  for (const job of s.jobs) {
    if (job.enRouteAt === undefined) continue;
    const hasOnMyWay = s.notifications.some((n) => n.jobId === job.id && n.event === "on-my-way");
    if (!hasOnMyWay) violations.push(`job ${job.id} went en-route without an on-my-way notification`);
  }
  return { id: "O1", description: "every en-route job is sent an on-my-way notification", ok: violations.length === 0, violations };
};

/** O4 — every completed job is invoiced exactly once. */
export const O4_completionInvoiced: Oracle = (s) => {
  const violations: string[] = [];
  for (const job of s.jobs) {
    if (job.completedAt === undefined) continue;
    const count = s.invoices.filter((i) => i.jobId === job.id).length;
    if (count !== 1) violations.push(`completed job ${job.id} has ${count} invoice(s) (expected 1)`);
  }
  return { id: "O4", description: "every completed job is invoiced exactly once", ok: violations.length === 0, violations };
};

/** O5 — every failed delivery surfaces as a board exception (no silent miss). */
export const O5_failuresSurface: Oracle = (s) => {
  const violations: string[] = [];
  const failed = s.notifications.filter((n) => !n.delivered).length;
  const surfaced = s.exceptions.filter((e) => e.reason.startsWith("notify-")).length;
  if (failed !== surfaced) {
    violations.push(`${failed} failed delivery/deliveries but ${surfaced} surfaced exception(s)`);
  }
  return { id: "O5", description: "every failed delivery surfaces as an exception", ok: violations.length === 0, violations };
};

/** O7 — no invoice without a completed on-site visit (no phantom billing). */
export const O7_noPhantom: Oracle = (s) => {
  const violations: string[] = [];
  for (const inv of s.invoices) {
    const job = s.jobs.find((j) => j.id === inv.jobId);
    if (!job || job.completedAt === undefined) {
      violations.push(`invoice for ${inv.jobId} without a completed on-site visit`);
    }
  }
  return { id: "O7", description: "no invoice without a completed visit", ok: violations.length === 0, violations };
};

export const DISPATCH_ORACLES: Oracle[] = [
  O1_customerInformed,
  O4_completionInvoiced,
  O5_failuresSurface,
  O7_noPhantom,
];

export function runOracles(snapshot: WorldSnapshot, oracles: Oracle[] = DISPATCH_ORACLES): OracleResult[] {
  return oracles.map((oracle) => oracle(snapshot));
}

export function oraclesPass(results: OracleResult[]): boolean {
  return results.every((r) => r.ok);
}

/** Flattened violation messages across a result set — for a readable failure report. */
export function oracleViolations(results: OracleResult[]): string[] {
  return results.flatMap((r) => r.violations.map((v) => `[${r.id}] ${v}`));
}
