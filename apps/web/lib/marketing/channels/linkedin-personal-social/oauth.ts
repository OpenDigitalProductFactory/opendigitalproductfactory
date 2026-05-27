// LinkedIn personal social — OAuth flow helpers.
//
// Three-legged authorization_code flow:
//   1. startLinkedInOAuth  — operator submits app credentials; we save them
//      to IntegrationCredential (status=pending-oauth), create an
//      OAuthPendingFlow row keyed by random state, return the authorize URL.
//   2. operator authorizes on LinkedIn.
//   3. completeLinkedInOAuth — callback handler exchanges code for tokens,
//      writes tokens into tokenCacheEnc, fetches /v2/userinfo, captures the
//      member URN + display name into fieldsEnc, sets status=connected.

import { prisma } from "@dpf/db";
import { encryptJson, decryptJson } from "@/lib/govern/credential-crypto";
import { randomBytes } from "node:crypto";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchUserInfo,
  memberUrnFromSub,
  type FetchImpl,
} from "./client";

const INTEGRATION_ID = "linkedin-personal-social";
const PROVIDER = "linkedin";
const FLOW_TTL_MS = 10 * 60 * 1000;

export type StartOAuthInput = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type StartOAuthResult =
  | { ok: true; authorizeUrl: string; state: string }
  | { ok: false; error: string };

export async function startLinkedInOAuth(input: StartOAuthInput): Promise<StartOAuthResult> {
  if (!input.clientId || !input.clientSecret || !input.redirectUri) {
    return { ok: false, error: "Missing clientId, clientSecret, or redirectUri." };
  }
  if (!/^https?:\/\//.test(input.redirectUri)) {
    return { ok: false, error: "redirectUri must be an absolute URL." };
  }

  const state = randomBytes(24).toString("base64url");

  const fields = {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
  };

  await prisma.integrationCredential.upsert({
    where: { integrationId: INTEGRATION_ID },
    create: {
      integrationId: INTEGRATION_ID,
      provider: PROVIDER,
      status: "pending-oauth",
      fieldsEnc: encryptJson(fields),
    },
    update: {
      provider: PROVIDER,
      status: "pending-oauth",
      fieldsEnc: encryptJson(fields),
      tokenCacheEnc: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    },
  });

  // Reuse OAuthPendingFlow — providerId column is a free-form string with no FK.
  await prisma.oAuthPendingFlow.create({
    data: {
      state,
      codeVerifier: "n/a (LinkedIn uses confidential client; no PKCE)",
      providerId: INTEGRATION_ID,
    },
  });

  return {
    ok: true,
    authorizeUrl: buildAuthorizeUrl({
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state,
    }),
    state,
  };
}

export type CompleteOAuthResult =
  | { ok: true; memberDisplayName: string | null; memberUrn: string }
  | { ok: false; error: string };

export async function completeLinkedInOAuth(input: {
  state: string;
  code: string;
  fetchImpl?: FetchImpl;
}): Promise<CompleteOAuthResult> {
  const flow = await prisma.oAuthPendingFlow.findUnique({ where: { state: input.state } });
  if (!flow || flow.providerId !== INTEGRATION_ID) {
    return { ok: false, error: "invalid_state" };
  }
  if (Date.now() - flow.createdAt.getTime() > FLOW_TTL_MS) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } }).catch(() => {});
    return { ok: false, error: "flow_expired" };
  }

  const credentialRow = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });
  if (!credentialRow) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } }).catch(() => {});
    return { ok: false, error: "credential_row_missing" };
  }

  const fields = decryptJson<{ clientId?: string; clientSecret?: string; redirectUri?: string }>(
    credentialRow.fieldsEnc,
  );
  if (!fields?.clientId || !fields.clientSecret || !fields.redirectUri) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } }).catch(() => {});
    return { ok: false, error: "credential_app_config_missing" };
  }

  const tokenResult = await exchangeCodeForToken({
    code: input.code,
    clientId: fields.clientId,
    clientSecret: fields.clientSecret,
    redirectUri: fields.redirectUri,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  if ("error" in tokenResult) {
    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "error",
        lastErrorAt: new Date(),
        lastErrorMsg: tokenResult.error,
      },
    });
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } }).catch(() => {});
    return { ok: false, error: tokenResult.error };
  }

  const userInfo = await fetchUserInfo(tokenResult.access_token, input.fetchImpl);
  if ("error" in userInfo) {
    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "error",
        lastErrorAt: new Date(),
        lastErrorMsg: userInfo.error,
      },
    });
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } }).catch(() => {});
    return { ok: false, error: userInfo.error };
  }

  const memberUrn = memberUrnFromSub(userInfo.sub);
  const memberDisplayName = userInfo.name ?? null;

  await prisma.integrationCredential.update({
    where: { integrationId: INTEGRATION_ID },
    data: {
      status: "connected",
      fieldsEnc: encryptJson({
        ...fields,
        memberUrn,
        memberDisplayName,
        memberEmail: userInfo.email ?? null,
      }),
      tokenCacheEnc: encryptJson({
        access_token: tokenResult.access_token,
        refresh_token: tokenResult.refresh_token ?? null,
        expires_at: new Date(Date.now() + tokenResult.expires_in * 1000).toISOString(),
        scope: tokenResult.scope ?? null,
      }),
      lastTestedAt: new Date(),
      lastErrorAt: null,
      lastErrorMsg: null,
    },
  });

  await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } }).catch(() => {});

  return { ok: true, memberDisplayName, memberUrn };
}

export async function disconnectLinkedInIntegration(): Promise<void> {
  await prisma.integrationCredential.deleteMany({
    where: { integrationId: INTEGRATION_ID },
  });
}

export async function readLinkedInConnectionState(): Promise<{
  status: "unconfigured" | "pending-oauth" | "connected" | "error";
  redirectUri: string | null;
  memberDisplayName: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
}> {
  const row = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });
  if (!row) {
    return {
      status: "unconfigured",
      redirectUri: null,
      memberDisplayName: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }
  const fields = decryptJson<{ redirectUri?: string; memberDisplayName?: string }>(row.fieldsEnc) ?? {};
  return {
    status: (row.status as "unconfigured" | "pending-oauth" | "connected" | "error"),
    redirectUri: typeof fields.redirectUri === "string" ? fields.redirectUri : null,
    memberDisplayName: typeof fields.memberDisplayName === "string" ? fields.memberDisplayName : null,
    lastErrorMsg: row.lastErrorMsg,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
  };
}
