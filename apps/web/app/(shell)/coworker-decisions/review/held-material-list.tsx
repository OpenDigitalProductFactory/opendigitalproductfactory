"use client";

// The release affordance for craft doctrine held by the high-stakes review
// hold (BI-5F3BFD13).
//
// Mirrors WeightProposalForm's open/closed disclosure. The evidence is already
// structured (which family, which pages, what grade), so this shows that
// evidence and offers a single Approve — there is no Reject, because the hold
// already IS the rejection until someone acts.

import { useState, useTransition } from "react";

import { approveHeldMaterial } from "./actions";

export type HeldFamilyView = {
  profileId: string;
  professionKey: string;
  rows: Array<{ materialId: string; sourceType: string; evidenceGrade: string; summary: string | null }>;
};

function pageLabel(materialId: string): string {
  // `wsid-security:professions/security/threat-modeling` -> `threat-modeling`
  const slug = materialId.includes(":") ? materialId.slice(materialId.indexOf(":") + 1) : materialId;
  return slug.split("/").pop() ?? slug;
}

function HeldFamily({ family }: { family: HeldFamilyView }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const approve = () => {
    if (pending) return;
    startTransition(async () => {
      setResult(await approveHeldMaterial({ profileId: family.profileId }));
    });
  };

  return (
    <li className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border border-[var(--dpf-warning)] text-[var(--dpf-warning)]">
          Held for review
        </span>
        <span className="text-sm font-medium text-[var(--dpf-text)] min-w-0 flex-1">
          {family.professionKey}
        </span>
        <span className="text-xs text-[var(--dpf-muted)] shrink-0">
          {family.rows.length} {family.rows.length === 1 ? "page" : "pages"}
        </span>
      </div>

      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
        This is a high-stakes craft area, so its doctrine was not made live
        automatically. Until you approve it, this coworker falls back to general
        platform doctrine instead of its own craft judgement.
      </p>

      {result ? (
        <p
          className={`mt-2 ml-1 text-xs ${
            result.ok ? "text-[var(--dpf-success)]" : "text-[var(--dpf-danger)]"
          }`}
        >
          {result.ok ? "✓ " : ""}
          {result.message}
        </p>
      ) : !open ? (
        <div className="mt-2 ml-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
          >
            Review this →
          </button>
        </div>
      ) : (
        <div className="mt-2 ml-1">
          <ul className="mb-2 flex flex-col gap-1">
            {family.rows.map((row) => (
              <li key={row.materialId} className="text-xs text-[var(--dpf-text)]">
                <span className="font-medium">{pageLabel(row.materialId)}</span>
                <span className="text-[var(--dpf-muted)]">
                  {" "}
                  — {row.sourceType}, evidence {row.evidenceGrade}
                </span>
                {row.summary ? (
                  <span className="block text-[var(--dpf-muted)]">{row.summary}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={approve}
              disabled={pending}
              className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-60"
            >
              {pending ? "Approving…" : "Approve for use"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-60"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function HeldMaterialList({ families }: { families: HeldFamilyView[] }) {
  if (families.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-1 text-sm font-semibold text-[var(--dpf-text)]">
        Craft doctrine waiting on you
      </h2>
      <p className="mb-2 text-xs text-[var(--dpf-muted)]">
        Doctrine for these areas was written but deliberately not switched on,
        because the subject matter is high-stakes. It stays inactive until you
        approve it.
      </p>
      <ul className="flex flex-col gap-2">
        {families.map((family) => (
          <HeldFamily key={family.profileId} family={family} />
        ))}
      </ul>
    </section>
  );
}
