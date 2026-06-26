"use client";

// EP-COWORKER-RT / WS2 — the Workday-style Related Actions ("…") menu on the
// coworker record header. Pure navigation: the data-model edges become links
// (manage prompt, skills catalog, model/priority grid, authority). Read-only and
// low-risk — no mutations happen here; the editing lives in the tabs. Theme
// tokens only; closes on outside-click and Escape.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type ActionLink = { label: string; href: string };

export function RecordActionsMenu({ actions }: { actions: ActionLink[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: "auto" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Related actions"
        onClick={() => setOpen((v) => !v)}
        style={{
          appearance: "none",
          border: "1px solid var(--dpf-border)",
          background: open ? "var(--dpf-surface-2)" : "transparent",
          color: "var(--dpf-text-secondary)",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: "3px 10px",
          fontWeight: 700,
        }}
      >
        …
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 50,
            minWidth: 200,
            padding: 4,
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-1)",
            boxShadow: "0 6px 20px color-mix(in srgb, var(--dpf-text) 14%, transparent)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "7px 10px",
                borderRadius: 5,
                fontSize: 12,
                color: "var(--dpf-text)",
                textDecoration: "none",
              }}
            >
              {a.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
