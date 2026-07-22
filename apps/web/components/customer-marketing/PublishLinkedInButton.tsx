"use client";

import { useState, useTransition } from "react";
import { publishOutboundDraftAction } from "@/app/(shell)/customer/marketing/actions";

type Props = {
  draftId: string;
  channelConnected: boolean;
  channelId: string;
  /** When true, content conflicts with the active archetype and must not publish. */
  fitBlocked?: boolean;
  fitReason?: string;
};

export function PublishLinkedInButton({
  draftId,
  channelConnected,
  channelId,
  fitBlocked = false,
  fitReason,
}: Props) {
  const [status, setStatus] = useState<"idle" | "publishing" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onPublish() {
    if (fitBlocked) {
      setStatus("error");
      setMessage(fitReason ?? "Blocked: content does not fit this business's archetype.");
      return;
    }
    setStatus("publishing");
    setMessage(null);
    setExternalUrl(null);
    startTransition(async () => {
      const result = await publishOutboundDraftAction(draftId);
      if (result.ok) {
        setStatus("done");
        setExternalUrl(result.externalUrl);
        setMessage("Published");
      } else {
        setStatus("error");
        setMessage(result.error);
      }
    });
  }

  if (!channelConnected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/platform/tools/integrations/${channelId}`}
          className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          Connect LinkedIn first
        </a>
        <span className="text-xs text-[var(--dpf-muted)]">
          Publish stays disabled until the integration is connected.
        </span>
      </div>
    );
  }

  if (status === "done" && externalUrl) {
    return (
      <a
        href={externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="publish-success-link"
        className="inline-flex items-center gap-1 rounded-full border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-accent)] hover:underline"
      >
        Published — view post ↗
      </a>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onPublish}
        disabled={pending || fitBlocked}
        title={fitBlocked ? fitReason : undefined}
        className="rounded-full bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Publishing…" : "Publish to LinkedIn"}
      </button>
      {message && (
        <span
          data-testid="publish-flash"
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
