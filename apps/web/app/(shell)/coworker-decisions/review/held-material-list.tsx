"use client";

// The release affordance for craft doctrine held by the high-stakes review
// hold (BI-5F3BFD13).
//
// Mirrors WeightProposalForm's open/closed disclosure. The evidence is already
// structured (which family, which pages, what grade), so this shows that
// evidence and offers a single Approve — there is no Reject, because the hold
// already IS the rejection until someone acts.
//
// Composed from ui/Surface and ui/Button rather than re-typed card and control
// markup (BI-D25ED55D).

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";

import type { ActionResult } from "@/lib/shared/action-result";

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
  const [result, setResult] = useState<ActionResult<string> | null>(null);
  const [pending, startTransition] = useTransition();

  const approve = () => {
    if (pending) return;
    startTransition(async () => {
      setResult(await approveHeldMaterial({ profileId: family.profileId }));
    });
  };

  return (
    <Surface as="li" level={1} padding="sm" rounded="md">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-dpf-body font-medium text-[var(--dpf-text)] min-w-0 flex-1">
          {family.professionKey}
        </span>
        <span className="text-dpf-caption text-[var(--dpf-muted)] shrink-0">
          {family.rows.length} {family.rows.length === 1 ? "page" : "pages"}
        </span>
      </div>

      {result ? (
        <p
          className={`mt-2 ml-1 text-dpf-caption ${
            result.ok ? "text-[var(--dpf-success)]" : "text-[var(--dpf-danger)]"
          }`}
        >
          {result.ok ? `✓ ${result.data}` : result.error}
        </p>
      ) : !open ? (
        <div className="mt-2 ml-1">
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Review this →
          </Button>
        </div>
      ) : (
        <div className="mt-2 ml-1">
          <p className="mb-2 text-dpf-caption text-[var(--dpf-muted)]">
            Until you approve it, this coworker uses general platform doctrine
            instead of its own craft judgement.
          </p>
          <ul className="mb-2 flex flex-col gap-1">
            {family.rows.map((row) => (
              <li key={row.materialId} className="text-dpf-caption text-[var(--dpf-text)]">
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
            <Button variant="primary" size="sm" onClick={approve} disabled={pending}>
              {pending ? "Approving…" : "Approve for use"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Not now
            </Button>
          </div>
        </div>
      )}
    </Surface>
  );
}

export function HeldMaterialList({ families }: { families: HeldFamilyView[] }) {
  if (families.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-1 text-dpf-body font-semibold text-[var(--dpf-text)]">
        Craft doctrine waiting on you
      </h2>
      <p className="mb-2 text-dpf-caption text-[var(--dpf-muted)]">
        These areas are high-stakes, so their doctrine was written but not
        switched on until you approve it.
      </p>
      <ul className="flex flex-col gap-2">
        {families.map((family) => (
          <HeldFamily key={family.profileId} family={family} />
        ))}
      </ul>
    </section>
  );
}
