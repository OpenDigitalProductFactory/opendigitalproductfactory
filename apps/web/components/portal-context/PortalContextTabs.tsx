"use client";

import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";

type TabItem = {
  id: string;
  label: string;
  panel: ReactNode;
};

export function PortalContextTabs({ tabs }: { tabs: TabItem[] }) {
  const baseId = useId();
  const [selected, setSelected] = useState(tabs[0]?.id ?? "");
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusTab(index: number) {
    const next = (index + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (!tab) return;
    setSelected(tab.id);
    buttonRefs.current[next]?.focus();
  }

  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label="Portal context sections" className="flex gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-1">
        {tabs.map((tab, index) => {
          const active = tab.id === selected;
          const tabId = `${baseId}-${tab.id}-tab`;
          const panelId = `${baseId}-${tab.id}-panel`;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  focusTab(index + 1);
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  focusTab(index - 1);
                }
                if (event.key === "Home") {
                  event.preventDefault();
                  focusTab(0);
                }
                if (event.key === "End") {
                  event.preventDefault();
                  focusTab(tabs.length - 1);
                }
              }}
              className={[
                "min-h-10 rounded px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]",
                active
                  ? "bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
                  : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => {
        const active = tab.id === selected;
        return (
          <div
            key={tab.id}
            id={`${baseId}-${tab.id}-panel`}
            role="tabpanel"
            aria-labelledby={`${baseId}-${tab.id}-tab`}
            hidden={!active}
            className="min-h-0"
          >
            {active ? tab.panel : null}
          </div>
        );
      })}
    </div>
  );
}
