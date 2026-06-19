"use client";

import { useState, useTransition } from "react";
import { savePlatformApiKey } from "@/lib/actions/ai-providers";
import {
  READING_LEVELS,
  READING_LEVEL_LABEL,
  READABILITY_POLICY_KEY,
  type ReadabilityPolicy,
  type ReadabilityAudience,
} from "@dpf/validators";

const TIERS: { key: ReadabilityAudience; label: string; help: string }[] = [
  {
    key: "marketing",
    label: "Marketing & business copy (external)",
    help: "Storefront, campaigns, notices — what customers and operators read. Plain language reaches the widest audience.",
  },
  {
    key: "reseller",
    label: "Reseller & partner material",
    help: "Documentation for partners, MSPs, and integrators who want more robust detail.",
  },
  {
    key: "architecture",
    label: "Architecture & standards",
    help: "System design and standards detail for technical reviewers. Precision outranks simplicity here.",
  },
];

export function ReadabilityPolicyPanel({ policy }: { policy: ReadabilityPolicy }) {
  const [draft, setDraft] = useState<ReadabilityPolicy>(policy);
  const [savedPolicy, setSavedPolicy] = useState<ReadabilityPolicy>(policy);
  const [isPending, startTransition] = useTransition();
  const dirty = TIERS.some((t) => draft[t.key] !== savedPolicy[t.key]);

  function save() {
    startTransition(async () => {
      await savePlatformApiKey(READABILITY_POLICY_KEY, JSON.stringify(draft));
      setSavedPolicy(draft);
    });
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Readability policy</h2>
      <p className="text-sm text-[var(--dpf-muted)] mb-4">
        The reading level your AI coworkers hold customer-facing copy to, by audience. Business and
        marketing copy stays plain (high school) for the widest reach; technical material may read higher.
        Measured with the Flesch&ndash;Kincaid test.
      </p>

      <div className="space-y-3">
        {TIERS.map((t) => (
          <div
            key={t.key}
            className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-[var(--dpf-text)]">{t.label}</span>
                <p className="text-xs text-[var(--dpf-muted)] mt-0.5">{t.help}</p>
              </div>
              <select
                value={draft[t.key]}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [t.key]: e.target.value as ReadabilityPolicy[typeof t.key] }))
                }
                disabled={isPending}
                className="shrink-0 px-3 py-2 text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
              >
                {READING_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {READING_LEVEL_LABEL[lvl]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={save}
          disabled={isPending || !dirty}
          className="px-4 py-2 text-xs font-semibold bg-[var(--dpf-accent)] text-white rounded disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save policy"}
        </button>
        {!dirty && !isPending && (
          <span className="text-xs text-[var(--dpf-muted)]">Saved</span>
        )}
      </div>
    </div>
  );
}
