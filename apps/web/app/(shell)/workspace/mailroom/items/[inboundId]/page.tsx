// /workspace/mailroom/items/[inboundId] — one message (design 2026-09-09 §4.8/§6).
// The message as received, how the platform understood it, the room it went to,
// acknowledge, and the reply flow. Nothing sends without Approve and send.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolveMailroomOrganizationId, resolveOrganizationMailroomProfile } from "@/lib/mailroom/runtime.server";
import { MAILROOM_REPLY_SOURCE_TYPE } from "@/lib/mailroom/reply";
import { encodeWorkCaseKey } from "@/lib/work-management/workspace-case-loader";
import { MAILROOM_QUEUE_SOURCE_TYPE } from "@/lib/mailroom/queue-room";
import { Surface } from "@/components/ui/Surface";
import { Notice } from "@/components/ui/report-kit/Notice";
import { MailroomItemActions } from "@/components/mailroom/MailroomItemActions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ inboundId: string }> };

const timeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function MailroomItemPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { inboundId } = await params;
  const organizationId = await resolveMailroomOrganizationId();
  if (!organizationId) notFound();

  const item = await prisma.inboundChannelMessage.findFirst({ where: { inboundId, organizationId, domain: "mailroom" } });
  if (!item) notFound();

  const [profile, draft, room] = await Promise.all([
    resolveOrganizationMailroomProfile(organizationId),
    prisma.outboundDraft.findFirst({
      where: { sourceType: MAILROOM_REPLY_SOURCE_TYPE, sourceId: inboundId },
      orderBy: { createdAt: "desc" },
      select: { draftId: true, body: true, status: true },
    }),
    item.routedWorkItemId
      ? prisma.workItem.findFirst({ where: { itemId: item.routedWorkItemId }, select: { itemId: true, sourceType: true, sourceId: true, title: true } })
      : Promise.resolve(null),
  ]);
  const reason = profile.reasons.find((r) => r.key === item.reasonKey);
  const queue = profile.queues.find((q) => q.key === item.queueKey);
  const meta = (item.metadata ?? {}) as { messageIdHeader?: string | null; inReplyTo?: string | null; references?: string[]; attachments?: Array<{ filename: string | null; contentType: string | null; size: number | null }> };
  const roomHref = room ? `/workspace/cases/${encodeWorkCaseKey({ sourceType: room.sourceType, sourceId: room.sourceId ?? room.itemId })}` : null;
  const status = item.mailroomStatus ?? "received";

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <nav className="text-xs text-[var(--dpf-text-muted)]">
        <Link href="/workspace/mailroom" className="underline-offset-2 hover:underline">Mailroom</Link> / message
      </nav>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-[var(--dpf-text)]">{item.subject ?? "(no subject)"}</h1>
        <p className="text-sm text-[var(--dpf-text-muted)]">
          From {item.fromDisplayName ? `${item.fromDisplayName} <${item.fromAddress}>` : item.fromAddress ?? "unknown sender"} · received {timeFormat.format(item.receivedAt)}
          {item.toAddress ? ` · to ${item.toAddress}` : ""}
        </p>
      </header>

      <Surface padding="md" data-evidence-key="triage" className="space-y-1 text-sm">
        <div className="text-[var(--dpf-text)]"><span className="text-[var(--dpf-text-muted)]">Reason:</span> {reason?.label ?? item.reasonKey ?? "not yet triaged"} {item.triageFlagged ? <span className="text-xs text-[var(--dpf-warning)]">(guessed — the classifier could not decide)</span> : null}</div>
        <div className="text-[var(--dpf-text)]"><span className="text-[var(--dpf-text-muted)]">Urgency:</span> {item.urgency ?? "—"}{item.acknowledgeBy ? ` · acknowledge by ${timeFormat.format(item.acknowledgeBy)}` : ""}</div>
        {item.subjectRef ? <div className="text-[var(--dpf-text)]"><span className="text-[var(--dpf-text-muted)]">About:</span> {item.subjectRef}</div> : null}
        <div className="text-[var(--dpf-text)]"><span className="text-[var(--dpf-text-muted)]">Queue:</span> {queue ? `${queue.label} (${queue.responsibleRole})` : item.queueKey ?? "—"}{roomHref ? <> · <Link href={roomHref} className="underline-offset-2 hover:underline">open the room</Link></> : null}{room && room.sourceType !== MAILROOM_QUEUE_SOURCE_TYPE ? " · the sender was already in a conversation with us" : ""}</div>
        <div className="text-[var(--dpf-text)]"><span className="text-[var(--dpf-text-muted)]">State:</span> {status}{item.acknowledgedAt ? ` · acknowledged ${timeFormat.format(item.acknowledgedAt)}` : ""}{item.repliedAt ? ` · replied ${timeFormat.format(item.repliedAt)}` : ""}</div>
        {item.triageSummary ? <p className="pt-1 text-[var(--dpf-text-muted)]">{item.triageSummary}</p> : null}
      </Surface>

      {status === "noise" ? <Notice variant="info" title="Automated or bulk mail">Stored for the record; the Mailroom does not route or reply to it.</Notice> : null}

      <section aria-labelledby="message-heading" data-evidence-key="message">
        <h2 id="message-heading" className="text-sm font-medium text-[var(--dpf-text-muted)]">Message</h2>
        <Surface padding="md" className="mt-2">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-[var(--dpf-text)]">{item.body}</pre>
        </Surface>
        {meta.attachments?.length ? (
          <p className="mt-2 text-xs text-[var(--dpf-text-muted)]">
            Attachments (names only): {meta.attachments.map((a) => a.filename ?? a.contentType ?? "unnamed").join(", ")}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="actions-heading" data-evidence-key="acknowledge" className="space-y-3">
        <h2 id="actions-heading" className="text-sm font-medium text-[var(--dpf-text-muted)]">Actions</h2>
        {draft && item.repliedAt ? <Notice variant="success" title="Replied">Sent {timeFormat.format(item.repliedAt)} to {item.fromAddress}.</Notice> : null}
        <div data-evidence-key="reply">
          <MailroomItemActions inboundId={inboundId} status={status} draft={draft} canReply={status !== "noise" && Boolean(item.fromAddress)} />
        </div>
      </section>

      <details data-evidence-key="raw-headers" className="rounded-lg border border-[var(--dpf-border)] p-4 text-xs text-[var(--dpf-text-muted)]">
        <summary className="cursor-pointer text-[var(--dpf-text)]">Details</summary>
        <dl className="mt-2 grid gap-1">
          <div><dt className="inline">Message id: </dt><dd className="inline">{meta.messageIdHeader ?? "—"}</dd></div>
          <div><dt className="inline">In reply to: </dt><dd className="inline">{meta.inReplyTo ?? "—"}</dd></div>
          <div><dt className="inline">Thread: </dt><dd className="inline">{item.externalThreadId}</dd></div>
          <div><dt className="inline">Channel: </dt><dd className="inline">{item.channelId}</dd></div>
        </dl>
      </details>
    </main>
  );
}
