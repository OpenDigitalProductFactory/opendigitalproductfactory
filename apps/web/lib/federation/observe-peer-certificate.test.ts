import { describe, expect, it } from "vitest";

import { collectChain, observePeerCertificateChain } from "./observe-peer-certificate";

type FakeCert = {
  fingerprint256?: string;
  valid_from?: string;
  valid_to?: string;
  subject?: { CN?: string };
  issuer?: { CN?: string };
  issuerCertificate?: FakeCert;
};

/** Build a leaf → intermediate → root graph shaped like Node's own. */
function chainOf(count: number): FakeCert {
  const certs: FakeCert[] = Array.from({ length: count }, (_, index) => ({
    fingerprint256: `${String(index).repeat(2)}:AA`,
    valid_from: "Jan  1 00:00:00 2026 GMT",
    valid_to: "Jan  1 00:00:00 2027 GMT",
    subject: { CN: `cert-${index}` },
    issuer: { CN: `cert-${index + 1}` },
  }));
  certs.forEach((cert, index) => {
    // Node marks the terminal certificate by making it its own issuer.
    cert.issuerCertificate = index === certs.length - 1 ? cert : certs[index + 1];
  });
  return certs[0]!;
}

describe("collectChain", () => {
  it("walks leaf to root and marks only the terminal certificate self-signed", () => {
    const chain = collectChain(chainOf(3) as never);
    expect(chain).toHaveLength(3);
    expect(chain.map((c) => c.selfSigned)).toEqual([false, false, true]);
    expect(chain[0]?.subject).toBe("cert-0");
  });

  it("handles a root-only chain", () => {
    const chain = collectChain(chainOf(1) as never);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.selfSigned).toBe(true);
  });

  it("terminates on a cyclic chain rather than spinning", () => {
    // A malicious peer must not be able to hold the connection open forever.
    const a: FakeCert = { fingerprint256: "AA:BB" };
    const b: FakeCert = { fingerprint256: "CC:DD" };
    a.issuerCertificate = b;
    b.issuerCertificate = a;
    expect(collectChain(a as never)).toHaveLength(2);
  });

  it("caps an absurdly deep chain", () => {
    expect(collectChain(chainOf(50) as never).length).toBeLessThanOrEqual(10);
  });

  it("returns nothing for a null certificate", () => {
    expect(collectChain(null)).toEqual([]);
  });

  it("stops at a certificate with no fingerprint rather than emitting a blank one", () => {
    const leaf: FakeCert = { fingerprint256: "AA:BB" };
    const blank: FakeCert = {};
    leaf.issuerCertificate = blank;
    blank.issuerCertificate = blank;
    expect(collectChain(leaf as never)).toHaveLength(1);
  });

  it("drops an unparseable validity date rather than carrying NaN forward", () => {
    const leaf: FakeCert = { fingerprint256: "AA:BB", valid_to: "not-a-date" };
    leaf.issuerCertificate = leaf;
    expect(collectChain(leaf as never)[0]?.validTo).toBeUndefined();
  });
});

const ORG_ROOT = ["-----BEGIN CERTIFICATE-----", "MIIB", "-----END CERTIFICATE-----"].join("\n");
const readRoot = async () => ORG_ROOT;

describe("observePeerCertificateChain — never throws", () => {
  it("reports an unparseable endpoint", async () => {
    expect(
      await observePeerCertificateChain("not a url", { readOrganizationRoot: readRoot }),
    ).toEqual({ observed: false, reason: "unparseable-endpoint" });
  });

  it("refuses plain HTTP outright", async () => {
    expect(
      await observePeerCertificateChain("http://peer.internal/", { readOrganizationRoot: readRoot }),
    ).toEqual({ observed: false, reason: "not-https" });
  });

  it("reports a connection failure as unobserved instead of throwing", async () => {
    // Port 1 on loopback refuses fast; the point is that it resolves, not rejects.
    const result = await observePeerCertificateChain("https://127.0.0.1:1/", {
      timeoutMs: 2000,
      readOrganizationRoot: readRoot,
    });
    expect(result.observed).toBe(false);
    if (!result.observed) expect(typeof result.reason).toBe("string");
  });

  it("fails closed when the organization root is unavailable", async () => {
    // Without a root there is nothing to validate against. Falling back to a
    // weaker check is exactly what CodeQL flagged, so we refuse instead.
    const result = await observePeerCertificateChain("https://peer.internal/", {
      readOrganizationRoot: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(result).toEqual({ observed: false, reason: "organization-root-unavailable" });
  });

  it("fails closed when the mounted root is not a certificate", async () => {
    const result = await observePeerCertificateChain("https://peer.internal/", {
      readOrganizationRoot: async () => "not a pem",
    });
    expect(result).toEqual({ observed: false, reason: "organization-root-unavailable" });
  });
});
