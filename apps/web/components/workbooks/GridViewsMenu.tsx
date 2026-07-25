"use client";

// Universal Grid & Workbooks — the "Views" dropdown (EP-GRID-WORKBOOKS).
//
// One saved-views control for every grid. The Grid owns the backend (server-side
// WorkbookView for custom tables, localStorage for platform grids) and passes the
// resolved list + handlers here; this component is pure UI over them. Naming a new
// view uses an inline input (not window.prompt, which blocks automation and reads
// worse). Applying a view is the Grid's job — this only signals intent.

import { useState, type ReactNode } from "react";
import { Bookmark } from "lucide-react";
import type { NamedView } from "./grid-named-views";

export interface GridViewsMenuProps {
  views: NamedView[];
  activeViewId: string | null;
  /** true → server-side shared views (custom tables); false → personal (localStorage). */
  shared: boolean;
  onApply: (view: NamedView) => void;
  /** Capture the current grid state under this name (Grid builds the snapshot). */
  onSaveAs: (name: string) => void;
  onDelete: (viewId: string) => void;
  /** Pass null to clear the default. */
  onSetDefault: (viewId: string | null) => void;
}

const ITEM = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--dpf-surface-2)]";

export function GridViewsMenu({
  views,
  activeViewId,
  shared,
  onApply,
  onSaveAs,
  onDelete,
  onSetDefault,
}: GridViewsMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const active = views.find((v) => v.viewId === activeViewId);
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSaveAs(trimmed);
    setName("");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        title="Saved views"
      >
        <Bookmark size={15} aria-hidden />
        {active ? active.name : "Views"}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          {/* click-away layer */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 flex w-72 flex-col gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 shadow-lg"
          >
            <div className="px-2 py-1 text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
              {shared ? "Shared views" : "My views"}
            </div>
            {views.length === 0 && (
              <div className="px-2 py-1 text-sm text-[var(--dpf-muted)]">No saved views yet.</div>
            )}
            {views.map((v) => (
              <div key={v.viewId} className="flex items-center gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onApply(v);
                    setOpen(false);
                  }}
                  className={`${ITEM} ${v.viewId === activeViewId ? "font-medium text-[var(--dpf-text)]" : "text-[var(--dpf-text)]"}`}
                >
                  <span className="flex-1 truncate">{v.name}</span>
                  {v.isDefault && (
                    <span className="text-xs text-[var(--dpf-muted)]" title="Default view">
                      default
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onSetDefault(v.isDefault ? null : v.viewId)}
                  aria-label={v.isDefault ? `Unset ${v.name} as default` : `Set ${v.name} as default`}
                  title={v.isDefault ? "Unset default" : "Set as default"}
                  className="rounded px-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                >
                  {v.isDefault ? "★" : "☆"}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(v.viewId)}
                  aria-label={`Delete view ${v.name}`}
                  title="Delete view"
                  className="rounded px-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-1 border-t border-[var(--dpf-border)] pt-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                placeholder="Save current view as…"
                aria-label="New view name"
                className="min-w-0 flex-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]"
              />
              <button
                type="button"
                onClick={save}
                disabled={!name.trim()}
                className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
