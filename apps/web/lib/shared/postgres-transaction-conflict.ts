function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Database-confirmed rollback only. Callers retain their own retry policy. */
export function isRolledBackPostgresConflict(error: unknown): boolean {
  const code = field(error, "code");
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  if (code !== "P2010") return false;
  // Prisma's driver adapter wraps raw-query SQLSTATEs rather than exposing
  // P2034. Connection errors or message text cannot prove rollback.
  const originalCode = field(field(field(field(error, "meta"), "driverAdapterError"), "cause"), "originalCode");
  return originalCode === "40001" || originalCode === "40P01";
}
