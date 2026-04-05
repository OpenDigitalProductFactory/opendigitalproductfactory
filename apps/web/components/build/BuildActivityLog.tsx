"use client";

type Activity = { id: string; tool: string; summary: string; createdAt: string | Date };

export function BuildActivityLog({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-widest mb-2">Activity</h3>
      <div className="space-y-1 max-h-48 overflow-auto">
        {activities.map((a) => (
          <div key={a.id} className="flex items-start gap-2 text-xs text-[var(--dpf-muted)]">
            <span className="shrink-0 tabular-nums">
              {new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="text-[var(--dpf-text-secondary)]">{a.summary}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
