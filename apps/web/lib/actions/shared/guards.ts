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

import { auth } from "@/lib/auth";
import { can, type CapabilityKey } from "@/lib/permissions";

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
