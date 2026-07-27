"use client";

// EP-AI-WORKFORCE-001 (HRIS surface) — client tab switcher for the coworker
// "employee record". Panels are server-rendered and passed in as children in
// the same order as `tabs`, so all data fetching/rendering stays server-side
// (no prop serialization). This component owns only the active-tab state.

import { Children, useEffect, useState } from "react";

export type CoworkerTab = { id: string; label: string; badge?: string | null };

export function CoworkerRecordTabs({
  tabs,
  children,
}: {
  tabs: CoworkerTab[];
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const panels = Children.toArray(children);

  useEffect(() => {
    function restoreSection() {
      const requested = window.location.hash.slice(1);
      const index = tabs.findIndex((tab) => tab.id === requested);
      setActive(index >= 0 ? index : 0);
    }

    restoreSection();
    window.addEventListener("hashchange", restoreSection);
    return () => window.removeEventListener("hashchange", restoreSection);
  }, [tabs]);

  function activateTab(index: number) {
    const next = Math.max(0, Math.min(tabs.length - 1, index));
    setActive(next);
    const tab = tabs[next];
    if (!tab) return;
    const url = new URL(window.location.href);
    url.hash = next === 0 ? "" : tab.id;
    window.history.replaceState(window.history.state, "", url);
  }

  function focusTab(index: number) {
    const next = Math.max(0, Math.min(tabs.length - 1, index));
    activateTab(next);
    window.requestAnimationFrame(() => {
      document.getElementById(`tab-${tabs[next]?.id}`)?.focus();
    });
  }

  return (
    <div>
      <label className="mb-4 block sm:hidden">
        <span className="mb-1 block text-xs font-medium text-[var(--dpf-muted)]">
          Coworker section
        </span>
        <select
          value={active}
          onChange={(event) => activateTab(Number(event.target.value))}
          className="h-11 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm text-[var(--dpf-text)]"
        >
          {tabs.map((tab, index) => (
            <option key={tab.id} value={index}>
              {tab.label}
              {tab.badge ? ` (${tab.badge})` : ""}
            </option>
          ))}
        </select>
      </label>
      <div
        role="tablist"
        aria-label="Coworker record"
        className="mb-5 hidden gap-1 overflow-x-auto border-b border-[var(--dpf-border)] sm:flex"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === i}
            aria-controls={`panel-${tab.id}`}
            type="button"
            onClick={() => activateTab(i)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                focusTab((i + 1) % tabs.length);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusTab((i - 1 + tabs.length) % tabs.length);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusTab(0);
              } else if (event.key === "End") {
                event.preventDefault();
                focusTab(tabs.length - 1);
              }
            }}
            tabIndex={active === i ? 0 : -1}
            className={[
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-t-md border border-b-2 px-3 text-xs font-medium",
              active === i
                ? "border-[var(--dpf-border-strong)] border-b-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                : "border-transparent text-[var(--dpf-text-secondary)] hover:text-[var(--dpf-text)]",
            ].join(" ")}
          >
            {tab.label}
            {tab.badge ? (
              <span className="rounded bg-[var(--dpf-accent-soft)] px-1.5 text-xs font-semibold text-[var(--dpf-accent)]">
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== i}
        >
          {panels[i]}
        </div>
      ))}
    </div>
  );
}
