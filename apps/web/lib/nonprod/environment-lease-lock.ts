// Shared DB-only serialization boundary for lease allocation and bounded handoff.
// Keep the closed registry here: schema, admission and absence proofs all consume it.
export const NONPROD_ENVIRONMENT_KEYS = Object.freeze([
  "active-candidate", "host-heavy-resource", "local-integration-ci",
] as const);
export type NonprodEnvironmentKey = (typeof NONPROD_ENVIRONMENT_KEYS)[number];
export const NONPROD_TERMINAL_LEASE_STATUSES = Object.freeze(["released", "expired", "cancelled"] as const);

export function isNonprodEnvironmentKey(value: string): value is NonprodEnvironmentKey {
  return (NONPROD_ENVIRONMENT_KEYS as readonly string[]).includes(value);
}
export function isTerminalLeaseStatus(value: string): value is (typeof NONPROD_TERMINAL_LEASE_STATUSES)[number] {
  return (NONPROD_TERMINAL_LEASE_STATUSES as readonly string[]).includes(value);
}

type EnvironmentLockDb = {
  $executeRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

/** Caller supplies a live transaction; this port performs no external I/O. */
export async function lockNonprodEnvironment(tx: EnvironmentLockDb, environmentKey: string): Promise<void> {
  if (!isNonprodEnvironmentKey(environmentKey)) throw new Error(`Unknown nonproduction environment: ${environmentKey}`);
  if (!tx.$executeRaw) throw new Error("Environment serialization requires $executeRaw on the transaction.");
  const lockKey = `dpf:nonprod-environment:${environmentKey}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

/** Stable order shared by the receipt attempt and rejection publication. */
export async function lockAllNonprodEnvironments(tx: EnvironmentLockDb): Promise<void> {
  for (const key of [...NONPROD_ENVIRONMENT_KEYS].sort()) await lockNonprodEnvironment(tx, key);
}
