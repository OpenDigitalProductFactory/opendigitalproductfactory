import { refreshOAuthToken } from "@dpf/integration-shared";
import { type Dispatcher } from "undici";

export interface ExchangeRefreshTokenParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  dispatcher?: Dispatcher;
}

export interface ExchangeRefreshTokenResult {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: Date;
}

export class QuickBooksAuthError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "QuickBooksAuthError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveTokenEndpoint(): string {
  return process.env.QUICKBOOKS_TOKEN_ENDPOINT_URL
    ?? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
}

export async function exchangeRefreshToken(
  params: ExchangeRefreshTokenParams,
): Promise<ExchangeRefreshTokenResult> {
  const result = await refreshOAuthToken({
    endpoint: resolveTokenEndpoint(),
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    refreshToken: params.refreshToken,
    credentialPlacement: "basic-header",
    dispatcher: params.dispatcher,
    makeError: (message, opts) => new QuickBooksAuthError(message, opts),
    requireRefreshToken: true,
    serverErrorMessage: "QuickBooks token endpoint returned a server error — retry later.",
    networkErrorMessage: "QuickBooks token exchange failed — check network reachability and try again.",
    invalidCredsMessage: "invalid QuickBooks credentials",
    missingTokenMessage: "QuickBooks token response missing access_token",
    invalidJsonMessage: "QuickBooks token response was not valid JSON",
    unexpectedStatusMessage: (statusCode) => `QuickBooks token exchange failed with status ${statusCode}`,
  });

  // requireRefreshToken guarantees a rotated refresh token; narrow for the
  // caller-facing result type without a non-null assertion.
  const { refreshToken } = result;
  if (refreshToken === null) {
    throw new QuickBooksAuthError("QuickBooks token response missing access_token");
  }

  return {
    accessToken: result.accessToken,
    refreshToken,
    tokenType: result.tokenType,
    expiresAt: result.expiresAt,
  };
}
