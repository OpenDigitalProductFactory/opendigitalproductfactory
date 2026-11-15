// Mailroom-item source — projects correspondence nobody has acknowledged onto
// the owner's attention surface (design 2026-09-09 §4.7, BI-12B0AE91).
//
// Three sets surface: every routed item whose acknowledge-by time has passed,
// every item of immediate urgency from the moment it is routed, and every
// supplier invoice from the moment it is routed — an emailed invoice is a bill
// to record and pay, and the owner hears about it on arrival (BI-4647EC04). This is
// the delivered-but-not-received reconciliation the Mailroom concept asks for,
// applied to mail: a message the platform accepted and a person never saw is
// the failure this source exists to make visible.
//
// Pure mapper + a thin db loader, mirroring storefront-inquiry. Read-only.

import type { prisma } from "@dpf/db";
import { COMMON_MAILROOM_PROFILE, isPrivilegedMailroomReason } from "@dpf/storefront-templates";

import type { AttentionItem, TimeToAct } from "../types";

type Db = typeof prisma;

export type MailroomItemRow = {
  inboundId: string;
  fromAddress: string | null;
  fromDisplayName: string | null;
  subject: string | null;
  triageSummary: string | null;
  reasonKey: string | null;
  urgency: "immediate" | "hours" | "days" | "weeks" | null;
  queueKey: string | null;
  subjectRef: string | null;
  receivedAt: Date;
  acknowledgeBy: Date | null;
};

function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function agePast(now: Date, by: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - by.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min past its window`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h past its window`;
  return `${Math.round(hours / 24)} d past its window`;
}

/** The Mailroom reason that means "a supplier sent a bill" (common profile). */
export const SUPPLIER_INVOICE_REASON_KEY = "supplier-invoice";

function isSupplierInvoice(row: Pick<MailroomItemRow, "reasonKey">): boolean {
  return row.reasonKey === SUPPLIER_INVOICE_REASON_KEY;
}

/** Pure: should this row surface now? */
export function mailroomItemNeedsAttention(row: MailroomItemRow, now: Date): boolean {
  if (row.urgency === "immediate") return true;
  if (isSupplierInvoice(row)) return true;
  return Boolean(row.acknowledgeBy && row.acknowledgeBy.getTime() <= now.getTime());
}

function timeToAct(row: MailroomItemRow, now: Date): TimeToAct {
  if (row.acknowledgeBy && row.acknowledgeBy.getTime() <= now.getTime()) return "overdue";
  return row.urgency === "immediate" || isSupplierInvoice(row) ? "due-today" : "none";
}

/** A supplier invoice reads as a bill to record and pay, leading to Bills. Pure. */
function supplierInvoiceToAttentionItem(row: MailroomItemRow, now: Date, sender: string): AttentionItem {
  const overdue = row.acknowledgeBy && row.acknowledgeBy.getTime() <= now.getTime();
  const subject = clip(row.subject ?? row.triageSummary ?? "invoice");
  const context = overdue
    ? `supplier invoice · ${agePast(now, row.acknowledgeBy!)} · ${subject}`
    : `supplier invoice · record it in Bills so it can be approved and paid · ${subject}`;
  const mailHref = `/workspace/mailroom/items/${row.inboundId}`;
  return {
    id: `mailroom-item:${row.inboundId}`,
    source: "mailroom-item",
    title: `A bill arrived from ${sender}: record it to pay`,
    context,
    decisionClass: { scorability: "unscorable" },
    riskClass: "read",
    triage: {
      timeToAct: timeToAct(row, now),
      residueReason: "input-required",
      blastRadius: `An unrecorded bill from ${sender}, received ${row.receivedAt.toISOString()}`,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.receivedAt.toISOString(),
    // Payables sit under For Employees › Financial Management (owner ruling DI-AE949CA7C701).
    portfolio: "for-employees",
    actions: [
      { kind: "open-in-context", label: "Record the bill", href: "/finance/bills/new" },
      { kind: "open-in-context", label: "Open in Mailroom", href: mailHref },
    ],
    deepLink: mailHref,
    audience: { operator: true },
  };
}

/** Project one unacknowledged item into an attention item. Pure. */
export function mailroomItemToAttentionItem(row: MailroomItemRow, now: Date): AttentionItem {
  const sender = row.fromDisplayName?.trim() || row.fromAddress || "an unknown sender";
  if (isSupplierInvoice(row)) return supplierInvoiceToAttentionItem(row, now, sender);
  const overdue = row.acknowledgeBy && row.acknowledgeBy.getTime() <= now.getTime();
  const reason = row.reasonKey ? row.reasonKey.replace(/-/g, " ") : "correspondence";
  const about = row.subjectRef ? ` about ${row.subjectRef}` : "";
  // Privileged reasons (counsel mail, BI-757C961E) never show their content here:
  // the reason and sender only, as in rooms and notifications.
  const gist = isPrivilegedMailroomReason(COMMON_MAILROOM_PROFILE, row.reasonKey)
    ? "privileged; open the item to read it"
    : clip(row.triageSummary ?? row.subject ?? "");
  const context = overdue
    ? `${reason}${about} · ${agePast(now, row.acknowledgeBy!)} · ${gist}`
    : `${reason}${about} · needs a person now · ${gist}`;
  return {
    id: `mailroom-item:${row.inboundId}`,
    source: "mailroom-item",
    title: `Acknowledge ${sender}${about}`,
    context,
    decisionClass: { scorability: "unscorable" },
    riskClass: "read",
    triage: {
      timeToAct: timeToAct(row, now),
      residueReason: "input-required",
      blastRadius: `${sender}'s message, waiting since ${row.receivedAt.toISOString()}`,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.receivedAt.toISOString(),
    portfolio: "products-and-services-sold",
    actions: [{ kind: "open-in-context", label: "Open in Mailroom", href: `/workspace/mailroom/items/${row.inboundId}` }],
    deepLink: `/workspace/mailroom/items/${row.inboundId}`,
    audience: { operator: true },
  };
}

/** Load routed, unacknowledged items that need a person now. */
export async function loadMailroomItemAttentionItems(db: Db, now: Date = new Date()): Promise<AttentionItem[]> {
  const rows = await db.inboundChannelMessage.findMany({
    where: {
      domain: "mailroom",
      mailroomStatus: "routed",
      OR: [{ urgency: "immediate" }, { reasonKey: SUPPLIER_INVOICE_REASON_KEY }, { acknowledgeBy: { lte: now } }],
    },
    orderBy: [{ acknowledgeBy: "asc" }],
    take: 50,
    select: {
      inboundId: true,
      fromAddress: true,
      fromDisplayName: true,
      subject: true,
      triageSummary: true,
      reasonKey: true,
      urgency: true,
      queueKey: true,
      subjectRef: true,
      receivedAt: true,
      acknowledgeBy: true,
    },
  });
  return rows
    .filter((row) => mailroomItemNeedsAttention(row, now))
    .map((row) => mailroomItemToAttentionItem(row, now));
}
