import type { Prisma } from "@dpf/db";

import type { DataSourceFilter, FilterCondition } from "./types";

function statusWhere(
  condition: FilterCondition,
): Prisma.BacklogItemWhereInput | undefined {
  if (condition.field !== "status") return undefined;

  if (condition.operator === "eq" && typeof condition.value === "string") {
    return { status: condition.value };
  }
  if (condition.operator === "neq" && typeof condition.value === "string") {
    return { status: { not: condition.value } };
  }
  if (
    condition.operator === "in"
    && Array.isArray(condition.value)
    && condition.value.every((value) => typeof value === "string")
  ) {
    return { status: { in: condition.value } };
  }
  return undefined;
}

/**
 * Translate only filters whose semantics Prisma mirrors exactly. Returning
 * undefined deliberately falls back to shared in-memory filtering.
 */
export function backlogPrismaWhere(
  filter: DataSourceFilter,
): Prisma.BacklogItemWhereInput | undefined {
  if (filter.logic !== "and" || filter.conditions.length === 0) return undefined;
  const clauses = filter.conditions.map(statusWhere);
  if (clauses.some((clause) => clause === undefined)) return undefined;
  return clauses.length === 1
    ? clauses[0]
    : { AND: clauses as Prisma.BacklogItemWhereInput[] };
}
