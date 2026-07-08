// Canonical "unknown thrown value -> human string" helper.
//
// Collapses the `err instanceof Error ? err.message : String(err)` idiom that was
// hand-written at 300+ sites. Keeping it in one place means a single, consistent
// extraction (Error.message, else a safe String() coercion) and lets a ratchet ban
// the raw ternary from regrowing.

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  // Some thrown values (e.g. Response-like or plain objects) carry a `message`.
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return String(err);
  } catch {
    return "Unknown error";
  }
}
