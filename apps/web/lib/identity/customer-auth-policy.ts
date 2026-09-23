import { CUSTOMER_ACCOUNT_STATUSES } from "@dpf/db/customer-lifecycle";

/**
 * Account lifecycle states that may hold an interactive customer session.
 *
 * This is deliberately a subset of the canonical customer lifecycle union:
 * suspended, closed, superseded, archived, and the historical `inactive`
 * value all fail closed at the authentication boundary.
 */
export const CUSTOMER_SESSION_CAPABLE_ACCOUNT_STATUSES = [
  "prospect",
  "qualified",
  "onboarding",
  "active",
  "at_risk",
] as const satisfies readonly (typeof CUSTOMER_ACCOUNT_STATUSES)[number][];

const sessionCapableStatuses = new Set<string>(
  CUSTOMER_SESSION_CAPABLE_ACCOUNT_STATUSES,
);

export function isCustomerAccountSessionCapable(status: string): boolean {
  return sessionCapableStatuses.has(status);
}
