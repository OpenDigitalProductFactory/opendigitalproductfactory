// EP-GOLDEN-TRIANGLE Slice 3 (BI-CF28CCF0) — read-time receipt reconstruction.
//
// Routine inference runs don't create a DecisionInteraction to hang a stored
// receipt on, and AdapterRunTelemetry has no JSON column — so instead of a
// migration plus a write on the inference hot path, we reconstruct receipts at
// READ time: take recent telemetry rows (the real run facts already captured) and
// compare each against the currently-effective posture with the same pure
// buildGoldenTriangleReceipt() used everywhere else. Zero writes, migration-free,
// fail-open. (The write-path receipt store stays for governed decisions that DO
// carry a DecisionInteraction.)
import { prisma } from "@dpf/db";

import type { DecodedPolicy, GoldenTrianglePreference } from "@/lib/golden-triangle";

import { compileGoldenTrianglePolicy } from "./compile";
import { getEffectiveGoldenTrianglePosture, type GoldenTrianglePersistenceClient } from "./persistence";
import { buildGoldenTriangleReceipt, type ActualRun } from "./receipt";
import type { StoredReceipt } from "./receipt-store";

/** The subset of an AdapterRunTelemetry row we read to reconstruct a receipt. */
export interface TelemetryRunRow {
  id: string;
  modelId: string;
  estimatedCostUsd: unknown; // Prisma.Decimal | number | null — coerced below
  durationMs: number | null;
  userAccepted: boolean | null;
  startedAt: Date | string;
}

/** Structural client — satisfied by PrismaClient and by test fakes. */
export interface TelemetryReceiptClient extends GoldenTrianglePersistenceClient {
  adapterRunTelemetry: {
    findMany: (args: unknown) => Promise<TelemetryRunRow[]>;
  };
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function actualFromRow(row: TelemetryRunRow): ActualRun {
  return {
    modelId: row.modelId,
    costUsd: toNumber(row.estimatedCostUsd),
    latencyMs: row.durationMs ?? null,
    // Failover isn't recorded on the telemetry row, so v1 reconstruction can't
    // distinguish an infra failover here; tier-match / cost / latency still hold.
    fallbackOccurred: false,
    accepted: row.userAccepted ?? null,
  };
}

/** Pure: turn one telemetry row + the active posture into a display receipt. */
export function receiptFromTelemetry(
  row: TelemetryRunRow,
  preference: GoldenTrianglePreference,
  decoded: DecodedPolicy,
): StoredReceipt {
  return {
    interactionId: row.id,
    routeContext: null,
    at: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
    receipt: buildGoldenTriangleReceipt(preference, decoded, actualFromRow(row)),
  };
}

/**
 * Reconstruct receipts for recent successful runs, measured against the currently
 * effective posture. Returns [] when no posture is set (nothing to compare) or on
 * any error (fail-open — this feeds a read-only view, never a gate).
 */
export async function listRecentPostureReceipts(
  limit = 25,
  db?: TelemetryReceiptClient,
): Promise<StoredReceipt[]> {
  const cap = Math.max(1, Math.min(200, limit));
  const client = db ?? (prisma as unknown as TelemetryReceiptClient);
  try {
    const resolved = await getEffectiveGoldenTrianglePosture(null, client);
    if (!resolved) return [];
    const decoded = compileGoldenTrianglePolicy({
      preference: resolved.preference,
      taskClass: "conversation",
      authorityScope: { kind: "wwmd" },
    });
    const rows = await client.adapterRunTelemetry.findMany({
      where: { status: "success" },
      orderBy: { startedAt: "desc" },
      take: cap,
      select: { id: true, modelId: true, estimatedCostUsd: true, durationMs: true, userAccepted: true, startedAt: true },
    });
    return rows.map((row) => receiptFromTelemetry(row, resolved.preference, decoded));
  } catch {
    return [];
  }
}
