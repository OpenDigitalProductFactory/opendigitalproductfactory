// Principal-rooted authentication (EP-24741BBF · BI-CEACBD0D).
//
// THE DEFECT THIS CLOSES. `apps/web/lib/govern/auth.ts` never read `Principal`.
// Authentication was `User`-rooted while every TAK/GAID authorization decision
// is `Principal`-rooted, reconciled after the fact by a one-way
// `syncUserPrincipal`. So the platform decided WHO YOU ARE without consulting
// the spine that decides WHAT YOU MAY DO — two identity roots inside one
// system, which is exactly the parallel-truth failure this epic exists to
// remove. Deactivation was a sync property rather than an invariant.
//
// WHAT CHANGES. `User` remains the CREDENTIAL HOLDER for humans — it is not
// deleted and its ~70 relations are untouched. It stops being an independent
// identity root: a credential is verified, then the session is authorized by
// the resolved `Principal`. An inactive Principal cannot log in even when its
// User row still says active.
//
// WHAT DOES NOT CHANGE. The authorization model. This decides who attests
// identity, not what a role may do. Grants, capabilities and TAK classes are
// untouched.

import { prisma } from "@dpf/db";

import { syncUserPrincipal } from "./principal-linking";

// NOTE: this is deliberately NOT `ActionResult` from @/lib/shared/action-result.
// That primitive models a server action's `{ok, data} | {ok, error}` contract and
// carries only a human-readable error string. An authorization verdict needs a
// STABLE machine reason the bind path and the session path both branch on, so the
// discriminant says what actually happened — authorized — rather than borrowing a
// generic one that would lose the reason code.
export const AUTHENTICATION_AUTHORITY = ["install", "upstream"] as const;
export type AuthenticationAuthority = (typeof AUTHENTICATION_AUTHORITY)[number];

export type PrincipalAuthenticationRefusal = {
  authorized: false;
  /** Stable machine code. Never surfaced verbatim to an end user. */
  reason:
    | "no-credential-match"
    | "principal-not-resolved"
    | "principal-inactive"
    | "authority-conflict";
  detail: string;
};

export type PrincipalAuthenticationSuccess = {
  authorized: true;
  principalId: string;
  principalRecordId: string;
  userId: string;
  authority: AuthenticationAuthority;
};

export type PrincipalAuthenticationResult =
  | PrincipalAuthenticationSuccess
  | PrincipalAuthenticationRefusal;

type AuthenticationDb = Pick<typeof prisma, "user" | "principal" | "principalAlias">;

/**
 * Authorize an already-credential-verified user through the spine.
 *
 * Credential verification stays with the caller (NextAuth's provider owns
 * password comparison and rehashing). This function answers the question that
 * was previously never asked: does the SPINE agree this identity may act?
 */
export async function authorizePrincipalForSession(
  userId: string,
  db: AuthenticationDb = prisma,
): Promise<PrincipalAuthenticationResult> {
  // Materialize the principal if the projection has not caught up. The spine is
  // authoritative, so a missing row is a staleness problem to fix, not grounds
  // to fall back to the User row and re-create the two-root split.
  let alias = await db.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: userId, issuer: "" },
    select: { principal: { select: { id: true, principalId: true, status: true } } },
  });

  if (!alias?.principal) {
    try {
      await syncUserPrincipal(userId, db as never);
    } catch {
      return {
        authorized: false,
        reason: "principal-not-resolved",
        detail: `user ${userId} could not be resolved or materialized as a Principal`,
      };
    }
    alias = await db.principalAlias.findFirst({
      where: { aliasType: "user", aliasValue: userId, issuer: "" },
      select: { principal: { select: { id: true, principalId: true, status: true } } },
    });
  }

  const principal = alias?.principal;
  if (!principal) {
    return {
      authorized: false,
      reason: "principal-not-resolved",
      detail: `user ${userId} has no Principal on the spine`,
    };
  }

  // The invariant: the SPINE gates the session. An inactive principal cannot
  // authenticate even if its credential row still says active.
  if (principal.status !== "active") {
    return {
      authorized: false,
      reason: "principal-inactive",
      detail: `principal ${principal.principalId} is ${principal.status}`,
    };
  }

  return {
    authorized: true,
    principalId: principal.principalId,
    principalRecordId: principal.id,
    userId,
    authority: "install",
  };
}

/**
 * Deactivate an identity as ONE transaction across the spine and its credential.
 *
 * Previously these drifted: disabling a User left its Principal active until a
 * sync ran, so authorization could outlive authentication. Deactivation is now
 * an invariant rather than an eventual consistency.
 */
export async function deactivatePrincipalAndCredentials(
  principalId: string,
  client: typeof prisma = prisma,
): Promise<{ principalId: string; userIdsDisabled: string[] }> {
  return client.$transaction(async (tx) => {
    const principal = await tx.principal.update({
      where: { principalId },
      data: { status: "inactive" },
      select: {
        principalId: true,
        aliases: { where: { aliasType: "user" }, select: { aliasValue: true } },
      },
    });
    const userIds = principal.aliases.map((alias) => alias.aliasValue);
    if (userIds.length > 0) {
      await tx.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
    }
    return { principalId: principal.principalId, userIdsDisabled: userIds };
  });
}

/**
 * Which authority attests people on this install.
 *
 * The install's own directory is authoritative by default, and outward
 * federation is OPTIONAL — the platform must be complete without it. When an
 * upstream is connected the install still wins for a principal it holds
 * locally; the pair is reported so a conflict SURFACES rather than resolving
 * silently in whichever direction the code happened to check first.
 */
export function resolveAuthenticationAuthority(input: {
  hasLocalPrincipal: boolean;
  connectedUpstreams: string[];
}): {
  authority: AuthenticationAuthority | null;
  conflict: boolean;
  explanation: string;
} {
  const hasUpstream = input.connectedUpstreams.length > 0;
  if (input.hasLocalPrincipal && hasUpstream) {
    return {
      authority: "install",
      conflict: true,
      explanation: `the install holds this principal locally and ${input.connectedUpstreams.join(", ")} also claims it; the install wins and the overlap is reported rather than hidden`,
    };
  }
  if (input.hasLocalPrincipal) {
    return {
      authority: "install",
      conflict: false,
      explanation: "the install's own directory is the authority; no upstream is connected",
    };
  }
  if (hasUpstream) {
    return {
      authority: "upstream",
      conflict: false,
      explanation: `no local principal; ${input.connectedUpstreams.join(", ")} attests this identity`,
    };
  }
  return {
    authority: null,
    conflict: false,
    explanation: "no local principal and no upstream authority can attest this identity",
  };
}
