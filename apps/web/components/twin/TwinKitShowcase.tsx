"use client";

// apps/web/components/twin/TwinKitShowcase.tsx
//
// Developer preview of the Operational Twin renderer (P3). An archetype switcher
// over a set of pre-derived examples, each rendered by the SAME <TwinView> from a
// real TwinProfile + a demo snapshot. Proves one renderer serves both lenses —
// physical space and non-physical boards.

import { useState } from "react";

import type { TwinProfile } from "@dpf/storefront-templates";

import { TwinView } from "./TwinView";
import type { TwinSnapshot } from "./snapshot";

export interface TwinExample {
  id: string;
  label: string;
  kind: string;
  template: string;
  profile: TwinProfile;
  snapshot: TwinSnapshot;
}

export interface TwinKitShowcaseProps {
  examples: TwinExample[];
}

export function TwinKitShowcase({ examples }: TwinKitShowcaseProps) {
  const [activeId, setActiveId] = useState(examples[0]?.id ?? "");
  const active = examples.find((e) => e.id === activeId) ?? examples[0];

  if (!active) {
    return (
      <p className="text-sm text-[var(--dpf-muted)]">No archetypes available to preview.</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Archetype"
        className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-1.5"
      >
        {examples.map((e) => {
          const on = e.id === active.id;
          return (
            <button
              key={e.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActiveId(e.id)}
              className="flex flex-col items-start rounded-md px-2.5 py-1.5 text-left transition-colors"
              style={
                on
                  ? { backgroundColor: "var(--dpf-accent-soft)", color: "var(--dpf-accent)" }
                  : { color: "var(--dpf-muted)" }
              }
            >
              <span className="text-xs font-medium">{e.label}</span>
              <span className="text-[10px] uppercase tracking-wide opacity-80">{e.kind}</span>
            </button>
          );
        })}
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{active.label}</h2>
          <span className="rounded-full bg-[var(--dpf-surface-3)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">
            {active.template}
            {active.profile.variant ? ` · ${active.profile.variant}` : ""}
          </span>
        </header>

        {/* key forces a fresh cog state per archetype switch */}
        <TwinView key={active.id} profile={active.profile} snapshot={active.snapshot} />
      </section>

      <p className="text-[11px] text-[var(--dpf-muted)]">
        Values are deterministic demo data (
        <code className="text-[var(--dpf-text-secondary)]">buildDemoTwinSnapshot</code>). The live{" "}
        <code className="text-[var(--dpf-text-secondary)]">LivingBusinessSnapshot</code> projection
        drops in behind the same shape.
      </p>
    </div>
  );
}
