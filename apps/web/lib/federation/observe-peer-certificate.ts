// EP-MSP-FEDERATION — observe a discovered peer's certificate chain.
//
// The security RULE lives in `verifyPeerChainAgainstRoot` and is pure. This
// module only observes: it opens a TLS connection, walks the presented chain,
// and hands it over. Keeping the two apart means a change here cannot alter what
// "verified" means.
//
// Certificate validation stays ON. An organization CA is a private root the
// public trust store does not contain, so the ORGANIZATION ROOT is supplied as
// the only acceptable `ca` and Node performs real chain validation against it.
//
// An earlier draft disabled validation and compared the root fingerprint by
// hand. CodeQL flagged it (js/disabling-certificate-validation) and was right:
// a fingerprint match proves a certificate with that fingerprint appeared in the
// chain, NOT that the leaf was signed by it. Only the TLS stack checks the
// signature chain. The fingerprint comparison remains, but as defence in depth
// on top of real validation rather than instead of it.

import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { connect, type DetailedPeerCertificate } from "node:tls";

import type { ObservedCertificate } from "@dpf/db/peer-certificate-verification";

/**
 * Where the organization root is mounted, per the organization-trust overlay
 * (`docker-compose.organization-trust.yml`). Without it there is no root to
 * validate against, so observation fails closed.
 */
const ORGANIZATION_ROOT_PATH = "/etc/dpf/pki/root_ca.crt";

/** How long to wait for a peer to present its chain before giving up. */
const OBSERVE_TIMEOUT_MS = 5_000;

/** Chain depth ceiling, so a malicious peer cannot spin us on a cyclic chain. */
const MAX_CHAIN_DEPTH = 10;

export type ChainObservation =
  | { observed: true; chain: ObservedCertificate[] }
  | { observed: false; reason: string };

/** Node types a certificate CN as `string | string[]`; take the first entry. */
function commonName(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toObserved(certificate: DetailedPeerCertificate): ObservedCertificate | null {
  const fingerprint = certificate.fingerprint256;
  if (typeof fingerprint !== "string" || fingerprint.length === 0) return null;
  const validFrom = certificate.valid_from ? new Date(certificate.valid_from) : undefined;
  const validTo = certificate.valid_to ? new Date(certificate.valid_to) : undefined;
  return {
    fingerprint256: fingerprint,
    // Node marks the terminal certificate by making it its own issuer.
    selfSigned: certificate.issuerCertificate === certificate,
    subject: commonName(certificate.subject?.CN),
    issuer: commonName(certificate.issuer?.CN),
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
export function collectChain(leaf: DetailedPeerCertificate | null): ObservedCertificate[] {
  const chain: ObservedCertificate[] = [];
  const seen = new Set<DetailedPeerCertificate>();
  let current: DetailedPeerCertificate | undefined | null = leaf;
  while (current && !seen.has(current) && chain.length < MAX_CHAIN_DEPTH) {
    seen.add(current);
    const observed = toObserved(current);
    if (!observed) break;
    chain.push(observed);
    // Annotated explicitly: `issuerCertificate` is self-referential, so an
    // inferred type here resolves to `any` (TS7022).
    const issuer: DetailedPeerCertificate | undefined = current.issuerCertificate;
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
  options: {
    timeoutMs?: number;
    /** Overridable for tests; defaults to the mounted organization root. */
    readOrganizationRoot?: () => Promise<string>;
  } = {},
): Promise<ChainObservation> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { observed: false, reason: "unparseable-endpoint" };
  }
  if (url.protocol !== "https:") return { observed: false, reason: "not-https" };

  // No organization root means nothing to validate against. Fail closed rather
  // than fall back to a weaker check.
  let organizationRoot: string;
  try {
    const read = options.readOrganizationRoot ?? (() => readFile(ORGANIZATION_ROOT_PATH, "utf8"));
    organizationRoot = await read();
  } catch {
    return { observed: false, reason: "organization-root-unavailable" };
  }
  if (!organizationRoot.includes("BEGIN CERTIFICATE")) {
    return { observed: false, reason: "organization-root-unavailable" };
  }

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
        // The organization root is the ONLY acceptable issuer, and Node
        // validates the signature chain against it. Narrower than the public
        // trust store, and real validation rather than a fingerprint comparison.
        ca: [organizationRoot],
        rejectUnauthorized: true,
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
