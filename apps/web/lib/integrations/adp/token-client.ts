import { exchangeClientCredentials } from "@dpf/integration-shared";
import { Agent, type Dispatcher } from "undici";

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

// ADP-specific: build the mTLS transport from the partner cert + key. This stays
// in the ADP wrapper (the shared helper is transport-agnostic) and is handed to
// the shared exchange via `dispatcher`.
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
  const dispatcher =
    params.dispatcher ?? buildMtlsDispatcher(params.certPem, params.privateKeyPem);

  const result = await exchangeClientCredentials({
    endpoint: resolveTokenEndpoint(params.environment),
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    // ADP sends no scope param.
    dispatcher,
    makeError: (message, opts) => new AdpAuthError(message, opts),
    // Preserve historic behavior: only 401/403 were treated as invalid creds
    // (the shared default of [400,401,403] would newly capture 400).
    authErrorStatuses: [401, 403],
    serverErrorMessage: "ADP token endpoint returned a server error — retry later",
    // The shared helper forwards the network error's `code` (e.g. ECONNREFUSED)
    // through makeError as errorCode — preserving AdpAuthError.errorCode on the
    // mTLS-handshake path.
    networkErrorMessage:
      "mTLS handshake failed — verify cert matches the one registered in ADP Partner Self-Service",
    invalidCredsMessage: "invalid client credentials",
    missingTokenMessage: "ADP token response missing access_token",
    invalidJsonMessage: "ADP token response was not valid JSON",
    unexpectedStatusMessage: (statusCode) =>
      `unexpected token exchange failed with status ${statusCode}`,
  });

  return {
    accessToken: result.accessToken,
    expiresAt: result.expiresAt,
  };
}
