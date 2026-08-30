"use server";

// Operator-facing actions for the MCP authorization server's client registry.
//
// This is where a HEADLESS caller gets its credentials. There is no browser in
// a CI job or a cron container, so authority cannot be granted at request time
// by a consent screen — it is granted here, once, by an operator, and the
// client's `allowedScopes` IS the grant. Without this surface the
// client_credentials grant has no way to exist, and without that the dpfmcp_
// PAT could never be retired (design §2.1, §9.5).
//
// Every action is capability-gated on the acting human and every issued client
// is bound to an owning user, so a client can never exceed the authority of the
// person who created it.

import { revalidatePath } from "next/cache";
import { ok, err, type ActionResult } from "@/lib/shared/action-result";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { prepareClientSecret } from "@/lib/auth/oauth-tokens";
import { isRegisterableRedirectUri } from "@/lib/auth/oauth-clients";
import { isPublicScope, PUBLIC_SCOPES, type PublicScope } from "@/lib/auth/oauth-scope-map";

const ADMIN_PATH = "/admin/platform-development";

type Actor = { userId: string };
/** Deliberately NOT the ActionFailure shape: keeping the denial distinct means
 *  a caller cannot forget to convert it and accidentally return a bare object
 *  where an ActionResult is expected. */
type Denial = { denied: string };

function isDenied(actor: Actor | Denial): actor is Denial {
  return "denied" in actor;
}

async function requireOperator(): Promise<Actor | Denial> {
  const session = await auth();
  if (!session?.user?.id) return { denied: "Not signed in." };
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return { denied: "You do not have permission to manage MCP clients." };
  }
  return { userId: session.user.id };
}

export type OAuthClientSummary = {
  clientId: string;
  clientName: string;
  registrationKind: string;
  allowedScopes: string[];
  redirectUris: string[];
  selfAsserted: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  liveTokenCount: number;
};

export async function listOAuthClients(): Promise<ActionResult<OAuthClientSummary[]>> {
  const actor = await requireOperator();
  if (isDenied(actor)) return err(actor.denied);

  const rows = await prisma.oAuthClient.findMany({
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      _count: {
        select: {
          tokens: { where: { revokedAt: null, expiresAt: { gt: new Date() } } },
        },
      },
    },
  });

  return ok(
    rows.map((r) => ({
      clientId: r.oAuthClientId,
      clientName: r.clientName,
      registrationKind: r.registrationKind,
      allowedScopes: r.allowedScopes,
      redirectUris: r.redirectUris,
      // Surfaced so the operator can see which names are self-chosen.
      selfAsserted: r.registrationKind === "dcr",
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      liveTokenCount: r._count.tokens,
    })),
  );
}

export type CreatedCredentialsClient = {
  clientId: string;
  clientSecret: string;
  scopes: PublicScope[];
};

/**
 * Create a `client_credentials` client — the headless replacement for a PAT.
 *
 * The secret is returned ONCE. Unlike a PAT it is not the credential the
 * client presents to the MCP transport: it is exchanged at the token endpoint
 * for a short-lived, audience-bound access token. That is the difference that
 * makes it safe to leave in a CI secret store.
 */
export async function createOAuthCredentialsClient(input: {
  clientName: string;
  scopes: string[];
  agentId?: string | null;
}): Promise<ActionResult<CreatedCredentialsClient>> {
  const actor = await requireOperator();
  if (isDenied(actor)) return err(actor.denied);

  const name = input.clientName?.trim();
  if (!name) return err("A client name is required.");
  if (name.length > 120) return err("Client name is too long.");

  const scopes = (input.scopes ?? []).filter(isPublicScope);
  if (scopes.length === 0) {
    return err(`Grant at least one scope (${PUBLIC_SCOPES.join(", ")}).`);
  }

  const secret = prepareClientSecret();
  const clientId = `dpfoc_${crypto.randomUUID().replace(/-/g, "")}`;

  await prisma.oAuthClient.create({
    data: {
      oAuthClientId: clientId,
      clientName: name,
      registrationKind: "credentials",
      clientSecretHash: secret.hash,
      clientSecretEnc: secret.enc,
      // No redirect URIs: this grant never involves a browser.
      redirectUris: [],
      // The human whose authority the client acts under. Their platformRole
      // still caps every call, so this cannot escalate.
      ownerUserId: actor.userId,
      agentId: input.agentId?.trim() || null,
      allowedScopes: scopes,
    },
  });

  revalidatePath(ADMIN_PATH);
  return ok({ clientId, clientSecret: secret.plaintext, scopes });
}

/**
 * Pre-register an interactive client (design §4.4 mechanism 3), for an
 * operator who wants a known client pinned rather than relying on DCR.
 */
export async function preregisterOAuthClient(input: {
  clientName: string;
  redirectUris: string[];
  scopes?: string[];
}): Promise<ActionResult<{ clientId: string }>> {
  const actor = await requireOperator();
  if (isDenied(actor)) return err(actor.denied);

  const name = input.clientName?.trim();
  if (!name) return err("A client name is required.");

  const uris = (input.redirectUris ?? []).map((u) => u.trim()).filter(Boolean);
  if (uris.length === 0) return err("At least one redirect URI is required.");
  const bad = uris.find((u) => !isRegisterableRedirectUri(u));
  if (bad) {
    return err(`Unusable redirect URI: ${bad}. Use https, or http on loopback only.`);
  }

  const clientId = `dpfoc_${crypto.randomUUID().replace(/-/g, "")}`;
  await prisma.oAuthClient.create({
    data: {
      oAuthClientId: clientId,
      clientName: name,
      registrationKind: "preregistered",
      redirectUris: uris,
      // Empty means uncapped: consent remains the gate for interactive clients.
      allowedScopes: (input.scopes ?? []).filter(isPublicScope),
      ownerUserId: actor.userId,
    },
  });

  revalidatePath(ADMIN_PATH);
  return ok({ clientId });
}

/**
 * Revoke a client and everything it holds.
 *
 * Both halves matter. Revoking the client alone would leave already-issued
 * access tokens live until they expired, which is not what anyone means by
 * "revoke" — so live tokens and refresh tokens are revoked in the same
 * transaction.
 */
export async function revokeOAuthClient(input: {
  clientId: string;
  reason?: string;
}): Promise<ActionResult<{ revokedTokens: number }>> {
  const actor = await requireOperator();
  if (isDenied(actor)) return err(actor.denied);

  const client = await prisma.oAuthClient.findUnique({ where: { oAuthClientId: input.clientId } });
  if (!client) return err("Unknown client.");

  const now = new Date();
  const reason = input.reason?.trim() || "operator_revoked";

  const [, tokens] = await prisma.$transaction([
    prisma.oAuthClient.update({
      where: { id: client.id },
      data: { revokedAt: now, revokedReason: reason },
    }),
    prisma.mcpApiToken.updateMany({
      where: { oauthClientId: client.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    }),
    prisma.oAuthRefreshToken.updateMany({
      where: { oauthClientId: client.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    }),
  ]);

  revalidatePath(ADMIN_PATH);
  return ok({ revokedTokens: tokens.count });
}

/**
 * The PAT migration surface (design §9.5 / Slice 6).
 *
 * Shows the operator what still depends on the legacy credential and how
 * recently — so the deprecation horizon is a decision made against evidence
 * rather than a guess about who might break.
 */
export type PatMigrationStatus = {
  issuanceClosed: boolean;
  resolutionDisabled: boolean;
  livePats: { name: string; scope: string; lastUsedAt: string | null; expiresAt: string | null }[];
};

export async function listPatMigrationStatus(): Promise<ActionResult<PatMigrationStatus>> {
  const actor = await requireOperator();
  if (isDenied(actor)) return err(actor.denied);

  const rows = await prisma.mcpApiToken.findMany({
    where: {
      kind: { not: "oauth_access" },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { name: true, scope: true, lastUsedAt: true, expiresAt: true },
    orderBy: { lastUsedAt: "desc" },
    take: 200,
  });

  return ok({
    issuanceClosed: process.env.DPF_MCP_PAT_ISSUANCE_CLOSED === "1",
    resolutionDisabled: process.env.DPF_MCP_PAT_RESOLUTION_DISABLED === "1",
    livePats: rows.map((r) => ({
      name: r.name,
      scope: r.scope,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
    })),
  });
}
