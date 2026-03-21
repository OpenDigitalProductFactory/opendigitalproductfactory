"use client";

import { useState } from "react";

type Props = {
  invoiceId: string;
  status: string;
};

export function InvoiceActions({ invoiceId, status }: Props) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = status === "draft" || status === "approved" || status === "sent";
  const label = status === "sent" || status === "viewed" ? "Resend" : "Send Invoice";

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/finance/invoices/${invoiceId}/send`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? "Failed to send invoice");
      } else {
        setSent(true);
      }
    } catch {
      setError("Network error — could not send invoice");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Download PDF */}
      <a
        href={`/api/v1/finance/invoices/${invoiceId}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
      >
        Download PDF
      </a>

      {/* Send Invoice — only for relevant statuses */}
      {canSend && (
        <button
          onClick={handleSend}
          disabled={sending || sent}
          className="px-3 py-1.5 text-xs font-medium rounded bg-[#22c55e] text-black hover:bg-[#16a34a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? "Sending…" : sent ? "Sent!" : label}
        </button>
      )}

      {error && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </div>
  );
}
