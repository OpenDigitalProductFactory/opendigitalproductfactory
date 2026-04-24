import { request, type Dispatcher } from "undici";

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
  const authorization = Buffer.from(`${params.clientId}:${params.clientSecret}`, "utf8").toString("base64");

  let response: Dispatcher.ResponseData;
  try {
    response = await request(resolveTokenEndpoint(), {
      method: "POST",
      dispatcher: params.dispatcher,
      headers: {
        authorization: `Basic ${authorization}`,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
      }).toString(),
    });
  } catch {
    throw new QuickBooksAuthError("QuickBooks token exchange failed — check network reachability and try again.");
  }

  const { statusCode, body } = response;

  if (statusCode === 401 || statusCode === 403) {
    await safelyDrainBody(body);
    throw new QuickBooksAuthError("invalid QuickBooks credentials", { statusCode });
  }

  if (statusCode >= 500) {
    await safelyDrainBody(body);
    throw new QuickBooksAuthError("QuickBooks token endpoint returned a server error — retry later.", { statusCode });
  }

  if (statusCode !== 200) {
    await safelyDrainBody(body);
    throw new QuickBooksAuthError(`QuickBooks token exchange failed with status ${statusCode}`, { statusCode });
  }

  let parsed: unknown;
  try {
    parsed = await body.json();
  } catch {
    throw new QuickBooksAuthError("QuickBooks token response was not valid JSON", { statusCode });
  }

  if (!isTokenResponse(parsed)) {
    throw new QuickBooksAuthError("QuickBooks token response missing access_token", { statusCode });
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    tokenType: parsed.token_type,
    expiresAt: new Date(Date.now() + parsed.expires_in * 1000),
  };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.access_token === "string" &&
    typeof candidate.refresh_token === "string" &&
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
