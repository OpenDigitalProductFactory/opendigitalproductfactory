"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { linkControlToObligation } from "@/lib/actions/compliance";

type AvailableObligation = {
  id: string;
  title: string;
  reference: string | null;
  regulationShortName: string | null;
};

type Props = {
  controlId: string;
  existingObligationIds: string[];
  availableObligations: AvailableObligation[];
};

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";

export function LinkObligationForm({ controlId, existingObligationIds, availableObligations }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [notes, setNotes] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const router = useRouter();

  const unlinked = availableObligations.filter(
    (o) => !existingObligationIds.includes(o.id),
  );

  const filtered = unlinked.filter(
    (o) => o.title.toLowerCase().includes(filter.toLowerCase()),
  );

  async function handleLink(obligationId: string) {
    setLinking(obligationId);
    const result = await linkControlToObligation(controlId, obligationId, notes || undefined);
    setLinking(null);
    if (result.ok) {
      setNotes("");
      setFilter("");
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
      >
        Link Obligation
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Link Obligation to Control">
        <div className="space-y-3">
          <div>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className={inputClasses}
              placeholder="Filter obligations by title..."
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--dpf-muted)] mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClasses}
              placeholder="Reason for linking..."
            />
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-[var(--dpf-muted)] py-4 text-center">
                {unlinked.length === 0 ? "All obligations are already linked." : "No obligations match your filter."}
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  disabled={linking !== null}
                  onClick={() => handleLink(o.id)}
                  className="w-full text-left p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors disabled:opacity-50"
                >
                  <span className="text-sm text-white">{o.title}</span>
                  <div className="flex gap-2 mt-1">
                    {o.regulationShortName && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">
                        {o.regulationShortName}
                      </span>
                    )}
                    {o.reference && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">
                        {o.reference}
                      </span>
                    )}
                  </div>
                  {linking === o.id && (
                    <span className="text-[9px] text-[var(--dpf-muted)] mt-1 block">Linking...</span>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      </ComplianceModal>
    </>
  );
}
