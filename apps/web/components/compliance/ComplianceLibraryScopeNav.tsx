import Link from "next/link";

import {
  COMPLIANCE_LIBRARY_SCOPE_FILTERS,
  DEFAULT_COMPLIANCE_LIBRARY_SCOPE,
  type ComplianceLibraryScopeFilter,
} from "@/lib/compliance-library";

const SCOPE_LABEL: Record<ComplianceLibraryScopeFilter, string> = {
  applies: "Applies",
  review: "Needs review",
  reference: "Reference",
  all: "All",
};

type Props = {
  basePath: string;
  activeScope: ComplianceLibraryScopeFilter;
  counts: Record<ComplianceLibraryScopeFilter, number>;
  preservedParams?: Record<string, string | undefined>;
};

function buildHref(
  basePath: string,
  scope: ComplianceLibraryScopeFilter,
  preservedParams: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(preservedParams)) {
    if (value) params.set(key, value);
  }
  if (scope !== DEFAULT_COMPLIANCE_LIBRARY_SCOPE) params.set("scope", scope);
  const qs = params.toString();
  return `${basePath}${qs ? `?${qs}` : ""}`;
}

export function ComplianceLibraryScopeNav({
  basePath,
  activeScope,
  counts,
  preservedParams = {},
}: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {COMPLIANCE_LIBRARY_SCOPE_FILTERS.map((scope) => {
        const active = activeScope === scope;
        return (
          <Link
            key={scope}
            href={buildHref(basePath, scope, preservedParams)}
            className={[
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
              active
                ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)] text-white"
                : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]",
            ].join(" ")}
          >
            <span>{SCOPE_LABEL[scope]}</span>
            <span className={active ? "text-white" : "text-[var(--dpf-muted)]"}>{counts[scope]}</span>
          </Link>
        );
      })}
    </div>
  );
}
