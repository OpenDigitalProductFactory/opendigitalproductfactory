import { prisma } from "@dpf/db";
import { CreateObligationForm } from "@/components/compliance/CreateObligationForm";
import { ComplianceLibraryScopeNav } from "@/components/compliance/ComplianceLibraryScopeNav";
import { ObligationLibraryPanel } from "@/components/compliance/ObligationLibraryPanel";
import {
  PlatformGridSection,
  parseSurfaceDataScope,
  parseSurfaceView,
} from "@/components/workbooks/PlatformGridSection";
import Link from "next/link";
import {
  DEFAULT_COMPLIANCE_LIBRARY_SCOPE,
  addObligationApplicability,
  complianceLibraryContextLabel,
  countObligationsByComplianceLibraryScope,
  filterObligationsByComplianceLibraryScope,
  parseComplianceLibraryScope,
  resolveComplianceLibraryContext,
} from "@/lib/compliance-library";

type Props = {
  searchParams: Promise<{ regulation?: string; category?: string; status?: string; scope?: string; view?: string; dataScope?: string }>;
};

export default async function ObligationsPage({ searchParams }: Props) {
  const filters = await searchParams;
  const view = parseSurfaceView(filters.view);
  const dataScope = parseSurfaceDataScope(filters.dataScope);
  const scope = parseComplianceLibraryScope(filters.scope);

  const [context, obligations, regulations, categories] = await Promise.all([
    resolveComplianceLibraryContext(),
    prisma.obligation.findMany({
      where: {
        ...(filters.regulation && { regulationId: filters.regulation }),
        ...(filters.category && { category: filters.category }),
        ...(filters.status ? { status: filters.status } : { status: "active" }),
      },
      include: {
        regulation: {
          select: {
            id: true,
            regulationId: true,
            name: true,
            shortName: true,
            jurisdiction: true,
            industry: true,
            sourceType: true,
            sourceUrl: true,
            applicability: true,
          },
        },
        ownerEmployee: { select: { id: true, displayName: true } },
        _count: { select: { controls: true } },
      },
      orderBy: { title: "asc" },
    }),
    prisma.regulation.findMany({
      where: { status: "active" },
      select: { id: true, shortName: true },
      orderBy: { shortName: "asc" },
    }),
    prisma.obligation.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    }),
  ]);

  const distinctCategories = categories
    .map((c) => c.category)
    .filter((c): c is string => c !== null);

  const classifiedObligations = obligations.map((obligation) =>
    addObligationApplicability(obligation, context),
  );
  const visibleObligations = filterObligationsByComplianceLibraryScope(classifiedObligations, scope);
  const scopeCounts = countObligationsByComplianceLibraryScope(classifiedObligations);
  const contextLabel = complianceLibraryContextLabel(context);

  // Build filter URL helper
  function filterUrl(key: string, value: string) {
    const p = new URLSearchParams();
    if (key === "regulation" && value) p.set("regulation", value);
    else if (filters.regulation) p.set("regulation", filters.regulation);

    if (key === "category" && value) p.set("category", value);
    else if (filters.category) p.set("category", filters.category);

    if (key === "status" && value) p.set("status", value);
    else if (filters.status) p.set("status", filters.status);

    if (scope !== DEFAULT_COMPLIANCE_LIBRARY_SCOPE) p.set("scope", scope);
    if (filters.view) p.set("view", filters.view);

    const qs = p.toString();
    return `/compliance/obligations${qs ? `?${qs}` : ""}`;
  }

  const activeFilterCount =
    (filters.regulation ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (scope !== DEFAULT_COMPLIANCE_LIBRARY_SCOPE ? 1 : 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Obligations</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {visibleObligations.length} shown - {obligations.length} result{obligations.length !== 1 ? "s" : ""} - {contextLabel}
          </p>
        </div>
        <CreateObligationForm regulations={regulations} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">Scope</label>
          <ComplianceLibraryScopeNav
            basePath="/compliance/obligations"
            activeScope={scope}
            counts={scopeCounts}
            preservedParams={{
              regulation: filters.regulation,
              category: filters.category,
              status: filters.status,
              view: filters.view,
            }}
          />
        </div>

        {/* Regulation filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">Regulation</label>
          <div className="flex gap-1">
            <Link
              href={filterUrl("regulation", "")}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                !filters.regulation
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
              }`}
            >
              All
            </Link>
            {regulations.map((r) => (
              <Link
                key={r.id}
                href={filterUrl("regulation", r.id)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  filters.regulation === r.id
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
                }`}
              >
                {r.shortName}
              </Link>
            ))}
          </div>
        </div>

        {/* Category filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">Category</label>
          <div className="flex gap-1 flex-wrap">
            <Link
              href={filterUrl("category", "")}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                !filters.category
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
              }`}
            >
              All
            </Link>
            {distinctCategories.map((cat) => (
              <Link
                key={cat}
                href={filterUrl("category", cat)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  filters.category === cat
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
                }`}
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>

        {/* Status filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">Status</label>
          <div className="flex gap-1">
            {["active", "inactive"].map((s) => (
              <Link
                key={s}
                href={filterUrl("status", s === "active" && !filters.status ? "" : s)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  (s === "active" && !filters.status) || filters.status === s
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
                }`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {/* Clear all filters */}
        {activeFilterCount > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-transparent uppercase tracking-widest">&nbsp;</span>
            <Link
              href="/compliance/obligations"
              className="text-[10px] px-2 py-1 rounded border border-[var(--dpf-border)] text-[var(--dpf-error)] hover:border-[var(--dpf-error)] transition-colors"
            >
              Clear filters
            </Link>
          </div>
        )}
      </div>

      <PlatformGridSection
        entityType="compliance_obligation"
        view={view}
        dataScope={dataScope}
      />

      {!view && (
        <ObligationLibraryPanel
          rows={visibleObligations}
          contextLabel={contextLabel}
          totalCount={classifiedObligations.length}
        />
      )}
    </div>
  );
}
