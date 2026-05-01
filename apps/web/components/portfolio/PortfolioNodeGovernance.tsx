// apps/web/components/portfolio/PortfolioNodeGovernance.tsx
//
// Renders the typed governance view-model fields (promotion policy + required
// fields) as a full-width band on the portfolio detail page. Task 3.3 of the
// discovery -> portfolio gap closure plan.
//
// Per spec section 6.4: no nested cards; full-width band with theme tokens
// only. We deliberately do NOT render `governance.raw` -- a JSON blob is not a
// product surface.

import type { ReactElement } from "react";
import type { GovernanceView } from "@/lib/portfolio/portfolio-node-view-model";

type Props = {
  governance: GovernanceView;
};

export function PortfolioNodeGovernance({ governance }: Props): ReactElement | null {
  const { promotion, requiredFields } = governance;
  if (promotion === null && requiredFields === null) return null;

  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-3">Governance</h2>

      {promotion !== null && (
        <div className="mb-4">
          <p className="text-sm font-medium text-[var(--dpf-muted)] mb-1">Promotion policy</p>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--dpf-text)]">
            <div className="flex items-baseline gap-2">
              <dt className="text-xs text-[var(--dpf-muted)]">Mode</dt>
              <dd>{promotion.mode}</dd>
            </div>
            {promotion.classifyAs !== undefined && (
              <div className="flex items-baseline gap-2">
                <dt className="text-xs text-[var(--dpf-muted)]">Classify as</dt>
                <dd>{promotion.classifyAs}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {requiredFields !== null && requiredFields.length > 0 && (
        <div>
          <p className="text-sm font-medium text-[var(--dpf-muted)] mb-1">Required fields</p>
          <ul className="list-disc list-inside text-sm text-[var(--dpf-text)]">
            {requiredFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
