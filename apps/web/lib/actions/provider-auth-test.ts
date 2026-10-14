import { prisma } from "@dpf/db";
import { getTestUrl } from "@/lib/ai-provider-types";
import { getDecryptedCredential, getProviderExtraHeaders, getProviderBearerToken, isAnthropicProvider, ANTHROPIC_OAUTH_BETA_HEADERS } from "@/lib/ai-provider-internals";
import { activateProvider } from "@/lib/govern/activate-provider";
import { findProviderCredential } from "@/lib/inference/provider-account-credentials";
import { providerWorkspaceHeaders } from "@/lib/inference/provider-workspace";
import { buildResponsesUrl, isChatGptBackend } from "@/lib/routing/responses-contract";
import { assertResponsesCompleted } from "@/lib/routing/responses-readiness";
import { clearProviderCapacityStatus, reconcileProviderQuotaObservation } from "@/lib/routing/provider-capacity/store";
import { resolveResponsesProbeBaseUrl } from "@/lib/routing/responses-provider";
import { refreshOAuthToken } from "@/lib/provider-oauth";
import { captureProviderQuotaObservation } from "./provider-quota-revalidation";
import type { ProviderQuotaObservation, ProviderQuotaReconciliation } from "@/lib/routing/provider-capacity/types";
import { ACCOUNT_CHANGED, assertActiveAccountSnapshot, getActiveAccountBearerToken, isActiveDefaultSubscription, type ActiveAccountSnapshot } from "@/lib/inference/active-provider-account-verification";

const OPENAI_OAUTH_LINKED_PROVIDERS = new Set(["codex", "chatgpt"]);
const SHARED_ACCOUNT_LINKED_PROVIDERS = new Set(["zai"]);

export function getLinkedActivationOptions(
  providerId: string,
  authMethod: string | null | undefined,
): { authMethod: string; activateLinked: true } | Record<string, never> {
  if (authMethod === "oauth2_authorization_code" && OPENAI_OAUTH_LINKED_PROVIDERS.has(providerId)) {
    return { authMethod, activateLinked: true };
  }
  if (authMethod === "api_key" && SHARED_ACCOUNT_LINKED_PROVIDERS.has(providerId)) {
    return { authMethod, activateLinked: true };
  }
  return {};
}

function formatResponsesScopeError(body: string): string | null {
  if (!body.includes("api.responses.write")) return null;
  return "OAuth token is missing Responses API scope (api.responses.write) — disconnect and sign in again";
}

function isExpiredOAuthResponse(status: number, body: string): boolean {
  if (status !== 401) return false;
  try {
    return JSON.parse(body)?.error?.code === "token_expired";
  } catch {
    return false;
  }
}

function signInRecoveryMessage(providerId: string, connectionId?: string): string {
  return providerId === "chatgpt" && connectionId === undefined
    ? "Session expired. Open Manage sign-in in the shared Codex connection above and sign in again, then retry verification."
    : "Session expired. Sign in again to this account, then retry verification.";
}

export async function testProviderAuthInternal(providerId: string, refreshCatalog = true, connectionId?: string, options: { verificationOnly?: boolean } = {}): Promise<{ ok: boolean; message: string }> {

  const catalog = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!catalog) return { ok: false, message: "Provider not found" };
  const connection = connectionId === undefined ? null : await prisma.aiProviderConnection.findUnique({ where: { connectionId }, include: { credentialEntry: true } });
  if (connectionId !== undefined && (!connection || connection.providerId !== providerId)) return { ok: false, message: "Provider account not found" };
  if (connection?.status === "disabled") return { ok: false, message: "Enable this account before testing authentication" };
  let activeSnapshot: ActiveAccountSnapshot | undefined;
  if (options.verificationOnly) {
    if (!isActiveDefaultSubscription(connection) || !connection.credentialEntry) return { ok: false, message: "This verification requires an already active, install-owned subscription account" };
    activeSnapshot = { connectionId: connection.connectionId, providerId: connection.providerId, credentialEntryId: connection.credentialEntryId, updatedAt: connection.updatedAt,
      credentialRevision: { updatedAt: connection.credentialEntry.updatedAt, cachedToken: connection.credentialEntry.cachedToken, refreshToken: connection.credentialEntry.refreshToken } };
  }
  const accountAuth = connection?.authMethod;
  const provider = { ...catalog, authMethod: accountAuth === "oauth" ? "oauth2_authorization_code" : accountAuth === "api-key" ? "api_key" : accountAuth === "workload-identity" ? "oauth2_client_credentials" : catalog.authMethod };
  const markAuthenticated = async (quotaObservation?: ProviderQuotaObservation | null): Promise<ProviderQuotaReconciliation | undefined> => {
    if (activeSnapshot) {
      await assertActiveAccountSnapshot(activeSnapshot);
      return undefined;
    }
    if (connectionId !== undefined) {
      return prisma.$transaction(async (tx) => {
        if (!connection?.credentialEntryId) throw new Error("Account credential not found");
        const activated = await tx.aiProviderConnection.updateMany({ where: { connectionId, credentialEntryId: connection.credentialEntryId, updatedAt: connection.updatedAt, status: { not: "disabled" } }, data: { status: "active" } });
        if (activated.count !== 1) throw new Error("Account changed during authentication — retry with its current credentials");
        await tx.credentialEntry.update({ where: { id: connection.credentialEntryId }, data: { status: "ok" } });
        return quotaObservation ? reconcileProviderQuotaObservation(tx, quotaObservation) : undefined;
      });
    } else await activateProvider(providerId, { trigger: "test_auth", skipDiscovery: !refreshCatalog, ...getLinkedActivationOptions(providerId, provider.authMethod) });
  };

  // Grok can be connected two ways: an API key (for inference/chat) OR device-code
  // OAuth (the Build Studio "grok" engine, whose ~/.grok/auth.json blob is stored in
  // cachedToken). When only the OAuth dispatch credential is present, testing the
  // inference API would misleadingly report "No API key configured" — so report the
  // OAuth connection the provider actually has.
  if (provider.cliEngine === "grok" && (provider.supportedAuthMethods as string[]).includes("oauth2_device")) {
    const oauthCred = await getDecryptedCredential(providerId, connectionId);
    const hasOAuth = !!oauthCred?.cachedToken && oauthCred.cachedToken.trimStart().startsWith("{");
    if (hasOAuth && !oauthCred?.secretRef) {
      return {
        ok: true,
        message: "Connected via your xAI account (OAuth). The Grok build engine is ready — an API key is optional and only needed for chat/inference.",
      };
    }
  }

  const providerRow = {
    ...provider,
    families: provider.families as string[],
    enabledFamilies: provider.enabledFamilies as string[],
    supportedAuthMethods: provider.supportedAuthMethods as string[],
  };

  const testUrl = getTestUrl(providerRow);
  if (!testUrl) return { ok: false, message: "No base URL or custom endpoint configured" };
  let attemptedUrl = testUrl;

  const headers: Record<string, string> = {
    ...getProviderExtraHeaders(providerId),
  };

  if (provider.authMethod === "api_key") {
    const credential = await getDecryptedCredential(providerId, connectionId);
    if (!credential?.secretRef) return { ok: false, message: "No API key configured" };
    Object.assign(headers, providerWorkspaceHeaders(providerId, credential.providerWorkspaceId));

    if (provider.authHeader) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${credential.secretRef}`
        : credential.secretRef;
    }
  } else if (provider.authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(providerId, connectionId);
    if ("error" in tokenResult) return { ok: false, message: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  } else if (provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = activeSnapshot ? await getActiveAccountBearerToken(activeSnapshot) : await getProviderBearerToken(providerId, connectionId);
    if ("error" in tokenResult) return { ok: false, message: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(provider.providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
  }
  // authMethod === "none" → no headers needed

  try {
    if (activeSnapshot) await assertActiveAccountSnapshot(activeSnapshot);
    let res: Response;

    // Agent providers (e.g. Codex) and ChatGPT subscription use the Responses
    // API, so verify the actual execution path instead of /models.
    if (provider.authMethod === "oauth2_authorization_code" &&
        (provider.category === "agent" || provider.providerId === "chatgpt")) {
      const cred = await findProviderCredential(providerId, connectionId);
      if (!cred?.status || !cred.cachedToken) {
        return { ok: false, message: "OAuth token not found — sign in again" };
      }

      const baseUrl = await resolveResponsesProbeBaseUrl(provider);
      attemptedUrl = buildResponsesUrl(providerId, baseUrl);
      const model = await prisma.modelProfile.findFirst({
        where: { providerId, modelStatus: "active" },
        orderBy: [{ lastSeenAt: "desc" }, { modelId: "asc" }],
        select: { modelId: true },
      });
      if (!model) return { ok: false, message: "No active model found — refresh the model catalog and retry" };
      let quotaObservation: ProviderQuotaObservation | null = null;
      if (connection && !activeSnapshot) {
        try {
          quotaObservation = await captureProviderQuotaObservation(connection);
        } catch {
          return { ok: false, message: "DPF could not read this account's routing restriction. No provider verification request was sent; retry when DPF is available." };
        }
      }
      const streaming = isChatGptBackend(providerId, baseUrl);
      headers["Content-Type"] = "application/json";
      const probe = async () => {
        if (activeSnapshot) await assertActiveAccountSnapshot(activeSnapshot);
        return fetch(attemptedUrl, {
        method: "POST",
        headers: { ...headers },
        body: JSON.stringify({
          model: model.modelId,
          instructions: "Reply with OK only.",
          input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
          store: false, stream: streaming, reasoning: { effort: "low" },
          ...(!streaming ? { max_output_tokens: 32 } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
        });
      };

      res = await probe();
      let body = await res.text();
      // Upstream expiry is authoritative even when our cached expiry is future.
      // Renew once through the existing owner; explicit accounts never alias.
      if (isExpiredOAuthResponse(res.status, body)) {
        const refreshProviderId = providerId === "chatgpt" && connectionId === undefined ? "codex" : providerId;
        const renewed = activeSnapshot
          ? await refreshOAuthToken(refreshProviderId, connectionId, activeSnapshot)
          : await refreshOAuthToken(refreshProviderId, connectionId);
        if ("error" in renewed) return { ok: false, message: renewed.error === ACCOUNT_CHANGED ? renewed.error : signInRecoveryMessage(providerId, connectionId) };
        headers.Authorization = `Bearer ${renewed.token}`;
        res = await probe();
        body = await res.text();
        if (isExpiredOAuthResponse(res.status, body)) {
          return { ok: false, message: signInRecoveryMessage(providerId, connectionId) };
        }
      }
      if (res.ok) {
        assertResponsesCompleted(body, streaming);
        let quotaReconciled: ProviderQuotaReconciliation | undefined;
        try {
          quotaReconciled = await markAuthenticated(quotaObservation);
        } catch (error) {
          const detail = error instanceof Error && error.message.startsWith("Account changed")
            ? error.message
            : "DPF could not persist this verification. Routing status was not confirmed.";
          return { ok: false, message: `Responses API verified. ${detail}` };
        }
        if (connectionId === undefined) await clearProviderCapacityStatus({ providerId, source: "oauth" });
        return {
          ok: true,
          message: quotaReconciled === "write-failed"
            ? "Connected via OAuth — Responses API verified. DPF could not update routing; the account is authenticated and its routing restriction remains."
            : quotaReconciled === "changed"
              ? "Connected via OAuth — Responses API verified. Routing status changed during verification; check its current status."
              : "Connected via OAuth — Responses API verified",
        };
      }

      const scopeError = formatResponsesScopeError(body);
      if (scopeError) {
        return { ok: false, message: scopeError };
      }
      return { ok: false, message: `HTTP ${res.status} — ${body.slice(0, 200)} — tried ${attemptedUrl}` };
    }

    // Anthropic subscription tokens (OAuth) can't access /models — test with a minimal /messages call instead
    if (isAnthropicProvider(provider.providerId) && provider.authMethod === "oauth2_authorization_code") {
      const baseUrl = provider.baseUrl ?? provider.endpoint ?? "";
      const messagesUrl = `${baseUrl}/messages`;
      attemptedUrl = messagesUrl;
      headers["Content-Type"] = "application/json";
      res = await fetch(messagesUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      // A 200 or even a 400 "max_tokens too low" means auth worked
      if (res.ok || res.status === 400) {
        await markAuthenticated();
        return { ok: true, message: `Connected via subscription token — auth verified` };
      }
      const body = await res.text().catch(() => "");
      return { ok: false, message: `HTTP ${res.status} — ${body.slice(0, 200)}` };
    }

    res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      // Clearance is evidence-derived: local/non-egress can use all levels;
      // hosted connections remain public-only until business terms are reviewed.
      await markAuthenticated();
      return { ok: true, message: `Connected — HTTP ${res.status}` };
    }
    return { ok: false, message: `HTTP ${res.status} — ${res.statusText}` };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Network error";
    return { ok: false, message: `${detail} — tried ${attemptedUrl}` };
  }
}
