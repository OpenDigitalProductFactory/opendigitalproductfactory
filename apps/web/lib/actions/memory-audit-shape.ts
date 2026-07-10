// apps/web/lib/actions/memory-audit-shape.ts
// Pure shaping for the coworker memory transparency surface — BI-DC8B03AB
// (EP-8C706944 Phase 4). Groups + labels the raw fact/note rows for the audit UI
// so the surface has no logic of its own. Deterministic, unit-testable.

export type MemoryAuditFact = {
  id: string;
  category: string;
  key: string;
  value: string;
  scope: string;
  sensitivity: string;
  sourceRoute: string | null;
  createdAt: Date;
  lastAccessedAt: Date | null;
};

export type MemoryAuditRow = {
  id: string;
  category: string;
  label: string;
  value: string;
  scope: "user" | "org";
  sensitive: boolean;
  provenance: string;
  createdAt: Date;
};

/** Plain-language category labels — never raw enum ids in primary copy. */
const CATEGORY_LABEL: Record<string, string> = {
  preference: "Preference",
  decision: "Decision",
  constraint: "Constraint",
  domain_context: "About your work",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category.replace(/_/g, " ");
}

/** Turn a stored key into a human label ("cloud_provider" → "cloud provider"). */
export function humanizeKey(key: string): string {
  return key.replace(/[_-]+/g, " ").trim();
}

/** Shape a fact row for display (no raw enum ids, provenance summarized). */
export function toAuditRow(fact: MemoryAuditFact): MemoryAuditRow {
  return {
    id: fact.id,
    category: fact.category,
    label: humanizeKey(fact.key),
    value: fact.value,
    scope: fact.scope === "org" ? "org" : "user",
    sensitive: fact.sensitivity === "sensitive",
    provenance: fact.sourceRoute ? `Learned in ${fact.sourceRoute}` : "Learned in conversation",
    createdAt: fact.createdAt,
  };
}

export type MemoryAuditGroup = {
  category: string;
  label: string;
  rows: MemoryAuditRow[];
};

/**
 * Group facts by category for the progressive-disclosure view (3–5 plain groups),
 * each group's rows newest-first, groups ordered by the display order below.
 */
const CATEGORY_ORDER = ["preference", "decision", "constraint", "domain_context"];

export function groupAuditRows(facts: MemoryAuditFact[]): MemoryAuditGroup[] {
  const byCategory = new Map<string, MemoryAuditRow[]>();
  for (const f of facts) {
    const rows = byCategory.get(f.category) ?? [];
    rows.push(toAuditRow(f));
    byCategory.set(f.category, rows);
  }
  const groups: MemoryAuditGroup[] = [];
  const seen = new Set<string>();
  for (const category of CATEGORY_ORDER) {
    const rows = byCategory.get(category);
    if (rows && rows.length > 0) {
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      groups.push({ category, label: categoryLabel(category), rows });
      seen.add(category);
    }
  }
  // Any unrecognized categories after the known order.
  for (const [category, rows] of byCategory) {
    if (seen.has(category)) continue;
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    groups.push({ category, label: categoryLabel(category), rows });
  }
  return groups;
}

export type MemoryAuditSummary = {
  total: number;
  orgShared: number;
  sensitive: number;
};

// Server-action return shapes live here (not in the "use server" module, which
// may export only async functions — a type export there 500s the route).
export type MyMemoryAudit = {
  groups: MemoryAuditGroup[];
  summary: MemoryAuditSummary;
};

export type OrgMemoryAuditNote = {
  id: string;
  agentId: string;
  noteKind: string;
  noteKey: string;
  content: string;
  createdAt: Date;
};

export type OrgMemoryAudit = {
  facts: MemoryAuditGroup[];
  summary: MemoryAuditSummary;
  notes: OrgMemoryAuditNote[];
};

export function summarizeAudit(facts: MemoryAuditFact[]): MemoryAuditSummary {
  return {
    total: facts.length,
    orgShared: facts.filter((f) => f.scope === "org").length,
    sensitive: facts.filter((f) => f.sensitivity === "sensitive").length,
  };
}
