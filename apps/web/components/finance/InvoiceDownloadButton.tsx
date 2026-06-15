"use client";

import { useState } from "react";

export function InvoiceDownloadButton({ invoiceId }: { invoiceId: string }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/v1/finance/invoices/${invoiceId}/pdf`);
      if (!res.ok) throw new Error("PDF generation failed");
      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
      const filename = filenameMatch?.[1] ?? `Invoice-${invoiceId}.pdf`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Surface the failure — the user needs to know it didn't work
      alert("PDF generation failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50 transition-colors"
    >
      {downloading ? "Generating PDF…" : "Download PDF"}
    </button>
  );
}
