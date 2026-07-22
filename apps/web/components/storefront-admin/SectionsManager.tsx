"use client";
import { useState } from "react";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { sectionDisplayName } from "@/lib/storefront/content-fit";
import type { ResidueGroup } from "@/lib/storefront/content-fit";
import {
  RowActionSheet,
  MutationStatus,
  useRowMutations,
  confirmPublicChange,
  GeneratedResidueBanner,
  type RowAction,
} from "./content-editing-ui";

type Section = { id: string; type: string; title: string | null; sortOrder: number; isVisible: boolean };

type Props = {
  storefrontId: string;
  sections: Section[];
  vocabulary: ArchetypeVocabulary;
  isPublished: boolean;
  residueGroups: ResidueGroup[];
};

export function SectionsManager({ storefrontId, sections: initial, vocabulary, isPublished, residueGroups }: Props) {
  const [sections, setSections] = useState(initial);
  const mutations = useRowMutations();
  const publicWhere = "your public page";

  async function toggleVisibility(section: Section) {
    const name = sectionDisplayName(section, vocabulary);
    const next = !section.isVisible;
    const confirmed = await confirmPublicChange({
      verb: next ? "Show" : "Hide",
      target: `${name} section`,
      where: publicWhere,
      isPublished,
    });
    if (!confirmed) return;

    setSections((prev) => prev.map((s) => (s.id === section.id ? { ...s, isVisible: next } : s)));
    try {
      await mutations.run(`${section.id}:visible`, async () => {
        const res = await fetch(`/api/storefront/admin/sections/${section.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isVisible: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });
    } catch {
      setSections((prev) => prev.map((s) => (s.id === section.id ? { ...s, isVisible: section.isVisible } : s)));
    }
  }

  async function moveSection(section: Section, direction: "up" | "down") {
    const idx = sections.findIndex((s) => s.id === section.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sections.length) return;

    const snapshot = sections;
    const updated = [...sections];
    const tmp = updated[idx]!;
    updated[idx] = updated[swapIdx]!;
    updated[swapIdx] = tmp;
    const reordered = updated.map((s, i) => ({ ...s, sortOrder: i }));
    setSections(reordered);

    try {
      await mutations.run(`${section.id}:order`, async () => {
        const res = await fetch(`/api/storefront/admin/sections/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storefrontId, order: reordered.map((s) => s.id) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });
    } catch {
      setSections(snapshot);
    }
  }

  return (
    <div>
      <GeneratedResidueBanner storefrontId={storefrontId} groups={residueGroups} isPublished={isPublished} />

      <h2 className="mb-4 text-base font-semibold text-[var(--dpf-text)]">Your public page sections</h2>
      <div className="flex flex-col gap-2">
        {sections.map((s, idx) => {
          const name = sectionDisplayName(s, vocabulary);
          const visibleState = mutations.get(`${s.id}:visible`);
          const orderState = mutations.get(`${s.id}:order`);
          const rowState = visibleState.phase !== "idle" ? visibleState : orderState;

          const actions: RowAction[] = [
            {
              label: s.isVisible ? `Hide ${name} section from ${publicWhere}` : `Show ${name} section on ${publicWhere}`,
              onSelect: () => void toggleVisibility(s),
            },
            { label: `Move ${name} up`, onSelect: () => void moveSection(s, "up"), disabled: idx === 0 },
            {
              label: `Move ${name} down`,
              onSelect: () => void moveSection(s, "down"),
              disabled: idx === sections.length - 1,
            },
          ];

          return (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 py-2.5"
              style={{ opacity: s.isVisible ? 1 : 0.55 }}
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-[var(--dpf-text)]">{name}</span>
                {!s.isVisible && (
                  <span className="ml-2 rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--dpf-muted)]">
                    Hidden
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <MutationStatus
                  state={rowState}
                  onRetry={() => mutations.retry(visibleState.phase === "failed" ? `${s.id}:visible` : `${s.id}:order`)}
                  label="section"
                />
                <RowActionSheet rowLabel={`${name} section`} actions={actions} />
              </div>
            </div>
          );
        })}
      </div>

      {sections.length === 0 && (
        <p className="py-8 text-center text-sm text-[var(--dpf-muted)]">No sections on your page yet.</p>
      )}
    </div>
  );
}
