"use client";

import { useState, useTransition } from "react";
import { publishOutboundDraftAction } from "@/app/(shell)/customer/marketing/actions";

type Props = {
  draftId: string;
  channelConnected: boolean;
  channelId: string;
  /** True when archetype-fit flags the body as off-archetype/software-platform content. */
  fitBlocked?: boolean;
  /** Owner-readable artifact title shown in the pre-publish confirmation. */
  artifactTitle?: string | null;
  /** Owner-readable audience description shown in the pre-publish confirmation. */
  audience?: string | null;
};

export function PublishLinkedInButton({
  draftId,
  channelConnected,
  channelId,
  fitBlocked,
  artifactTitle,
  audience,
}: Props) {
  const [status, setStatus] = useState<"idle" | "confirming" | "publishing" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onPublish() {
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

  if (fitBlocked) {
    return (
      <p
        data-testid="publish-blocked-fit"
        className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-500"
        role="status"
      >
        Blocked: this reads as imported/test or off-archetype content. It can’t be published to this
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

  // Explicit owner confirmation before anything leaves the building: channel,
  // artifact, audience, and the external consequence, reviewed in one place
  // (BI-CC580161 publish-confirmation acceptance).
  if (status === "confirming") {
    return (
      <div
        data-testid="publish-confirm-panel"
        className="flex flex-col gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs text-[var(--dpf-text)]"
      >
        <p className="font-semibold">Publish this post publicly?</p>
        <ul className="flex flex-col gap-1">
          <li><span className="text-[var(--dpf-muted)]">Channel:</span> LinkedIn</li>
          {artifactTitle && <li><span className="text-[var(--dpf-muted)]">Post:</span> {artifactTitle}</li>}
          <li>
            <span className="text-[var(--dpf-muted)]">Audience:</span>{" "}
            {audience ?? "everyone who can see this business's LinkedIn presence"}
          </li>
          <li>This posts outside DPF. It can be deleted on LinkedIn later, but people may already have seen it.</li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPublish}
            className="rounded-full bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-white"
          >
            Yes, publish to LinkedIn
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
        disabled={pending}
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
