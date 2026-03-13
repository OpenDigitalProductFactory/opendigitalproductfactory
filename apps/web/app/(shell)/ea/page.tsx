// apps/web/app/(shell)/ea/page.tsx
import { prisma } from "@dpf/db";

const LAYOUT_LABELS: Record<string, string> = {
  graph:    "Graph",
  swimlane: "Swimlane",
  matrix:   "Matrix",
  layered:  "Layered",
};

const SCOPE_LABELS: Record<string, string> = {
  portfolio: "Portfolio",
  domain:    "Domain",
  custom:    "Custom",
};

export default async function EaPage() {
  const views = await prisma.eaView.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id:          true,
      name:        true,
      description: true,
      layoutType:  true,
      scopeType:   true,
      scopeRef:    true,
      createdAt:   true,
      notation:    { select: { name: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Enterprise Architecture</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {views.length} view{views.length !== 1 ? "s" : ""}
        </p>
      </div>

      {views.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {views.map((v) => (
            <div
              key={v.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {v.notation.name} · {LAYOUT_LABELS[v.layoutType] ?? v.layoutType}
              </p>
              <p className="text-sm font-semibold text-white leading-tight mb-1">
                {v.name}
              </p>
              {v.description != null && (
                <p className="text-[10px] text-[var(--dpf-muted)] line-clamp-2 mb-1.5">
                  {v.description}
                </p>
              )}
              <p className="text-[10px] text-[var(--dpf-muted)]">
                {SCOPE_LABELS[v.scopeType] ?? v.scopeType}
                {v.scopeRef != null ? ` · ${v.scopeRef}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--dpf-muted)]">
          No views yet. Views will appear here once the modeling canvas is available.
        </p>
      )}
    </div>
  );
}
