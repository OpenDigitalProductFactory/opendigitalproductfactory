// Bind verification (EP-24741BBF · BI-F7317D65 + BI-CEACBD0D).
//
// A bind is an AUTHENTICATION event, so it resolves through the same spine the
// portal session does. That is the point of the epic: one identity path, no
// matter which surface the caller arrives on. A directory that authenticated
// against its own private view would be the second identity truth all over
// again, just reached over port 636 instead of HTTP.
//
// Two credential shapes are accepted, resolving design open question 1:
//
//   - PASSWORD, for human principals, verified against the credential holder
//     and then authorized by the spine.
//   - mTLS CLIENT CERTIFICATE, for any class, matched against the bind DN. This
//     is the only path open to agents and service accounts, because they have
//     no password and inventing one for them would re-create the "authorized
//     but never authenticated" gap this epic closes.

import { prisma } from "@dpf/db";

import { authorizePrincipalForSession } from "@/lib/identity/authentication";
import { verifyPassword } from "@/lib/govern/password";

import type { BindVerifier } from "./server";

/** Extract the `uid=` RDN value from a bind DN, unescaping RFC 4514 escapes. */
export function principalIdFromBindDn(bindDn: string): string | null {
  const match = /^uid=((?:[^,\\]|\\.)*),/i.exec(bindDn.trim());
  if (!match) return null;
  return match[1]!.replace(/\\(.)/g, "$1");
}

type BindDb = Pick<typeof prisma, "principal" | "principalAlias" | "user">;

export function createBindVerifier(
  db: BindDb = prisma,
  deps: {
    verify?: typeof verifyPassword;
    authorize?: typeof authorizePrincipalForSession;
  } = {},
): BindVerifier {
  const verify = deps.verify ?? verifyPassword;
  const authorize = deps.authorize ?? authorizePrincipalForSession;

  return async ({ bindDn, password, clientCertificateSubject }) => {
    const principalId = principalIdFromBindDn(bindDn);
    if (!principalId) {
      return { bound: false, reason: "bind DN must name a principal as uid=<principalId>,…" };
    }

    const principal = await db.principal.findUnique({
      where: { principalId },
      select: {
        principalId: true,
        kind: true,
        status: true,
        aliases: { select: { aliasType: true, aliasValue: true } },
      },
    });
    if (!principal) return { bound: false, reason: "no such principal" };

    // Refuse an inactive principal before touching any credential, so an
    // attacker cannot use timing to distinguish "disabled" from "wrong password".
    if (principal.status !== "active") {
      return { bound: false, reason: "invalid credentials" };
    }

    // mTLS: the certificate subject must name the same principal.
    if (clientCertificateSubject) {
      if (clientCertificateSubject === principalId) {
        return { bound: true, principalId };
      }
      return { bound: false, reason: "client certificate does not match the bind DN" };
    }

    // Password binds are for humans only. An agent or service account has no
    // password by design; giving it one would be a second credential store.
    if (principal.kind !== "human") {
      return {
        bound: false,
        reason: "non-human principals bind with a client certificate, not a password",
      };
    }
    if (!password) return { bound: false, reason: "invalid credentials" };

    const userId = principal.aliases.find((alias) => alias.aliasType === "user")?.aliasValue;
    if (!userId) return { bound: false, reason: "invalid credentials" };

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) return { bound: false, reason: "invalid credentials" };

    const { valid } = await verify(password, user.passwordHash);
    if (!valid) return { bound: false, reason: "invalid credentials" };

    // Same spine check the portal session runs. One identity path.
    const spine = await authorize(user.id, db as never);
    if (!spine.authorized) return { bound: false, reason: "invalid credentials" };

    return { bound: true, principalId };
  };
}
