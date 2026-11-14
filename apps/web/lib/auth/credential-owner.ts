// Who owns a credential the host toolchain issues for an AI client (BI-81F01D3A).
//
// The issuer scripts (issue-grok-credentials-client.ts, issue-mcp-token.ts) run
// inside the portal container, called by the toolchain bootstrap with no
// account named. They used to default to admin@dpf.local, the seeded bootstrap
// account, so a host's Grok acted as that account and every approval it raised
// went to an inbox nobody reads: the failure the account handover (BI-F25A5FC7)
// and the portfolio owner (BI-67B27832) exist to end.
//
// With no account named, the owner is the install's accountable person: the
// same owner walk scheduled work uses (findTaskOwnerUserId: Foundational
// portfolio, then the organization, skipping an account whose work was handed
// over). A named account still wins, but it must exist and be active.

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

type UserLookup = {
  findFirst(args: { where: { email?: string; id?: string }; select?: unknown }): Promise<{ id: string; email: string; isActive: boolean } | null>;
};

export type CredentialOwner = { user: { id: string; email: string }; source: "named" | "accountable-owner" };

export async function resolveCredentialOwner(
  users: UserLookup,
  findAccountableOwnerUserId: () => Promise<string | null>,
  namedEmail: string | undefined,
): Promise<ActionResult<CredentialOwner>> {
  const select = { id: true, email: true, isActive: true };
  if (namedEmail) {
    const user = await users.findFirst({ where: { email: namedEmail }, select });
    if (!user) return err(`No user found with email "${namedEmail}".`);
    if (!user.isActive) return err(`The account "${namedEmail}" is deactivated.`);
    return ok({ user: { id: user.id, email: user.email }, source: "named" });
  }
  const ownerId = await findAccountableOwnerUserId();
  const user = ownerId ? await users.findFirst({ where: { id: ownerId }, select }) : null;
  if (!user || !user.isActive) {
    return err("No accountable person is recorded for this install. Name one with --user <email>.");
  }
  return ok({ user: { id: user.id, email: user.email }, source: "accountable-owner" });
}
