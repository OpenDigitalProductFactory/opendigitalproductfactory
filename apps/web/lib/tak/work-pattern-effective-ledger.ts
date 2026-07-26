import { isRecord } from "@/lib/shared/coerce";

export type WorkPatternLedgerRow = {
  ledgerId: string;
  metadata: unknown;
};

export type WorkPatternPromotionCell = {
  cellKey: string;
  fixtureKey: string;
  sourceCommitSha: string;
  taskCorpusKey: string;
  taskCorpusVersion: string;
  oracleKey: string;
  oracleVersion: string;
  resourcePolicyKey: string;
  status: "submitted" | "working" | "completed" | "blocked" | "canceled" | "failed";
  budgetUsed: number;
  budgetLimit: number;
};

export type WorkPatternPromotionPairVerdict = {
  valid: boolean;
  reasons: string[];
};

function supersededLedgerId(row: WorkPatternLedgerRow): string | null {
  if (!isRecord(row.metadata)) return null;
  const supersedes = row.metadata.supersedesLedgerId;
  const reason = row.metadata.invalidationReason;
  if (supersedes === undefined && reason === undefined) return null;
  if (
    typeof supersedes !== "string"
    || supersedes.trim().length === 0
    || typeof reason !== "string"
    || reason.trim().length === 0
  ) {
    throw new Error(`invalid_work_pattern_ledger_correction:${row.ledgerId}`);
  }
  return supersedes;
}

export function resolveEffectiveWorkPatternLedger<T extends WorkPatternLedgerRow>(
  rows: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (byId.has(row.ledgerId)) {
      throw new Error(`duplicate_work_pattern_ledger_id:${row.ledgerId}`);
    }
    byId.set(row.ledgerId, row);
  }

  const superseded = new Set<string>();
  const edges = new Map<string, string>();
  const supersederByTarget = new Map<string, string>();
  for (const row of rows) {
    const target = supersededLedgerId(row);
    if (!target) continue;
    if (!byId.has(target)) {
      throw new Error(`work_pattern_ledger_dangling_reference:${target}`);
    }
    const priorSuperseder = supersederByTarget.get(target);
    if (priorSuperseder) {
      throw new Error(
        `work_pattern_ledger_ambiguous_supersession:${target}:${priorSuperseder}:${row.ledgerId}`,
      );
    }
    supersederByTarget.set(target, row.ledgerId);
    superseded.add(target);
    edges.set(row.ledgerId, target);
  }

  for (const start of edges.keys()) {
    const visited = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor && edges.has(cursor)) {
      if (visited.has(cursor)) {
        throw new Error("work_pattern_ledger_supersession_cycle");
      }
      visited.add(cursor);
      cursor = edges.get(cursor);
    }
  }

  return rows.filter((row) => !superseded.has(row.ledgerId));
}

function mismatch(
  left: WorkPatternPromotionCell,
  right: WorkPatternPromotionCell,
  fields: readonly (keyof WorkPatternPromotionCell)[],
): boolean {
  return fields.some((field) => left[field] !== right[field]);
}

export function validateWorkPatternPromotionPair(input: {
  requiredCellKeys: readonly string[];
  left: readonly WorkPatternPromotionCell[];
  right: readonly WorkPatternPromotionCell[];
}): WorkPatternPromotionPairVerdict {
  const reasons: string[] = [];
  const all = [...input.left, ...input.right];
  const presentKeys = new Set(all.map((cell) => cell.cellKey));
  if (
    input.left.length === 0
    || input.right.length === 0
    || input.requiredCellKeys.some((cellKey) => !presentKeys.has(cellKey))
  ) {
    reasons.push("missing_required_cell");
  }
  if (all.some((cell) => cell.status !== "completed")) {
    reasons.push("non_terminal_required_cell");
  }
  if (all.some((cell) => cell.budgetUsed > cell.budgetLimit)) {
    reasons.push("resource_budget_exceeded");
  }

  const pairs = input.left.flatMap((left) => input.right.map((right) => [left, right] as const));
  if (pairs.some(([left, right]) => mismatch(left, right, ["fixtureKey"]))) {
    reasons.push("fixture_mismatch");
  }
  if (pairs.some(([left, right]) => mismatch(left, right, ["sourceCommitSha"]))) {
    reasons.push("source_commit_mismatch");
  }
  if (
    pairs.some(([left, right]) =>
      mismatch(left, right, ["taskCorpusKey", "taskCorpusVersion"]))
  ) {
    reasons.push("corpus_mismatch");
  }
  if (
    pairs.some(([left, right]) => mismatch(left, right, ["oracleKey", "oracleVersion"]))
  ) {
    reasons.push("oracle_mismatch");
  }
  if (pairs.some(([left, right]) => mismatch(left, right, ["resourcePolicyKey"]))) {
    reasons.push("resource_policy_mismatch");
  }

  return { valid: reasons.length === 0, reasons };
}
