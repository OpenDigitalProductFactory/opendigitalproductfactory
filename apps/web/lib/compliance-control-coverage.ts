// Phase 2 — control consolidation. A control is global (not regulation-scoped)
// and links M:N to obligations, each of which belongs to a regulation. When an
// org is subject to many frameworks, ONE control can satisfy obligations across
// several regulations (a crosswalk). These pure helpers compute the
// control-centric coverage — "this one control covers N obligations across M
// regulations" — the inverse of the per-regulation gap view, and dedupe a set
// of controls by their stable catalogKey.

export type CoverageRegulationRef = {
  id: string;
  regulationId: string;
  shortName: string;
};

/** A control's obligation links, narrowed to what coverage needs. */
export type CoverageControl = {
  obligations: { obligation: { regulation: CoverageRegulationRef } }[];
};

export type ControlCoverage = {
  obligationCount: number;
  /** Distinct regulations this control helps satisfy. */
  regulationCount: number;
  regulations: CoverageRegulationRef[];
  /** True when the control crosswalks more than one framework — the consolidation signal. */
  isCrosswalk: boolean;
};

/** Compute "1 control → N obligations → M regulations" for a single control. */
export function computeControlCoverage(control: CoverageControl): ControlCoverage {
  const byRegId = new Map<string, CoverageRegulationRef>();
  for (const link of control.obligations) {
    const reg = link.obligation.regulation;
    if (reg && !byRegId.has(reg.id)) byRegId.set(reg.id, reg);
  }
  const regulations = [...byRegId.values()].sort((a, b) =>
    a.shortName.localeCompare(b.shortName),
  );
  return {
    obligationCount: control.obligations.length,
    regulationCount: regulations.length,
    regulations,
    isCrosswalk: regulations.length > 1,
  };
}

/** Short human label, e.g. "5 obligations · 3 frameworks". */
export function formatCoverage(coverage: ControlCoverage): string {
  const obl = `${coverage.obligationCount} obligation${coverage.obligationCount === 1 ? "" : "s"}`;
  const reg = `${coverage.regulationCount} framework${coverage.regulationCount === 1 ? "" : "s"}`;
  return `${obl} · ${reg}`;
}

export type ConsolidatableControl = { id: string; catalogKey: string | null };

/**
 * Group controls by stable catalogKey so duplicates (same catalog identity across
 * seed packs / authoring) consolidate into one logical control. Un-cataloged
 * controls (null catalogKey) each stand alone. Returns groups with >1 member
 * first — those are the consolidation opportunities.
 */
export function groupControlsByCatalogKey<T extends ConsolidatableControl>(
  controls: T[],
): { catalogKey: string | null; controls: T[] }[] {
  const groups = new Map<string, T[]>();
  const standalone: { catalogKey: null; controls: T[] }[] = [];
  for (const c of controls) {
    if (c.catalogKey == null) {
      standalone.push({ catalogKey: null, controls: [c] });
      continue;
    }
    const g = groups.get(c.catalogKey);
    if (g) g.push(c);
    else groups.set(c.catalogKey, [c]);
  }
  const keyed = [...groups.entries()].map(([catalogKey, controls]) => ({ catalogKey, controls }));
  keyed.sort((a, b) => b.controls.length - a.controls.length || a.catalogKey.localeCompare(b.catalogKey));
  return [...keyed, ...standalone];
}
