// Storefront activity pack. Guest-facing activity (orders, reservations,
// inquiries) was a full substrate with no read tool, so no coworker could see
// what guests bought or booked — a demand-review duty was impossible to serve.
// One consolidated, read-only door keeps the tool surface small while giving
// operations coworkers the demand signal (what is selling, who is waiting).

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const MAX_ROWS = 25;
const DEFAULT_ROWS = 10;
/** Orders aggregated for the item rollup — bounded so one call stays cheap. */
const ROLLUP_SCAN_CAP = 200;

const definitions: ToolDefinition[] = [
  {
    name: "list_storefront_activity",
    description:
      "List recent guest activity from the public storefront: orders, reservations (bookings), or " +
      "inquiries, newest first, with status and customer. For orders the result includes an " +
      "item-quantity rollup across the whole window (e.g. Margherita Pizza x11) — the demand " +
      "signal for restocking, staffing, and follow-up proposals. Read-only. " +
      "Call once per review window with the filters you need. Empty results are a finding, not a retry signal — do not re-call with identical arguments. On errors, fix scope or grants once; do not thrash.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["order", "booking", "inquiry"],
          description: "Which guest activity to list.",
        },
        status: {
          type: "string",
          description:
            "Optional status filter (orders: pending|accepted|ready|fulfilled|cancelled; " +
            "bookings: pending|confirmed|completed|cancelled|needs-reschedule).",
        },
        sinceDays: {
          type: "number",
          description: "Look-back window in days (default 7, max 90).",
        },
        limit: {
          type: "number",
          description: `Rows to return (default ${DEFAULT_ROWS}, max ${MAX_ROWS}).`,
        },
      },
      required: ["kind"],
    },
    requiredCapability: "view_storefront",
    sideEffect: false,
  },
];

type OrderItemLine = { qty?: unknown; name?: unknown };

/** Sum item quantities across order `items` JSON payloads. Defensive: the
 *  column is free JSON, so unknown shapes are skipped, never thrown on. */
export function rollupOrderItems(
  itemPayloads: unknown[],
): Array<{ name: string; qty: number }> {
  const totals = new Map<string, number>();
  for (const payload of itemPayloads) {
    if (!Array.isArray(payload)) continue;
    for (const line of payload as OrderItemLine[]) {
      if (typeof line !== "object" || line === null) continue;
      const name = typeof line.name === "string" && line.name.trim() ? line.name.trim() : null;
      if (!name) continue;
      const qty = typeof line.qty === "number" && line.qty > 0 ? line.qty : 1;
      totals.set(name, (totals.get(name) ?? 0) + qty);
    }
  }
  return [...totals.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(max, n));
}

async function listStorefrontActivityTool(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const kind = params["kind"];
  if (kind !== "order" && kind !== "booking" && kind !== "inquiry") {
    return {
      success: false,
      error: "kind must be one of: order, booking, inquiry.",
      message: "kind must be one of: order, booking, inquiry.",
    };
  }
  const status = typeof params["status"] === "string" && params["status"].trim()
    ? (params["status"] as string).trim()
    : undefined;
  const sinceDays = clampInt(params["sinceDays"], 7, 90);
  const limit = clampInt(params["limit"], DEFAULT_ROWS, MAX_ROWS);
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const { prisma } = await import("@dpf/db");

  if (kind === "order") {
    const where = { createdAt: { gte: since }, ...(status ? { status } : {}) };
    const [rows, matching] = await Promise.all([
      prisma.storefrontOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          orderRef: true,
          customerName: true,
          customerEmail: true,
          totalAmount: true,
          currency: true,
          status: true,
          items: true,
          createdAt: true,
        },
      }),
      prisma.storefrontOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: ROLLUP_SCAN_CAP,
        select: { items: true },
      }),
    ]);
    const itemTotals = rollupOrderItems(matching.map((o) => o.items));
    const top = itemTotals
      .slice(0, 5)
      .map((t) => `${t.name} x${t.qty}`)
      .join(", ");
    return {
      success: true,
      message:
        `${rows.length} order(s) in the last ${sinceDays} day(s)` +
        (status ? ` with status ${status}` : "") +
        (top ? `. Top sellers: ${top}.` : "."),
      data: {
        rows: rows.map((o) => ({
          ref: o.orderRef,
          customer: o.customerName ?? o.customerEmail,
          total: o.totalAmount.toString(),
          currency: o.currency,
          status: o.status,
          createdAt: o.createdAt.toISOString(),
        })),
        itemTotals,
        rollupScannedOrders: matching.length,
        rollupTruncated: matching.length === ROLLUP_SCAN_CAP,
      },
    };
  }

  if (kind === "booking") {
    const rows = await prisma.storefrontBooking.findMany({
      where: { createdAt: { gte: since }, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        bookingRef: true,
        customerName: true,
        customerEmail: true,
        scheduledAt: true,
        covers: true,
        status: true,
        createdAt: true,
      },
    });
    return {
      success: true,
      message:
        `${rows.length} reservation(s) in the last ${sinceDays} day(s)` +
        (status ? ` with status ${status}.` : "."),
      data: {
        rows: rows.map((b) => ({
          ref: b.bookingRef,
          customer: b.customerName ?? b.customerEmail,
          scheduledAt: b.scheduledAt.toISOString(),
          covers: b.covers,
          status: b.status,
          createdAt: b.createdAt.toISOString(),
        })),
      },
    };
  }

  const rows = await prisma.storefrontInquiry.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      inquiryRef: true,
      customerName: true,
      customerEmail: true,
      message: true,
      createdAt: true,
    },
  });
  return {
    success: true,
    message: `${rows.length} inquiry(ies) in the last ${sinceDays} day(s).`,
    data: {
      rows: rows.map((i) => ({
        ref: i.inquiryRef,
        customer: i.customerName ?? i.customerEmail,
        message: (i.message ?? "").slice(0, 200),
        createdAt: i.createdAt.toISOString(),
      })),
    },
  };
}

export const storefrontActivityPack: ToolPack = {
  packId: "storefront-activity",
  definitions,
  handlers: {
    list_storefront_activity: listStorefrontActivityTool,
  },
  grants: {
    list_storefront_activity: ["storefront_read"],
  },
};
