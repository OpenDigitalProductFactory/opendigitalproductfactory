import Link from "next/link";

import { ComplianceLibraryScopeNav } from "@/components/compliance/ComplianceLibraryScopeNav";
import { StatusBadge } from "@/components/ui/report-kit";
import {
  DEFAULT_COMPLIANCE_LIBRARY_SCOPE,
  type ClassifiableRegulation,
  type ComplianceLibraryScopeFilter,
  type RegulationWithApplicability,
} from "@/lib/compliance-library";

const SOURCE_TYPES = ["all", "external", "standard", "framework", "internal"];

export type RegulationLibraryRow = RegulationWithApplicability<
  ClassifiableRegulation & {
    id: string;
    status: string;
    _count: { obligations: number };
  }
>;

type Props = {
  rows: RegulationLibraryRow[];
  totalCount: number;
  contextLabel: string;
  activeScope: ComplianceLibraryScopeFilter;
  activeSourceType?: string;
  scopeCounts: Record<ComplianceLibraryScopeFilter, number>;
};

function labelForSourceType(type: string): string {
  return type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1);
}

function sourceTypeHref(scope: ComplianceLibraryScopeFilter, type: string): string {
  const params = new URLSearchParams();
  if (scope !== DEFAULT_COMPLIANCE_LIBRARY_SCOPE) params.set("scope", scope);
  if (type !== "all") params.set("type", type);
  const qs = params.toString();
  return `/compliance/regulations${qs ? `?${qs}` : ""}`;
}

function sourceAction(row: RegulationLibraryRow) {
  if (!row.sourceUrl) {
    return <StatusBadge intent="warning" label="Source needed" variant="soft" uppercase={false} />;
  }

  return (
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium text-[var(--dpf-info)] hover:underline"
    >
      Source
    </a>
  );
}

export function RegulationLibraryPanel({
  rows,
  totalCount,
  contextLabel,
  activeScope,
  activeSourceType,
  scopeCounts,
}: Props) {
  const sourceType = activeSourceType ?? "all";

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <ComplianceLibraryScopeNav
          basePath="/compliance/regulations"
          activeScope={activeScope}
          counts={scopeCounts}
          preservedParams={{ type: activeSourceType }}
        />

        <div className="flex flex-wrap gap-2">
          {SOURCE_TYPES.map((type) => {
            const active = sourceType === type;
            return (
              <Link
                key={type}
                href={sourceTypeHref(activeScope, type)}
                className={[
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  active
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)] text-white"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]",
                ].join(" ")}
              >
                {labelForSourceType(type)}
              </Link>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-[var(--dpf-border)] p-4">
          <p className="text-sm font-medium text-[var(--dpf-text)]">No regulations in this scope for {contextLabel}.</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {totalCount} regulation{totalCount !== 1 ? "s" : ""} remain available across the full reference library.
          </p>
          {activeScope !== "all" && (
            <Link
              href={sourceTypeHref("all", sourceType)}
              className="mt-3 inline-flex rounded border border-[var(--dpf-border)] px-3 py-1 text-xs text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)]"
            >
              View all
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex min-h-[154px] flex-col justify-between rounded-lg border border-[var(--dpf-border)] p-4 transition-colors hover:border-[var(--dpf-accent)]"
            >
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--dpf-text)]">{row.shortName}</span>
                  <span className="rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] text-[var(--dpf-muted)]">
                    {row.jurisdiction}
                  </span>
                  <StatusBadge
                    domain="complianceApplicability"
                    status={row.applicability.scope}
                    label={row.applicability.label}
                    variant="soft"
                    uppercase={false}
                  />
                  <StatusBadge domain="complianceRegulation" status={row.status} variant="soft" uppercase={false} />
                </div>
                <p className="text-xs text-[var(--dpf-muted)]">{row.name}</p>
                <p className="mt-2 text-xs text-[var(--dpf-text)]">{row.applicability.reason}</p>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--dpf-muted)]">
                  {row._count.obligations} obligation{row._count.obligations !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/compliance/regulations/${row.id}`}
                    className="text-xs font-medium text-[var(--dpf-accent)] hover:underline"
                  >
                    Details
                  </Link>
                  {sourceAction(row)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
