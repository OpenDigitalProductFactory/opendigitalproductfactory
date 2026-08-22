"use client";

import { useState, useTransition } from "react";

import { publishOutboundDraftAction } from "@/app/(shell)/customer/marketing/actions";

export type ExternalPublicationCopy = {
  channelName: string;
  connectLabel: string;
  triggerLabel: string;
  confirmTitle: string;
  confirmLabel: string;
  cancelLabel: string;
  itemLabel: string;
  defaultAudience: string;
  consequence: string;
  successLabel: string;
  disconnectedHelp: string;
  blockedMessage: string;
};

type Props = {
  draftId: string;
  channelConnected: boolean;
  connectHref: string;
  copy: ExternalPublicationCopy;
  fitBlocked?: boolean;
  artifactTitle?: string | null;
  audience?: string | null;
  testIds: {
    blocked: string;
    confirmation: string;
    flash: string;
    success: string;
  };
};

export function ExternalPublicationControl({
  draftId,
  channelConnected,
  connectHref,
  copy,
  fitBlocked,
  artifactTitle,
  audience,
  testIds,
}: Props) {
  const [status, setStatus] = useState<"idle" | "confirming" | "publishing" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function publish() {
    setStatus("publishing");
    setMessage(null);
    setExternalUrl(null);
    startTransition(async () => {
      const result = await publishOutboundDraftAction(draftId);
      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      setStatus("done");
      setExternalUrl(result.externalUrl);
      setMessage(copy.successLabel);
    });
  }

  if (fitBlocked) {
    return (
      <p
        data-testid={testIds.blocked}
        className="rounded-dpf-md border border-dpf-error bg-dpf-state-error px-dpf-md py-dpf-sm text-dpf-caption text-dpf-text"
        role="status"
      >
        {copy.blockedMessage}
      </p>
    );
  }

  if (!channelConnected) {
    return (
      <div className="flex flex-wrap items-center gap-dpf-sm">
        <a
          href={connectHref}
          className="dpf-tap-target inline-flex items-center rounded-dpf-md border border-dpf-border bg-dpf-surface-1 px-dpf-md py-dpf-sm text-dpf-caption font-dpf-medium text-dpf-text hover:border-dpf-accent"
        >
          {copy.connectLabel}
        </a>
        <span className="text-dpf-caption text-dpf-muted">{copy.disconnectedHelp}</span>
      </div>
    );
  }

  const safeReceiptUrl = safeHttpsUrl(externalUrl);
  if (status === "done" && safeReceiptUrl) {
    return (
      <a
        href={safeReceiptUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={testIds.success}
        className="dpf-tap-target inline-flex items-center rounded-dpf-md border border-dpf-accent bg-dpf-surface-1 px-dpf-md py-dpf-sm text-dpf-caption font-dpf-medium text-dpf-accent hover:underline"
      >
        {copy.successLabel} ↗
      </a>
    );
  }

  if (status === "done") {
    return (
      <span
        data-testid={testIds.success}
        className="inline-flex rounded-dpf-md border border-dpf-border bg-dpf-surface-1 px-dpf-md py-dpf-sm text-dpf-caption text-dpf-text"
        role="status"
      >
        {copy.successLabel} — receipt recorded; no safe external link was returned.
      </span>
    );
  }

  if (status === "confirming") {
    return (
      <div
        data-testid={testIds.confirmation}
        className="flex flex-col gap-dpf-sm rounded-dpf-md border border-dpf-border bg-dpf-surface-2 p-dpf-md text-dpf-caption text-dpf-text"
      >
        <p className="font-dpf-semibold">{copy.confirmTitle}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-dpf-sm gap-y-dpf-xs">
          <dt className="text-dpf-muted">Channel</dt><dd>{copy.channelName}</dd>
          {artifactTitle ? <><dt className="text-dpf-muted">{copy.itemLabel}</dt><dd>{artifactTitle}</dd></> : null}
          <dt className="text-dpf-muted">Audience</dt><dd>{audience ?? copy.defaultAudience}</dd>
          <dt className="text-dpf-muted">Consequence</dt><dd>{copy.consequence}</dd>
        </dl>
        <div className="flex flex-wrap items-center gap-dpf-sm">
          <button
            type="button"
            onClick={publish}
            className="dpf-tap-target rounded-dpf-md bg-dpf-accent px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-dpf-on-accent"
          >
            {copy.confirmLabel}
          </button>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="dpf-tap-target rounded-dpf-md border border-dpf-border px-dpf-md py-dpf-sm text-dpf-body text-dpf-text"
          >
            {copy.cancelLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-dpf-sm">
      <button
        type="button"
        onClick={() => setStatus("confirming")}
        disabled={pending}
        className="dpf-tap-target rounded-dpf-md bg-dpf-accent px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-dpf-on-accent disabled:opacity-50"
      >
        {pending || status === "publishing" ? "Working…" : copy.triggerLabel}
      </button>
      {message ? (
        <span data-testid={testIds.flash} className="text-dpf-caption text-dpf-text" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}
