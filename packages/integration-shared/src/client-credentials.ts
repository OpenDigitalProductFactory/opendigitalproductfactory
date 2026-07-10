import { request, type Dispatcher } from "undici";

/**
 * BI-ABC88965 (EP-8DC217EB BET-3 increment 2) — the single canonical home for
 * the RFC-6749 `client_credentials` grant exchange over undici `request`.
 *
 * The sibling of `oauth-refresh.ts` (the merged BET-3 opener, #2744). Where that
 * helper consolidated the `refresh_token` grant, this one consolidates the
 * two-legged `client_credentials` grant that provider integrations (Microsoft
 * 365 Communications, ADP) each hand-rolled: build a form-encoded
 * `grant_type=client_credentials` body, POST it with undici, walk the identical
 * status ladder (401/403 → invalid creds, ≥500 → server error, generic non-200,
 * JSON-parse guard, missing-token guard), and map the payload to an
 * `{ accessToken, tokenType, expiresAt }`-shaped result.
 *
 * The axes that legitimately vary between providers are captured as config here
 * — whether a `scope` param is sent, the mTLS/harness dispatcher a vendor
 * supplies, which statuses count as invalid-credentials, and the exact
 * provider-specific error wording + Error subclass (passed as `makeError`).
 * ADP-specific concerns — building the mTLS `undici.Agent` from cert+key — STAY
 * in the ADP wrapper and are handed in via `dispatcher`; the shared helper is
 * transport-agnostic.
 *
 * NOTE — this covers the `client_credentials` grant only. The `refresh_token`
 * grant lives in the sibling `oauth-refresh.ts`.
 */

export interface ClientCredentialsConfig {
  /** Fully-resolved token endpoint URL (provider resolves its own env override). */
  endpoint: string;
  clientId: string;
  clientSecret: string;
  /** OAuth scope. When omitted, no `scope` param is sent in the body. */
  scope?: string;
  /** Extra form-body params merged after the standard grant params. */
  extraBodyParams?: Record<string, string>;
  /** Undici dispatcher — a MockAgent in tests, or a vendor's own transport
   *  (ADP passes its mTLS `Agent`; when omitted, undici's global dispatcher). */
  dispatcher?: Dispatcher;
  /** Provider error factory — preserves each vendor's Error subclass + name. */
  makeError: (message: string, opts?: { statusCode?: number; errorCode?: string }) => Error;
  /** HTTP statuses treated as invalid-credentials. Default [400, 401, 403]. */
  authErrorStatuses?: number[];
  /** When set, statusCode ≥ 500 throws this. When omitted, ≥ 500 falls into the
   *  generic non-200 branch (i.e. no distinct server-error message). */
  serverErrorMessage?: string;
  /** When true, the response MUST carry a string scope. Default false. */
  requireScope?: boolean;
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

export interface ClientCredentialsResult {
  accessToken: string;
  /** token_type from the response, defaulting to "Bearer" when absent. */
  tokenType: string;
  expiresAt: Date;
  /** Granted scope string, or null when the response omits it. */
  scope: string | null;
  /** The raw parsed token response, for provider-specific extraction. */
  raw: Record<string, unknown>;
}

const DEFAULT_AUTH_ERROR_STATUSES = [400, 401, 403];
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

/**
 * Perform an OAuth 2.0 `client_credentials` grant exchange. Throws — via
 * `config.makeError` — on network failure, auth error, unexpected status,
 * invalid JSON, or a missing/invalid token payload. Client credentials are
 * always sent in the body (this grant has no Basic-header variant among the
 * migrated providers).
 */
export async function exchangeClientCredentials(
  config: ClientCredentialsConfig,
): Promise<ClientCredentialsResult> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };

  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", config.clientId);
  params.set("client_secret", config.clientSecret);

  if (config.scope !== undefined) {
    params.set("scope", config.scope);
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
  } catch (err) {
    // Network-layer failure (mTLS handshake, DNS, timeout). Do not include the
    // underlying error's stringification — it may contain cert bytes. Forward
    // only the error's `code` (e.g. ECONNREFUSED) as errorCode; vendors whose
    // Error ignores errorCode simply drop it.
    const code =
      err instanceof Error && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    throw config.makeError(config.networkErrorMessage, { errorCode: code });
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

  const scope = typeof raw.scope === "string" ? raw.scope : null;
  if (config.requireScope && scope === null) {
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
    tokenType: typeof raw.token_type === "string" ? raw.token_type : "Bearer",
    expiresAt: new Date(Date.now() + Math.max(1, expiresIn) * 1000),
    scope,
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
