"use client";

// A compact summary of the instance's direction on the business settings page
// (BI-916216E7). The full Direction panel lives behind one link
// (?section=direction, also the setup step and the Needs-you target), so the
// page's arrival view stays within its word budget.

import { ButtonLink } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { StatusBadge } from "@/components/ui/report-kit";
import { useT } from "@/lib/i18n/use-t";
import type { DirectionGap } from "@/lib/organization-direction/direction";
import { DIRECTION_PANEL_HREF } from "@/lib/organization-direction/direction-vocabulary";

export function DirectionSummary({ missing, outcomeCount }: { missing: DirectionGap[]; outcomeCount: number }) {
  const t = useT("storefront");
  const nothingSet = missing.length === 3;
  const status =
    missing.length > 0
      ? t("direction.summary.missing", { parts: missing.map((g) => t(`direction.gap.${g}`)).join(", ") })
      : t("direction.summary.complete", { count: outcomeCount });
  return (
    <Surface as="section" padding="md" className="mb-6 flex max-w-[560px] flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{t("direction.heading")}</h3>
        {nothingSet ? (
          <StatusBadge intent="warning" label={t("direction.notSet")} uppercase={false} />
        ) : (
          <span className="text-sm text-[var(--dpf-muted)]">{status}</span>
        )}
      </div>
      <ButtonLink href={DIRECTION_PANEL_HREF} variant="secondary" size="sm">
        {nothingSet ? t("direction.summary.set") : t("direction.summary.edit")}
      </ButtonLink>
    </Surface>
  );
}
