// Decision-engine weekly self-review — the measures (BI-19CEC4B4, design
// docs/superpowers/specs/2026-09-10-decision-engine-weekly-self-review-design.md §4.1).
//
// Pure functions over ledger rows so every measure is fixture-testable and
// deterministic: no LLM, no clock reads, no I/O. The task executor loads the
// window and hands the rows here; each measure returns zero or more review
// LINES, each carrying the evidence that produced it. A line without evidence
// is never emitted — the human rules on the query, not on a summary.

export type LedgerScope = "wwmd" | "wwwd" | "wsid";

/** The DecisionInteraction columns the measures read (joined with the profile kind). */
export type ReviewLedgerRow = {
  interactionId: string;
  profileId: string;
  profileKind: "platform" | "organization" | "profession";
  gateKey: string | null;
  routeContext: string | null;
  domainClass: string;
  outcomeType: string;
  riskTier: string;
  question: string;
  gateFallbackUsed: boolean;
  outcomePayload: unknown;
  recommendedOptionId: string | null;
  chosenOptionId: string | null;
  sensitivityUnstable: boolean | null;
  sensitivity: unknown;
  createdAt: Date;
};

export type ReviewMeasureKey =
  | "volume"
  | "craft-fallback"
  | "starvation"
  | "repeat-escalation"
  | "empty-question"
  | "unlearned"
  | "agreement"
  | "weight-sensitive";

export type ReviewProposedAction =
  | "confirm-material"
  | "publish-craft-page"
  | "examine-weight"
  | "file-defect"
  | "capture-stance"
  | "no-action";

export type ReviewLine = {
  /** Stable within a measure so dispositions can match across weeks. */
  lineKey: string;
  measureKey: ReviewMeasureKey;
  scope: LedgerScope;
  /** Registry profession key for WSID lines; null for WWMD/WWWD. */
  professionKey: string | null;
  headline: string;
  evidence: Record<string, number | string | string[]>;
  proposedAction: ReviewProposedAction;
};

export type ReviewThresholds = {
  starvationDecisionsPerMaterial: number;
  repeatEscalationMin: number;
  unlearnedRatioMax: number;
  agreementMin: number;
  weightSensitiveFlipsMin: number;
};

/** One module owns every threshold (design §4.5). */
export const REVIEW_THRESHOLDS: ReviewThresholds = {
  starvationDecisionsPerMaterial: 20,
  repeatEscalationMin: 3,
  unlearnedRatioMax: 0.5,
  agreementMin: 0.7,
  weightSensitiveFlipsMin: 3,
};

const UNANSWERED = new Set(["defer", "escalate"]);

export function scopeOfProfileKind(kind: ReviewLedgerRow["profileKind"]): LedgerScope {
  if (kind === "organization") return "wwwd";
  if (kind === "profession") return "wsid";
  return "wwmd";
}

/** A profession-gate row's scope is WSID even when doctrine fell back to platform. */
export function scopeOfRow(row: ReviewLedgerRow): LedgerScope {
  if (row.gateKey === "profession") return "wsid";
  if (row.gateKey === "org-business") return "wwwd";
  return scopeOfProfileKind(row.profileKind);
}

function professionKeyOf(row: ReviewLedgerRow): string | null {
  const payload = row.outcomePayload;
  if (payload && typeof payload === "object") {
    const key = (payload as { professionKey?: unknown }).professionKey;
    if (typeof key === "string" && key.trim()) return key;
  }
  return null;
}

function count<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[key(row)] = (out[key(row)] ?? 0) + 1;
  return out;
}

/** Normalise a question so repeats cluster: lower-case, collapse whitespace, strip ids. */
export function normaliseQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/\b(bi|wc|di|ep|tr)-[a-z0-9-]+\b/g, "<id>")
    .replace(/\s+/g, " ")
    .trim();
}

/** A bare label: a tool name followed by a colon and nothing else, or empty. */
export function isBareQuestion(question: string): boolean {
  const q = question.trim();
  return q.length === 0 || /^[a-z0-9 _-]{1,60}:$/i.test(q);
}

export function measureVolume(rows: readonly ReviewLedgerRow[]): ReviewLine[] {
  if (rows.length === 0) return [];
  return [{
    lineKey: "volume",
    measureKey: "volume",
    scope: "wwmd",
    professionKey: null,
    headline: `${rows.length} decisions this week`,
    evidence: {
      total: rows.length,
      ...prefix("scope", count(rows, scopeOfRow)),
      ...prefix("gate", count(rows, (r) => r.gateKey ?? "none")),
      ...prefix("outcome", count(rows, (r) => r.outcomeType)),
      ...prefix("risk", count(rows, (r) => r.riskTier)),
    },
    proposedAction: "no-action",
  }];
}

function prefix(p: string, counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) out[`${p}.${k}`] = v;
  return out;
}

export function measureCraftFallback(rows: readonly ReviewLedgerRow[]): ReviewLine[] {
  const groups = new Map<string, { professionKey: string; domainClass: string; consults: number; deferred: number }>();
  for (const row of rows) {
    if (row.gateKey !== "profession") continue;
    if (!row.gateFallbackUsed && !UNANSWERED.has(row.outcomeType)) continue;
    const professionKey = professionKeyOf(row) ?? "unbound";
    const key = `${professionKey}/${row.domainClass}`;
    const g = groups.get(key) ?? { professionKey, domainClass: row.domainClass, consults: 0, deferred: 0 };
    g.consults += 1;
    if (row.outcomeType === "defer") g.deferred += 1;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].consults - a[1].consults)
    .map(([key, g]) => ({
      lineKey: `craft-fallback:${key}`,
      measureKey: "craft-fallback",
      scope: "wsid",
      professionKey: g.professionKey === "unbound" ? null : g.professionKey,
      headline: `${g.professionKey} answered ${g.consults} ${g.domainClass} consults from platform defaults`,
      evidence: { consults: g.consults, deferred: g.deferred, domainClass: g.domainClass },
      proposedAction: g.professionKey === "unbound" ? "file-defect" : "publish-craft-page",
    }));
}

export function measureStarvation(
  rows: readonly ReviewLedgerRow[],
  materialCountByProfile: Readonly<Record<string, number>>,
  thresholds: ReviewThresholds = REVIEW_THRESHOLDS,
): ReviewLine[] {
  const decided = rows.filter((r) => !r.gateFallbackUsed);
  const byProfile = count(decided, (r) => r.profileId);
  const lines: ReviewLine[] = [];
  for (const [profileId, decisions] of Object.entries(byProfile)) {
    const material = materialCountByProfile[profileId] ?? 0;
    const perRow = material === 0 ? Number.POSITIVE_INFINITY : decisions / material;
    if (perRow < thresholds.starvationDecisionsPerMaterial) continue;
    const kind = decided.find((r) => r.profileId === profileId)!.profileKind;
    lines.push({
      lineKey: `starvation:${profileId}`,
      measureKey: "starvation",
      scope: scopeOfProfileKind(kind),
      professionKey: kind === "profession" ? profileId.replace(/^wsid-/, "") : null,
      headline: `${profileId} decided ${decisions} times on ${material} material rows`,
      evidence: { decisions, materialRows: material, decisionsPerRow: material === 0 ? -1 : Math.round(perRow) },
      proposedAction: "confirm-material",
    });
  }
  return lines.sort((a, b) => (b.evidence.decisions as number) - (a.evidence.decisions as number));
}

export function measureRepeatEscalation(
  rows: readonly ReviewLedgerRow[],
  thresholds: ReviewThresholds = REVIEW_THRESHOLDS,
): ReviewLine[] {
  const groups = new Map<string, ReviewLedgerRow[]>();
  for (const row of rows) {
    if (!UNANSWERED.has(row.outcomeType)) continue;
    const key = row.routeContext?.startsWith("/tool/") ? row.routeContext : normaliseQuestion(row.question);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.length >= thresholds.repeatEscalationMin)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, g]) => ({
      lineKey: `repeat-escalation:${key.slice(0, 120)}`,
      measureKey: "repeat-escalation",
      scope: scopeOfRow(g[0]!),
      professionKey: professionKeyOf(g[0]!),
      headline: `${g.length} unanswered decisions repeat the same question`,
      evidence: { repeats: g.length, sample: g[0]!.question.slice(0, 200), interactionIds: g.slice(0, 10).map((r) => r.interactionId) },
      proposedAction: scopeOfRow(g[0]!) === "wwwd" ? "capture-stance" : "confirm-material",
    }));
}

export function measureEmptyQuestion(rows: readonly ReviewLedgerRow[]): ReviewLine[] {
  const bare = rows.filter((r) => UNANSWERED.has(r.outcomeType) && isBareQuestion(r.question));
  if (bare.length === 0) return [];
  const byLabel = count(bare, (r) => r.question.trim() || "(empty)");
  return [{
    lineKey: "empty-question",
    measureKey: "empty-question",
    scope: "wwmd",
    professionKey: null,
    headline: `${bare.length} escalations carried no question`,
    evidence: { rows: bare.length, labels: Object.keys(byLabel), gates: Object.keys(count(bare, (r) => r.gateKey ?? "none")) },
    proposedAction: "file-defect",
  }];
}

export function measureUnlearned(
  rows: readonly ReviewLedgerRow[],
  now: Date,
  thresholds: ReviewThresholds = REVIEW_THRESHOLDS,
): ReviewLine[] {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const eligible = rows.filter((r) => r.recommendedOptionId && r.createdAt.getTime() <= weekAgo);
  const byGate = new Map<string, { total: number; unlearned: number; sample: ReviewLedgerRow }>();
  for (const row of eligible) {
    const key = row.gateKey ?? "none";
    const g = byGate.get(key) ?? { total: 0, unlearned: 0, sample: row };
    g.total += 1;
    if (!row.chosenOptionId) g.unlearned += 1;
    byGate.set(key, g);
  }
  return [...byGate.entries()]
    .filter(([, g]) => g.unlearned / g.total > thresholds.unlearnedRatioMax)
    .map(([gate, g]) => ({
      lineKey: `unlearned:${gate}`,
      measureKey: "unlearned",
      scope: scopeOfRow(g.sample),
      professionKey: null,
      headline: `${g.unlearned} of ${g.total} ${gate} recommendations older than a week never recorded what was chosen`,
      evidence: { total: g.total, unlearned: g.unlearned, ratio: Number((g.unlearned / g.total).toFixed(2)), gate },
      proposedAction: "no-action",
    }));
}

export function measureAgreement(
  rows: readonly ReviewLedgerRow[],
  thresholds: ReviewThresholds = REVIEW_THRESHOLDS,
): ReviewLine[] {
  const graded = rows.filter((r) => r.recommendedOptionId && r.chosenOptionId);
  const byKey = new Map<string, { agreed: number; total: number; sample: ReviewLedgerRow }>();
  for (const row of graded) {
    const key = `${scopeOfRow(row)}/${row.domainClass}`;
    const g = byKey.get(key) ?? { agreed: 0, total: 0, sample: row };
    g.total += 1;
    if (row.chosenOptionId === row.recommendedOptionId) g.agreed += 1;
    byKey.set(key, g);
  }
  const lines: ReviewLine[] = [];
  for (const scope of ["wwmd", "wwwd", "wsid"] as const) {
    const any = [...byKey.keys()].some((k) => k.startsWith(`${scope}/`));
    if (!any) {
      lines.push({
        lineKey: `agreement:${scope}:none`,
        measureKey: "agreement",
        scope,
        professionKey: null,
        headline: `No ${scope.toUpperCase()} decision this week has both a recommendation and a recorded choice`,
        evidence: { graded: 0 },
        proposedAction: "no-action",
      });
    }
  }
  for (const [key, g] of byKey) {
    const rate = g.agreed / g.total;
    if (rate >= thresholds.agreementMin) continue;
    lines.push({
      lineKey: `agreement:${key}`,
      measureKey: "agreement",
      scope: scopeOfRow(g.sample),
      professionKey: professionKeyOf(g.sample),
      headline: `Humans agreed with ${Math.round(rate * 100)}% of ${key} recommendations`,
      evidence: { agreed: g.agreed, total: g.total, rate: Number(rate.toFixed(2)) },
      proposedAction: "examine-weight",
    });
  }
  return lines;
}

function flippingPrincipleIds(sensitivity: unknown): string[] {
  if (!sensitivity || typeof sensitivity !== "object") return [];
  const ids = (sensitivity as { flippingPrincipleIds?: unknown }).flippingPrincipleIds;
  return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
}

export function measureWeightSensitive(
  rows: readonly ReviewLedgerRow[],
  thresholds: ReviewThresholds = REVIEW_THRESHOLDS,
): ReviewLine[] {
  const byPrinciple = new Map<string, string[]>();
  for (const row of rows) {
    const ids = flippingPrincipleIds(row.sensitivity);
    if (ids.length === 0 && !row.sensitivityUnstable) continue;
    for (const id of ids.length ? ids : ["(unattributed)"]) {
      byPrinciple.set(id, [...(byPrinciple.get(id) ?? []), row.interactionId]);
    }
  }
  return [...byPrinciple.entries()]
    .filter(([, ids]) => ids.length >= thresholds.weightSensitiveFlipsMin)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([principleId, ids]) => ({
      lineKey: `weight-sensitive:${principleId}`,
      measureKey: "weight-sensitive",
      scope: "wwmd",
      professionKey: null,
      headline: `A ±10% change to ${principleId} flips ${ids.length} decisions`,
      evidence: { principleId, flips: ids.length, interactionIds: ids.slice(0, 10) },
      proposedAction: "examine-weight",
    }));
}

export type ReviewInput = {
  rows: readonly ReviewLedgerRow[];
  materialCountByProfile: Readonly<Record<string, number>>;
  now: Date;
  thresholds?: ReviewThresholds;
};

/** Every measure, in report order. Deterministic for a given input. */
export function computeReviewLines(input: ReviewInput): ReviewLine[] {
  const t = input.thresholds ?? REVIEW_THRESHOLDS;
  return [
    ...measureVolume(input.rows),
    ...measureCraftFallback(input.rows),
    ...measureStarvation(input.rows, input.materialCountByProfile, t),
    ...measureRepeatEscalation(input.rows, t),
    ...measureEmptyQuestion(input.rows),
    ...measureUnlearned(input.rows, input.now, t),
    ...measureAgreement(input.rows, t),
    ...measureWeightSensitive(input.rows, t),
  ];
}
