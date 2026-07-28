"use client";

import Link from "next/link";
import { useState } from "react";
import { Notice } from "@/components/ui/report-kit";

export function ProductContextActionPreview({
  scopeLabel,
  sourceKinds,
}: {
  scopeLabel: string;
  sourceKinds: string[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
      >
        Preview a demand review
      </button>
    );
  }

  return (
    <section
      aria-labelledby="product-action-preview-title"
      className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
    >
      <h2
        id="product-action-preview-title"
        className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
      >
        Preview: review product demand
      </h2>
      <dl className="mt-dpf-md grid gap-dpf-md text-dpf-body sm:grid-cols-2">
        <div>
          <dt className="font-dpf-medium text-[var(--dpf-text)]">Read scope</dt>
          <dd className="mt-dpf-2xs text-[var(--dpf-muted)]">{scopeLabel}</dd>
        </div>
        <div>
          <dt className="font-dpf-medium text-[var(--dpf-text)]">Sources</dt>
          <dd className="mt-dpf-2xs text-[var(--dpf-muted)]">
            {sourceKinds.length > 0 ? sourceKinds.join(", ") : "No connected sources"}
          </dd>
        </div>
        <div>
          <dt className="font-dpf-medium text-[var(--dpf-text)]">Proposed writes</dt>
          <dd className="mt-dpf-2xs text-[var(--dpf-muted)]">
            None from this page. Funding and backlog records remain in Delivery.
          </dd>
        </div>
        <div>
          <dt className="font-dpf-medium text-[var(--dpf-text)]">Schedule effect</dt>
          <dd className="mt-dpf-2xs text-[var(--dpf-muted)]">None</dd>
        </div>
      </dl>
      <Notice variant="info" title="Approval boundary" className="mt-dpf-md">
        Opening Delivery does not approve or fund demand. Any later mutation uses
        its existing governed preview and confirmation boundary.
      </Notice>
      <div className="mt-dpf-lg flex flex-wrap gap-dpf-sm">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm text-dpf-body text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          Cancel
        </button>
        <Link
          href="/delivery?view=flow"
          className="rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)]"
        >
          Continue to Delivery
        </Link>
      </div>
    </section>
  );
}
