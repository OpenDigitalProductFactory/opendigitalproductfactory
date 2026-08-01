// Stock coverage pack. Turns "what sold" into "what is about to run out", so an
// operations coworker can propose a restock with a quantity and a supplier
// instead of guessing or reporting a capability gap.
//
// Read-only and consolidated: one tool answers the whole question (levels,
// derived consumption, days of cover, suggested order) rather than making the
// model stitch three calls together.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import {
  computeStockCoverage,
  describeCoverageRow,
  type ComponentLine,
  type SoldUnits,
  type StockLevel,
} from "@/lib/stock/stock-coverage";

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;
const MAX_ROWS = 30;
/** Orders scanned to derive consumption — bounded so one call stays cheap. */
const ORDER_SCAN_CAP = 500;

const definitions: ToolDefinition[] = [
  {
    name: "list_stock_coverage",
    description:
      "Show which supplies are running low: on-hand level, how much each is being consumed " +
      "based on what actually sold, days of cover left, and a suggested order quantity with " +
      "the supplier. Use for restocking, purchasing, and 'can we get through the week' " +
      "questions. Covers a multi-day window (default 7 days) because a single day is rarely " +
      "a reliable trend. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        windowDays: {
          type: "number",
          description: `Days of sales to derive consumption from (default ${DEFAULT_WINDOW_DAYS}, max ${MAX_WINDOW_DAYS}).`,
        },
        belowReorderPointOnly: {
          type: "boolean",
          description: "Only return supplies at or below their reorder point.",
        },
        limit: {
          type: "number",
          description: `Rows to return (default ${MAX_ROWS}, max ${MAX_ROWS}).`,
        },
      },
    },
    requiredCapability: "view_storefront",
    sideEffect: false,
  },
];

type OrderItemLine = { qty?: unknown; itemId?: unknown };

/** Units sold per storefront item id, from the free-JSON order items column. */
export function tallySoldUnits(orderItemPayloads: unknown[]): SoldUnits[] {
  const byItem = new Map<string, number>();
  for (const payload of orderItemPayloads) {
    if (!Array.isArray(payload)) continue;
    for (const line of payload as OrderItemLine[]) {
      if (typeof line !== "object" || line === null) continue;
      const itemId = typeof line.itemId === "string" && line.itemId.trim() ? line.itemId.trim() : null;
      if (!itemId) continue;
      const qty = typeof line.qty === "number" && line.qty > 0 ? line.qty : 1;
      byItem.set(itemId, (byItem.get(itemId) ?? 0) + qty);
    }
  }
  return [...byItem.entries()].map(([storefrontItemId, units]) => ({ storefrontItemId, units }));
}

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(max, n));
}

async function listStockCoverageTool(params: Record<string, unknown>): Promise<ToolResult> {
  const windowDays = clampInt(params["windowDays"], DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS);
  const limit = clampInt(params["limit"], MAX_ROWS, MAX_ROWS);
  const belowOnly = params["belowReorderPointOnly"] === true;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const { prisma } = await import("@dpf/db");

  const [stockRows, componentRows, orders] = await Promise.all([
    prisma.stockItem.findMany({
      where: { isActive: true },
      select: {
        stockItemId: true,
        name: true,
        unit: true,
        onHandQuantity: true,
        reorderPoint: true,
        reorderQuantity: true,
        supplier: { select: { name: true } },
      },
    }),
    prisma.storefrontItemComponent.findMany({
      select: {
        quantityPerUnit: true,
        stockItem: { select: { stockItemId: true } },
        storefrontItem: { select: { itemId: true } },
      },
    }),
    prisma.storefrontOrder.findMany({
      where: { createdAt: { gte: since }, status: { not: "cancelled" } },
      orderBy: { createdAt: "desc" },
      take: ORDER_SCAN_CAP,
      select: { items: true },
    }),
  ]);

  if (stockRows.length === 0) {
    return {
      success: true,
      message:
        "No supplies are being tracked yet, so there is nothing to project. Add the supplies you " +
        "count and the amount each menu item uses, then this will show what is running low.",
      data: { rows: [], windowDays, trackedStockItems: 0 },
    };
  }

  const stock: StockLevel[] = stockRows.map((s) => ({
    stockItemId: s.stockItemId,
    name: s.name,
    unit: s.unit,
    onHandQuantity: Number(s.onHandQuantity),
    reorderPoint: Number(s.reorderPoint),
    reorderQuantity: Number(s.reorderQuantity),
    supplierName: s.supplier?.name ?? null,
  }));
  const components: ComponentLine[] = componentRows.map((c) => ({
    storefrontItemId: c.storefrontItem.itemId,
    stockItemId: c.stockItem.stockItemId,
    quantityPerUnit: Number(c.quantityPerUnit),
  }));

  const coverage = computeStockCoverage({
    stock,
    components,
    sold: tallySoldUnits(orders.map((o) => o.items)),
    windowDays,
  });
  const filtered = (belowOnly ? coverage.filter((r) => r.belowReorderPoint) : coverage).slice(0, limit);
  const lowCount = coverage.filter((r) => r.belowReorderPoint).length;
  const headline = filtered.length
    ? filtered.slice(0, 3).map(describeCoverageRow).join(" | ")
    : "Nothing is at or below its reorder point.";

  return {
    success: true,
    message:
      `${lowCount} of ${coverage.length} tracked supplies are at or below their reorder point ` +
      `(consumption derived from the last ${windowDays} day(s) of sales). ${headline}`,
    data: {
      windowDays,
      trackedStockItems: coverage.length,
      belowReorderPointCount: lowCount,
      ordersScanned: orders.length,
      rows: filtered,
    },
  };
}

export const stockCoveragePack: ToolPack = {
  packId: "stock-coverage",
  definitions,
  handlers: {
    list_stock_coverage: listStockCoverageTool,
  },
  grants: {
    list_stock_coverage: ["stock_read"],
  },
};
