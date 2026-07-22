// Storefront-inquiry source — projects new public StorefrontInquiry rows that
// still need the OWNER's first response into the attention surface, so a customer
// lead surfaces as the owner's next task instead of living only in the Storefront
// inbox while Workspace says "nothing needs you" (BI-348766E5).
//
// Spec: docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.1.
// An inquiry needs a human while it is status `new` and has NOT been routed to
// the backlog: routing it (Send to backlog) is the owner's handling decision, so
// routed inquiries are settled from the attention surface's point of view even
// though the inbox still shows their history.
//
// Pure mapper + a thin db loader, mirroring the reservation-exception source.
// Read-only: never mutates an inquiry row.

import type { prisma } from "@dpf/db";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export type StorefrontInquiryRow = {
  inquiryId: string;
  inquiryRef: string;
  customerName: string;
  customerEmail: string;
  message: string | null;
  itemName: string | null;
  createdAt: Date;
};

function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Project one unanswered inquiry into an attention item. Pure. */
export function storefrontInquiryToAttentionItem(row: StorefrontInquiryRow): AttentionItem {
  const about = row.itemName ? ` about ${row.itemName}` : "";
  const context = row.message
    ? clip(row.message)
    : `${row.inquiryRef} · ${row.customerEmail}`;

  return {
    id: `storefront-inquiry:${row.inquiryRef}`,
    source: "storefront-inquiry",
    title: `Reply to ${row.customerName}${about}`,
    context,
    decisionClass: { scorability: "unscorable" },
    // Replying is a customer-visible action, but surfacing the lead is read-only.
    riskClass: "read",
    triage: {
      timeToAct: "none",
      residueReason: "input-required",
      blastRadius: `${row.customerName}'s inquiry ${row.inquiryRef}`,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    // Customer-facing revenue surface — surfaces OUTSIDE-IN, ahead of and separate
    // from for-employees coworker decision cards (same lane as reservations).
    portfolio: "products-and-services-sold",
    actions: [{ kind: "open-in-context", label: "Open inquiry", href: "/storefront/inbox" }],
    deepLink: "/storefront/inbox",
    audience: { operator: true },
  };
}

/** The derived backlog id Send-to-backlog creates for an inquiry ref — an
 *  inquiry with this item present has been routed and is settled. Mirrors the
 *  id derivation in the inbox page + product-backlog route. */
export function inquiryBacklogItemId(inquiryRef: string): string {
  return `BI-SFI-${inquiryRef.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
}

/** Load the unanswered (new, not-yet-routed) inquiries for the install's storefront. */
export async function loadStorefrontInquiryItems(db: Db): Promise<AttentionItem[]> {
  const config = await db.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) return [];

  // Settled = explicitly closed or already being worked; every other status
  // (including unknown future ones) stays actionable so no waiting customer is
  // silently dropped (BI-A36CF68D).
  const rows = await db.storefrontInquiry.findMany({
    where: { storefrontId: config.id, status: { notIn: ["closed", "in-progress"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      inquiryRef: true,
      customerName: true,
      customerEmail: true,
      message: true,
      itemId: true,
      createdAt: true,
    },
  });
  if (rows.length === 0) return [];

  // Routed inquiries (Send to backlog already clicked) are settled.
  const routedIds = new Set(
    (
      await db.backlogItem.findMany({
        where: { itemId: { in: rows.map((r) => inquiryBacklogItemId(r.inquiryRef)) } },
        select: { itemId: true },
      })
    ).map((b) => b.itemId),
  );

  const open = rows.filter((r) => !routedIds.has(inquiryBacklogItemId(r.inquiryRef)));
  if (open.length === 0) return [];

  const itemIds = [...new Set(open.map((r) => r.itemId).filter((id): id is string => id != null))];
  const itemNameById = new Map(
    itemIds.length === 0
      ? []
      : (
          await db.storefrontItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, name: true },
          })
        ).map((item) => [item.id, item.name] as const),
  );

  return open.map((r) =>
    storefrontInquiryToAttentionItem({
      inquiryId: r.id,
      inquiryRef: r.inquiryRef,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      message: r.message,
      itemName: r.itemId ? (itemNameById.get(r.itemId) ?? null) : null,
      createdAt: r.createdAt,
    }),
  );
}
