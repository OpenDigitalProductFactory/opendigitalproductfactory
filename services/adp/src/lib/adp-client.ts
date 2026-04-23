// HTTPS GET against ADP over mTLS + Bearer. Shared across read tools.

import { Agent, request, type Dispatcher } from "undici";
import type { AdpEnvironment } from "./token-client.js";
import type { ActiveCredential } from "./creds.js";

export class AdpApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "AdpApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AdpGetParams {
  credential: ActiveCredential;
  path: string;
  query?: Record<string, string | number | undefined>;
  dispatcher?: Dispatcher;
}

export async function adpGet<T>(params: AdpGetParams): Promise<T> {
  const baseHost = resolveApiHost(params.credential.environment);
  const queryString = buildQuery(params.query);
  const url = `${baseHost}${params.path}${queryString}`;

  const dispatcher = params.dispatcher
    ?? new Agent({
      connect: {
        cert: params.credential.certPem,
        key: params.credential.privateKeyPem,
      },
    });

  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${params.credential.accessToken}`,
        accept: "application/json",
      },
      dispatcher,
    });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "NETWORK";
    throw new AdpApiError("mTLS handshake failed or network unreachable", 0, code);
  }

  const { statusCode, body } = response;

  if (statusCode === 429) {
    await drain(body);
    throw new AdpApiError("ADP rate limit — retry later", 429, "RATE_LIMITED");
  }
  if (statusCode === 401 || statusCode === 403) {
    await drain(body);
    throw new AdpApiError("ADP rejected credentials — re-connect", statusCode, "AUTH_FAILED");
  }
  if (statusCode >= 500) {
    await drain(body);
    throw new AdpApiError("ADP returned a server error", statusCode, "UPSTREAM_ERROR");
  }
  if (statusCode !== 200) {
    await drain(body);
    throw new AdpApiError(`ADP returned unexpected status ${statusCode}`, statusCode, "UNEXPECTED_STATUS");
  }

  try {
    return (await body.json()) as T;
  } catch {
    throw new AdpApiError("ADP response was not valid JSON", statusCode, "BAD_RESPONSE");
  }
}

function resolveApiHost(env: AdpEnvironment): string {
  // TODO(sandbox-URL): ADP's sandbox host needs confirmation during the first
  // manual sandbox test. The token endpoint pattern is accounts.sandbox.api.adp.com,
  // so api.sandbox.adp.com is the most likely mirror — but ADP's partner docs
  // also reference apis-workforcenow.adp.com for some tenants. Adjust here
  // once we have a confirmed sandbox base URL from a partner account.
  return env === "production" ? "https://api.adp.com" : "https://api.sandbox.adp.com";
}

function buildQuery(q: Record<string, string | number | undefined> | undefined): string {
  if (!q) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function drain(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    /* ignore */
  }
}
