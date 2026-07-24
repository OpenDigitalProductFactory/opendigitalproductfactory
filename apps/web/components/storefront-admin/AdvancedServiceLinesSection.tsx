"use client";

import { useState } from "react";
import { ServiceLinesPanel } from "./ServiceLinesPanel";
import type { StorefrontCompositionView } from "@/lib/storefront/composition-view";

interface AvailableArchetype {
  archetypeSlug: string;
  name: string;
  category: string;
  itemCount: number;
  sectionCount: number;
}

interface Props {
  storefrontId: string;
  view: StorefrontCompositionView;
  availableArchetypes: AvailableArchetype[];
}

/**
 * BI-6F9D487C — the add/remove service-line control offers every storefront
 * archetype not already active (cross-industry, ~101 options at time of
 * writing). That belongs behind explicit disclosure, not sitting open on the
 * ordinary owner dashboard next to everyday setup/status — same collapsed
 * pattern as the "Generated content & recovery" section in
 * `StorefrontSetupPanel.tsx`. Collapsed by default.
 */
export function AdvancedServiceLinesSection({ storefrontId, view, availableArchetypes }: Props) {
  const [open, setOpen] = useState(false);
  const secondaryCount = view.secondaries.length;

  return (
    <section
      className="border border-[var(--dpf-border)]"
      style={{ borderRadius: 10, overflow: "hidden", marginTop: 24 }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
        style={{
          width: "100%",
          border: "none",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Advanced: service lines</span>
          <span className="text-[var(--dpf-muted)]" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
            {secondaryCount} secondary line{secondaryCount !== 1 ? "s" : ""} active ·{" "}
            {availableArchetypes.length} other business type{availableArchetypes.length !== 1 ? "s" : ""}{" "}
            available to add.
          </span>
        </span>
        <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {open ? "Hide ▲" : "Open ▼"}
        </span>
      </button>

      {open && (
        <ServiceLinesPanel storefrontId={storefrontId} view={view} availableArchetypes={availableArchetypes} />
      )}
    </section>
  );
}
