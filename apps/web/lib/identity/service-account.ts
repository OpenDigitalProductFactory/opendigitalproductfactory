// Service accounts as a Principal subtype (EP-24741BBF · BI-3181909E).
//
// A service account is one of three shapes of the SAME identity spine — a peer
// of a human employee and an AI coworker, not a subsystem of its own. It is a
// Principal(kind="service") whose names live on PrincipalAlias, per the
// Principal-convergence rule (AGENTS.md §11). There is no parallel identity
// table, and there must never be one.
//
// This module exists because the capability was already real but lived inside
// ONE consumer (apps/web/lib/browser-drive/), which is the AGENTS.md §8
// anti-pattern: a feature-local helper acting as the second home for a shared
// concern. Moving it here is the convergence half of the epic; browser-drive
// now delegates.
//
// The rule this module enforces that its predecessor did not:
//
//   A service account with no accountable owner must be REFUSABLE.
//
// Non-human identity without a named human behind it is how authority escapes
// audit. Accountability is therefore a precondition of minting, checked at this
// module boundary — not in a UI validator a caller can bypass.

import { prisma } from "@dpf/db";

/** PrincipalAlias.aliasType for service accounts, whatever mints them. */
export const SERVICE_ACCOUNT_ALIAS_TYPE = "service-account";

/** Principal.kind discriminating the service class. */
export const SERVICE_PRINCIPAL_KIND = "service";

/** PrincipalAlias.issuer used for DPF-internal aliases (see principal-linking). */
const INTERNAL_ISSUER = "";

/** Separator between the namespace and each segment of a service principal id. */
const ID_SEPARATOR = ":";

/** The slice of Prisma this module touches; injectable so the refusal is
 *  testable at the boundary rather than only through a live database. */
export type ServiceAccountDb = Pick<typeof prisma, "principal" | "principalAlias">;

export type OwnerlessServiceAccount = {
  principalId: string;
  displayName: string;
};

/**
 * Deterministic principal id for a service account.
 *
 * The grammar is `<namespace>:<segment>[:<segment>…]` and is LOAD-BEARING:
 * browser-session integration ids embed the whole string, so a change silently
 * orphans every existing credential and binding. Callers keep their own
 * namespace so two subsystems can never collide.
 */
export function buildServiceAccountPrincipalId(
  namespace: string,
  segments: readonly string[],
): string {
  if (!namespace.trim()) {
    throw new Error("buildServiceAccountPrincipalId: a namespace is required");
  }
  if (segments.length === 0) {
    throw new Error("buildServiceAccountPrincipalId: at least one segment is required");
  }
  for (const segment of segments) {
    if (!segment.trim()) {
      throw new Error("buildServiceAccountPrincipalId: a segment must not be empty");
    }
    if (segment.includes(ID_SEPARATOR)) {
      // Otherwise (a, b:c) and (a:b, c) would produce the same id.
      throw new Error(
        `buildServiceAccountPrincipalId: a segment must not contain the "${ID_SEPARATOR}" separator`,
      );
    }
  }
  if (namespace.includes(ID_SEPARATOR)) {
    throw new Error(
      `buildServiceAccountPrincipalId: a namespace must not contain the "${ID_SEPARATOR}" separator`,
    );
  }
  return [namespace, ...segments].join(ID_SEPARATOR);
}

/**
 * Resolve the relational Principal.id for the human accountable for a service
 * account. Returns null when the user has no principal, which the caller must
 * treat as a refusal rather than a soft failure.
 */
async function resolveAccountableOwnerRecordId(
  userId: string,
  db: ServiceAccountDb,
): Promise<string | null> {
  const alias = await db.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: userId, issuer: INTERNAL_ISSUER },
    include: { principal: { select: { id: true } } },
  });
  return alias?.principal?.id ?? null;
}

/**
 * Find-or-create the service Principal for a (namespace, segments) pair, bound
 * to an accountable human owner.
 *
 * Idempotent on the principal: re-resolving an owned account returns it without
 * rewriting its alias set. Repairs forward: an account that predates the
 * accountability rule gains its sponsor the next time it is touched, so the
 * invariant converges instead of requiring a one-shot backfill to be perfect.
 */
export async function resolveServiceAccountPrincipal(
  input: {
    namespace: string;
    segments: readonly string[];
    issuer: string;
    displayName?: string;
    /** The human accountable for this non-human identity. Not optional. */
    accountableOwnerUserId: string;
  },
  db: ServiceAccountDb = prisma,
): Promise<{ principalId: string }> {
  const principalId = buildServiceAccountPrincipalId(input.namespace, input.segments);

  if (!input.accountableOwnerUserId?.trim()) {
    throw new Error(
      `resolveServiceAccountPrincipal: refusing to mint service account ${principalId} with no accountable owner`,
    );
  }

  const sponsorPrincipalId = await resolveAccountableOwnerRecordId(
    input.accountableOwnerUserId,
    db,
  );
  if (!sponsorPrincipalId) {
    throw new Error(
      `resolveServiceAccountPrincipal: refusing to mint service account ${principalId} — its accountable owner (${input.accountableOwnerUserId}) could not be resolved to a Principal`,
    );
  }

  const existing = await db.principal.findUnique({
    where: { principalId },
    select: { principalId: true, sponsorPrincipalId: true },
  });

  if (existing && !existing.sponsorPrincipalId) {
    // Repair forward rather than leaving a known-orphaned identity in place.
    await db.principal.update({
      where: { principalId },
      data: { sponsorPrincipalId },
    });
  }

  const principal = await db.principal.upsert({
    where: { principalId },
    create: {
      principalId,
      kind: SERVICE_PRINCIPAL_KIND,
      status: "active",
      displayName:
        input.displayName ?? `${input.namespace} service account (${input.segments.join(" ")})`,
      sponsorPrincipalId,
      aliases: {
        create: {
          aliasType: SERVICE_ACCOUNT_ALIAS_TYPE,
          aliasValue: principalId,
          issuer: input.issuer,
        },
      },
    },
    update: {},
    select: { principalId: true },
  });

  return { principalId: principal.principalId };
}

/**
 * The invariant guard: every service account must have an accountable owner.
 * A non-empty result is a defect, not a report — surface it rather than
 * letting an unowned non-human identity sit unnoticed.
 */
export async function findOwnerlessServiceAccounts(
  db: ServiceAccountDb = prisma,
): Promise<OwnerlessServiceAccount[]> {
  return db.principal.findMany({
    where: { kind: SERVICE_PRINCIPAL_KIND, sponsorPrincipalId: null },
    select: { principalId: true, displayName: true },
    orderBy: { principalId: "asc" },
  });
}
