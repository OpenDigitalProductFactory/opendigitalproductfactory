import { request, type Dispatcher } from "undici";

/**
 * BI-ABC88965 (EP-8DC217EB BET-3) — the single canonical home for the
 * RFC-6749 `refresh_token` grant exchange over undici `request`.
 *
 * Before this, every provider integration hand-rolled the same ~110-LOC token
 * client: build a form-encoded `grant_type=refresh_token` body, POST it with
 * undici, walk the identical status ladder (401/403 → invalid creds, optional
 * ≥500 branch, generic non-200, JSON-parse guard, missing-token guard), and
 * map the payload to `{ accessToken, refreshToken, tokenType, expiresAt }`.
 *
 * The only things that legitimately varied between providers are captured as
 * config here — credential placement (Basic-auth header vs body params), which
 * statuses count as invalid-credentials, whether a distinct ≥500 branch exists,
 * whether the response must carry a rotated refresh_token, and the exact
 * provider-specific error wording. Each provider keeps its OWN error class by
 * passing a `makeError` factory, so caller-observable behavior is unchanged.
 *
 * NOTE — this covers the `refresh_token` grant only. The `client_credentials`
 * clients (Microsoft 365, ADP) are a DIFFERENT grant with their own shape
 * (mTLS dispatcher construction, harness-transport headers, no refresh token)
 * and consolidate under a sibling increment.
 */

export interface OAuthRefreshConfig {
  /** Fully-resolved token endpoint URL (provider resolves its own env override). */
  endpoint: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Where the client credentials go: an HTTP Basic header, or body params. */
  credentialPlacement: "basic-header" | "body";
  /** Optional undici dispatcher — primarily a MockAgent in tests. */
  dispatcher?: Dispatcher;
  /** Extra form-body params merged after the standard grant params. */
  extraBodyParams?: Record<string, string>;
  /** Provider error factory — preserves each vendor's Error subclass + name. */
  makeError: (message: string, opts?: { statusCode?: number }) => Error;
  /** HTTP statuses treated as invalid-credentials. Default [401, 403]. */
  authErrorStatuses?: number[];
  /** When set, statusCode ≥ 500 throws this. When omitted, ≥ 500 falls into the
   *  generic non-200 branch (i.e. no distinct server-error message). */
  serverErrorMessage?: string;
  /** When true, the response MUST carry a string refresh_token. Default false. */
  requireRefreshToken?: boolean;
  /** Provider-specific "check network reachability" message (network failure). */
  networkErrorMessage: string;
  /** Provider-specific "invalid X credentials" message (auth-error statuses). */
  invalidCredsMessage: string;
  /** Provider-specific "did not return an access token" message. */
  missingTokenMessage: string;
  /** Provider-specific "response was not valid JSON" message. */
  invalidJsonMessage: string;
  /** Provider-specific message for an unexpected (non-200, non-auth, non-5xx)
   *  status — receives the status code. */
  unexpectedStatusMessage: (statusCode: number) => string;
}

export interface OAuthRefreshResult {
  accessToken: string;
  /** The rotated refresh token, or null for non-rotating providers. */
  refreshToken: string | null;
  /** token_type from the response, defaulting to "Bearer" when absent. */
  tokenType: string;
  expiresAt: Date;
  /** Granted scope string, or null when the response omits it. */
  scope: string | null;
  /** The raw parsed token response, for provider-specific extraction. */
  raw: Record<string, unknown>;
}

const DEFAULT_AUTH_ERROR_STATUSES = [401, 403];
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

/**
 * Perform an OAuth 2.0 `refresh_token` grant exchange. Throws — via
 * `config.makeError` — on network failure, auth error, unexpected status,
 * invalid JSON, or a missing/invalid token payload.
 */
export async function refreshOAuthToken(
  config: OAuthRefreshConfig,
): Promise<OAuthRefreshResult> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };

  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", config.refreshToken);

  if (config.credentialPlacement === "basic-header") {
    const authorization = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
      "utf8",
    ).toString("base64");
    headers.authorization = `Basic ${authorization}`;
  } else {
    params.set("client_id", config.clientId);
    params.set("client_secret", config.clientSecret);
  }

  for (const [key, value] of Object.entries(config.extraBodyParams ?? {})) {
    params.set(key, value);
  }

  let response: Dispatcher.ResponseData;
  try {
    response = await request(config.endpoint, {
      method: "POST",
      dispatcher: config.dispatcher,
      headers,
      body: params.toString(),
    });
  } catch {
    throw config.makeError(config.networkErrorMessage);
  }

  const { statusCode, body } = response;
  const authErrorStatuses = config.authErrorStatuses ?? DEFAULT_AUTH_ERROR_STATUSES;

  if (authErrorStatuses.includes(statusCode)) {
    await safelyDrainBody(body);
    throw config.makeError(config.invalidCredsMessage, { statusCode });
  }

  if (config.serverErrorMessage !== undefined && statusCode >= 500) {
    await safelyDrainBody(body);
    throw config.makeError(config.serverErrorMessage, { statusCode });
  }

  if (statusCode !== 200) {
    await safelyDrainBody(body);
    throw config.makeError(config.unexpectedStatusMessage(statusCode), { statusCode });
  }

  let parsed: unknown;
  try {
    parsed = await body.json();
  } catch {
    throw config.makeError(config.invalidJsonMessage, { statusCode });
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw config.makeError(config.missingTokenMessage, { statusCode });
  }
  const raw = parsed as Record<string, unknown>;

  const accessToken = typeof raw.access_token === "string" ? raw.access_token : null;
  if (!accessToken) {
    throw config.makeError(config.missingTokenMessage, { statusCode });
  }

  const rotatedRefreshToken =
    typeof raw.refresh_token === "string" ? raw.refresh_token : null;
  if (config.requireRefreshToken && rotatedRefreshToken === null) {
    throw config.makeError(config.missingTokenMessage, { statusCode });
  }

  const rawExpiresIn = raw.expires_in;
  const expiresIn =
    typeof rawExpiresIn === "number"
      ? rawExpiresIn
      : typeof rawExpiresIn === "string"
        ? Number(rawExpiresIn)
        : DEFAULT_EXPIRES_IN_SECONDS;

  return {
    accessToken,
    refreshToken: rotatedRefreshToken,
    tokenType: typeof raw.token_type === "string" ? raw.token_type : "Bearer",
    expiresAt: new Date(Date.now() + Math.max(1, expiresIn) * 1000),
    scope: typeof raw.scope === "string" ? raw.scope : null,
    raw,
  };
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore — we don't care about the content, just need to release the socket
  }
}
