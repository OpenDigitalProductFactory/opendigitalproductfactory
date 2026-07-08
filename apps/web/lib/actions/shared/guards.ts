// apps/web/lib/actions/shared/guards.ts
//
// Shared authorization preamble for server actions. The capability check
// itself stays in the canonical `can()` primitive (@/lib/permissions); this
// module only deduplicates the `auth() -> session -> can() -> throw` wrapper
// that was copy-pasted into ~40 action files (e.g. requireManageFinance was
// verbatim across the eight finance files).
//
// Standard preamble only: resolve the session, run a single capability check,
// and throw `Error("Unauthorized")` on failure. Helpers that do MORE than this
// (ownership checks, result-object unions, custom error types/messages,
// multi-capability OR logic, organization lookups) keep their bespoke bodies
// and are intentionally NOT routed through here.

import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { can, type CapabilityKey } from "@/lib/permissions";

/** The authenticated session user, exactly as `auth()` resolves it. */
export type SessionUser = Session["user"];

/**
 * Resolve the current session and assert a signed-in user.
 *
 * The single authentication preamble for server actions: ~17 files had grown
 * their own local `requireAuth` / `requireUser` / `requireAuthUser` copies that
 * drifted on two axes — the null-check (`!user` vs `!user?.id`) and the error
 * string (`"Unauthorized"` vs `"Not authenticated"`). This helper fixes ONE
 * contract: the strict `!user?.id` check and `Error("Unauthorized")`.
 *
 * Use `requireUser` when the action needs fields off the user (role, email,
 * accountId); use `requireUserId` when it only needs the id.
 *
 * @returns the authenticated session user.
 * @throws Error("Unauthorized") when there is no user or the user has no id.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    throw new Error("Unauthorized");
  }
  return user;
}

/**
 * Resolve the current session and assert a signed-in user, returning the id.
 *
 * The id-only companion to {@link requireUser} with the same error contract.
 *
 * @returns the authenticated user's id.
 * @throws Error("Unauthorized") when there is no user or the user has no id.
 */
export async function requireUserId(): Promise<string> {
  return (await requireUser()).id;
}

/**
 * Resolve the current session and assert it holds `capability`.
 *
 * Mirrors the historical inline preamble exactly: it reads the session user,
 * runs `can({ platformRole, isSuperuser }, capability)`, and throws
 * `Error("Unauthorized")` when there is no user or the capability is absent.
 *
 * @returns the authenticated user's id, wrapped as `{ userId }`.
 * @throws Error("Unauthorized") when unauthenticated or lacking the capability.
 */
export async function requireCapability(
  capability: CapabilityKey,
): Promise<{ userId: string }> {
  const session = await auth();
  const user = session?.user;
  if (
    !user?.id ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, capability)
  ) {
    throw new Error("Unauthorized");
  }
  return { userId: user.id };
}

/**
 * Wrap a server-action body behind a capability check. The guarded callback
 * receives the resolved `{ userId }` so it never re-reads the session.
 *
 * @example
 *   export const archiveThing = (id: string) =>
 *     withCapability("manage_backlog", ({ userId }) => doArchive(id, userId));
 *
 * @throws Error("Unauthorized") before `fn` runs when the check fails.
 */
export async function withCapability<T>(
  capability: CapabilityKey,
  fn: (ctx: { userId: string }) => Promise<T> | T,
): Promise<T> {
  const ctx = await requireCapability(capability);
  return fn(ctx);
}
