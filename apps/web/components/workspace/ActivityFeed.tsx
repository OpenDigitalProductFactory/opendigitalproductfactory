"use client";

import { useState } from "react";
import type { FeedItem } from "@/lib/activity-feed-data";

const SECTION_CONFIG = {
  action: { label: "Action Required", color: "#fbbf24", defaultOpen: true },
  awareness: { label: "Awareness", color: "#38bdf8", defaultOpen: true },
  history: { label: "Recent History", color: "#8888a0", defaultOpen: false },
} as const;

type Props = {
  items: FeedItem[];
};

export function ActivityFeed({ items }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(Object.entries(SECTION_CONFIG).filter(([, v]) => !v.defaultOpen).map(([k]) => k)),
  );

  function toggleSection(section: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  const sections = (["action", "awareness", "history"] as const).map((key) => ({
    key,
    ...SECTION_CONFIG[key],
    items: items.filter((i) => i.section === key),
  }));

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center">
        <p className="text-xs text-[var(--dpf-muted)]">No activity to show. Everything is up to date.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] overflow-hidden">
      {sections.map((section) => {
        if (section.items.length === 0) return null;
        const isCollapsed = collapsed.has(section.key);

        return (
          <div key={section.key}>
            {/* Section header */}
            <button
              type="button"
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between px-4 py-2 border-b border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: section.color }} />
                <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: section.color }}>
                  {section.label}
                </span>
                <span className="text-[10px] text-[var(--dpf-muted)]">({section.items.length})</span>
              </div>
              <span className="text-[10px] text-[var(--dpf-muted)]">{isCollapsed ? "+" : "\u2212"}</span>
            </button>

            {/* Section items */}
            {!isCollapsed && (
              <div>
                {section.items.map((item) => (
                  <a
                    key={item.id}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--dpf-border)] last:border-b-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <span className="text-sm shrink-0">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{item.title}</p>
                      <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5">
                        {item.person ? `${item.person} · ` : ""}{new Date(item.date).toLocaleDateString()}
                      </p>
                    </div>
                    {item.status && item.statusColor && (
                      <span
                        className="shrink-0 text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: `${item.statusColor}15`, color: item.statusColor }}
                      >
                        {item.status}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
