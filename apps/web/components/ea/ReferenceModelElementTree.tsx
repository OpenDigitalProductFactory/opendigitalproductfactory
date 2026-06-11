"use client";

import { useState } from "react";
import type { ReferenceModelElementNode } from "@/lib/explore/reference-model-types";

interface Props {
  elements: ReferenceModelElementNode[];
}

function buildTree(elements: ReferenceModelElementNode[]) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const childrenOf = new Map<string | null, ReferenceModelElementNode[]>();

  for (const el of elements) {
    const key = el.parentId ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(el);
  }

  // Sort each level alphabetically by name (seed order may vary by kind).
  for (const children of childrenOf.values()) {
    children.sort((a, b) => a.name.localeCompare(b.name));
  }

  return { byId, childrenOf };
}

function ServiceDomainRow({ sd }: { sd: ReferenceModelElementNode }) {
  const props = sd.properties as Record<string, unknown>;
  const hasApi = props?.semanticApi === true;
  const dpfCapabilityKey = typeof props?.dpfCapabilityKey === "string" ? props.dpfCapabilityKey : null;

  return (
    <div className="flex items-start gap-2 py-1.5 pl-4 border-l border-[var(--dpf-border)]">
      <span
        title={hasApi ? "Published Semantic API" : "No Semantic API yet"}
        className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${hasApi ? "bg-green-500" : "bg-[var(--dpf-border)]"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs text-[var(--dpf-text)] leading-snug">{sd.name}</p>
          {dpfCapabilityKey && (
            <span
              title={`In DPF banking capability map (${dpfCapabilityKey})`}
              className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-[var(--dpf-accent-subtle,#1e3a5f)] text-[var(--dpf-accent,#60a5fa)] leading-none"
            >
              DPF
            </span>
          )}
        </div>
        {sd.description && (
          <p className="text-[11px] text-[var(--dpf-muted)] leading-snug mt-0.5 line-clamp-2">
            {sd.description}
          </p>
        )}
      </div>
    </div>
  );
}

function BusinessDomainSection({
  domain,
  serviceDomains,
}: {
  domain: ReferenceModelElementNode;
  serviceDomains: ReferenceModelElementNode[];
}) {
  const [open, setOpen] = useState(false);
  const apiCount = serviceDomains.filter(
    (sd) => (sd.properties as Record<string, unknown>)?.semanticApi === true
  ).length;
  const dpfCount = serviceDomains.filter(
    (sd) => typeof (sd.properties as Record<string, unknown>)?.dpfCapabilityKey === "string"
  ).length;

  return (
    <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--dpf-surface-2)] rounded"
      >
        <span className="text-xs font-medium text-[var(--dpf-text)]">{domain.name}</span>
        <span className="flex-shrink-0 text-[10px] text-[var(--dpf-muted)]">
          {serviceDomains.length} SD{serviceDomains.length !== 1 ? "s" : ""}
          {apiCount > 0 && ` · ${apiCount} with API`}
          {dpfCount > 0 && ` · ${dpfCount} in DPF`}
          <span className="ml-1.5">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-0.5">
          {serviceDomains.map((sd) => (
            <ServiceDomainRow key={sd.id} sd={sd} />
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessAreaSection({
  area,
  childrenOf,
}: {
  area: ReferenceModelElementNode;
  childrenOf: Map<string | null, ReferenceModelElementNode[]>;
}) {
  const [open, setOpen] = useState(false);
  const domains = childrenOf.get(area.id) ?? [];
  const sdCount = domains.reduce(
    (n, d) => n + (childrenOf.get(d.id)?.length ?? 0),
    0
  );

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-0)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--dpf-surface-1)]"
      >
        <span className="text-sm font-semibold text-[var(--dpf-text)]">{area.name}</span>
        <span className="flex-shrink-0 text-xs text-[var(--dpf-muted)]">
          {domains.length} domains · {sdCount} service domains
          <span className="ml-2">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {domains.map((domain) => (
            <BusinessDomainSection
              key={domain.id}
              domain={domain}
              serviceDomains={childrenOf.get(domain.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ReferenceModelElementTree({ elements }: Props) {
  if (elements.length === 0) return null;

  const { childrenOf } = buildTree(elements);
  const roots = childrenOf.get(null) ?? [];

  if (roots.length === 0) return null;

  const totalSd = elements.filter((e) => e.kind === "service_domain").length;
  const apiSd = elements.filter(
    (e) => e.kind === "service_domain" && (e.properties as Record<string, unknown>)?.semanticApi === true
  ).length;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Service Landscape</h2>
          <p className="text-xs text-[var(--dpf-muted)]">
            {roots.length} Business Areas · {elements.filter((e) => e.kind === "business_domain").length} Business Domains ·{" "}
            {totalSd} Service Domains
          </p>
        </div>
        <p className="flex-shrink-0 text-[11px] text-[var(--dpf-muted)]">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500 mr-1 align-middle" />
          {apiSd} Semantic APIs published
        </p>
      </div>
      <div className="space-y-2">
        {roots.map((area) => (
          <BusinessAreaSection key={area.id} area={area} childrenOf={childrenOf} />
        ))}
      </div>
      <p className="mt-3 text-[11px] text-[var(--dpf-muted)]">
        Source: BIAN Service Landscape v14.0 — Value Chain View (bian.org).{" "}
        <span className="inline-block h-2 w-2 rounded-full bg-green-500 align-middle" /> = published Semantic API.{" "}
        <span className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-[var(--dpf-accent-subtle,#1e3a5f)] text-[var(--dpf-accent,#60a5fa)] leading-none align-middle">DPF</span>
        {" "}= in DPF banking capability map (active when a banking archetype is selected).
      </p>
    </section>
  );
}
