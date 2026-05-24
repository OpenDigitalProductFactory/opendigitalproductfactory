// apps/web/lib/gear-interface/query.ts
//
// Reduction Gear Phase 0 — read API for the Cockpit.
//
// All Cockpit aggregate readings (torque, slip, wear, lubrication, heat,
// graduation) compute from this module. Drill-down resolves a single row and
// its source event. Per spec §5.3, no Cockpit panel should independently
// reconcile fragmented event tables — every aggregate goes through here.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §5

import { prisma } from "@dpf/db";

export type RingInterface = "1-2" | "2-3" | "3-4" | "4-5";

export interface QueryWindow {
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
}

export interface InterfaceFilter {
  innerRing?: number;
  outerRing?: number;
  transmissionDirection?: "outward" | "inward" | "lateral";
}

/**
 * Default window for the Cockpit overview — last 7 days. Callers may override.
 */
export function defaultWindow(now: Date = new Date()): QueryWindow {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end: now };
}

// ── Aggregate readings ───────────────────────────────────────────────────────

export interface InterfaceTorqueReading {
  innerRing: number | null;
  outerRing: number | null;
  transmissionDirection: string;
  totalRecords: number;
  meanTorqueTechnical: number;
  meanTorqueConfidence: number;
  slipCount: number;
  slipRate: number;
  graduationCount: number;
  totalCostUsd: number;
}

/**
 * Per-interface torque summary for the overview ring panel. Returns one row
 * per (innerRing, outerRing, transmissionDirection) tuple that appeared in the
 * window.
 */
export async function getInterfaceTorqueReadings(
  window: QueryWindow,
): Promise<InterfaceTorqueReading[]> {
  const rows = await prisma.gearInterface.findMany({
    where: { recordedAt: { gte: window.start, lt: window.end } },
    select: {
      innerRing: true,
      outerRing: true,
      transmissionDirection: true,
      torqueTechnical: true,
      torqueConfidence: true,
      slipDetected: true,
      outcomeType: true,
      costUsd: true,
    },
  });

  const bucket = new Map<string, InterfaceTorqueReading & {
    sumTechnical: number;
    sumConfidence: number;
  }>();

  for (const row of rows) {
    const key = `${row.innerRing ?? "null"}:${row.outerRing ?? "null"}:${row.transmissionDirection}`;
    const existing = bucket.get(key);
    const cost = row.costUsd ? Number(row.costUsd.toString()) : 0;
    if (existing) {
      existing.totalRecords += 1;
      existing.sumTechnical += row.torqueTechnical;
      existing.sumConfidence += row.torqueConfidence;
      existing.slipCount += row.slipDetected ? 1 : 0;
      existing.graduationCount += row.outcomeType === "graduation" ? 1 : 0;
      existing.totalCostUsd += cost;
    } else {
      bucket.set(key, {
        innerRing: row.innerRing,
        outerRing: row.outerRing,
        transmissionDirection: row.transmissionDirection,
        totalRecords: 1,
        meanTorqueTechnical: 0,
        meanTorqueConfidence: 0,
        slipCount: row.slipDetected ? 1 : 0,
        slipRate: 0,
        graduationCount: row.outcomeType === "graduation" ? 1 : 0,
        totalCostUsd: cost,
        sumTechnical: row.torqueTechnical,
        sumConfidence: row.torqueConfidence,
      });
    }
  }

  return Array.from(bucket.values())
    .map(({ sumTechnical, sumConfidence, ...r }) => ({
      ...r,
      meanTorqueTechnical: r.totalRecords > 0 ? sumTechnical / r.totalRecords : 0,
      meanTorqueConfidence: r.totalRecords > 0 ? sumConfidence / r.totalRecords : 0,
      slipRate: r.totalRecords > 0 ? r.slipCount / r.totalRecords : 0,
    }))
    .sort((a, b) => {
      // null rings sort last
      const aRing = a.innerRing ?? 99;
      const bRing = b.innerRing ?? 99;
      if (aRing !== bRing) return aRing - bRing;
      return a.transmissionDirection.localeCompare(b.transmissionDirection);
    });
}

export interface SlipByReason {
  slipReason: string;
  count: number;
  totalCostUsd: number;
}

/**
 * Slip rollup keyed by reason — the diagnostic of "what kind of friction is
 * happening." Optional ring filter narrows to a specific interface.
 */
export async function getSlipByReason(
  window: QueryWindow,
  filter: InterfaceFilter = {},
): Promise<SlipByReason[]> {
  const rows = await prisma.gearInterface.findMany({
    where: {
      recordedAt: { gte: window.start, lt: window.end },
      slipDetected: true,
      ...(filter.innerRing != null ? { innerRing: filter.innerRing } : {}),
      ...(filter.outerRing != null ? { outerRing: filter.outerRing } : {}),
      ...(filter.transmissionDirection
        ? { transmissionDirection: filter.transmissionDirection }
        : {}),
    },
    select: { slipReason: true, costUsd: true },
  });

  const bucket = new Map<string, SlipByReason>();
  for (const row of rows) {
    const reason = row.slipReason ?? "uncategorized";
    const existing = bucket.get(reason);
    const cost = row.costUsd ? Number(row.costUsd.toString()) : 0;
    if (existing) {
      existing.count += 1;
      existing.totalCostUsd += cost;
    } else {
      bucket.set(reason, { slipReason: reason, count: 1, totalCostUsd: cost });
    }
  }
  return Array.from(bucket.values()).sort((a, b) => b.count - a.count);
}

export interface TripleWearReading {
  agentIdForTriple: string;
  capabilityName: string;
  archetypeContext: string | null;
  sampleSize: number;
  meanTorqueTechnical: number;
  trailingFailures: number;
  lastSeenAt: Date;
}

/**
 * Per-triple wear reading — which {agent, capability, archetype} combinations
 * are degrading? Sorted by mean torque ascending so the worst surfaces first.
 */
export async function getTripleWearReadings(
  window: QueryWindow,
  options: { minSampleSize?: number } = {},
): Promise<TripleWearReading[]> {
  const minSample = options.minSampleSize ?? 1;

  const rows = await prisma.gearInterface.findMany({
    where: { recordedAt: { gte: window.start, lt: window.end } },
    select: {
      agentIdForTriple: true,
      capabilityName: true,
      archetypeContext: true,
      torqueTechnical: true,
      recordedAt: true,
    },
    orderBy: { recordedAt: "desc" },
  });

  const bucket = new Map<
    string,
    TripleWearReading & { sumTechnical: number }
  >();
  for (const row of rows) {
    const key = `${row.agentIdForTriple}::${row.capabilityName}::${row.archetypeContext ?? "null"}`;
    const existing = bucket.get(key);
    const failure = row.torqueTechnical < 0.5 ? 1 : 0;
    if (existing) {
      existing.sampleSize += 1;
      existing.sumTechnical += row.torqueTechnical;
      existing.trailingFailures += failure;
      if (row.recordedAt > existing.lastSeenAt) existing.lastSeenAt = row.recordedAt;
    } else {
      bucket.set(key, {
        agentIdForTriple: row.agentIdForTriple,
        capabilityName: row.capabilityName,
        archetypeContext: row.archetypeContext,
        sampleSize: 1,
        meanTorqueTechnical: 0,
        trailingFailures: failure,
        lastSeenAt: row.recordedAt,
        sumTechnical: row.torqueTechnical,
      });
    }
  }

  return Array.from(bucket.values())
    .filter((r) => r.sampleSize >= minSample)
    .map(({ sumTechnical, ...r }) => ({
      ...r,
      meanTorqueTechnical: r.sampleSize > 0 ? sumTechnical / r.sampleSize : 0,
    }))
    .sort((a, b) => a.meanTorqueTechnical - b.meanTorqueTechnical);
}

export interface GraduationEvent {
  id: string;
  recordedAt: Date;
  agentIdForTriple: string;
  capabilityName: string;
  archetypeContext: string | null;
  fromAutonomy: string;
  toAutonomy: string;
  sampleSize: number | null;
  governorRef: string | null;
  innerRing: number | null;
  outerRing: number | null;
}

export async function getRecentGraduations(
  window: QueryWindow,
  options: { limit?: number } = {},
): Promise<GraduationEvent[]> {
  const rows = await prisma.gearInterface.findMany({
    where: {
      recordedAt: { gte: window.start, lt: window.end },
      outcomeType: "graduation",
    },
    orderBy: { recordedAt: "desc" },
    take: options.limit ?? 20,
  });
  return rows
    .filter((r) => r.graduationFromAutonomy && r.graduationToAutonomy)
    .map((r) => ({
      id: r.id,
      recordedAt: r.recordedAt,
      agentIdForTriple: r.agentIdForTriple,
      capabilityName: r.capabilityName,
      archetypeContext: r.archetypeContext,
      fromAutonomy: r.graduationFromAutonomy!,
      toAutonomy: r.graduationToAutonomy!,
      sampleSize: r.graduationSampleSize,
      governorRef: r.graduationGovernorRef,
      innerRing: r.innerRing,
      outerRing: r.outerRing,
    }));
}

// ── Drill-down ────────────────────────────────────────────────────────────────

export interface GearRowSummary {
  id: string;
  recordedAt: Date;
  innerRing: number | null;
  outerRing: number | null;
  transmissionDirection: string;
  shaftSourceType: string;
  shaftSourceId: string;
  actorType: string;
  actorId: string;
  capabilityName: string;
  archetypeContext: string | null;
  torqueTechnical: number;
  torqueConfidence: number;
  outcomeType: string;
  slipDetected: boolean;
  slipReason: string | null;
  costUsd: string | null;
  graderType: string;
}

/**
 * Recent rows for the Cockpit's row table. Filterable by ring interface and
 * outcome type so drill-throughs from aggregates remain consistent.
 */
export async function listRecentGearInterfaceRows(
  window: QueryWindow,
  filter: InterfaceFilter & { outcomeType?: string; slipOnly?: boolean } = {},
  options: { limit?: number } = {},
): Promise<GearRowSummary[]> {
  const rows = await prisma.gearInterface.findMany({
    where: {
      recordedAt: { gte: window.start, lt: window.end },
      ...(filter.innerRing != null ? { innerRing: filter.innerRing } : {}),
      ...(filter.outerRing != null ? { outerRing: filter.outerRing } : {}),
      ...(filter.transmissionDirection
        ? { transmissionDirection: filter.transmissionDirection }
        : {}),
      ...(filter.outcomeType ? { outcomeType: filter.outcomeType } : {}),
      ...(filter.slipOnly ? { slipDetected: true } : {}),
    },
    orderBy: { recordedAt: "desc" },
    take: options.limit ?? 50,
    select: {
      id: true,
      recordedAt: true,
      innerRing: true,
      outerRing: true,
      transmissionDirection: true,
      shaftSourceType: true,
      shaftSourceId: true,
      actorType: true,
      actorId: true,
      capabilityName: true,
      archetypeContext: true,
      torqueTechnical: true,
      torqueConfidence: true,
      outcomeType: true,
      slipDetected: true,
      slipReason: true,
      costUsd: true,
      graderType: true,
    },
  });

  return rows.map((r) => ({
    ...r,
    costUsd: r.costUsd ? r.costUsd.toString() : null,
  }));
}

export async function getGearInterfaceRowById(id: string) {
  return prisma.gearInterface.findUnique({ where: { id } });
}
