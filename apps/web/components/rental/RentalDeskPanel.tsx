"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  verifyAgreement,
  checkoutAgreement,
  returnAgreement,
  cancelAgreement,
} from "@/lib/actions/rental";
import { MediaUploader } from "@/components/storefront-admin/MediaUploader";

type ActiveInspection = { recordId: string; phase: "checkout" | "return"; ref: string };

const STATUS_CHIPS: Record<string, string> = {
  reserved: "bg-[var(--dpf-info)]/15 text-[var(--dpf-info)]",
  verified: "bg-[var(--dpf-accent)]/15 text-[var(--dpf-accent)]",
  active: "bg-[var(--dpf-warning)]/15 text-[var(--dpf-warning)]",
  closed: "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  cancelled: "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
};

export type RentalAgreementRow = {
  id: string;
  ref: string;
  itemName: string;
  unitLabel: string | null;
  customerName: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  verificationStatus: string;
  depositAmount: number | null;
  currency: string;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

export function RentalDeskPanel({ agreements }: { agreements: RentalAgreementRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ActiveInspection | null>(null);

  async function run(id: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(id);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) setError(result.message);
    else router.refresh();
  }

  // Checkout / return return the condition-record id; open an inspection-photo
  // uploader for it so the operator can attach condition evidence on the spot.
  async function runInspection(
    id: string,
    ref: string,
    phase: "checkout" | "return",
    fn: () => Promise<{ ok: boolean; message: string; id?: string }>,
  ) {
    setBusy(id);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.id) setInspection({ recordId: result.id, phase, ref });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}

      {inspection && (
        <div className="rounded-lg border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--dpf-text)]">
              {inspection.phase === "checkout" ? "Checkout" : "Return"} inspection photos
            </span>
            <span className="font-mono text-[11px] text-[var(--dpf-muted)]">{inspection.ref}</span>
            <button
              onClick={() => setInspection(null)}
              className="ml-auto px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
            >
              Done
            </button>
          </div>
          <MediaUploader
            ownerType="RentalConditionRecord"
            ownerId={inspection.recordId}
            role={`inspection-${inspection.phase}`}
            label="Condition photos"
            hint="Photographic evidence of the asset's condition for this agreement"
          />
        </div>
      )}

      <ul className="space-y-2">
        {agreements.map((a) => {
          const isBusy = busy === a.id;
          return (
            <li key={a.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIPS[a.status] ?? STATUS_CHIPS.reserved}`}>
                  {a.status}
                </span>
                <span className="text-xs font-mono text-[var(--dpf-muted)]">{a.ref}</span>
                <span className="text-sm font-medium text-[var(--dpf-text)]">{a.itemName}</span>
                {a.unitLabel && (
                  <span className="rounded bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[11px] text-[var(--dpf-muted)]">
                    {a.unitLabel}
                  </span>
                )}
                {a.verificationStatus === "pending" && (
                  <span className="rounded bg-[var(--dpf-error)]/15 px-2 py-0.5 text-[11px] text-[var(--dpf-error)]">
                    verify required
                  </span>
                )}
                <span className="ml-auto text-xs text-[var(--dpf-muted)]">
                  {fmtDate(a.periodStart)} → {fmtDate(a.periodEnd)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-[var(--dpf-muted)]">
                <span>{a.customerName}</span>
                {a.depositAmount != null && a.depositAmount > 0 && (
                  <span>deposit {a.currency} {a.depositAmount.toFixed(2)}</span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {a.status === "reserved" && a.verificationStatus === "pending" && (
                  <button
                    onClick={() => run(a.id, () => verifyAgreement(a.id))}
                    disabled={isBusy}
                    className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-accent)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                  >
                    Verify renter
                  </button>
                )}
                {(a.status === "reserved" || a.status === "verified") && a.verificationStatus !== "pending" && (
                  <button
                    onClick={() => runInspection(a.id, a.ref, "checkout", () => checkoutAgreement(a.id, {}))}
                    disabled={isBusy}
                    className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-warning)] hover:border-[var(--dpf-warning)] disabled:opacity-50"
                  >
                    Check out
                  </button>
                )}
                {a.status === "active" && (
                  <>
                    <button
                      onClick={() => runInspection(a.id, a.ref, "return", () => returnAgreement(a.id, {}))}
                      disabled={isBusy}
                      className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-success)] hover:border-[var(--dpf-success)] disabled:opacity-50"
                    >
                      Return &amp; re-pool
                    </button>
                    <button
                      onClick={() => runInspection(a.id, a.ref, "return", () => returnAgreement(a.id, { needsMaintenance: true }))}
                      disabled={isBusy}
                      className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                    >
                      Return → maintenance
                    </button>
                  </>
                )}
                {(a.status === "reserved" || a.status === "verified") && (
                  <button
                    onClick={() => run(a.id, () => cancelAgreement(a.id))}
                    disabled={isBusy}
                    className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-error)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {agreements.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--dpf-border)] p-6 text-center text-sm text-[var(--dpf-muted)]">
            No reservations yet. Bookings from your public rental portal land here for
            checkout and return.
          </li>
        )}
      </ul>
    </div>
  );
}
