"use client";

import { useState } from "react";

import { WorkspaceTiles } from "@/components/shell/WorkspaceTiles";
import type { TileStatus } from "@/components/shell/WorkspaceTiles";
import type { WorkspaceSection } from "@/lib/permissions";

type WorkspaceAreaLauncherProps = {
  sections: WorkspaceSection[];
  tileStatus: Record<string, TileStatus>;
};

export function WorkspaceAreaLauncher({ sections, tileStatus }: WorkspaceAreaLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (sections.length === 0) return null;

  return (
    <section
      aria-labelledby="workspace-area-launcher-title"
      className="mt-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Launcher</p>
          <h2 id="workspace-area-launcher-title" className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
            Work areas
          </h2>
        </div>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls="workspace-area-launcher-content"
          onClick={() => setIsOpen((current) => !current)}
          className="inline-flex w-fit items-center rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          {isOpen ? "Hide areas" : "Show areas"}
        </button>
      </div>

      {isOpen && (
        <div id="workspace-area-launcher-content" className="space-y-6 border-t border-[var(--dpf-border)] p-4">
          {sections.map((section) => (
            <section key={section.key}>
              <div className="mb-3">
                <p className="text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">
                  {section.label}
                </p>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">{section.description}</p>
              </div>
              <WorkspaceTiles tiles={section.tiles} tileStatus={tileStatus} />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
