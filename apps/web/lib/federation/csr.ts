// EP-ZERO-CONFIG-FEDERATION — portal-mediated membership, key half.
// Spec: docs/superpowers/specs/2026-09-03-portal-mediated-organization-membership-design.md §5.2 step 2.
//
// A member installation turns its organization join file into a certificate
// without a host script: it generates an EC P-256 keypair in the portal
// process and a PKCS#10 certificate signing request for the hostname the
// join file was issued for. Node's crypto module can make the key and sign
// bytes but has no CSR builder, so the DER is assembled here by hand — a
// handful of ASN.1 shapes, no dependency, no shell-out.
//
// The CA's one-time token names the subject and the SANs it will accept, so
// the CSR carries exactly those: CN = intended hostname; SANs = the hostname
// plus any extra names, each classified as an IP address or a DNS name the
// way step-ca classifies them (`x509util.SplitSANs`).
//
// Pure: no I/O. The private key never leaves the caller.

import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { isIP } from "node:net";

const OID_COMMON_NAME = [2, 5, 4, 3];
const OID_EXTENSION_REQUEST = [1, 2, 840, 113549, 1, 9, 14];
const OID_SUBJECT_ALT_NAME = [2, 5, 29, 17];
const OID_ECDSA_WITH_SHA256 = [1, 2, 840, 10045, 4, 3, 2];

const CSR_BEGIN = "-----BEGIN CERTIFICATE REQUEST-----";
const CSR_END = "-----END CERTIFICATE REQUEST-----";

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  if (length < 0x10000) return Buffer.from([0x82, length >> 8, length & 0xff]);
  throw new Error("DER value too long");
}

function tlv(tag: number, ...contents: Buffer[]): Buffer {
  const body = Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...items: Buffer[]) => tlv(0x30, ...items);
const set = (...items: Buffer[]) => tlv(0x31, ...items);
const octetString = (bytes: Buffer) => tlv(0x04, bytes);
const utf8String = (text: string) => tlv(0x0c, Buffer.from(text, "utf8"));
const integer = (value: number) => tlv(0x02, Buffer.from([value]));
const bitString = (bytes: Buffer) => tlv(0x03, Buffer.from([0x00]), bytes);
/** [n] IMPLICIT, constructed. */
const contextConstructed = (n: number, ...items: Buffer[]) => tlv(0xa0 | n, ...items);
/** [n] IMPLICIT, primitive. */
const contextPrimitive = (n: number, bytes: Buffer) => tlv(0x80 | n, bytes);

function objectIdentifier(arcs: readonly number[]): Buffer {
  const bytes: number[] = [arcs[0]! * 40 + arcs[1]!];
  for (const arc of arcs.slice(2)) {
    const stack: number[] = [arc & 0x7f];
    let rest = arc >> 7;
    while (rest > 0) {
      stack.unshift((rest & 0x7f) | 0x80);
      rest >>= 7;
    }
    bytes.push(...stack);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function ipBytes(address: string): Buffer {
  if (isIP(address) === 4) return Buffer.from(address.split(".").map((octet) => Number(octet)));
  // IPv6: expand `::` and parse eight 16-bit groups.
  const [head, tail = ""] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array.from({ length: missing }, () => "0"), ...tailGroups];
  const out = Buffer.alloc(16);
  groups.forEach((group, index) => out.writeUInt16BE(Number.parseInt(group || "0", 16), index * 2));
  return out;
}

/** step-ca classifies a token SAN as an IP when it parses as one, else a DNS name. */
export function classifySan(name: string): { kind: "ip"; value: string } | { kind: "dns"; value: string } {
  const trimmed = name.trim().replace(/^\[|\]$/g, "");
  return isIP(trimmed) ? { kind: "ip", value: trimmed } : { kind: "dns", value: trimmed.toLowerCase() };
}

function generalName(name: string): Buffer {
  const san = classifySan(name);
  // GeneralName: iPAddress is [7] IMPLICIT OCTET STRING; dNSName is [2] IMPLICIT
  // IA5String — the context tag replaces the universal tag in both cases.
  return san.kind === "ip"
    ? contextPrimitive(7, ipBytes(san.value))
    : contextPrimitive(2, Buffer.from(san.value, "ascii"));
}

/** The SAN set the CA's token names: the subject first, then extra names, deduplicated. */
export function membershipSanSet(commonName: string, extraSans: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [commonName, ...extraSans]) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = classifySan(trimmed).value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export interface MembershipKeypair {
  /** PKCS#8 PEM. Written mode 0600 by the caller; never leaves the machine. */
  privateKeyPem: string;
  /** SubjectPublicKeyInfo PEM. */
  publicKeyPem: string;
}

/** EC P-256, the curve step-ca issues for by default. */
export function generateMembershipKeypair(): MembershipKeypair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function privateKeyFrom(pem: string): KeyObject {
  return createPrivateKey(pem);
}

/**
 * Build a PKCS#10 certificate signing request: CN = `commonName`, SANs =
 * `membershipSanSet(commonName, extraSans)`, signed ecdsa-with-SHA256 by the
 * key. Returns PEM.
 */
export function buildCertificateSigningRequest(input: {
  privateKeyPem: string;
  commonName: string;
  extraSans?: readonly string[];
}): string {
  const commonName = input.commonName.trim();
  if (!commonName) throw new Error("A common name is required");
  const privateKey = privateKeyFrom(input.privateKeyPem);
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const sans = membershipSanSet(commonName, input.extraSans ?? []);

  const subject = sequence(set(sequence(objectIdentifier(OID_COMMON_NAME), utf8String(commonName))));
  const sanExtension = sequence(
    objectIdentifier(OID_SUBJECT_ALT_NAME),
    octetString(sequence(...sans.map(generalName))),
  );
  const extensionRequest = sequence(objectIdentifier(OID_EXTENSION_REQUEST), set(sequence(sanExtension)));
  const info = sequence(integer(0), subject, spki, contextConstructed(0, extensionRequest));

  const signer = createSign("sha256");
  signer.update(info);
  signer.end();
  const signature = signer.sign(privateKey);
  const csr = sequence(info, sequence(objectIdentifier(OID_ECDSA_WITH_SHA256)), bitString(signature));
  const body = csr.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `${CSR_BEGIN}\n${body}\n${CSR_END}\n`;
}

/** Shape check for a peer-supplied CSR before it is relayed anywhere. */
export function looksLikeCertificateSigningRequest(value: unknown, maxBytes = 16 * 1024): value is string {
  if (typeof value !== "string" || value.length > maxBytes) return false;
  const trimmed = value.trim();
  return trimmed.startsWith(CSR_BEGIN) && trimmed.endsWith(CSR_END) && !trimmed.includes("PRIVATE KEY");
}
