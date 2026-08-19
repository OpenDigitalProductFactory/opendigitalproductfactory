import { refreshOAuthToken } from "@dpf/integration-shared";
import { type Dispatcher } from "undici";

export interface ExchangeGoogleRefreshTokenParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  dispatcher?: Dispatcher;
}

export interface ExchangeGoogleRefreshTokenResult {
  accessToken: string;
  tokenType: string;
  expiresAt: Date;
  scope: string;
}

export class GoogleMarketingAuthError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "GoogleMarketingAuthError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveGoogleTokenEndpoint(): string {
  return process.env.GOOGLE_TOKEN_ENDPOINT_URL ?? "https://oauth2.googleapis.com/token";
}

export async function exchangeGoogleRefreshToken(
  params: ExchangeGoogleRefreshTokenParams,
): Promise<ExchangeGoogleRefreshTokenResult> {
  const result = await refreshOAuthToken({
    endpoint: resolveGoogleTokenEndpoint(),
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    refreshToken: params.refreshToken,
    credentialPlacement: "body",
    dispatcher: params.dispatcher,
    makeError: (message, opts) => new GoogleMarketingAuthError(message, opts),
    // Google returns 400 (invalid_grant) for a bad refresh token in addition
    // to the standard 401/403.
    authErrorStatuses: [400, 401, 403],
    networkErrorMessage: "Google token exchange failed — check network reachability and try again.",
    invalidCredsMessage: "invalid Google credentials",
    missingTokenMessage: "Google token exchange did not return an access token",
    invalidJsonMessage: "Google token response was not valid JSON",
    unexpectedStatusMessage: (statusCode) => `Google token exchange failed with status ${statusCode}`,
  });

  return {
    accessToken: result.accessToken,
    tokenType: result.tokenType,
    expiresAt: result.expiresAt,
    // Google does not rotate the refresh token; preserve the historic ""
    // default when the response omits scope.
    scope: result.scope ?? "",
  };
}
