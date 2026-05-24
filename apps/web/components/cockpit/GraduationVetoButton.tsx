"use client";
//
// Reduction Gear Phase 1 — operator-veto button for a single graduation row.
//
// Renders a compact "Veto" button. On click, opens a small inline prompt for
// the rationale (required per spec §6.4 — every veto records why). Posts to
// the `vetoGraduation` server action and disables while pending.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6.4

import { useState, useTransition } from "react";
import { XOctagon } from "lucide-react";
import { vetoGraduation } from "@/lib/actions/gear-interface-veto";

export function GraduationVetoButton({ graduationRowId }: { graduationRowId: string }) {
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <span className="text-[10px] italic" style={{ color: "var(--dpf-muted)" }}>
        vetoed
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1"
        style={{
          borderColor: "var(--dpf-border)",
          color: "var(--dpf-error)",
          background: "var(--dpf-surface-2)",
        }}
        title="Veto this graduation — operator override"
      >
        <XOctagon size={11} />
        Veto
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Why veto?"
        className="text-[11px] px-1.5 py-0.5 rounded border w-48"
        style={{
          borderColor: "var(--dpf-border)",
          background: "var(--dpf-surface-1)",
          color: "var(--dpf-text)",
        }}
        disabled={pending}
        autoFocus
      />
      <button
        type="button"
        disabled={pending || rationale.trim().length === 0}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await vetoGraduation({ graduationRowId, rationale });
              setDone(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          });
        }}
        className="text-[11px] px-1.5 py-0.5 rounded"
        style={{
          background: rationale.trim().length === 0 ? "var(--dpf-border)" : "var(--dpf-error)",
          color: "white",
        }}
      >
        {pending ? "..." : "Submit"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          setRationale("");
          setError(null);
        }}
        className="text-[11px] px-1.5 py-0.5"
        style={{ color: "var(--dpf-muted)" }}
      >
        Cancel
      </button>
      {error && (
        <span className="text-[10px]" style={{ color: "var(--dpf-error)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
