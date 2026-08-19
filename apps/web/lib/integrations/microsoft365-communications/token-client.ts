import { exchangeClientCredentials } from "@dpf/integration-shared";
import { type Dispatcher } from "undici";

export interface ExchangeMicrosoftGraphClientCredentialsParams {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  dispatcher?: Dispatcher;
}

export interface ExchangeMicrosoftGraphClientCredentialsResult {
  accessToken: string;
  tokenType: string;
  expiresAt: Date;
}

export class Microsoft365CommunicationsAuthError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "Microsoft365CommunicationsAuthError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveMicrosoftTokenEndpoint(tenantId: string): string {
  return (
    process.env.MICROSOFT365_TOKEN_ENDPOINT_URL ??
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`
  );
}

export async function exchangeMicrosoftGraphClientCredentials(
  params: ExchangeMicrosoftGraphClientCredentialsParams,
): Promise<ExchangeMicrosoftGraphClientCredentialsResult> {
  const result = await exchangeClientCredentials({
    endpoint: resolveMicrosoftTokenEndpoint(params.tenantId),
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    scope: params.scope ?? "https://graph.microsoft.com/.default",
    dispatcher: params.dispatcher,
    makeError: (message, opts) => new Microsoft365CommunicationsAuthError(message, opts),
    // Preserve historic behavior: only 401/403 were treated as invalid creds
    // (the shared default of [400,401,403] would newly capture 400).
    authErrorStatuses: [401, 403],
    serverErrorMessage: "Microsoft token endpoint returned a server error — retry later.",
    networkErrorMessage:
      "Microsoft token exchange failed — check network reachability and try again.",
    invalidCredsMessage: "invalid Microsoft 365 credentials",
    missingTokenMessage: "Microsoft token response missing access_token",
    invalidJsonMessage: "Microsoft token response was not valid JSON",
    unexpectedStatusMessage: (statusCode) =>
      `Microsoft token exchange failed with status ${statusCode}`,
  });

  return {
    accessToken: result.accessToken,
    tokenType: result.tokenType,
    expiresAt: result.expiresAt,
  };
}
