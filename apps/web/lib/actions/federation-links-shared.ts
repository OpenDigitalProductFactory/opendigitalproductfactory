// EP-MSP-FEDERATION · B1 operator surface — the guard and failure shape every
// federation-links action shares.
//
// Split out of `federation-links.ts` rather than invented here: that module is a
// `"use server"` file, so it can only export async functions, and a shared type,
// a path constant and a permission guard cannot live behind that boundary while
// also being importable by a sibling action module.

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { can } from "@/lib/permissions";

/** Admin route revalidated after every federation-links mutation. */
export const ADMIN_PATH = "/platform/federation-links";

/** The closed failure shape these actions return. */
export type ActionFailure = {
  ok: false;
  error:
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "invalid_input"
    | "invalid_transition"
    | "internal_error";
  message: string;
};

/**
 * Require `manage_platform`, and resolve the acting principal for audit.
 *
 * Resolves through `PrincipalAlias` first and falls back to syncing one, so an
 * action always has a principal id to attribute a mutation to rather than a bare
 * user id.
 */
export async function assertManagePlatform(): Promise<
  { ok: true; principalId: string; userId: string } | ActionFailure
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthorized", message: "Sign in required" };
  }
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_platform",
    )
  ) {
    return { ok: false, error: "forbidden", message: "manage_platform capability required" };
  }
  const alias = await prisma.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: session.user.id },
    select: { principalId: true },
  });
  if (alias?.principalId) {
    return { ok: true, principalId: alias.principalId, userId: session.user.id };
  }
  const synced = await syncUserPrincipal(session.user.id);
  return { ok: true, principalId: synced.id, userId: session.user.id };
}
