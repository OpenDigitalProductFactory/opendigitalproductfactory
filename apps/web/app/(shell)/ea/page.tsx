// apps/web/app/(shell)/ea/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { EaTabNav } from "@/components/ea/EaTabNav";
import { ReferenceModelSummary } from "@/components/ea/ReferenceModelSummary";
import { getReferenceModelsSummary } from "@/lib/ea-data";

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
  const [views, models] = await Promise.all([
    prisma.eaView.findMany({
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
    }),
    getReferenceModelsSummary(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Enterprise Architecture</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {views.length} view{views.length !== 1 ? "s" : ""}
        </p>
      </div>

      <EaTabNav />

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
              EA Conformance
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">Reference Models</h2>
          </div>
          <Link
            href="/ea/models"
            className="text-xs font-medium text-[var(--dpf-accent)] hover:text-white"
          >
            Browse all
          </Link>
        </div>
        <ReferenceModelSummary models={models} />
      </section>

      {views.length > 0 ? (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <button
              disabled
              style={{ padding: "6px 14px", background: "#7c8cf8", border: "none", borderRadius: 5, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "not-allowed", opacity: 0.5 }}
              title="New view creation coming soon"
            >
              + New view
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {views.map((v) => (
              <Link key={v.id} href={`/ea/views/${v.id}`} style={{ textDecoration: "none" }}>
                <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
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
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--dpf-muted)]">
          No views yet. Views will appear here once the modeling canvas is available.
        </p>
      )}
    </div>
  );
}
