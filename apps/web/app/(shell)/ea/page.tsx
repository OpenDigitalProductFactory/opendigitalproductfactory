// apps/web/app/(shell)/ea/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { EaTabNav } from "@/components/ea/EaTabNav";
import { ReferenceModelSummary } from "@/components/ea/ReferenceModelSummary";
import { CreateViewButton } from "@/components/ea/CreateViewButton";
import { It4itConformanceCard } from "@/components/ea/It4itConformanceCard";
import { ArchitectureProjectionActions } from "@/components/ea/ArchitectureProjectionActions";
import { getReferenceModelsSummary, getIt4itCoverageHeatmap } from "@/lib/ea-data";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

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
  const [views, models, it4itCoverage, session] = await Promise.all([
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
    getIt4itCoverageHeatmap("it4it_v3_0_1").catch(() => null),
    auth(),
  ]);
  const canManageArchitecture = Boolean(
    session?.user &&
    can(
      {
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      },
      "manage_ea_model",
    ),
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Architecture</h1>
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
            <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">Reference Models</h2>
          </div>
          <Link
            href="/ea/models"
            className="text-xs font-medium text-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
          >
            Browse all
          </Link>
        </div>
        <ReferenceModelSummary models={models} />
      </section>

      {it4itCoverage && <It4itConformanceCard data={it4itCoverage} />}

      {canManageArchitecture ? (
        <div className="mb-4 flex flex-wrap items-start justify-end gap-3">
          <ArchitectureProjectionActions />
          <CreateViewButton />
        </div>
      ) : null}

      {views.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {views.map((v) => (
              <Link key={v.id} href={`/ea/views/${v.id}`} style={{ textDecoration: "none" }}>
                <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
                  <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                    {v.notation.name} · {LAYOUT_LABELS[v.layoutType] ?? v.layoutType}
                  </p>
                  <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight mb-1">
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
        <div className="text-center py-8">
          <p className="text-sm text-[var(--dpf-muted)] mb-4">
            No views yet. Create your first view to start modeling.
          </p>
          <p className="text-xs text-[var(--dpf-muted)]">
            {canManageArchitecture
              ? "Use New view above, or refresh live projections to load governed architecture."
              : "No architecture views are available for this workspace yet."}
          </p>
        </div>
      )}
    </div>
  );
}
