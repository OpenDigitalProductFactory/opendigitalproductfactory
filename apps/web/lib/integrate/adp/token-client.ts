import { Agent, request, type Dispatcher } from "undici";

export type AdpEnvironment = "sandbox" | "production";

export interface ExchangeTokenParams {
  environment: AdpEnvironment;
  clientId: string;
  clientSecret: string;
  certPem: string;
  privateKeyPem: string;
  /**
   * Override the dispatcher used for the HTTP call. Primarily for tests
   * (inject a MockAgent to avoid real network). When omitted, a fresh mTLS
   * Agent is built from certPem + privateKeyPem — that's the production path.
   */
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
  if (env === "production") return "https://accounts.api.adp.com/auth/oauth/v2/token";
  return "https://accounts.sandbox.api.adp.com/auth/oauth/v2/token";
}

function buildMtlsDispatcher(certPem: string, privateKeyPem: string): Agent {
  return new Agent({
    connect: {
      cert: certPem,
      key: privateKeyPem,
    },
  });
}

/**
 * Perform an OAuth 2.0 client_credentials exchange against ADP over mTLS.
 * Returns { accessToken, expiresAt } on success.
 * Throws AdpAuthError on any failure — the message is redacted (never
 * includes clientSecret, clientId, cert bytes, or raw server responses).
 */
export async function exchangeToken(params: ExchangeTokenParams): Promise<ExchangeTokenResult> {
  const url = resolveTokenEndpoint(params.environment);
  const dispatcher = params.dispatcher ?? buildMtlsDispatcher(params.certPem, params.privateKeyPem);

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
      },
      body,
      dispatcher,
    });
  } catch (err) {
    // Network-layer failure (mTLS handshake, DNS, timeout). Do not include
    // the underlying error's stringification — it may contain cert bytes.
    const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : undefined;
    throw new AdpAuthError(
      "mTLS handshake failed — verify cert matches the one registered in ADP Partner Self-Service",
      { errorCode: code },
    );
  }

  const { statusCode, body: responseBody } = response;

  if (statusCode === 401 || statusCode === 403) {
    // Drain the body without inspecting it; the response may echo our client_id.
    await safelyDrainBody(responseBody);
    throw new AdpAuthError("invalid client credentials", { statusCode });
  }

  if (statusCode >= 500) {
    await safelyDrainBody(responseBody);
    throw new AdpAuthError("ADP token endpoint returned a server error — retry later", {
      statusCode,
    });
  }

  if (statusCode !== 200) {
    await safelyDrainBody(responseBody);
    throw new AdpAuthError(`unexpected token exchange failed with status ${statusCode}`, {
      statusCode,
    });
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
    : 3600; // ADP default

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

function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.access_token === "string" && v.access_token.length > 0;
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore — we don't care about the content, just need to release the socket
  }
}
