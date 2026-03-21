"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { linkRiskToControl } from "@/lib/actions/compliance";

type AvailableControl = {
  id: string;
  title: string;
  controlType: string;
  implementationStatus: string;
};

type Props = {
  riskAssessmentId: string;
  existingControlIds: string[];
  availableControls: AvailableControl[];
};

const IMPL_COLORS: Record<string, string> = {
  implemented: "bg-green-900/30 text-green-400",
  "in-progress": "bg-yellow-900/30 text-yellow-400",
  planned: "bg-blue-900/30 text-blue-400",
  "not-applicable": "bg-gray-900/30 text-gray-400",
};

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";

export function LinkRiskControlForm({ riskAssessmentId, existingControlIds, availableControls }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [notes, setNotes] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const router = useRouter();

  const unlinked = availableControls.filter(
    (c) => !existingControlIds.includes(c.id),
  );

  const filtered = unlinked.filter(
    (c) => c.title.toLowerCase().includes(filter.toLowerCase()),
  );

  async function handleLink(controlId: string) {
    setLinking(controlId);
    const result = await linkRiskToControl(riskAssessmentId, controlId, notes || undefined);
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
        Link Control
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Link Control to Risk">
        <div className="space-y-3">
          <div>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className={inputClasses}
              placeholder="Filter controls by title..."
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--dpf-muted)] mb-1">Mitigation Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClasses}
              placeholder="How this control mitigates the risk..."
            />
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-[var(--dpf-muted)] py-4 text-center">
                {unlinked.length === 0 ? "All controls are already linked." : "No controls match your filter."}
              </p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  disabled={linking !== null}
                  onClick={() => handleLink(c.id)}
                  className="w-full text-left p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors disabled:opacity-50"
                >
                  <span className="text-sm text-[var(--dpf-text)]">{c.title}</span>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                      {c.controlType}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full ${IMPL_COLORS[c.implementationStatus] ?? "bg-gray-900/30 text-gray-400"}`}
                    >
                      {c.implementationStatus}
                    </span>
                  </div>
                  {linking === c.id && (
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
              className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              Cancel
            </button>
          </div>
        </div>
      </ComplianceModal>
    </>
  );
}
