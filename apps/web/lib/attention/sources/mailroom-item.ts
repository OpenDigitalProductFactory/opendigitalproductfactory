// Mailroom-item source — projects correspondence nobody has acknowledged onto
// the owner's attention surface (design 2026-09-09 §4.7, BI-12B0AE91).
//
// Two sets surface: every routed item whose acknowledge-by time has passed,
// and every item of immediate urgency from the moment it is routed. This is
// the delivered-but-not-received reconciliation the Mailroom concept asks for,
// applied to mail: a message the platform accepted and a person never saw is
// the failure this source exists to make visible.
//
// Pure mapper + a thin db loader, mirroring storefront-inquiry. Read-only.

import type { prisma } from "@dpf/db";

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

/** Pure: should this row surface now? */
export function mailroomItemNeedsAttention(row: MailroomItemRow, now: Date): boolean {
  if (row.urgency === "immediate") return true;
  return Boolean(row.acknowledgeBy && row.acknowledgeBy.getTime() <= now.getTime());
}

function timeToAct(row: MailroomItemRow, now: Date): TimeToAct {
  if (row.acknowledgeBy && row.acknowledgeBy.getTime() <= now.getTime()) return "overdue";
  return row.urgency === "immediate" ? "due-today" : "none";
}

/** Project one unacknowledged item into an attention item. Pure. */
export function mailroomItemToAttentionItem(row: MailroomItemRow, now: Date): AttentionItem {
  const sender = row.fromDisplayName?.trim() || row.fromAddress || "an unknown sender";
  const overdue = row.acknowledgeBy && row.acknowledgeBy.getTime() <= now.getTime();
  const reason = row.reasonKey ? row.reasonKey.replace(/-/g, " ") : "correspondence";
  const about = row.subjectRef ? ` about ${row.subjectRef}` : "";
  const context = overdue
    ? `${reason}${about} · ${agePast(now, row.acknowledgeBy!)} · ${clip(row.triageSummary ?? row.subject ?? "")}`
    : `${reason}${about} · needs a person now · ${clip(row.triageSummary ?? row.subject ?? "")}`;
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
      OR: [{ urgency: "immediate" }, { acknowledgeBy: { lte: now } }],
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
