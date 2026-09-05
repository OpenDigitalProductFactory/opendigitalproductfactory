import { createPublicKey, createVerify, X509Certificate } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildCertificateSigningRequest,
  classifySan,
  generateMembershipKeypair,
  looksLikeCertificateSigningRequest,
  membershipSanSet,
} from "./csr";

/** Minimal DER reader: returns the tag, the content bytes and the next offset. */
function readTlv(buf: Buffer, offset: number): { tag: number; content: Buffer; next: number } {
  const tag = buf[offset]!;
  let length = buf[offset + 1]!;
  let cursor = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    length = 0;
    for (let index = 0; index < bytes; index++) length = (length << 8) | buf[cursor + index]!;
    cursor += bytes;
  }
  return { tag, content: buf.subarray(cursor, cursor + length), next: cursor + length };
}

function derOf(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""), "base64");
}

describe("classifySan / membershipSanSet", () => {
  it("classifies the way step-ca does: IP when it parses, DNS otherwise, and dedupes", () => {
    expect(classifySan("192.168.0.200")).toEqual({ kind: "ip", value: "192.168.0.200" });
    expect(classifySan("[fe80::1]")).toEqual({ kind: "ip", value: "fe80::1" });
    expect(classifySan("Dev.Internal")).toEqual({ kind: "dns", value: "dev.internal" });
    expect(membershipSanSet("192.168.0.200", ["192.168.0.200", " dev.internal ", "DEV.internal", ""])).toEqual(["192.168.0.200", "dev.internal"]);
  });
});

describe("buildCertificateSigningRequest", () => {
  it("emits a PKCS#10 request whose signature verifies with the generated key and which names CN and SANs", () => {
    const kp = generateMembershipKeypair();
    const pem = buildCertificateSigningRequest({ privateKeyPem: kp.privateKeyPem, commonName: "192.168.0.200", extraSans: ["dev.internal"] });
    expect(looksLikeCertificateSigningRequest(pem)).toBe(true);

    const csr = derOf(pem);
    const outer = readTlv(csr, 0);
    expect(outer.tag).toBe(0x30);
    const info = readTlv(outer.content, 0);
    const algorithm = readTlv(outer.content, info.next);
    const signature = readTlv(outer.content, algorithm.next);
    expect(info.tag).toBe(0x30);
    expect(algorithm.content.toString("hex")).toBe("06082a8648ce3d040302"); // ecdsa-with-SHA256
    expect(signature.tag).toBe(0x03);

    const infoBytes = outer.content.subarray(0, info.next);
    const verifier = createVerify("sha256");
    verifier.update(infoBytes);
    verifier.end();
    expect(verifier.verify(createPublicKey(kp.publicKeyPem), signature.content.subarray(1))).toBe(true);

    // CertificationRequestInfo: version, subject, spki, [0] attributes.
    const version = readTlv(info.content, 0);
    const subject = readTlv(info.content, version.next);
    const spki = readTlv(info.content, subject.next);
    const attributes = readTlv(info.content, spki.next);
    expect(version.content.toString("hex")).toBe("00");
    expect(subject.content.includes(Buffer.from("192.168.0.200", "utf8"))).toBe(true);
    expect(spki.content.equals(createPublicKey(kp.publicKeyPem).export({ type: "spki", format: "der" }).subarray(2))).toBe(true);
    expect(attributes.tag).toBe(0xa0);
    // The SAN extension carries the IP as 4 raw octets and the DNS name as IA5.
    expect(attributes.content.includes(Buffer.from([0x87, 0x04, 192, 168, 0, 200]))).toBe(true);
    expect(attributes.content.includes(Buffer.concat([Buffer.from([0x82, 0x0c]), Buffer.from("dev.internal", "ascii")]))).toBe(true);
  });

  it("refuses an empty common name and a foreign key format", () => {
    const kp = generateMembershipKeypair();
    expect(() => buildCertificateSigningRequest({ privateKeyPem: kp.privateKeyPem, commonName: " " })).toThrow(/common name/);
    expect(() => buildCertificateSigningRequest({ privateKeyPem: "not a key", commonName: "x" })).toThrow();
  });

  it("generates a P-256 key the way step-ca issues for", () => {
    const kp = generateMembershipKeypair();
    const key = createPublicKey(kp.publicKeyPem);
    expect(key.asymmetricKeyType).toBe("ec");
    expect(key.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    expect(kp.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
  });
});

describe("looksLikeCertificateSigningRequest", () => {
  it("accepts only a bare request block and never a private key", () => {
    expect(looksLikeCertificateSigningRequest("-----BEGIN CERTIFICATE REQUEST-----\nAA==\n-----END CERTIFICATE REQUEST-----")).toBe(true);
    expect(looksLikeCertificateSigningRequest("-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----")).toBe(false);
    expect(looksLikeCertificateSigningRequest("-----BEGIN CERTIFICATE REQUEST-----\n-----BEGIN PRIVATE KEY-----\n-----END CERTIFICATE REQUEST-----")).toBe(false);
    expect(looksLikeCertificateSigningRequest(42)).toBe(false);
    expect(looksLikeCertificateSigningRequest("-----BEGIN CERTIFICATE REQUEST-----".padEnd(20_000, "A") + "-----END CERTIFICATE REQUEST-----")).toBe(false);
  });
});

// Keep the fixture module honest: an X509 parse of a CSR must fail, which is
// exactly why this module exists.
describe("node has no CSR parser", () => {
  it("cannot parse a request as a certificate", () => {
    const kp = generateMembershipKeypair();
    const pem = buildCertificateSigningRequest({ privateKeyPem: kp.privateKeyPem, commonName: "x" });
    expect(() => new X509Certificate(pem)).toThrow();
  });
});
