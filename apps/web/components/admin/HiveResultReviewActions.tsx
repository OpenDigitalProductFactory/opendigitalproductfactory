"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { retryHiveResultDeliveryAction, reviewHiveResultAction } from "@/lib/actions/hive-contributions";

export function HiveResultReviewActions({
  id,
  status,
  deliveryStatus,
}: {
  id: string;
  status: string;
  deliveryStatus: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (action: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? result.message ?? "Saved." : result.error ?? "Unable to save.");
      if (result.ok) router.refresh();
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "submitted" || status === "curating" ? (
        <>
          <button type="button" disabled={pending} onClick={() => run(() => reviewHiveResultAction({ id, decision: "accepted" }))} className="rounded bg-[var(--dpf-accent)] px-2 py-1 text-xs font-semibold text-[var(--dpf-bg)] disabled:opacity-50">Accept</button>
          <button type="button" disabled={pending} onClick={() => run(() => reviewHiveResultAction({ id, decision: "rejected" }))} className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)] disabled:opacity-50">Reject</button>
        </>
      ) : null}
      {status === "accepted" && deliveryStatus !== "delivered" ? (
        <button type="button" disabled={pending} onClick={() => run(() => retryHiveResultDeliveryAction(id))} className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)] disabled:opacity-50">Retry forge delivery</button>
      ) : null}
      {message ? <span role="status" className="text-xs text-[var(--dpf-muted)]">{message}</span> : null}
    </div>
  );
}
