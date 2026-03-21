"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { linkPolicyToObligation } from "@/lib/actions/policy";

type AvailableObligation = {
  id: string;
  title: string;
  reference: string | null;
  regulation: { shortName: string; sourceType: string } | null;
};

type Props = {
  policyId: string;
  linkedObligationIds: string[];
  availableObligations: AvailableObligation[];
};

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";

export function LinkPolicyObligationForm({ policyId, linkedObligationIds, availableObligations }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [linking, setLinking] = useState<string | null>(null);
  const router = useRouter();

  const unlinked = availableObligations.filter((o) => !linkedObligationIds.includes(o.id));
  const filtered = unlinked
    .filter((o) => sourceFilter === "all" || o.regulation?.sourceType === sourceFilter)
    .filter((o) => o.title.toLowerCase().includes(filter.toLowerCase()) ||
      o.regulation?.shortName.toLowerCase().includes(filter.toLowerCase()));

  async function handleLink(obligationId: string) {
    setLinking(obligationId);
    const result = await linkPolicyToObligation(policyId, obligationId);
    setLinking(null);
    if (result.ok) {
      router.refresh();
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
        Link Obligation
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Link Obligation to Policy">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} className={inputClasses} placeholder="Search obligations..." />
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={inputClasses + " w-36"}>
              <option value="all">All types</option>
              <option value="external">Regulations</option>
              <option value="standard">Standards</option>
              <option value="framework">Frameworks</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-[var(--dpf-muted)] py-4 text-center">
                {unlinked.length === 0 ? "All obligations are already linked." : "No obligations match your filter."}
              </p>
            ) : (
              filtered.map((o) => (
                <button key={o.id} disabled={linking !== null} onClick={() => handleLink(o.id)}
                  className="w-full text-left p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors disabled:opacity-50">
                  <span className="text-sm text-[var(--dpf-text)]">{o.title}</span>
                  <div className="flex gap-2 mt-1">
                    {o.regulation && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                        {o.regulation.shortName}
                      </span>
                    )}
                    {o.reference && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                        {o.reference}
                      </span>
                    )}
                  </div>
                  {linking === o.id && <span className="text-[9px] text-[var(--dpf-muted)] mt-1 block">Linking...</span>}
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Cancel</button>
          </div>
        </div>
      </ComplianceModal>
    </>
  );
}
