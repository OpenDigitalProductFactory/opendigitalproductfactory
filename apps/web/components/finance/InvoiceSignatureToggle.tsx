"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setInvoiceSignatureRequired } from "@/lib/actions/finance";

type Props = {
  invoiceId: string;
  signatureRequired: boolean;
};

export function InvoiceSignatureToggle({ invoiceId, signatureRequired }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await setInvoiceSignatureRequired(invoiceId, !signatureRequired);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={toggle}
        disabled={busy}
        className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] transition-colors disabled:opacity-50"
      >
        {busy
          ? "Saving…"
          : signatureRequired
            ? "Remove signature requirement"
            : "Require signature"}
      </button>
      {error && <span className="text-[10px] text-[var(--dpf-error)]">{error}</span>}
    </div>
  );
}
