"use client";

import { useState, useTransition } from "react";
import { draftMarketingAssetAction } from "@/app/(shell)/customer/marketing/actions";

type Props = {
  assetTaskId: string;
  assetTaskTitle: string;
};

export function DraftAssetButton({ assetTaskId, assetTaskTitle }: Props) {
  const [status, setStatus] = useState<"idle" | "drafting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setStatus("drafting");
    setMessage(null);
    startTransition(async () => {
      const result = await draftMarketingAssetAction(assetTaskId);
      if (result.ok) {
        setStatus("done");
        setMessage(`Drafted ${result.wordCount} words — review below`);
      } else {
        setStatus("error");
        setMessage(result.error);
      }
    });
  }

  const label =
    status === "drafting" || pending
      ? "Drafting…"
      : status === "done"
        ? "Drafted"
        : status === "error"
          ? "Retry draft"
          : "Draft";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label={`Draft ${assetTaskTitle}`}
        className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
      >
        {label}
      </button>
      {message ? (
        <span
          data-testid="draft-flash"
          className={
            status === "error" ? "text-xs text-[var(--dpf-text)]" : "text-xs text-[var(--dpf-accent)]"
          }
          role="status"
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
