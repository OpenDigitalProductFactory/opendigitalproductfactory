// Distinguished-name construction for the DPF directory projection
// (EP-24741BBF · BI-DCE49BA9).
//
// The base DN is DERIVED FROM `Organization`, the canonical platform identity
// model (AGENTS.md §8) — never a hardcoded constant. An install's directory
// follows its own org identity, so two installs never collide and a rename is
// a data change rather than a code change.
//
// Escaping follows RFC 4514 §2.4. It is not cosmetic: an unescaped `,` or `+`
// in a display name would split one entry's DN into two RDNs and silently
// re-parent it under a branch nobody intended.

/** Branches of the published tree. Order is stable; consumers may rely on it. */
export const DIRECTORY_BRANCHES = ["people", "agents", "services", "groups"] as const;
export type DirectoryBranch = (typeof DIRECTORY_BRANCHES)[number];

export type OrganizationDnSource = {
  slug: string;
  website?: string | null;
};

/** Fallback domain component when the organization publishes no website. */
const FALLBACK_TLD = "internal";

/** RFC 4514 §2.4 — characters that must be escaped anywhere in an attribute value. */
const ESCAPED_ANYWHERE = /([\\,+"<>;=])/g;

/**
 * Escape an RDN attribute value per RFC 4514.
 *
 * Leading `#` or space, and trailing space, are escaped positionally; the
 * reserved set is escaped wherever it appears. NUL is rejected outright rather
 * than encoded, because a value containing it is not a name we should publish.
 */
export function escapeRdnValue(value: string): string {
  if (value.includes("\0")) {
    throw new Error("escapeRdnValue: an attribute value must not contain a NUL byte");
  }
  let escaped = value.replace(ESCAPED_ANYWHERE, "\\$1");
  if (escaped.startsWith("#") || escaped.startsWith(" ")) {
    escaped = `\\${escaped}`;
  }
  if (escaped.endsWith(" ") && !escaped.endsWith("\\ ")) {
    escaped = `${escaped.slice(0, -1)}\\ `;
  }
  return escaped;
}

/** Split a hostname into `dc=` components, dropping a leading `www.`. */
function hostToDomainComponents(host: string): string[] {
  return host
    .replace(/^www\./i, "")
    .split(".")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Derive the install's base DN from its `Organization`.
 *
 * Prefers the organization's own website host, so the directory reads as the
 * organization's namespace to anyone who binds. Falls back to the slug under a
 * reserved `internal` domain when no website is published — deliberately NOT a
 * public TLD, so a fallback can never collide with a real domain.
 */
export function deriveBaseDn(organization: OrganizationDnSource): string {
  const slug = organization.slug?.trim();
  if (!slug) {
    throw new Error("deriveBaseDn: the organization must have a slug to derive a base DN");
  }

  let components: string[] = [];
  const website = organization.website?.trim();
  if (website) {
    try {
      const url = new URL(website.includes("://") ? website : `https://${website}`);
      components = hostToDomainComponents(url.hostname);
    } catch {
      components = [];
    }
  }

  if (components.length < 2) {
    components = [slug.toLowerCase(), FALLBACK_TLD];
  }

  return components.map((part) => `dc=${escapeRdnValue(part)}`).join(",");
}

/** The DN of one branch, e.g. `ou=people,dc=acme,dc=com`. */
export function branchDn(baseDn: string, branch: DirectoryBranch): string {
  return `ou=${branch},${baseDn}`;
}

/**
 * The DN of a published principal. Keyed on `principalId` rather than a display
 * name: a DN must be stable, and a person's name is not.
 */
export function principalDn(
  baseDn: string,
  branch: Exclude<DirectoryBranch, "groups">,
  principalId: string,
): string {
  return `uid=${escapeRdnValue(principalId)},${branchDn(baseDn, branch)}`;
}

/** The DN of a published group. */
export function groupDn(baseDn: string, groupKey: string): string {
  return `cn=${escapeRdnValue(groupKey)},${branchDn(baseDn, "groups")}`;
}

/** Case-insensitive DN comparison, sufficient for the read-only projection. */
export function dnEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** True when `dn` sits at or beneath `baseDn` — the subtree scope test. */
export function isWithinSubtree(dn: string, baseDn: string): boolean {
  const needle = baseDn.trim().toLowerCase();
  const haystack = dn.trim().toLowerCase();
  return haystack === needle || haystack.endsWith(`,${needle}`);
}
