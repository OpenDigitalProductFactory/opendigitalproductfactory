// apps/web/lib/shared/action-result.ts
//
// Canonical discriminated result for server actions — the single source of
// truth for the `{ ok: true; data } | { ok: false; error }` shape that was
// hand-inlined at ~700 return sites across server actions, with two divergent
// local type aliases (`lib/actions/workbooks.ts` `ActionResult`,
// `lib/actions/taskrun-recovery-server-actions.ts` `Result`).
//
// A server action returns success xor failure; the caller narrows on `ok`:
//
//   const res = await doThingAction(id);
//   if (!res.ok) return toast.error(res.error);
//   use(res.data);
//
// The `ok()` / `err()` constructors keep the discriminant literal (`ok: true` /
// `ok: false`) correct by construction, so a typo like `ok: "true"` or a
// forgotten `error` field can't slip in.
//
// `T = void` models a side-effecting action with no payload — `ok()` with no
// argument yields `{ ok: true }` (no `data` key), matching the pre-existing
// workbooks contract exactly so this is a drop-in replacement there.
//
// Pure types + pure functions only (no Prisma / server-only / React imports) so
// server actions, API routes, and client components can all import it.

export type ActionSuccess<T = void> = T extends void ? { ok: true } : { ok: true; data: T };
export type ActionFailure = { ok: false; error: string };
export type ActionResult<T = void> = ActionSuccess<T> | ActionFailure;

/** Success with no payload — `{ ok: true }`. */
export function ok(): ActionSuccess<void>;
/** Success carrying a payload — `{ ok: true, data }`. */
export function ok<T>(data: T): ActionSuccess<T>;
export function ok<T>(data?: T): ActionSuccess<T> {
  return (data === undefined ? { ok: true } : { ok: true, data }) as ActionSuccess<T>;
}

/**
 * Failure carrying a human-readable message — `{ ok: false, error }`.
 * Its precise (non-generic) type is assignable to `ActionResult<T>` for every
 * `T` (the failure branch is identical across all payload types), so `err(...)`
 * can be returned from any action regardless of its success payload.
 */
export function err(message: string): ActionFailure {
  return { ok: false, error: message };
}
