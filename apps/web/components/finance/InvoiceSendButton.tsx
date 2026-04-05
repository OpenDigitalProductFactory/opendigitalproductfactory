"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  invoiceId: string;
  status: string;
};

export function InvoiceSendButton({ invoiceId, status }: Props) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = ["draft", "approved"].includes(status);
  const canResend = ["sent", "viewed", "overdue"].includes(status);

  if (!canSend && !canResend) return null;

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/finance/invoices/${invoiceId}/send`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to send invoice");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={handleSend}
        disabled={sending}
        className={
          canSend
            ? "px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-success)] text-black hover:opacity-90 transition-colors disabled:opacity-50"
            : "px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-success)] text-[var(--dpf-success)] hover:bg-[var(--dpf-success)] hover:text-black transition-colors disabled:opacity-50"
        }
      >
        {sending ? "Sending…" : canSend ? "Send Invoice" : "Resend"}
      </button>
      {error && (
        <span className="text-[10px] text-[var(--dpf-error)] ml-2">{error}</span>
      )}
    </>
  );
}
