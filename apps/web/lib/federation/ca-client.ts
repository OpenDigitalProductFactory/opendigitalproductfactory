// EP-ZERO-CONFIG-FEDERATION — the portal's client for the organization CA.
//
// The authority portal reaches its step-ca over the private compose network
// (`https://step-ca:9000` by default) with TLS pinned to the organization root
// it already reads from disk — never the system trust store. The CA's own
// certificate names the hostnames the authority was bootstrapped with
// (localhost and 127.0.0.1 always among them), not the compose service name,
// so identity is checked against the URL host first and those two bootstrap
// names second; the chain must still verify to the pinned root.
//
// Two callers: the membership sign relay (POST /1.0/sign) and the join-file
// issuer (GET /provisioners). Both inject this so a fake CA runs under test.

import { promises as dns, type LookupAddress } from "node:dns";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity as tlsCheckServerIdentity, type PeerCertificate } from "node:tls";

export const DEFAULT_CA_INTERNAL_URL = "https://step-ca:9000";
const CA_TIMEOUT_MS = 15_000;

/**
 * One fresh connection per CA request. The portal's production server
 * replaces the global HTTPS agent with a keep-alive one; a CA request must
 * never be handed a pooled socket the CA has since closed, so the client
 * keeps its own agent with keep-alive off.
 */
const caAgent = new HttpsAgent({ keepAlive: false, maxSockets: 8 });

/** net.connect calls lookup with `{ all: true }` (happy-eyeballs) and expects an array then; otherwise a single address. */
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * Resolve the CA host without the libuv thread pool. Node's default
 * `dns.lookup` is a getaddrinfo call on that pool, and libuv caps such "slow"
 * work at half the pool: two stalled lookups elsewhere in the portal process
 * (seen live on 2026-09-05: two workers parked in poll on Docker's resolver)
 * queue every later lookup behind them, so the relay's request never even
 * opened a socket and timed out while the same request from a fresh process
 * answered in 75 ms. `dns.resolve4/6` go through c-ares on the event loop and
 * Docker's embedded DNS answers compose service names directly; the
 * getaddrinfo path stays as the fallback for hosts only /etc/hosts knows.
 */
export async function resolveCaHost(hostname: string, resolver: Pick<typeof dns, "resolve4" | "resolve6" | "lookup"> = dns): Promise<LookupAddress> {
  const literal = isIP(hostname);
  if (literal) return { address: hostname, family: literal };
  try {
    const [address] = await resolver.resolve4(hostname);
    if (address) return { address, family: 4 };
  } catch {
    // fall through to AAAA, then getaddrinfo
  }
  try {
    const [address] = await resolver.resolve6(hostname);
    if (address) return { address, family: 6 };
  } catch {
    // fall through to getaddrinfo
  }
  return resolver.lookup(hostname);
}

export function offThreadpoolLookup(hostname: string, options: unknown, callback: LookupCallback, resolver?: Pick<typeof dns, "resolve4" | "resolve6" | "lookup">): void {
  const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
  resolveCaHost(hostname, resolver).then(
    (found) => (wantsAll ? callback(null, [found]) : callback(null, found.address, found.family)),
    (error: NodeJS.ErrnoException) => (wantsAll ? callback(error, []) : callback(error, "", 0)),
  );
}

export function caInternalUrl(env: Record<string, string | undefined> = process.env): string {
  return env.DPF_ORGANIZATION_CA_INTERNAL_URL?.trim().replace(/\/+$/, "") || DEFAULT_CA_INTERNAL_URL;
}

export interface CaResponse {
  status: number;
  body: unknown;
}

export type CaRequest = (input: {
  caUrl: string;
  rootPem: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  timeoutMs?: number;
}) => Promise<CaResponse>;

export const caRequest: CaRequest = (input) => {
  const url = new URL(`${input.caUrl}${input.path}`);
  const payload = input.body === undefined ? undefined : JSON.stringify(input.body);
  const candidates = [url.hostname, "localhost", "127.0.0.1"];
  // Which phases the request reached — reported on a timeout so a stall is
  // attributable (name resolution, TCP connect, TLS, or the CA itself).
  const reached: string[] = [];
  const startedAt = Date.now();
  return new Promise<CaResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: input.method,
        headers: payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
        ca: input.rootPem,
        servername: url.hostname,
        lookup: offThreadpoolLookup,
        agent: caAgent,
        checkServerIdentity: (_host: string, cert: PeerCertificate) => {
          let last: Error | undefined;
          for (const candidate of candidates) {
            const failure = tlsCheckServerIdentity(candidate, cert);
            if (!failure) return undefined;
            last = failure;
          }
          return last;
        },
        timeout: input.timeoutMs ?? CA_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = null;
          try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("socket", (socket) => {
      reached.push("socket");
      socket.once("lookup", () => reached.push("lookup"));
      socket.once("connect", () => reached.push("connect"));
      socket.once("secureConnect", () => reached.push("tls"));
    });
    req.on("response", () => reached.push("response"));
    req.on("timeout", () => {
      req.destroy(new Error(`CA request timed out after ${Date.now() - startedAt}ms (reached: ${reached.join(">") || "nothing"})`));
    });
    req.on("error", reject);
    req.end(payload);
  });
};
