"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  invoiceId: string;
  status: string;
  /** Gate results computed on the server; the actions re-check server-side regardless. */
  canDelete: boolean;
  deleteBlockedReason: string | null;
  canVoid: boolean;
  voidBlockedReason: string | null;
  /** Plain-language consequences, so the confirm names what will happen. */
  deleteConsequences: string[];
  voidConsequences: string[];
};

type Mode = "void" | "delete";

export function InvoiceLifecycleActions({
  invoiceId,
  status,
  canDelete,
  deleteBlockedReason,
  canVoid,
  voidBlockedReason,
  deleteConsequences,
  voidConsequences,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to offer at all — say nothing rather than showing two dead buttons.
  if (!canVoid && !canDelete) return null;

  const consequences = mode === "delete" ? deleteConsequences : voidConsequences;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "delete"
          ? await fetch(`/api/v1/finance/invoices/${invoiceId}`, { method: "DELETE" })
          : await fetch(`/api/v1/finance/invoices/${invoiceId}/void`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: reason.trim() }),
            });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Failed to ${mode} this invoice`);
      }

      if (mode === "delete") {
        router.push("/finance/invoices");
      } else {
        setMode(null);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${mode}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {canVoid ? (
        <button
          onClick={() => { setMode("void"); setReason(""); setError(null); }}
          className="px-3 py-1.5 text-dpf-caption font-medium rounded-dpf-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-warning)] hover:text-[var(--dpf-warning)] transition-colors"
        >
          Void
        </button>
      ) : voidBlockedReason ? (
        <button
          type="button"
          disabled
          title={voidBlockedReason}
          className="px-3 py-1.5 text-dpf-caption font-medium rounded-dpf-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] opacity-40 cursor-not-allowed"
        >
          Void
        </button>
      ) : null}

      {canDelete ? (
        <button
          onClick={() => { setMode("delete"); setError(null); }}
          className="px-3 py-1.5 text-dpf-caption font-medium rounded-dpf-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-error)] hover:text-[var(--dpf-error)] transition-colors"
        >
          Delete
        </button>
      ) : deleteBlockedReason ? (
        <button
          type="button"
          disabled
          title={deleteBlockedReason}
          className="px-3 py-1.5 text-dpf-caption font-medium rounded-dpf-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] opacity-40 cursor-not-allowed"
        >
          Delete
        </button>
      ) : null}

      {mode ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-lifecycle-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-5">
            <h2
              id="invoice-lifecycle-title"
              className="text-dpf-body font-semibold text-[var(--dpf-text)]"
            >
              {mode === "delete" ? "Delete this invoice?" : "Void this invoice?"}
            </h2>

            <ul className="mt-3 space-y-1.5">
              {consequences.map((line) => (
                <li key={line} className="text-dpf-caption text-[var(--dpf-muted)] flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {mode === "void" ? (
              <label className="block mt-4">
                <span className="text-dpf-caption text-[var(--dpf-muted)]">
                  Reason (kept with the invoice)
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. duplicate of INV-2026-0009"
                  className="mt-1 w-full rounded-dpf-md border border-[var(--dpf-border)] bg-transparent px-2 py-1.5 text-dpf-body text-[var(--dpf-text)]"
                />
              </label>
            ) : null}

            {error ? (
              <p className="mt-3 text-dpf-caption text-[var(--dpf-error)]">{error}</p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setMode(null)}
                disabled={busy}
                className="px-3 py-1.5 text-dpf-caption rounded-dpf-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={run}
                disabled={busy || (mode === "void" && reason.trim().length < 3)}
                className={
                  mode === "delete"
                    ? "px-3 py-1.5 text-dpf-caption font-medium rounded-dpf-md bg-[var(--dpf-error)] text-black hover:opacity-90 disabled:opacity-40"
                    : "px-3 py-1.5 text-dpf-caption font-medium rounded-dpf-md bg-[var(--dpf-warning)] text-black hover:opacity-90 disabled:opacity-40"
                }
              >
                {busy
                  ? mode === "delete" ? "Deleting…" : "Voiding…"
                  : mode === "delete" ? "Delete permanently" : "Void invoice"}
              </button>
            </div>

            {mode === "void" && reason.trim().length < 3 ? (
              <p className="mt-2 text-right text-dpf-caption text-[var(--dpf-muted)]">
                A reason is required.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <span className="sr-only">Current status: {status}</span>
    </>
  );
}
