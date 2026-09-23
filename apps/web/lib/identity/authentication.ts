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

import {
  PrincipalAliasConflictError,
  syncCustomerPrincipal,
  syncUserPrincipal,
} from "./principal-linking";
import { isCustomerAccountSessionCapable } from "./customer-auth-policy";

// NOTE: this is deliberately NOT `ActionResult` from @/lib/shared/action-result.
// That primitive models a server action's `{ok, data} | {ok, error}` contract and
// carries only a human-readable error string. An authorization verdict needs a
// STABLE machine reason the bind path and the session path both branch on, so the
// discriminant says what actually happened — authorized — rather than borrowing a
// generic one that would lose the reason code.
export const AUTHENTICATION_AUTHORITY = ["install", "upstream"] as const;
export type AuthenticationAuthority = (typeof AUTHENTICATION_AUTHORITY)[number];

export const AUTHENTICATION_REFUSAL_CODES = [
  "no-credential-match",
  "credential-inactive",
  "account-inactive",
  "principal-not-resolved",
  "principal-inactive",
  "authority-conflict",
] as const;
export type AuthenticationRefusalCode = (typeof AUTHENTICATION_REFUSAL_CODES)[number];

export type PrincipalAuthenticationRefusal = {
  authorized: false;
  /** Stable machine code. Never surfaced verbatim to an end user. */
  reason: AuthenticationRefusalCode;
  detail: string;
};

export type PrincipalAuthenticationSuccess = {
  authorized: true;
  principalId: string;
  principalRecordId: string;
  credentialId: string;
  population: "workforce" | "customer";
  /** Backwards-compatible workforce subject; customer callers use credentialId. */
  userId?: string;
  authority: AuthenticationAuthority;
};

export type PrincipalAuthenticationResult =
  | PrincipalAuthenticationSuccess
  | PrincipalAuthenticationRefusal;

type AuthenticationDb = Pick<
  typeof prisma,
  "user" | "customerContact" | "principal" | "principalAlias"
>;

type PrincipalAuthorityRow = { id: string; principalId: string; status: string };

function principalVerdict(input: {
  principal: PrincipalAuthorityRow;
  credentialId: string;
  population: "workforce" | "customer";
}): PrincipalAuthenticationResult {
  if (input.principal.status !== "active") {
    return {
      authorized: false,
      reason: "principal-inactive",
      detail: `principal ${input.principal.principalId} is ${input.principal.status}`,
    };
  }
  return {
    authorized: true,
    principalId: input.principal.principalId,
    principalRecordId: input.principal.id,
    credentialId: input.credentialId,
    population: input.population,
    ...(input.population === "workforce" ? { userId: input.credentialId } : {}),
    authority: "install",
  };
}

/**
 * Population-aware authority seam called only after the caller verifies the
 * credential or provider assertion. It owns Principal materialization and all
 * state checks shared by workforce, customer password, and social sign-in.
 */
export async function authorizeIdentityForSession(
  input: { population: "workforce" | "customer"; credentialId: string },
  db: AuthenticationDb = prisma,
): Promise<PrincipalAuthenticationResult> {
  if (input.population === "workforce") {
    return authorizePrincipalForSession(input.credentialId, db);
  }

  const contact = await db.customerContact.findUnique({
    where: { id: input.credentialId },
    select: {
      id: true,
      isActive: true,
      mergedIntoId: true,
      account: {
        select: {
          status: true,
          partnerEnrollment: { select: { status: true, endedAt: true } },
        },
      },
    },
  });
  if (!contact) {
    return {
      authorized: false,
      reason: "no-credential-match",
      detail: `customer contact ${input.credentialId} was not found`,
    };
  }
  if (!contact.isActive || contact.mergedIntoId) {
    return {
      authorized: false,
      reason: "credential-inactive",
      detail: `customer contact ${contact.id} is inactive or superseded`,
    };
  }
  if (!isCustomerAccountSessionCapable(contact.account.status)) {
    return {
      authorized: false,
      reason: "account-inactive",
      detail: `customer account is ${contact.account.status}`,
    };
  }

  const aliases = await db.principalAlias.findMany({
    where: {
      aliasType: { in: ["customer_contact", "partner_contact"] },
      aliasValue: contact.id,
      issuer: "",
    },
    select: { principal: { select: { id: true, principalId: true, status: true } } },
  });
  const principals = new Map<string, PrincipalAuthorityRow>();
  for (const alias of aliases) principals.set(alias.principal.id, alias.principal);
  if (principals.size > 1) {
    return {
      authorized: false,
      reason: "authority-conflict",
      detail: `customer contact ${contact.id} resolves to multiple Principals`,
    };
  }

  let principal = principals.values().next().value as PrincipalAuthorityRow | undefined;
  if (!principal) {
    try {
      principal = await syncCustomerPrincipal(contact.id, db as never);
    } catch (error) {
      return {
        authorized: false,
        reason: error instanceof PrincipalAliasConflictError
          ? "authority-conflict"
          : "principal-not-resolved",
        detail: `customer contact ${contact.id} could not be resolved as one Principal`,
      };
    }
  }
  return principalVerdict({
    principal,
    credentialId: contact.id,
    population: "customer",
  });
}

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
    credentialId: userId,
    population: "workforce",
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
): Promise<{
  principalId: string;
  userIdsDisabled: string[];
  customerContactIdsDisabled: string[];
}> {
  return client.$transaction(async (tx) => {
    const principal = await tx.principal.update({
      where: { principalId },
      data: { status: "inactive" },
      select: {
        principalId: true,
        aliases: {
          where: { aliasType: { in: ["user", "customer_contact", "partner_contact"] } },
          select: { aliasType: true, aliasValue: true },
        },
      },
    });
    const userIds = principal.aliases
      .filter((alias) => alias.aliasType === "user")
      .map((alias) => alias.aliasValue);
    const customerContactIds = [...new Set(
      principal.aliases
        .filter((alias) => alias.aliasType === "customer_contact" || alias.aliasType === "partner_contact")
        .map((alias) => alias.aliasValue),
    )];
    if (userIds.length > 0) {
      await tx.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
    }
    if (customerContactIds.length > 0) {
      await tx.customerContact.updateMany({
        where: { id: { in: customerContactIds } },
        data: { isActive: false },
      });
    }
    return {
      principalId: principal.principalId,
      userIdsDisabled: userIds,
      customerContactIdsDisabled: customerContactIds,
    };
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
