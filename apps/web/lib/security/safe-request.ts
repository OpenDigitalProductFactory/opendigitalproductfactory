import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, request as undiciRequest } from "undici";

import { assertSafeOutboundUrl, classifyOutboundHost } from "./safe-fetch";

export type SafeRequestErrorCode =
  | "invalid_url"
  | "dns_failed"
  | "private_network"
  | "cross_origin_redirect"
  | "write_redirect"
  | "redirect_limit"
  | "network_timeout"
  | "network_failed"
  | "response_too_large"
  | "invalid_json";

export class SafeRequestError extends Error {
  constructor(
    readonly code: SafeRequestErrorCode,
    message: string,
    readonly retryable = false,
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = "SafeRequestError";
  }
}

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

export interface SafeTransportResponse {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
}

export type SafeRequestTransport = (input: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  addresses: readonly string[];
  timeoutMs: number;
}) => Promise<SafeTransportResponse>;

export interface SafeJsonRequestInput {
  url: string | URL;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  resolve?: ResolveHost;
  transport?: SafeRequestTransport;
}

export interface SafeJsonResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_REDIRECTS = 3;

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
}

async function defaultTransport(input: Parameters<SafeRequestTransport>[0]): Promise<SafeTransportResponse> {
  const allowed = new Set(input.addresses);
  const agent = new Agent({
    connect: {
      lookup(_hostname, _options, callback) {
        const address = input.addresses[0];
        if (!address || !allowed.has(address)) {
          callback(new Error("safe-request: no verified address available"), "", 4);
          return;
        }
        callback(null, address, address.includes(":") ? 6 : 4);
      },
    },
  });
  try {
    const response = await undiciRequest(input.url, {
      method: input.method as never,
      headers: input.headers,
      body: input.body,
      dispatcher: agent,
      headersTimeout: input.timeoutMs,
      bodyTimeout: input.timeoutMs,
    });
    const body = response.body;
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      for (const entry of Array.isArray(value) ? value : [String(value)]) headers.append(key, entry);
    }
    return {
      status: response.statusCode,
      headers,
      body: (async function* () {
        try {
          for await (const chunk of body) yield new Uint8Array(chunk);
        } finally {
          await agent.close();
        }
      })(),
    };
  } catch (error) {
    await agent.close();
    throw error;
  }
}

function safeUrl(input: string | URL): URL {
  try {
    const url = assertSafeOutboundUrl(input.toString());
    if (url.username || url.password) throw new Error("embedded credentials are prohibited");
    return url;
  } catch {
    throw new SafeRequestError("invalid_url", "Outbound URL is not permitted by the HTTPS network policy.");
  }
}

async function resolvePublic(hostname: string, resolve: ResolveHost): Promise<ResolvedAddress[]> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new SafeRequestError("dns_failed", "The remote host could not be resolved.", true);
  }
  if (addresses.length === 0) throw new SafeRequestError("dns_failed", "The remote host did not resolve to an address.", true);
  for (const { address } of addresses) {
    if (classifyOutboundHost(address)) {
      throw new SafeRequestError("private_network", "The remote host resolves to a private or local network and was blocked.");
    }
  }
  return addresses;
}

async function boundedBody(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new SafeRequestError("response_too_large", "The remote response exceeded the configured byte limit.");
    chunks.push(chunk);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

async function readBoundedResponse(body: AsyncIterable<Uint8Array>, maxBytes: number, method: string): Promise<string> {
  try { return await boundedBody(body, maxBytes); }
  catch (error) {
    if (error instanceof SafeRequestError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const timedOut = ["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ABORT_ERR"].includes(code);
    throw new SafeRequestError(timedOut ? "network_timeout" : "network_failed", timedOut ? "The remote response body timed out." : "The remote response body could not be read safely.", true, method !== "GET");
  }
}

export async function safeJsonRequest<T = unknown>(input: SafeJsonRequestInput): Promise<SafeJsonResponse<T>> {
  const resolve = input.resolve ?? defaultResolve;
  const transport = input.transport ?? defaultTransport;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const original = safeUrl(input.url);
  const method = (input.method ?? "GET").toUpperCase();
  let current = original;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const addresses = await resolvePublic(current.hostname, resolve);
    let response: SafeTransportResponse;
    try {
      response = await transport({
        url: current,
        method,
        headers: { accept: "application/json", ...input.headers },
        ...(input.body === undefined ? {} : { body: input.body }),
        addresses: addresses.map(({ address }) => address),
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof SafeRequestError) throw error;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const timedOut = ["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ABORT_ERR"].includes(code);
      throw new SafeRequestError(timedOut ? "network_timeout" : "network_failed", timedOut ? "The remote request timed out before a confirmed response was received." : "The remote request failed before a confirmed response was received.", true, method !== "GET");
    }

    if (response.status >= 300 && response.status < 400) {
      await readBoundedResponse(response.body, maxResponseBytes, method);
      if (method !== "GET" && method !== "HEAD") {
        throw new SafeRequestError(
          "write_redirect",
          "A remote write redirected after transmission, so its outcome must be reconciled before retrying.",
          false,
          true,
        );
      }
      if (redirectCount >= maxRedirects) throw new SafeRequestError("redirect_limit", "The remote server exceeded the redirect limit.");
      const location = response.headers.get("location");
      if (!location) throw new SafeRequestError("invalid_url", "The remote redirect did not include a target.");
      const next = safeUrl(new URL(location, current));
      if (next.origin !== original.origin) {
        throw new SafeRequestError("cross_origin_redirect", "Cross-origin redirects are blocked so credentials cannot be forwarded.");
      }
      current = next;
      continue;
    }

    const text = await readBoundedResponse(response.body, maxResponseBytes, method);
    try {
      return { status: response.status, headers: response.headers, data: (text === "" ? null : JSON.parse(text)) as T };
    } catch (error) {
      if (error instanceof SafeRequestError) throw error;
      throw new SafeRequestError("invalid_json", "The remote response was not valid bounded JSON.");
    }
  }
}
