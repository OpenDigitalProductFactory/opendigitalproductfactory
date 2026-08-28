// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// BI-7626A660 / BI-C7151B1B — the estate identity of THIS installation.
//
// An installation has always been able to say what it is FOR (operating intent)
// and what KIND it is (environment class). It could not say WHOSE it is. That
// missing half is why the workspace had to render a whole panel to identify
// itself, why two installs of one organization present identically over MCP, and
// why a discovered LAN peer has no name to show.
//
// The estate is the operator of the installation, NOT the business it runs. On a
// company running its own single production install the two coincide; they
// diverge exactly where DPF already models the difference — an MSP is one estate
// and many organizations, and a dev/prod pair is one estate where the dev side may
// carry a demo organization the production side does not. `Organization` stays the
// canonical model of the BUSINESS (AGENTS.md §8); this is a different fact.
//
// The value feeds `OrganizationTrustAnchor.organizationRef`, which the binding
// zero-touch federation design already defined and already refuses on
// (`organization-ref-mismatch`) but which nothing populated. This gives it a source.
//
// Split from any filesystem reader for the same reason `environment-class-contract`
// is: the shell header is a `"use client"` component and needs these values, and a
// module that reaches `node:fs/promises` cannot be in that graph.

import {
  isInstallationEnvironmentClass,
  type InstallationEnvironmentClass,
} from "@dpf/db/installation-operating-intent";

/** PlatformConfig key holding the portal-recorded estate declaration. */
export const ESTATE_IDENTITY_CONFIG_KEY = "installation.estate-identity.v1";

/** Process-level override, highest precedence. Set by the runtime, not the portal. */
export const ESTATE_NAME_ENV_VAR = "DPF_ESTATE_NAME";

/**
 * Precedence tiers, highest first — deliberately the same shape as
 * `ENVIRONMENT_CLASS_TIERS` so the two halves of the badge cannot disagree about
 * where authority lives. The bottom tier is `unset` rather than `default`,
 * because there is no cautious default name to fall back to: an unnamed
 * installation is a real state and says so.
 */
export const ESTATE_NAME_TIERS = [
  "process-override",
  "installer-state",
  "portal-declaration",
  "unset",
] as const;
export type EstateNameTier = (typeof ESTATE_NAME_TIERS)[number];

/**
 * How an estate name arrived. `discovered-peer` is still operator-confirmed —
 * discovery pre-fills the field, it never silently adopts a peer's answer.
 */
export const ESTATE_NAME_SOURCES = [
  "operator",
  "installer",
  "discovered-peer",
  "organization-join",
] as const;
export type EstateNameSource = (typeof ESTATE_NAME_SOURCES)[number];

export function isEstateNameSource(value: unknown): value is EstateNameSource {
  return typeof value === "string" && (ESTATE_NAME_SOURCES as readonly string[]).includes(value);
}

/**
 * The grammar is narrower than a display string on purpose: this value is
 * slugified into an MCP `serverInfo.name` and published in an mDNS TXT record,
 * so it must survive both without escaping. Letters, digits, spaces, dot, dash
 * and underscore; must start alphanumeric; 48 characters is comfortably inside
 * the DNS-SD TXT budget once the key and the other record fields are counted.
 */
export const ESTATE_NAME_MAX_LENGTH = 48;
const ESTATE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/;

export function isValidEstateName(value: unknown): value is string {
  return typeof value === "string" && ESTATE_NAME_RE.test(value);
}

/**
 * Trim and collapse internal whitespace, then validate.
 *
 * Returns null for anything that cannot be a name, so an empty form field and a
 * malformed one converge on the same "no name" state rather than storing `""`.
 */
export function normalizeEstateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) return null;
  return isValidEstateName(collapsed) ? collapsed : null;
}

/**
 * Lowercase, hyphen-joined form for machine identifiers.
 *
 * Used for the MCP `serverInfo.name`. Deliberately lossy and NEVER used for
 * equality between installations — the Ed25519 device id is the identity, this
 * is a label (see `lib/federation/instance-identity`).
 */
export function slugifyEstateName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The normal form used when two installations compare trust roots.
 *
 * `evaluateOrganizationEnrollment` compares organization refs with `!==`, so both
 * sides have to reduce an operator-typed estate name the SAME way or a genuine
 * same-organization pair never matches. Defining it once here is what makes that
 * true: the local ref (`organization-trust-anchor-store`) and the peer-advertised
 * ref (`nearby-candidates`) both call this function.
 *
 * Deliberately NOT `slugifyEstateName`. That form is lossy by design and its own
 * comment forbids using it for equality between installations — it would collapse
 * "North Wind" and "North-Wind" into one trust root. This folds only whitespace
 * and case, the drift two operators typing one name actually produce, and keeps
 * every distinct name distinct.
 */
export function normalizeOrganizationRef(value: unknown): string | null {
  const normalized = normalizeEstateName(value);
  return normalized ? normalized.toLowerCase() : null;
}

/** Short role word for the badge and the server name. */
export const ENVIRONMENT_ROLE_WORD: Record<InstallationEnvironmentClass, string> = {
  production: "prod",
  development: "dev",
  test: "test",
};

/** The portal-recorded declaration stored at {@link ESTATE_IDENTITY_CONFIG_KEY}. */
export interface PortalEstateIdentityDeclarationV1 {
  schemaVersion: 1;
  estateName: string;
  source: EstateNameSource;
  declaredAt: string;
  declaredByPrincipalId: string;
}

/** The resolved answer plus what a surface needs to explain it. */
export interface EstateNameResolution {
  /** The name in force, or null when nobody has named this installation. */
  estateName: string | null;
  tier: EstateNameTier;
  /** The installer-state value, when installer state supplied one. */
  installerStateValue?: string;
  /** The portal declaration, whether or not it is the value in force. */
  portalDeclaration?: PortalEstateIdentityDeclarationV1;
  /**
   * Set when a portal declaration exists but a higher tier won AND the two
   * disagree. An echo of the winning value is agreement, not drift.
   */
  shadowedPortalDeclaration?: {
    declaredName: string;
    winningTier: Exclude<EstateNameTier, "portal-declaration" | "unset">;
    winningName: string;
  };
}

/**
 * Parse a stored declaration. Returns null for anything unrecognised so a
 * corrupt row degrades to "unnamed" instead of throwing on read.
 */
export function parsePortalEstateIdentityDeclaration(
  raw: unknown,
): PortalEstateIdentityDeclarationV1 | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value["schemaVersion"] !== 1) return null;
  const estateName = normalizeEstateName(value["estateName"]);
  if (estateName === null) return null;
  if (!isEstateNameSource(value["source"])) return null;
  const declaredAt = value["declaredAt"];
  if (typeof declaredAt !== "string" || Number.isNaN(Date.parse(declaredAt))) return null;
  const declaredBy = value["declaredByPrincipalId"];
  if (typeof declaredBy !== "string" || declaredBy.trim().length === 0) return null;
  return {
    schemaVersion: 1,
    estateName,
    source: value["source"],
    declaredAt,
    declaredByPrincipalId: declaredBy,
  };
}

/**
 * Apply the precedence order to already-read inputs.
 *
 * Pure and total, so the ordering is testable without a filesystem or database.
 * Every unreadable input arrives as `undefined` and the `unset` tier answers.
 */
export function resolveEstateNamePrecedence(input: {
  processOverride?: string | null;
  installerState?: string | null;
  portalDeclaration?: PortalEstateIdentityDeclarationV1 | null;
}): EstateNameResolution {
  const portalDeclaration = input.portalDeclaration ?? undefined;
  const override = normalizeEstateName(input.processOverride);
  const installerState = normalizeEstateName(input.installerState);

  const base = {
    ...(installerState ? { installerStateValue: installerState } : {}),
    ...(portalDeclaration ? { portalDeclaration } : {}),
  };

  const shadowedBy = (
    winningTier: Exclude<EstateNameTier, "portal-declaration" | "unset">,
    winningName: string,
  ) =>
    portalDeclaration && portalDeclaration.estateName !== winningName
      ? {
          shadowedPortalDeclaration: {
            declaredName: portalDeclaration.estateName,
            winningTier,
            winningName,
          },
        }
      : {};

  if (override) {
    return {
      estateName: override,
      tier: "process-override",
      ...base,
      ...shadowedBy("process-override", override),
    };
  }

  if (installerState) {
    return {
      estateName: installerState,
      tier: "installer-state",
      ...base,
      ...shadowedBy("installer-state", installerState),
    };
  }

  if (portalDeclaration) {
    return {
      estateName: portalDeclaration.estateName,
      tier: "portal-declaration",
      ...base,
    };
  }

  return { estateName: null, tier: "unset", ...base };
}

/** Everything a surface needs to identify this installation, resolved once. */
export interface ResolvedInstallationIdentity {
  estateName: string | null;
  environmentClass: InstallationEnvironmentClass;
  /** True only for `production`, and the sole gate on whether the badge renders. */
  isProduction: boolean;
  /** `did_ab12…9f0c`, or null before the signing keypair is minted. */
  shortDeviceId: string | null;
}

/**
 * The header badge text, or null when no badge should render.
 *
 * Production returns null BY DESIGN, and this is the only place that decision is
 * made. Marking the exception rather than the rule keeps the signal readable: a
 * badge that is always present stops being read. It also fails safe — if identity
 * cannot be resolved the caller passes the cautious class and gets a badge, never
 * a silent false "PROD".
 */
export function formatInstallationBadge(input: {
  estateName: string | null;
  environmentClass: InstallationEnvironmentClass;
}): string | null {
  if (input.environmentClass === "production") return null;
  const role = ENVIRONMENT_ROLE_WORD[input.environmentClass].toUpperCase();
  const name = normalizeEstateName(input.estateName);
  return name ? `${name.toUpperCase()} ${role}` : role;
}

/**
 * The MCP `serverInfo.name` for this installation.
 *
 * Falls back through `dpf-<role>` to the bare constant, so a client listing two
 * connectors sees two names as soon as EITHER half of the identity is known.
 */
export function formatMcpServerName(input: {
  estateName: string | null;
  environmentClass: InstallationEnvironmentClass;
}): string {
  const role = ENVIRONMENT_ROLE_WORD[input.environmentClass];
  const name = normalizeEstateName(input.estateName);
  if (!name) return `dpf-${role}`;
  const slug = slugifyEstateName(name);
  return slug ? `dpf-${slug}-${role}` : `dpf-${role}`;
}

/** The human-readable installation title, e.g. `Northwind DEV`. */
export function formatInstallationTitle(input: {
  estateName: string | null;
  environmentClass: InstallationEnvironmentClass;
}): string {
  const role = ENVIRONMENT_ROLE_WORD[input.environmentClass].toUpperCase();
  const name = normalizeEstateName(input.estateName);
  return name ? `${name} ${role}` : `Unnamed DPF ${role}`;
}

/** Re-exported so a caller validating a class does not import two modules. */
export { isInstallationEnvironmentClass };
