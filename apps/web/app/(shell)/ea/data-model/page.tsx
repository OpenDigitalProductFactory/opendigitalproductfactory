// apps/web/app/(shell)/ea/data-model/page.tsx
// EP-DATA-ARCH Phase 3 (BI-759537CA): the Data Model aspect of the EA home.
// Surfaces the system-owned "Data Model" EaView (a live ERD mirrored from the
// Prisma schema) via the existing /ea/views/[id] renderer, plus the EaSnapshot
// evolution timeline. The viewpoint host is owned by EP-ARCH-NAV; this page
// owns the data-model content surface.
import Link from "next/link";
import { prisma } from "@dpf/db";
import { EaTabNav } from "@/components/ea/EaTabNav";

const MIRROR_ISSUE_TYPE = "mirror-duplicate-source-key";

export default async function EaDataModelPage() {
  const view = await prisma.eaView.findFirst({
    where: { scopeType: "data-model", scopeRef: "prisma" },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      notation: { select: { name: true } },
      _count: { select: { viewElements: true } },
    },
  });

  const snapshots = view
    ? await prisma.eaSnapshot.findMany({
        where: { viewId: view.id },
        orderBy: { id: "desc" },
        take: 8,
        select: { id: true, changeSummary: true, elementCount: true, relationshipCount: true },
      })
    : [];

  const openIssues = view
    ? await prisma.eaConformanceIssue.findMany({
        where: { viewId: view.id, issueType: MIRROR_ISSUE_TYPE, status: "open" },
        select: { id: true, message: true },
      })
    : [];

  const elementCount = view?._count.viewElements ?? 0;
  const populated = view != null && elementCount > 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Architecture</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Data Model — the logical data model mirrored from the Prisma schema as a live ERD, kept current by
          the data-architecture mirror.
        </p>
      </div>

      <EaTabNav />

      {openIssues.length > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--dpf-error)] bg-[var(--dpf-surface-1)] p-3">
          <p className="text-xs font-semibold text-[var(--dpf-error)]">
            Mirror halted — {openIssues.length} duplicate source-key issue{openIssues.length !== 1 ? "s" : ""}
          </p>
          <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">
            The data-model mirror stopped to avoid creating duplicate elements. Showing the last successful
            snapshot below until the conflict is resolved.
          </p>
        </div>
      )}

      {populated ? (
        <>
          <Link href={`/ea/views/${view!.id}`} style={{ textDecoration: "none" }}>
            <div className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:bg-[var(--dpf-surface-2)]">
              <p className="mb-1 font-mono text-[9px] text-[var(--dpf-muted)]">
                {view!.notation.name} · Live ERD
              </p>
              <p className="mb-1 text-sm font-semibold leading-tight text-[var(--dpf-text)]">{view!.name}</p>
              {view!.description != null && (
                <p className="mb-1.5 line-clamp-2 text-[10px] text-[var(--dpf-muted)]">{view!.description}</p>
              )}
              <div className="flex items-center gap-3 text-[10px] text-[var(--dpf-muted)]">
                <span>
                  {elementCount} data object{elementCount !== 1 ? "s" : ""}
                </span>
                <span>Open the ERD →</span>
              </div>
            </div>
          </Link>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
              Evolution timeline
            </h2>
            {snapshots.length > 0 ? (
              <ol className="space-y-2">
                {snapshots.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
                  >
                    <p className="text-xs text-[var(--dpf-text)]">{s.changeSummary ?? "Mirror reconcile"}</p>
                    <p className="mt-1 text-[10px] text-[var(--dpf-muted)]">
                      {s.elementCount} element{s.elementCount !== 1 ? "s" : ""} · {s.relationshipCount} relationship
                      {s.relationshipCount !== 1 ? "s" : ""}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[11px] text-[var(--dpf-muted)]">
                No snapshots yet — the next mirror reconcile with changes will record one.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center">
          <p className="mb-2 text-sm font-medium text-[var(--dpf-text)]">
            {view == null
              ? "Data Model view has not been generated yet."
              : "The Data Model view exists but has not been populated yet."}
          </p>
          <p className="mb-4 text-xs text-[var(--dpf-muted)]">
            The live ERD is mirrored from the Prisma schema by the data-architecture mirror. It runs on schema
            changes, on a schedule, and on demand. Once it has run, the data objects and their relationships
            appear here as an interactive ERD with an evolution timeline.
          </p>
          <Link
            href="/ea/views"
            className="text-xs font-medium text-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
          >
            Browse all views &amp; viewpoints →
          </Link>
        </div>
      )}
    </div>
  );
}
