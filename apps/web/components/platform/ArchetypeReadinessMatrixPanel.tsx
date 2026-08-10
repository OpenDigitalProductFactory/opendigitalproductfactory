import {
  ALL_ARCHETYPES,
  ARCHETYPE_READINESS_MATRIX,
  ARCHETYPE_READINESS_TIER_REQUIREMENTS,
  ARCHETYPE_READINESS_TIERS,
  compareArchetypeReadinessTiers,
  evaluateArchetypeReadinessClaim,
  type ArchetypeReadinessEvidenceRef,
  type ArchetypeReadinessRecord,
  type ArchetypeReadinessTier,
} from "@dpf/storefront-templates";

import { KpiCard, Notice, StatusBadge } from "@/components/ui/report-kit";

import {
  ArchetypeReadinessMatrixTable,
  type ArchetypeReadinessEvidenceView,
  type ArchetypeReadinessMatrixRow,
} from "./ArchetypeReadinessMatrixTable";

type ReadinessSummary = {
  totalCategories: number;
  totalLeafArchetypes: number;
  templateOnlyCategories: number;
  opsReadyCategories: number;
  solePlatformReadyCategories: number;
  categoriesMissingVerticalLane: number;
};

export function ArchetypeReadinessMatrixPanel({
  matrix = ARCHETYPE_READINESS_MATRIX,
}: {
  matrix?: readonly ArchetypeReadinessRecord[];
}) {
  const rows = buildArchetypeReadinessRows(matrix);
  const summary = summarizeArchetypeReadinessRows(rows);

  return (
    <section className="space-y-4" data-component="archetype-readiness-matrix">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          value={summary.totalCategories}
          label="Categories"
          hint={`${summary.totalLeafArchetypes} leaf archetypes`}
          intent="info"
          size="sm"
        />
        <KpiCard
          value={summary.templateOnlyCategories}
          label="Template only"
          hint="Higher claims still blocked"
          intent="warning"
          size="sm"
        />
        <KpiCard
          value={summary.opsReadyCategories}
          label="Ops ready"
          hint="At least ops-ready today"
          intent={summary.opsReadyCategories > 0 ? "success" : "neutral"}
          size="sm"
        />
        <KpiCard
          value={summary.solePlatformReadyCategories}
          label="Sole-platform ready"
          hint="Needs full proof pack"
          intent={summary.solePlatformReadyCategories > 0 ? "success" : "danger"}
          size="sm"
        />
      </div>

      <Notice variant="warn" title="Claim gate is on" icon={false}>
        Template ready means only a template exists. Higher claims need more proof.
      </Notice>

      {summary.categoriesMissingVerticalLane > 0 ? (
        <Notice variant="info" title="Some rows need a vertical epic" icon={false}>
          {summary.categoriesMissingVerticalLane} categor
          {summary.categoriesMissingVerticalLane === 1 ? "y has" : "ies have"} no vertical
          epic yet.
        </Notice>
      ) : null}

      {/* Full matrix stays collapsed on arrival so the net-new detail shell stays
          under the UX word budget. Expand to scan claim blockers. */}
      <details
        id="archetype-claim-matrix"
        className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      >
        <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">
          Category claim table ({rows.length} categories)
        </summary>
        <div className="mt-3">
          <ArchetypeReadinessMatrixTable rows={rows} />
        </div>
      </details>

      <details className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">
          Tier definitions
        </summary>
        <ul className="mt-3 divide-y divide-[var(--dpf-border)]">
          {ARCHETYPE_READINESS_TIER_REQUIREMENTS.map((requirement) => (
            <li key={requirement.tier} className="flex flex-col gap-2 py-3 md:flex-row md:items-start">
              <div className="shrink-0 md:w-48">
                <StatusBadge
                  domain="archetypeReadinessTier"
                  status={requirement.tier}
                  label={formatArchetypeReadinessLabel(requirement.tier)}
                  variant="soft"
                  uppercase={false}
                />
              </div>
              <p className="max-w-4xl text-sm leading-5 text-[var(--dpf-text)]">
                {requirement.summary}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function buildArchetypeReadinessRows(
  matrix: readonly ArchetypeReadinessRecord[] = ARCHETYPE_READINESS_MATRIX,
): ArchetypeReadinessMatrixRow[] {
  return matrix.map((record) => {
    const solePlatformClaim = evaluateArchetypeReadinessClaim({
      archetypeCategory: record.archetypeCategory,
      requestedTier: "sole-platform-ready",
      matrix,
    });
    const blockers = solePlatformClaim.blockers;
    const blockedTierSet = new Set(blockers.map((blocker) => blocker.tier));
    const blockerEvidence = uniqueEvidenceRefs(
      blockers.flatMap((blocker) => [...blocker.evidence]),
    );
    const evidenceRefs = blockerEvidence.length > 0
      ? blockerEvidence
      : uniqueEvidenceRefs(record.dependencies);

    return {
      categorySlug: record.archetypeCategory,
      categoryLabel: formatArchetypeReadinessLabel(record.archetypeCategory),
      leafCount: ALL_ARCHETYPES.filter(
        (archetype) => archetype.category === record.archetypeCategory,
      ).length,
      highestTier: record.highestClaimableTier,
      highestTierLabel: formatArchetypeReadinessLabel(record.highestClaimableTier),
      blockedTierLabels: ARCHETYPE_READINESS_TIERS.filter(
        (tier) => tier !== "template-ready" && blockedTierSet.has(tier),
      ).map(formatArchetypeReadinessLabel),
      primaryBlocker: blockers[0]?.reason ?? "No higher-tier blockers are recorded.",
      blockerCount: blockers.length,
      evidenceRefs: evidenceRefs.map(toEvidenceView),
    };
  });
}

export function summarizeArchetypeReadinessRows(
  rows: readonly ArchetypeReadinessMatrixRow[],
): ReadinessSummary {
  return {
    totalCategories: rows.length,
    totalLeafArchetypes: rows.reduce((sum, row) => sum + row.leafCount, 0),
    templateOnlyCategories: rows.filter((row) => row.highestTier === "template-ready").length,
    opsReadyCategories: rows.filter((row) => isAtLeastTier(row.highestTier, "ops-ready")).length,
    solePlatformReadyCategories: rows.filter((row) =>
      isAtLeastTier(row.highestTier, "sole-platform-ready"),
    ).length,
    categoriesMissingVerticalLane: rows.filter((row) =>
      row.primaryBlocker.includes("No category-level vertical-readiness epic"),
    ).length,
  };
}

export function formatArchetypeReadinessLabel(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isAtLeastTier(
  highestTier: ArchetypeReadinessTier,
  requestedTier: ArchetypeReadinessTier,
): boolean {
  return compareArchetypeReadinessTiers(highestTier, requestedTier) >= 0;
}

function uniqueEvidenceRefs(
  refs: readonly ArchetypeReadinessEvidenceRef[],
): ArchetypeReadinessEvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toEvidenceView(ref: ArchetypeReadinessEvidenceRef): ArchetypeReadinessEvidenceView {
  return {
    id: ref.id,
    title: ref.title,
    kindLabel: formatArchetypeReadinessLabel(ref.kind),
    statusLabel: formatArchetypeReadinessLabel(ref.status),
    status: ref.status,
  };
}
