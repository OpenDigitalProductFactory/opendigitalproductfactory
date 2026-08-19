import { X509Certificate } from "node:crypto";

// Parses a PEM-encoded X.509 certificate and returns its notAfter date.
// Returns null on any parse failure — the Connect flow must fail-closed
// when a submitted cert can't be parsed, rather than storing it with a null
// expiry and surprising the admin later.
export function parseCertExpiry(pem: string): Date | null {
  if (!pem || typeof pem !== "string") return null;
  try {
    const cert = new X509Certificate(pem);
    const expiry = new Date(cert.validTo);
    if (Number.isNaN(expiry.getTime())) return null;
    return expiry;
  } catch {
    return null;
  }
}
