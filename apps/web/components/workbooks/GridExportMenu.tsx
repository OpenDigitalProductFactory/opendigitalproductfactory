"use client";

// Universal Grid & Workbooks — the "Export" dropdown (EP-GRID-WORKBOOKS).
//
// One export control instead of a button per format: an "Export" button that opens
// a small menu to pick CSV or Excel (.xlsx). The Grid owns the actual download for
// each format and passes the handlers here; this is pure UI over them. Mirrors the
// GridViewsMenu pattern (plain toggle + click-away layer) for a consistent feel.

import { useState, type ReactNode } from "react";
import { Download } from "lucide-react";

export interface GridExportMenuProps {
  disabled?: boolean;
  onExportCsv: () => void;
  onExportXlsx: () => void;
}

const ITEM =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]";

export function GridExportMenu({ disabled, onExportCsv, onExportXlsx }: GridExportMenuProps): ReactNode {
  const [open, setOpen] = useState(false);

  const pick = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-40"
        title="Export the current view"
      >
        <Download size={15} aria-hidden />
        Export
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          {/* click-away layer */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 flex w-48 flex-col gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-1 shadow-lg"
          >
            <button type="button" role="menuitem" onClick={() => pick(onExportCsv)} className={ITEM}>
              <Download size={15} aria-hidden className="text-[var(--dpf-muted)]" />
              CSV (.csv)
            </button>
            <button type="button" role="menuitem" onClick={() => pick(onExportXlsx)} className={ITEM}>
              <Download size={15} aria-hidden className="text-[var(--dpf-muted)]" />
              Excel (.xlsx)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
