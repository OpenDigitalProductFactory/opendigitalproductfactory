// ADP OAuth token-exchange client for the services/adp container.
// Ported from apps/web/lib/integrate/adp/token-client.ts — same semantics.
// Dedup TODO when a shared integrations package lands.

import { Agent, request, type Dispatcher } from "undici";
import { getAdpRuntimeConfig, getHarnessRequestHeaders, isHarnessTransport } from "./runtime-config.js";

export type AdpEnvironment = "sandbox" | "production";

export interface ExchangeTokenParams {
  environment: AdpEnvironment;
  clientId: string;
  clientSecret: string;
  certPem: string;
  privateKeyPem: string;
  dispatcher?: Dispatcher;
}

export interface ExchangeTokenResult {
  accessToken: string;
  expiresAt: Date;
}

export class AdpAuthError extends Error {
  readonly statusCode: number | undefined;
  readonly errorCode: string | undefined;

  constructor(message: string, opts?: { statusCode?: number; errorCode?: string }) {
    super(message);
    this.name = "AdpAuthError";
    this.statusCode = opts?.statusCode;
    this.errorCode = opts?.errorCode;
  }
}

export function resolveTokenEndpoint(env: AdpEnvironment): string {
  return getAdpRuntimeConfig(env).tokenEndpointUrl;
}

function buildMtlsDispatcher(certPem: string, privateKeyPem: string): Agent {
  return new Agent({ connect: { cert: certPem, key: privateKeyPem } });
}

export async function exchangeToken(params: ExchangeTokenParams): Promise<ExchangeTokenResult> {
  const url = resolveTokenEndpoint(params.environment);
  const dispatcher = params.dispatcher
    ?? (isHarnessTransport(url) ? undefined : buildMtlsDispatcher(params.certPem, params.privateKeyPem));

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: params.clientId,
    client_secret: params.clientSecret,
  }).toString();

  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...getHarnessRequestHeaders(),
      },
      body,
      dispatcher,
    });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : undefined;
    throw new AdpAuthError(
      "mTLS handshake failed — verify cert matches the one registered in ADP Partner Self-Service",
      { errorCode: code },
    );
  }

  const { statusCode, body: responseBody } = response;

  if (statusCode === 401 || statusCode === 403) {
    await safelyDrain(responseBody);
    throw new AdpAuthError("invalid client credentials", { statusCode });
  }
  if (statusCode >= 500) {
    await safelyDrain(responseBody);
    throw new AdpAuthError("ADP token endpoint returned a server error — retry later", { statusCode });
  }
  if (statusCode !== 200) {
    await safelyDrain(responseBody);
    throw new AdpAuthError(`unexpected token exchange failed with status ${statusCode}`, { statusCode });
  }

  let parsed: unknown;
  try {
    parsed = await responseBody.json();
  } catch {
    throw new AdpAuthError("ADP token response was not valid JSON", { statusCode });
  }
  if (!isTokenResponse(parsed)) {
    throw new AdpAuthError("ADP token response missing access_token", { statusCode });
  }

  const expiresInSec = typeof parsed.expires_in === "number" && parsed.expires_in > 0
    ? parsed.expires_in
    : 3600;

  return {
    accessToken: parsed.access_token,
    expiresAt: new Date(Date.now() + expiresInSec * 1000),
  };
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

function isTokenResponse(v: unknown): v is TokenResponse {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.access_token === "string" && o.access_token.length > 0;
}

async function safelyDrain(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    /* ignore */
  }
}
