import { request, type Dispatcher } from "undici";

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
  let response: Dispatcher.ResponseData;
  try {
    response = await request(resolveGoogleTokenEndpoint(), {
      method: "POST",
      dispatcher: params.dispatcher,
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        refresh_token: params.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch {
    throw new GoogleMarketingAuthError(
      "Google token exchange failed — check network reachability and try again.",
    );
  }

  if (response.statusCode === 400 || response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new GoogleMarketingAuthError("invalid Google credentials", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new GoogleMarketingAuthError(
      `Google token exchange failed with status ${response.statusCode}`,
      { statusCode: response.statusCode },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await response.body.json() as Record<string, unknown>;
  } catch {
    throw new GoogleMarketingAuthError("Google token response was not valid JSON", {
      statusCode: response.statusCode,
    });
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : null;
  if (!accessToken) {
    throw new GoogleMarketingAuthError("Google token exchange did not return an access token", {
      statusCode: response.statusCode,
    });
  }

  const expiresIn =
    typeof payload.expires_in === "number"
      ? payload.expires_in
      : typeof payload.expires_in === "string"
        ? Number(payload.expires_in)
        : 3600;

  return {
    accessToken,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    expiresAt: new Date(Date.now() + Math.max(1, expiresIn) * 1000),
    scope: typeof payload.scope === "string" ? payload.scope : "",
  };
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
