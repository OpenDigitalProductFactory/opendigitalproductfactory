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

import { request as httpsRequest } from "node:https";
import { checkServerIdentity as tlsCheckServerIdentity, type PeerCertificate } from "node:tls";

export const DEFAULT_CA_INTERNAL_URL = "https://step-ca:9000";
const CA_TIMEOUT_MS = 15_000;

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
    req.on("timeout", () => req.destroy(new Error("CA request timed out")));
    req.on("error", reject);
    req.end(payload);
  });
};
