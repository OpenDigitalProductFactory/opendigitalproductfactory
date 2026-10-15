// BI-79D26E39 — the consent a headless OAuth client already has.
//
// A client_credentials client has no browser and no consent screen. Its
// authority is granted ONCE, by an operator, when the client is created:
// `allowedScopes` is the grant, `ownerUserId` the human whose role caps it, and
// `agentId` the assistant it acts as (for Grok, bound by setup — BI-8D152751).
// Without a consent binding its tokens got no connection-delegation steering,
// so every routine write a headless assistant made parked on a human approval.
//
// Founder decision 2026-10-15: the operator's creation of such a client IS the
// consent. This reuses — or creates once — the owner's consent binding for
// (owner, client, resource, assistant), through the same eligibility rule the
// consent screen applies (createOAuthConsentBinding → eligibleOAuthCoworkers).
// The token carries it, and resolveOAuthConsent revalidates it on every call,
// exactly as for an authorization_code token. A client with no assistant, or an
// assistant the rules reject, gets no binding — the behaviour before this.
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";

import {
  OAUTH_SETUP_REQUIRED,
  createOAuthConsentBinding,
  resolveOAuthConsent,
} from "./oauth-identity-binding";
import type { PublicScope } from "./oauth-public-scopes";

type Db = Pick<typeof prisma, "authorityBinding" | "authorizationDecisionLog" | "$transaction">;

export async function credentialsClientConsentBindingId(
  input: {
    userId: string;
    /** OAuthClient ROW id — the binding's foreign key. */
    clientRowId: string;
    /** Public client_id, for the audit record only. */
    publicClientId: string;
    /** Canonical MCP resource the token is issued for. */
    resource: string;
    /** Public agent id (AGT-*) the client acts as, or null. */
    agentId: string | null;
    scopes: PublicScope[];
  },
  db: Db = prisma,
): Promise<string | null> {
  if (!input.agentId) return null;

  const candidates = await db.authorityBinding.findMany({
    where: {
      oauthPurpose: "consent", status: "active",
      oauthUserId: input.userId, oauthClientId: input.clientRowId,
      resourceRef: input.resource, appliedAgent: { agentId: input.agentId },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const candidate of candidates) {
    const consent = await resolveOAuthConsent({
      bindingId: candidate.id, userId: input.userId, clientId: input.clientRowId,
      resource: input.resource, scopes: input.scopes,
    }, db as never);
    if (consent && consent.agentId === input.agentId) return candidate.id;
  }

  try {
    return await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const binding = await createOAuthConsentBinding({
        userId: input.userId, clientId: input.clientRowId, resource: input.resource,
        agentId: input.agentId!, scopes: input.scopes,
      }, tx);
      await tx.authorizationDecisionLog.create({ data: {
        authorityBindingId: binding.id,
        decisionId: `oauth-client-credentials-consent-${randomUUID()}`,
        actorType: "human", actorRef: input.userId, humanContextRef: input.userId,
        agentContextRef: input.agentId, actionKey: "oauth_client_credentials_consent",
        objectRef: input.resource, decision: "allow",
        rationale: {
          bindingId: binding.bindingId, clientId: input.publicClientId,
          registrationKind: "credentials", approvedScopes: input.scopes,
          basis: "operator-created credentials client bound to an approved assistant (BI-79D26E39)",
        },
      } });
      return binding.id;
    });
  } catch (err) {
    // The consent rules said no: keep the pre-existing unbound behaviour.
    if (err instanceof Error && err.message === OAUTH_SETUP_REQUIRED) return null;
    throw err;
  }
}
