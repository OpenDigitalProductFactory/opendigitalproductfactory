// apps/web/app/(shell)/ea/views/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { EaTabNav } from "@/components/ea/EaTabNav";

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

export default async function EaViewsPage() {
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
      _count:      { select: { elements: true } },
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

      <EaTabNav />

      {views.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {views.map((v) => (
            <Link key={v.id} href={`/ea/views/${v.id}`} style={{ textDecoration: "none" }}>
              <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)] transition-colors">
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
                <div className="flex items-center gap-3 text-[10px] text-[var(--dpf-muted)]">
                  <span>{SCOPE_LABELS[v.scopeType] ?? v.scopeType}{v.scopeRef ? ` · ${v.scopeRef}` : ""}</span>
                  <span>{v._count.elements} element{v._count.elements !== 1 ? "s" : ""}</span>
                  <span>{new Date(v.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-sm text-[var(--dpf-muted)] mb-2">
            No architecture views yet.
          </p>
          <p className="text-xs text-[var(--dpf-muted)]">
            Views are created from Reference Models or via the AI co-worker.
          </p>
        </div>
      )}
    </div>
  );
}
