// EP-SOVEREIGN-SOC P4 — SOC console data aggregation.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.6, §10.2.
//
// Pure computation of the console's first-screen answers (Are we covered? Are we
// exposed? What needs a decision? Are we improving?) from raw query rows. The API
// route does the prisma queries and calls computeSocConsoleData; this stays pure
// so the projection logic is unit-tested without a DB.

export interface SocDetectionRow {
  severity: string;
  status: string;
}

export interface SocCaseRow {
  severity: string;
  status: string;
  verdict: string;
  openedAt: Date;
  resolvedAt: Date | null;
}

export interface SocConsoleInput {
  detections: SocDetectionRow[];
  cases: SocCaseRow[];
  /** Source kinds seen within the coverage lookback window. */
  activeSourceKinds: string[];
  /** All source kinds ever seen (stale = ever-seen minus active). */
  allSourceKinds: string[];
}

export interface SocConsoleData {
  coverage: {
    connectedSources: number;
    staleSources: number;
    staleSourceKinds: string[];
    /** False until at least one source is reporting — an empty board is NOT green. */
    monitoring: boolean;
  };
  detections: {
    open: number;
    total: number;
    bySeverity: Record<string, number>;
  };
  cases: {
    open: number;
    resolved: number;
    total: number;
    byStatus: Record<string, number>;
    awaitingDecision: number;
  };
  metrics: {
    mttrMinutes: number | null;
    falsePositiveRate: number | null;
  };
}

const OPEN_CASE_STATUSES = new Set(["new", "triaging", "investigating", "contained"]);
const DECISION_STATUSES = new Set(["new", "triaging"]);

function tally(rows: { severity?: string; status?: string }[], key: "severity" | "status"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = (r[key] ?? "unknown") as string;
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

export function computeSocConsoleData(input: SocConsoleInput): SocConsoleData {
  const active = new Set(input.activeSourceKinds);
  const staleSourceKinds = input.allSourceKinds.filter((s) => !active.has(s));

  const openDetections = input.detections.filter((d) => d.status === "open").length;

  const resolvedCases = input.cases.filter((c) => c.status === "resolved" || c.status === "closed");
  const openCases = input.cases.filter((c) => OPEN_CASE_STATUSES.has(c.status)).length;
  const awaitingDecision = input.cases.filter((c) => DECISION_STATUSES.has(c.status)).length;

  // MTTR over resolved cases with a resolve timestamp.
  const mttrSamples = resolvedCases
    .filter((c) => c.resolvedAt)
    .map((c) => (c.resolvedAt!.getTime() - c.openedAt.getTime()) / 60000)
    .filter((m) => m >= 0);
  const mttrMinutes =
    mttrSamples.length > 0
      ? Math.round(mttrSamples.reduce((a, b) => a + b, 0) / mttrSamples.length)
      : null;

  // FP rate over cases that reached a verdict.
  const verdicted = input.cases.filter((c) => c.verdict && c.verdict !== "unknown");
  const falsePositives = verdicted.filter((c) => c.verdict === "false-positive").length;
  const falsePositiveRate =
    verdicted.length > 0 ? Math.round((falsePositives / verdicted.length) * 100) / 100 : null;

  return {
    coverage: {
      connectedSources: active.size,
      staleSources: staleSourceKinds.length,
      staleSourceKinds,
      monitoring: active.size > 0,
    },
    detections: {
      open: openDetections,
      total: input.detections.length,
      bySeverity: tally(input.detections, "severity"),
    },
    cases: {
      open: openCases,
      resolved: resolvedCases.length,
      total: input.cases.length,
      byStatus: tally(input.cases, "status"),
      awaitingDecision,
    },
    metrics: { mttrMinutes, falsePositiveRate },
  };
}
