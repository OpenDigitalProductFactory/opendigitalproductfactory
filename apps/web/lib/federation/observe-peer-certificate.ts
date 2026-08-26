// EP-MSP-FEDERATION — observe a discovered peer's certificate chain.
//
// The security RULE lives in `verifyPeerChainAgainstRoot` and is pure. This
// module only observes: it opens a TLS connection, walks the presented chain,
// and hands it over. Keeping the two apart means a change here cannot alter what
// "verified" means.
//
// On `rejectUnauthorized: false` — this is deliberate and is NOT a relaxation.
// A DPF organization CA is a private root that the public trust store does not
// contain, so Node's default verification would reject every legitimate
// organization peer. The chain obtained here is then verified against the PINNED
// organization root, which is strictly narrower than public-CA validation: it
// accepts exactly one root rather than every root a distribution happens to
// ship. The connection is used only to read the chain; nothing is sent over it.

import { isIP } from "node:net";
import { connect, type PeerCertificate } from "node:tls";

import type { ObservedCertificate } from "@dpf/db/peer-certificate-verification";

/** How long to wait for a peer to present its chain before giving up. */
const OBSERVE_TIMEOUT_MS = 5_000;

/** Chain depth ceiling, so a malicious peer cannot spin us on a cyclic chain. */
const MAX_CHAIN_DEPTH = 10;

export type ChainObservation =
  | { observed: true; chain: ObservedCertificate[] }
  | { observed: false; reason: string };

function toObserved(certificate: PeerCertificate): ObservedCertificate | null {
  const fingerprint = certificate.fingerprint256;
  if (typeof fingerprint !== "string" || fingerprint.length === 0) return null;
  const validFrom = certificate.valid_from ? new Date(certificate.valid_from) : undefined;
  const validTo = certificate.valid_to ? new Date(certificate.valid_to) : undefined;
  return {
    fingerprint256: fingerprint,
    // Node marks the terminal certificate by making it its own issuer.
    selfSigned: certificate.issuerCertificate === certificate,
    subject: certificate.subject?.CN,
    issuer: certificate.issuer?.CN,
    validFrom: validFrom && Number.isFinite(validFrom.getTime()) ? validFrom : undefined,
    validTo: validTo && Number.isFinite(validTo.getTime()) ? validTo : undefined,
  };
}

/**
 * Walk the presented chain from leaf to root.
 *
 * Exported for tests, which supply a plain object graph rather than a live
 * socket — the walk is where the cycle and depth handling live, so it is worth
 * exercising directly.
 */
export function collectChain(leaf: PeerCertificate | null): ObservedCertificate[] {
  const chain: ObservedCertificate[] = [];
  const seen = new Set<PeerCertificate>();
  let current = leaf;
  while (current && !seen.has(current) && chain.length < MAX_CHAIN_DEPTH) {
    seen.add(current);
    const observed = toObserved(current);
    if (!observed) break;
    chain.push(observed);
    const issuer = current.issuerCertificate;
    if (!issuer || issuer === current) break;
    current = issuer;
  }
  return chain;
}

/**
 * Observe the certificate chain a peer presents.
 *
 * Never throws: every failure is an unobserved result, which leaves
 * `decideAutomaticPairing` at `operator-confirmation`. An unreachable or
 * misbehaving peer therefore costs a human confirmation, never an assumption.
 */
export async function observePeerCertificateChain(
  endpoint: string,
  options: { timeoutMs?: number } = {},
): Promise<ChainObservation> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { observed: false, reason: "unparseable-endpoint" };
  }
  if (url.protocol !== "https:") return { observed: false, reason: "not-https" };

  const timeoutMs = options.timeoutMs ?? OBSERVE_TIMEOUT_MS;
  return await new Promise<ChainObservation>((resolve) => {
    let settled = false;
    const finish = (result: ChainObservation) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // already closed
      }
      resolve(result);
    };

    const socket = connect(
      {
        host: url.hostname,
        port: url.port ? Number(url.port) : 443,
        // SNI must not carry an IP address (RFC 6066); a LAN peer discovered by
        // address would otherwise emit a deprecation warning and send a field the
        // spec forbids.
        ...(isIP(url.hostname) ? {} : { servername: url.hostname }),
        // See the module header: the organization root is private, so Node's
        // default trust store cannot validate it. The chain is verified against
        // the pinned root instead, which is narrower, not looser.
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const chain = collectChain(socket.getPeerCertificate(true));
        finish(chain.length > 0 ? { observed: true, chain } : { observed: false, reason: "empty-chain" });
      },
    );

    socket.setTimeout(timeoutMs, () => finish({ observed: false, reason: "timeout" }));
    socket.on("error", (error) => finish({ observed: false, reason: error.message }));
  });
}
