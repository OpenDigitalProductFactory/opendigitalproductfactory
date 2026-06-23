// EP-GOLDEN-TRIANGLE Slice 3b (BI-CF28CCF0) — additive, migration-free receipt store.
//
// Records a Golden Triangle outcome receipt onto the existing
// DecisionInteraction.outcomePayload JSON (no schema change), and reads recent
// receipts for the comparison view. Structural client + fail-open so a missing
// DB or shape drift never breaks the caller — this is observability, never a gate.
import { prisma } from "@dpf/db";

import type { GoldenTriangleReceipt } from "./receipt";

const RECEIPT_KEY = "goldenTriangleReceipt";

/** Minimal structural shape of the prisma surface we touch — lets tests inject a fake. */
export interface ReceiptStoreClient {
  decisionInteraction: {
    findUnique: (args: {
      where: { interactionId: string };
      select: { outcomePayload: true };
    }) => Promise<{ outcomePayload: unknown } | null>;
    updateMany: (args: {
      where: { interactionId: string };
      data: { outcomePayload: unknown };
    }) => Promise<{ count: number }>;
    findMany: (args: {
      orderBy: { createdAt: "desc" };
      take: number;
      select: { interactionId: true; outcomePayload: true; createdAt: true; routeContext: true };
    }) => Promise<Array<{ interactionId: string; outcomePayload: unknown; createdAt: Date; routeContext: string | null }>>;
  };
}

export interface StoredReceipt {
  interactionId: string;
  routeContext: string | null;
  at: string; // ISO timestamp
  receipt: GoldenTriangleReceipt;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function defaultClient(db?: ReceiptStoreClient): ReceiptStoreClient {
  return db ?? (prisma as unknown as ReceiptStoreClient);
}

/**
 * Merge a receipt onto an existing DecisionInteraction's outcomePayload.
 * Additive (preserves every other key) and fail-open (returns false on any error).
 */
export async function recordGoldenTriangleReceipt(
  interactionId: string,
  receipt: GoldenTriangleReceipt,
  db?: ReceiptStoreClient,
): Promise<boolean> {
  const client = defaultClient(db);
  try {
    const existing = await client.decisionInteraction.findUnique({
      where: { interactionId },
      select: { outcomePayload: true },
    });
    if (!existing) return false;
    const merged = { ...asRecord(existing.outcomePayload), [RECEIPT_KEY]: receipt };
    const res = await client.decisionInteraction.updateMany({
      where: { interactionId },
      data: { outcomePayload: merged },
    });
    return res.count > 0;
  } catch {
    return false;
  }
}

/** Read recent stored receipts for the comparison view. Fail-open: returns [] on error. */
export async function listGoldenTriangleReceipts(limit = 25, db?: ReceiptStoreClient): Promise<StoredReceipt[]> {
  const client = defaultClient(db);
  const cap = Math.max(1, Math.min(200, limit));
  try {
    const rows = await client.decisionInteraction.findMany({
      orderBy: { createdAt: "desc" },
      // Overscan: most interactions carry no GT receipt, so fetch a wider window then filter.
      take: cap * 4,
      select: { interactionId: true, outcomePayload: true, createdAt: true, routeContext: true },
    });
    const out: StoredReceipt[] = [];
    for (const row of rows) {
      const raw = asRecord(row.outcomePayload)[RECEIPT_KEY];
      if (!raw || typeof raw !== "object") continue;
      out.push({
        interactionId: row.interactionId,
        routeContext: row.routeContext,
        at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
        receipt: raw as GoldenTriangleReceipt,
      });
      if (out.length >= cap) break;
    }
    return out;
  } catch {
    return [];
  }
}
