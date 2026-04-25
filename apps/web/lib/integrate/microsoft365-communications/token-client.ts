import { request, type Dispatcher } from "undici";

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
  let response: Dispatcher.ResponseData;

  try {
    response = await request(resolveMicrosoftTokenEndpoint(params.tenantId), {
      method: "POST",
      dispatcher: params.dispatcher,
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: params.clientId,
        client_secret: params.clientSecret,
        scope: params.scope ?? "https://graph.microsoft.com/.default",
      }).toString(),
    });
  } catch {
    throw new Microsoft365CommunicationsAuthError(
      "Microsoft token exchange failed — check network reachability and try again.",
    );
  }

  const { statusCode, body } = response;

  if (statusCode === 401 || statusCode === 403) {
    await safelyDrainBody(body);
    throw new Microsoft365CommunicationsAuthError("invalid Microsoft 365 credentials", {
      statusCode,
    });
  }

  if (statusCode >= 500) {
    await safelyDrainBody(body);
    throw new Microsoft365CommunicationsAuthError(
      "Microsoft token endpoint returned a server error — retry later.",
      { statusCode },
    );
  }

  if (statusCode !== 200) {
    await safelyDrainBody(body);
    throw new Microsoft365CommunicationsAuthError(
      `Microsoft token exchange failed with status ${statusCode}`,
      { statusCode },
    );
  }

  let parsed: unknown;
  try {
    parsed = await body.json();
  } catch {
    throw new Microsoft365CommunicationsAuthError(
      "Microsoft token response was not valid JSON",
      { statusCode },
    );
  }

  if (!isTokenResponse(parsed)) {
    throw new Microsoft365CommunicationsAuthError(
      "Microsoft token response missing access_token",
      { statusCode },
    );
  }

  return {
    accessToken: parsed.access_token,
    tokenType: parsed.token_type,
    expiresAt: new Date(Date.now() + parsed.expires_in * 1000),
  };
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.access_token === "string" &&
    typeof candidate.token_type === "string" &&
    typeof candidate.expires_in === "number"
  );
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
