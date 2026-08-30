// TLS material for the LDAP listener (EP-24741BBF · BI-F7317D65).
//
// The listener serves LDAPS using the ORGANIZATION'S OWN PKI — the Step CA
// substrate that already issues machine trust and mTLS for this install. There
// is deliberately NO self-signed fallback: a directory that quietly downgrades
// its own transport is worse than one that refuses to start, because the
// failure is invisible to every client that trusts it.

import { readFileSync } from "node:fs";

export type LdapTlsMaterial = {
  key: Buffer;
  cert: Buffer;
  /** Org CA bundle, used to verify client certificates for mTLS binds. */
  ca: Buffer;
};

export type LdapTlsPaths = {
  keyPath?: string;
  certPath?: string;
  caPath?: string;
};

/** Read the org-PKI material the listener requires, or refuse to start. */
export function loadLdapTlsMaterial(
  paths: LdapTlsPaths = {
    keyPath: process.env.DPF_LDAP_TLS_KEY_PATH,
    certPath: process.env.DPF_LDAP_TLS_CERT_PATH,
    caPath: process.env.DPF_LDAP_TLS_CA_PATH,
  },
  read: (path: string) => Buffer = readFileSync,
): LdapTlsMaterial {
  const missing = (["keyPath", "certPath", "caPath"] as const).filter((field) => !paths[field]);
  if (missing.length > 0) {
    throw new Error(
      `LDAP listener: refusing to start without organization PKI material (${missing.join(", ")} unset). ` +
        "The directory serves LDAPS from the org CA; there is no self-signed fallback.",
    );
  }
  return {
    key: read(paths.keyPath!),
    cert: read(paths.certPath!),
    ca: read(paths.caPath!),
  };
}
