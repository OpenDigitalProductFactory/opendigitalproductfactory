"use client";

import { useState, useTransition } from "react";
import { publishOutboundDraftAction } from "@/app/(shell)/customer/marketing/actions";

type Props = {
  draftId: string;
  channelConnected: boolean;
  channelId: string;
  /** True when archetype-fit flags the body as off-archetype/software-platform content. */
  fitBlocked?: boolean;
  /** Owner-readable artifact title shown in the pre-send confirmation. */
  artifactTitle?: string | null;
  /** Owner-readable audience description shown in the pre-send confirmation. */
  audience?: string | null;
};

export function PublishEmailButton({
  draftId,
  channelConnected,
  channelId,
  fitBlocked,
  artifactTitle,
  audience,
}: Props) {
  const [status, setStatus] = useState<"idle" | "confirming" | "sending" | "done" | "error">("idle");
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

  // Explicit owner confirmation before the send: channel, artifact, audience,
  // and the external consequence (BI-CC580161 publish-confirmation acceptance).
  if (status === "confirming") {
    return (
      <div
        data-testid="send-confirm-panel"
        className="flex flex-col gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs text-[var(--dpf-text)]"
      >
        <p className="font-semibold">Send this email?</p>
        <ul className="flex flex-col gap-1">
          <li><span className="text-[var(--dpf-muted)]">Channel:</span> Email</li>
          {artifactTitle && <li><span className="text-[var(--dpf-muted)]">Message:</span> {artifactTitle}</li>}
          <li>
            <span className="text-[var(--dpf-muted)]">Audience:</span>{" "}
            {audience ?? "the recipients configured for this email channel"}
          </li>
          <li>This sends outside DPF and cannot be unsent.</li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSend}
            className="rounded-full bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-white"
          >
            Yes, send email
          </button>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="rounded-full border border-[var(--dpf-border)] px-4 py-1.5 text-sm text-[var(--dpf-text)]"
          >
            Keep as draft
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setStatus("confirming")}
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
