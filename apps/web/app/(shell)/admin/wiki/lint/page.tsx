// EP-WIKI-001 Phase 4b2: admin lint findings page.
// Server component. Read-only listing of WikiLintFinding rows produced
// by the Phase 4b1 daily scheduled job (apps/web/lib/queue/functions/wiki-lint.ts).

import { prisma } from "@dpf/db";
import Link from "next/link";

import {
  LintFindingCard,
  type LintFindingRow,
} from "@/components/wiki/LintFindingCard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wiki Lint · Admin",
};

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All" },
];

const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All severities" },
  { value: "error", label: "Error" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
];

const SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All scopes" },
  { value: "kernel", label: "Kernel" },
  { value: "overlay", label: "Overlay" },
];

type SearchParams = Promise<{
  status?: string;
  severity?: string;
  scope?: string;
  kind?: string;
}>;

export default async function AdminWikiLintPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status ?? "open";
  const severityFilter = sp.severity ?? "";
  const scopeFilter = sp.scope ?? "";
  const kindFilter = sp.kind ?? "";

  const where: Record<string, unknown> = {};
  if (statusFilter !== "all") where.status = statusFilter;
  if (severityFilter) where.severity = severityFilter;
  if (scopeFilter === "kernel") where.organizationId = null;
  else if (scopeFilter === "overlay") where.organizationId = { not: null };
  if (kindFilter) where.findingKind = kindFilter;

  const findings = (await prisma.wikiLintFinding.findMany({
    where,
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      // No relation on WikiLintFinding to WikiPage in the schema (it's a
      // loose pageId reference), so fetch pages separately and join in memory.
    },
  })) as Array<{
    id: string;
    organizationId: string | null;
    pageId: string;
    findingKind: string;
    severity: string;
    status: string;
    detail: unknown;
    resolvedAt: Date | null;
    createdAt: Date;
  }>;

  const pageIds = Array.from(new Set(findings.map((f) => f.pageId)));
  const pages =
    pageIds.length > 0
      ? await prisma.wikiPage.findMany({
          where: { id: { in: pageIds } },
          select: { id: true, slug: true, title: true, pageKind: true, isKernel: true },
        })
      : [];
  const pageById = new Map(pages.map((p) => [p.id, p]));

  const rows: LintFindingRow[] = findings.map((f) => ({
    ...f,
    page: pageById.get(f.pageId) ?? null,
  }));

  const counts = {
    open: rows.filter((r) => r.status === "open").length,
    resolved: rows.filter((r) => r.status === "resolved").length,
    ignored: rows.filter((r) => r.status === "ignored").length,
    error: rows.filter((r) => r.severity === "error").length,
    warn: rows.filter((r) => r.severity === "warn").length,
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--dpf-text)]">Wiki Lint</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Findings produced by the daily scheduled job. {counts.error} errors,{" "}
          {counts.warn} warns, {counts.open} open.
        </p>
      </header>

      <FilterBar
        statusFilter={statusFilter}
        severityFilter={severityFilter}
        scopeFilter={scopeFilter}
        kindFilter={kindFilter}
      />

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--dpf-muted)] italic">
          No findings match the current filters. The daily lint job has either
          not run yet, the kernel + overlay are clean, or your filter excluded
          everything.
        </p>
      ) : (
        <div className="mt-6 space-y-px border border-[var(--dpf-border)] rounded overflow-hidden">
          {rows.map((r) => (
            <LintFindingCard key={r.id} finding={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Filter Bar ─────────────────────────────────────────────────────────────

function FilterBar({
  statusFilter,
  severityFilter,
  scopeFilter,
  kindFilter,
}: {
  statusFilter: string;
  severityFilter: string;
  scopeFilter: string;
  kindFilter: string;
}) {
  function hrefWith(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    const current: Record<string, string> = {
      status: statusFilter,
      severity: severityFilter,
      scope: scopeFilter,
      kind: kindFilter,
    };
    for (const [k, v] of Object.entries({ ...current, ...overrides })) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/admin/wiki/lint?${qs}` : "/admin/wiki/lint";
  }

  return (
    <div className="flex flex-wrap gap-3 items-center text-xs">
      <div className="flex gap-1">
        {STATUS_TABS.map((tab) => {
          const active = tab.value === statusFilter;
          return (
            <Link
              key={tab.value}
              href={hrefWith({ status: tab.value })}
              className={`px-2 py-1 rounded border ${
                active
                  ? "bg-[var(--dpf-surface-2)] border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <div className="flex gap-1">
        {SEVERITY_OPTIONS.map((opt) => {
          const active = opt.value === severityFilter;
          return (
            <Link
              key={opt.value || "all"}
              href={hrefWith({ severity: opt.value || undefined })}
              className={`px-2 py-1 rounded border ${
                active
                  ? "bg-[var(--dpf-surface-2)] border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)]"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>
      <div className="flex gap-1">
        {SCOPE_OPTIONS.map((opt) => {
          const active = opt.value === scopeFilter;
          return (
            <Link
              key={opt.value || "all"}
              href={hrefWith({ scope: opt.value || undefined })}
              className={`px-2 py-1 rounded border ${
                active
                  ? "bg-[var(--dpf-surface-2)] border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)]"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
