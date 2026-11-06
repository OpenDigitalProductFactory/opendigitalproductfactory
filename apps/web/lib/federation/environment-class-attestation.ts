// BI-0716C8A8 — the peer's environment class, attested by the organization CA.
// Design: docs/superpowers/specs/2026-08-11-a2a-coordination-layer-design.md §19.2.
//
// The authority names the joining installation's class when it issues the join
// file. The one-time CA token then admits that class as a URI SAN, so the
// member certificate the CA signs carries it. A receiver reads the class from
// the verified leaf certificate, never from anything the peer says about
// itself: a self-declared class is option A3, which the decision rejected.

import {
  isInstallationEnvironmentClass,
  type InstallationEnvironmentClass,
} from "@dpf/db/installation-operating-intent";

export const ENVIRONMENT_CLASS_SAN_PREFIX = "urn:dpf:environment-class:";

/** The URI SAN that carries an environment class in a member certificate. */
export function environmentClassSan(environmentClass: InstallationEnvironmentClass): string {
  return `${ENVIRONMENT_CLASS_SAN_PREFIX}${environmentClass}`;
}

/**
 * The class a certificate attests, from Node's `X509Certificate.subjectAltName`
 * text. Null (unattested) when it names none, more than one, or an unknown one.
 */
export function readAttestedEnvironmentClass(subjectAltName: string | undefined): InstallationEnvironmentClass | null {
  if (!subjectAltName) return null;
  const classes = subjectAltName
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`URI:${ENVIRONMENT_CLASS_SAN_PREFIX}`))
    .map((entry) => entry.slice(`URI:${ENVIRONMENT_CLASS_SAN_PREFIX}`.length));
  if (classes.length !== 1) return null;
  return isInstallationEnvironmentClass(classes[0]) ? classes[0] : null;
}
