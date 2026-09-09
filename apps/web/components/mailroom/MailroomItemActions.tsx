"use client";

// Item actions: acknowledge, draft a reply, approve and send (design 2026-09-09 §4.8).
// Nothing leaves without "Approve and send".

import { useActionState, useState, useTransition } from "react";

import {
  acknowledgeMailroomItem,
  approveAndSendMailroomReply,
  draftMailroomReplyAction,
} from "@/app/(shell)/workspace/mailroom/actions";
import type { ApproveReplyResult } from "@/lib/mailroom/mailbox-form";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/report-kit/Notice";

type Draft = { draftId: string; body: string; status: string } | null;

export function MailroomItemActions({
  inboundId,
  status,
  draft,
  canReply,
}: {
  inboundId: string;
  status: string;
  draft: Draft;
  canReply: boolean;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [sendState, sendAction, sending] = useActionState<ApproveReplyResult | null, FormData>(approveAndSendMailroomReply, null);
  const replied = status === "replied";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {status === "routed" ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await acknowledgeMailroomItem(inboundId);
                setNote(r.ok ? "Acknowledged." : r.error);
              })
            }
          >
            Acknowledge
          </Button>
        ) : null}
        {!draft && !replied && canReply ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await draftMailroomReplyAction(inboundId);
                setNote(r.ok ? "A reply is drafted below for you to review." : r.error);
              })
            }
          >
            Draft a reply
          </Button>
        ) : null}
        {note ? <span className="text-xs text-[var(--dpf-text-muted)]">{note}</span> : null}
      </div>

      {draft && !replied && (draft.status === "pending-review" || draft.status === "draft") ? (
        <form action={sendAction} className="space-y-3" aria-label="Review and send the reply">
          <input type="hidden" name="inboundId" value={inboundId} />
          <input type="hidden" name="draftId" value={draft.draftId} />
          <label className="block text-xs font-medium text-[var(--dpf-text-muted)]" htmlFor="reply-body">
            Reply (edit before sending)
          </label>
          <textarea
            id="reply-body"
            name="body"
            defaultValue={draft.body}
            rows={8}
            className="w-full rounded-md border border-[var(--dpf-border)] bg-transparent px-3 py-2 text-sm text-[var(--dpf-text)]"
          />
          {sendState && !sendState.ok ? <Notice variant="warn" title="Not sent">{sendState.error}</Notice> : null}
          {sendState && sendState.ok ? <Notice variant="success" title="Sent">Reply sent and threaded onto the sender&apos;s conversation.</Notice> : null}
          <Button type="submit" disabled={sending}>{sending ? "Sending…" : "Approve and send"}</Button>
        </form>
      ) : null}
    </div>
  );
}
