// Test support for the document isolation suites (BI-957915CB): evaluates the
// subset of a Prisma `where` the document store builds against an in-memory
// row, so the tests prove what the clause SELECTS rather than what it looks
// like. Supported: AND / OR / NOT, scalar equality and null, `in`, `not`,
// `gt`, case-insensitive `contains`, and `some` over a related array.

type Row = Record<string, unknown>;

function matchesScalar(value: unknown, condition: unknown, now: Date): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
  if (typeof condition !== "object") return value === condition;
  const ops = condition as Record<string, unknown>;
  for (const [op, operand] of Object.entries(ops)) {
    switch (op) {
      case "in":
        if (!(operand as unknown[]).includes(value)) return false;
        break;
      case "notIn":
        if ((operand as unknown[]).includes(value)) return false;
        break;
      case "not":
        if (matchesScalar(value, operand, now)) return false;
        break;
      case "gt":
        if (!(value instanceof Date) || !(operand instanceof Date) || value.getTime() <= operand.getTime()) return false;
        break;
      case "contains": {
        const insensitive = ops["mode"] === "insensitive";
        const haystack = typeof value === "string" ? value : "";
        const needle = String(operand);
        if (!(insensitive ? haystack.toLowerCase().includes(needle.toLowerCase()) : haystack.includes(needle))) return false;
        break;
      }
      case "mode":
        break;
      case "equals":
        if (value !== operand) return false;
        break;
      default:
        throw new Error(`matchesWhere: unsupported scalar operator ${op}`);
    }
  }
  return true;
}

export function matchesWhere(row: Row, where: unknown, now: Date = new Date()): boolean {
  if (!where || typeof where !== "object") return true;
  for (const [key, condition] of Object.entries(where as Record<string, unknown>)) {
    if (condition === undefined) continue;
    if (key === "AND") {
      if (!(condition as unknown[]).every((clause) => matchesWhere(row, clause, now))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(condition as unknown[]).some((clause) => matchesWhere(row, clause, now))) return false;
      continue;
    }
    if (key === "NOT") {
      const clauses = Array.isArray(condition) ? condition : [condition];
      if (clauses.some((clause) => matchesWhere(row, clause, now))) return false;
      continue;
    }
    const value = row[key];
    if (condition && typeof condition === "object" && "is" in (condition as object)) {
      const related = value as Row | null | undefined;
      if (!related || !matchesWhere(related, (condition as { is: unknown }).is, now)) return false;
      continue;
    }
    if (condition && typeof condition === "object" && "some" in (condition as object)) {
      const related = Array.isArray(value) ? (value as Row[]) : [];
      if (!related.some((child) => matchesWhere(child, (condition as { some: unknown }).some, now))) return false;
      continue;
    }
    if (!matchesScalar(value, condition, now)) return false;
  }
  return true;
}
