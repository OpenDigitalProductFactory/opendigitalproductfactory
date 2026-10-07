"use client";
import { useState } from "react";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { sectionDisplayName } from "@/lib/storefront/content-fit";
import type { ResidueGroup } from "@/lib/storefront/content-fit";
import { editableSectionTextFields, readSectionText } from "@/lib/storefront/section-text";
import { SectionTextDialog } from "./SectionTextDialog";
import {
  RowActionSheet,
  MutationStatus,
  useRowMutations,
  confirmPublicChange,
  GeneratedResidueBanner,
  type RowAction,
} from "./content-editing-ui";

type Section = {
  id: string;
  type: string;
  title: string | null;
  sortOrder: number;
  isVisible: boolean;
  content?: unknown;
};

type Props = {
  storefrontId: string;
  sections: Section[];
  vocabulary: ArchetypeVocabulary;
  isPublished: boolean;
  residueGroups: ResidueGroup[];
};

export function SectionsManager({ storefrontId, sections: initial, vocabulary, isPublished, residueGroups }: Props) {
  const [sections, setSections] = useState(initial);
  const [editing, setEditing] = useState<Section | null>(null);
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

  // Returns an error message for the dialog, or null on success.
  async function saveText(section: Section, text: Record<string, string>): Promise<string | null> {
    const res = await fetch(`/api/storefront/admin/sections/${section.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return body?.error ?? "The text could not be saved. Try again.";
    }
    const content = { ...((section.content as Record<string, unknown> | null) ?? {}) };
    for (const [key, value] of Object.entries(text)) {
      if (value.trim()) content[key] = value.trim();
      else delete content[key];
    }
    setSections((prev) => prev.map((s) => (s.id === section.id ? { ...s, content } : s)));
    return null;
  }

  return (
    <div>
      {editing && (
        <SectionTextDialog
          sectionName={sectionDisplayName(editing, vocabulary)}
          sectionType={editing.type}
          initialText={readSectionText(editing.type, editing.content)}
          onSave={(text) => saveText(editing, text)}
          onClose={() => setEditing(null)}
        />
      )}
      <GeneratedResidueBanner storefrontId={storefrontId} groups={residueGroups} isPublished={isPublished} />

      <h2 className="mb-4 text-base font-semibold text-[var(--dpf-text)]">Your public page sections</h2>
      <div className="flex flex-col gap-2">
        {sections.map((s, idx) => {
          const name = sectionDisplayName(s, vocabulary);
          const visibleState = mutations.get(`${s.id}:visible`);
          const orderState = mutations.get(`${s.id}:order`);
          const rowState = visibleState.phase !== "idle" ? visibleState : orderState;

          const actions: RowAction[] = [
            ...(editableSectionTextFields(s.type).length > 0
              ? [{ label: `Edit ${name} text`, onSelect: () => setEditing(s) }]
              : []),
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
