"use client";

import { useState, useTransition } from "react";
import { publishOutboundDraftAction } from "@/app/(shell)/customer/marketing/actions";

type Props = {
  draftId: string;
  channelConnected: boolean;
  channelId: string;
  /** True when archetype-fit flags the body as off-archetype/software-platform content. */
  fitBlocked?: boolean;
};

export function PublishEmailButton({ draftId, channelConnected, channelId, fitBlocked }: Props) {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSend() {
    setStatus("sending");
    setMessage(null);
    startTransition(async () => {
      const result = await publishOutboundDraftAction(draftId);
      if (result.ok) {
        setStatus("done");
        setMessage("Sent");
      } else {
        setStatus("error");
        setMessage(result.error);
      }
    });
  }

  if (fitBlocked) {
    return (
      <p
        data-testid="send-blocked-fit"
        className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-500"
        role="status"
      >
        Blocked: this reads as imported/test or off-archetype content. It can’t be emailed to this
        business’s audience — reject it or fix the copy first.
      </p>
    );
  }

  if (!channelConnected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/platform/tools/integrations/${channelId}`}
          className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          Connect Postmark first
        </a>
        <span className="text-xs text-[var(--dpf-muted)]">
          Sending stays disabled until the email integration is connected.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onSend}
        disabled={pending || status === "done"}
        className="rounded-full bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === "done" ? "Sent" : pending || status === "sending" ? "Sending…" : "Send email"}
      </button>
      {message && (
        <span
          data-testid="publish-email-flash"
          className={
            status === "error" ? "text-xs text-[var(--dpf-text)]" : "text-xs text-[var(--dpf-accent)]"
          }
          role="status"
        >
          {message}
        </span>
      )}
    </div>
  );
}
