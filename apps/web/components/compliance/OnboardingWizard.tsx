"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { onboardRegulation } from "@/lib/actions/compliance";
import { REGULATION_SOURCE_TYPES, OBLIGATION_CATEGORIES, OBLIGATION_FREQUENCIES } from "@/lib/compliance-types";
import type { OnboardingObligationInput, OnboardingControlInput } from "@/lib/compliance-types";

type Step = 1 | 2 | 3 | 4;

type RegMeta = {
  name: string;
  shortName: string;
  sourceType: string;
  jurisdiction: string;
  industry: string;
  sourceUrl: string;
  effectiveDate: string;
  notes: string;
};

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";
const btnPrimary = "px-4 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50";
const btnSecondary = "px-4 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]";

type Props = {
  draft?: {
    name?: string;
    shortName?: string;
    sourceType?: string;
    jurisdiction?: string;
    industry?: string;
    sourceUrl?: string;
    obligations?: OnboardingObligationInput[];
    suggestedControls?: OnboardingControlInput[];
  } | null;
};

export function OnboardingWizard({ draft }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meta, setMeta] = useState<RegMeta>({
    name: draft?.name ?? "",
    shortName: draft?.shortName ?? "",
    sourceType: draft?.sourceType ?? "external",
    jurisdiction: draft?.jurisdiction ?? "",
    industry: draft?.industry ?? "",
    sourceUrl: draft?.sourceUrl ?? "",
    effectiveDate: "",
    notes: "",
  });

  const [obligations, setObligations] = useState<OnboardingObligationInput[]>(
    draft?.obligations ?? []
  );

  const [controls, setControls] = useState<OnboardingControlInput[]>(
    draft?.suggestedControls ?? []
  );

  function addObligation() {
    setObligations([...obligations, { title: "", reference: "", category: "other", frequency: "", applicability: "", description: "" }]);
  }

  function removeObligation(idx: number) {
    setObligations(obligations.filter((_, i) => i !== idx));
  }

  function updateObligation(idx: number, field: keyof OnboardingObligationInput, value: string) {
    const updated = [...obligations];
    updated[idx] = { ...updated[idx]!, [field]: value || null };
    setObligations(updated);
  }

  async function handleCommit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await onboardRegulation({
        regulation: {
          name: meta.name,
          shortName: meta.shortName,
          sourceType: meta.sourceType,
          jurisdiction: meta.jurisdiction,
          industry: meta.industry || null,
          sourceUrl: meta.sourceUrl || null,
          effectiveDate: meta.effectiveDate ? new Date(meta.effectiveDate) : null,
          notes: meta.notes || null,
        },
        obligations,
        controls: controls.length > 0 ? controls : undefined,
      });
      if (!result.ok) {
        setError(result.message);
        setSubmitting(false);
        return;
      }
      router.push("/compliance/regulations");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onboarding failed.");
      setSubmitting(false);
    }
  }

  // ─── Step 1: Identity ─────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="max-w-lg">
        <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-4">Step 1: Identity</h2>
        <div className="space-y-3">
          <div>
            <label className={labelClasses}>Name *</label>
            <input className={inputClasses} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="General Data Protection Regulation" />
          </div>
          <div>
            <label className={labelClasses}>Short Name *</label>
            <input className={inputClasses} value={meta.shortName} onChange={(e) => setMeta({ ...meta, shortName: e.target.value })} placeholder="GDPR" />
          </div>
          <div>
            <label className={labelClasses}>Source Type *</label>
            <select className={inputClasses} value={meta.sourceType} onChange={(e) => setMeta({ ...meta, sourceType: e.target.value })}>
              {REGULATION_SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Jurisdiction *</label>
            <input className={inputClasses} value={meta.jurisdiction} onChange={(e) => setMeta({ ...meta, jurisdiction: e.target.value })} placeholder="EU" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Industry</label>
              <input className={inputClasses} value={meta.industry} onChange={(e) => setMeta({ ...meta, industry: e.target.value })} placeholder="All" />
            </div>
            <div>
              <label className={labelClasses}>Effective Date</label>
              <input type="date" className={inputClasses} value={meta.effectiveDate} onChange={(e) => setMeta({ ...meta, effectiveDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Source URL</label>
            <input type="url" className={inputClasses} value={meta.sourceUrl} onChange={(e) => setMeta({ ...meta, sourceUrl: e.target.value })} placeholder="https://..." />
          </div>
          <div>
            <label className={labelClasses}>Notes</label>
            <textarea className={inputClasses} rows={2} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
          </div>
          <div className="flex justify-end pt-2">
            <button className={btnPrimary} disabled={!meta.name || !meta.shortName || !meta.jurisdiction} onClick={() => setStep(2)}>
              Next: Obligations
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2: Obligations ──────────────────────────────────────────────
  if (step === 2) {
    return (
      <div>
        <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-1">Step 2: Obligations</h2>
        <p className="text-xs text-[var(--dpf-muted)] mb-4">{obligations.length} obligation(s) — edit, add, or remove as needed.</p>
        <div className="space-y-2 mb-4 max-h-[60vh] overflow-y-auto">
          {obligations.map((obl, i) => (
            <div key={i} className="p-3 rounded border border-[var(--dpf-border)] space-y-2">
              <div className="flex gap-2">
                <input className={inputClasses + " flex-1"} placeholder="Title *" value={obl.title} onChange={(e) => updateObligation(i, "title", e.target.value)} />
                <input className={inputClasses + " w-28"} placeholder="Ref" value={obl.reference ?? ""} onChange={(e) => updateObligation(i, "reference", e.target.value)} />
                <button onClick={() => removeObligation(i)} className="text-xs text-red-400 hover:text-red-300 px-2">Remove</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select className={inputClasses} value={obl.category ?? "other"} onChange={(e) => updateObligation(i, "category", e.target.value)}>
                  {OBLIGATION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className={inputClasses} value={obl.frequency ?? ""} onChange={(e) => updateObligation(i, "frequency", e.target.value)}>
                  <option value="">No frequency</option>
                  {OBLIGATION_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <input className={inputClasses} placeholder="Applicability" value={obl.applicability ?? ""} onChange={(e) => updateObligation(i, "applicability", e.target.value)} />
              </div>
            </div>
          ))}
        </div>
        <button onClick={addObligation} className={btnSecondary + " mb-4"}>+ Add Obligation</button>
        <div className="flex justify-between">
          <button className={btnSecondary} onClick={() => setStep(1)}>Back</button>
          <button className={btnPrimary} onClick={() => setStep(3)}>Next: Controls</button>
        </div>
      </div>
    );
  }

  // ─── Step 3: Controls (optional) ──────────────────────────────────────
  if (step === 3) {
    return (
      <div>
        <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-1">Step 3: Controls (optional)</h2>
        <p className="text-xs text-[var(--dpf-muted)] mb-4">Map controls to obligations. You can skip this and add controls later.</p>
        <p className="text-xs text-[var(--dpf-muted)] mb-4">{controls.length} control(s) suggested.</p>
        {/* Controls editing UI — simplified for initial implementation */}
        {controls.map((ctrl, i) => (
          <div key={i} className="p-3 rounded border border-[var(--dpf-border)] mb-2">
            <div className="flex gap-2 items-center">
              <input className={inputClasses + " flex-1"} value={ctrl.title} onChange={(e) => {
                const updated = [...controls];
                updated[i] = { ...updated[i]!, title: e.target.value };
                setControls(updated);
              }} />
              <select className={inputClasses + " w-32"} value={ctrl.controlType} onChange={(e) => {
                const updated = [...controls];
                updated[i] = { ...updated[i]!, controlType: e.target.value };
                setControls(updated);
              }}>
                <option value="preventive">Preventive</option>
                <option value="detective">Detective</option>
                <option value="corrective">Corrective</option>
              </select>
              <button onClick={() => setControls(controls.filter((_, j) => j !== i))} className="text-xs text-red-400 hover:text-red-300 px-2">Remove</button>
            </div>
            <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
              Linked to: {ctrl.linkedObligationIndices.map((idx) => obligations[idx]?.title ?? `#${idx}`).join(", ") || "none"}
            </p>
          </div>
        ))}
        <div className="flex justify-between mt-4">
          <button className={btnSecondary} onClick={() => setStep(2)}>Back</button>
          <button className={btnPrimary} onClick={() => setStep(4)}>Next: Confirm</button>
        </div>
      </div>
    );
  }

  // ─── Step 4: Confirm ──────────────────────────────────────────────────
  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-4">Step 4: Confirm</h2>
      <div className="space-y-3 mb-6">
        <div className="p-3 rounded border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Name</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{meta.name} ({meta.shortName})</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Type</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{meta.sourceType}</p>
          </div>
          <div className="p-3 rounded border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Obligations</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligations.length}</p>
          </div>
          <div className="p-3 rounded border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Controls</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{controls.length}</p>
          </div>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 mb-4">{error}</p>}
      <div className="flex justify-between">
        <button className={btnSecondary} onClick={() => setStep(3)}>Back</button>
        <button className={btnPrimary} disabled={submitting || obligations.length === 0} onClick={handleCommit}>
          {submitting ? "Onboarding..." : "Commit to Compliance Register"}
        </button>
      </div>
    </div>
  );
}
