"use client";

// EP-AI-WORKFORCE-001 (HRIS surface) — client tab switcher for the coworker
// "employee record". Panels are server-rendered and passed in as children in
// the same order as `tabs`, so all data fetching/rendering stays server-side
// (no prop serialization). This component owns only the active-tab state.

import { useState, Children } from "react";

export type CoworkerTab = { id: string; label: string; badge?: string | null };

const tabBtn = (active: boolean): React.CSSProperties => ({
  appearance: "none",
  background: active ? "var(--dpf-surface-2)" : "transparent",
  border: "1px solid",
  borderColor: active ? "var(--dpf-border-strong)" : "transparent",
  borderBottomColor: active ? "var(--dpf-accent)" : "transparent",
  color: active ? "var(--dpf-text)" : "var(--dpf-text-secondary)",
  fontSize: 12,
  fontWeight: active ? 600 : 500,
  padding: "7px 14px",
  borderRadius: "6px 6px 0 0",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
});

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: "0 6px",
  borderRadius: 999,
  background: "var(--dpf-accent-soft)",
  color: "var(--dpf-accent)",
};

export function CoworkerRecordTabs({
  tabs,
  children,
}: {
  tabs: CoworkerTab[];
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const panels = Children.toArray(children);

  return (
    <div>
      <div
        role="tablist"
        aria-label="Coworker record"
        style={{
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
          borderBottom: "1px solid var(--dpf-border)",
          marginBottom: 18,
        }}
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === i}
            aria-controls={`panel-${tab.id}`}
            type="button"
            onClick={() => setActive(i)}
            style={tabBtn(active === i)}
          >
            {tab.label}
            {tab.badge ? <span style={badgeStyle}>{tab.badge}</span> : null}
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
