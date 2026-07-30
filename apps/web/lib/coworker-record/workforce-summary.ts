// apps/web/lib/coworker-record/workforce-summary.ts
// EP-COWORKER-RT (coworker-management-consolidation, WS5) — the founder's
// "see this detail summarized" panel, computed PURELY from the already-loaded
// roster rows (no extra DB query). One screen for "how is my whole workforce
// configured": headcount, role-type + family mix, fitness/health rollup, and
// naming-health (how many lack a clean displayName — drives WS1 to done).
//
// Pure + tested so the page only renders the result. No DB / no React.

import type { RosterRow } from "./roster";

export type CountBucket = { key: string; label: string; count: number };

export type WorkforceSummary = {
  /** Total coworkers in the roster. */
  total: number;
  /** Headcount by role-type (kind), sorted by count desc then label. */
  byKind: CountBucket[];
  /** Headcount by profession family, sorted by count desc; unmapped folded in as its own bucket. */
  byFamily: CountBucket[];
  /** How many distinct profession families are represented (excludes "unmapped"). */
  familiesRepresented: number;
  /** Fitness/health rollup — the at-a-glance "is my workforce OK" numbers. */
  health: {
    /** Coworkers whose advertised work can start a conversation now. */
    conversationReady: number;
    /** Coworkers whose advertised work cannot start a conversation now. */
    conversationUnavailable: number;
    /** Coworkers not bound to any profession family (registry-lint gap). */
    unmappedRole: number;
    /** Coworkers with ≥1 open capability blocker. */
    withOpenBlockers: number;
    /** Sum of open capability blockers across the workforce. */
    openBlockersTotal: number;
    /** Coworkers below 80% corpus-checklist coverage (mapped families only). */
    lowCoverage: number;
  };
  /** Naming-health — how many lack a clean Title-Case displayName (should be 0 post-Phase-1). */
  naming: {
    /** Coworkers missing a displayName entirely (empty/whitespace). */
    missingDisplayName: number;
    /** Coworkers whose displayName still carries a role suffix in the name (-agent / -specialist / …). */
    suffixInName: number;
    /** missingDisplayName + suffixInName — the WS1 "not done yet" count. */
    needsAttention: number;
  };
};

/** Title-Case-ish label for a controlled-vocab key (e.g. "orchestrator" → "Orchestrator"). */
function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Suffixes the naming standard (design §1.1) pulls OUT of the name into the `kind` chip. */
const NAME_SUFFIX_RE = /-(?:agent|specialist|orchestrator|engineer|architect|coordinator|advisor|scout)\b/i;

function tally(values: string[]): CountBucket[] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()]
    .map(([key, count]) => ({ key, label: titleCase(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function computeWorkforceSummary(rows: RosterRow[]): WorkforceSummary {
  const byKind = tally(rows.map((r) => r.kind).filter((k): k is string => !!k));

  // Family tally — mapped families by label; unmapped folded into one bucket so
  // the mix always sums to the total.
  const familyKeys = rows.map((r) => (r.unmapped ? "__unmapped__" : (r.familyLabel ?? r.familyKey ?? "__unmapped__")));
  const byFamily = [...new Map<string, number>(
    familyKeys.reduce<Map<string, number>>((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map()),
  ).entries()]
    .map(([key, count]) => ({
      key,
      label: key === "__unmapped__" ? "Unmapped" : key,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const familiesRepresented = new Set(
    rows.filter((r) => !r.unmapped && r.familyKey).map((r) => r.familyKey),
  ).size;

  const health = {
    conversationReady: rows.filter((r) => r.canStartConversation).length,
    conversationUnavailable: rows.filter(
      (r) => !r.canStartConversation,
    ).length,
    unmappedRole: rows.filter((r) => r.unmapped).length,
    withOpenBlockers: rows.filter((r) => r.openBlockers > 0).length,
    openBlockersTotal: rows.reduce((sum, r) => sum + r.openBlockers, 0),
    lowCoverage: rows.filter((r) => !r.unmapped && r.coveragePct !== null && r.coveragePct < 80).length,
  };

  const missingDisplayName = rows.filter((r) => !r.displayName || !r.displayName.trim()).length;
  const suffixInName = rows.filter((r) => NAME_SUFFIX_RE.test(r.displayName ?? "")).length;

  return {
    total: rows.length,
    byKind,
    byFamily,
    familiesRepresented,
    health,
    naming: {
      missingDisplayName,
      suffixInName,
      needsAttention: missingDisplayName + suffixInName,
    },
  };
}
