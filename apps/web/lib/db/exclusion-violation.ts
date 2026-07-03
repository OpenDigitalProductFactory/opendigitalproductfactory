/**
 * Detect a Postgres exclusion-constraint violation (SQLSTATE 23P01).
 *
 * Postgres raises 23P01 when a `gist` EXCLUDE constraint rejects a row that
 * would overlap an existing one — the atomic backstop that makes double-booking
 * a database error rather than an application race (EP-056D2A5E, kernel decision
 * D2 = gist-exclude). Prisma has no dedicated error code for exclusion
 * violations (`P2002` is unique-only), so `create()` surfaces them either as a
 * `PrismaClientKnownRequestError` carrying the driver `code`/`meta.code`, or as
 * a raw error whose message embeds the SQLSTATE and the constraint name. We
 * detect all of those shapes so every reservation call site treats a lost race
 * identically.
 *
 * Kept dependency-free (operates on the error shape only) so it is trivially
 * unit-testable and importable from any server action.
 */
export function isExclusionViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: string;
    meta?: { code?: unknown } | null;
    message?: unknown;
  };
  // Prisma known-request errors surface the driver SQLSTATE on meta.code.
  const metaCode = e.meta && typeof e.meta === "object" ? (e.meta as { code?: unknown }).code : undefined;
  if (metaCode === "23P01") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return (
    msg.includes("23P01") ||
    msg.includes("exclusion constraint") ||
    // Our constraints are all named `<Table>_no_overlap` (see the
    // booking_overlap_exclusion migration).
    msg.includes("_no_overlap")
  );
}
