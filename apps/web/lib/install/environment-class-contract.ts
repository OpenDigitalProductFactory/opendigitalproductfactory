// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// Environment-class precedence: which authority's answer is actually in force.
//
// The parent design (§4.4) fixes the order and this module is the only place it
// is written down as code:
//
//   process override  →  installer state  →  derived projection  →  default
//
// Installer state remains canonical for the LOCAL host fact. The portal may
// record a declaration, but it does so in the *derived projection* tier — one
// rank BELOW installer state — so a portal write can never overrule the host
// fact the installer wrote. When a higher tier is present, the portal
// declaration is reported as shadowed rather than silently discarded, because
// an operator who declared something is owed the reason it is not in effect.
//
// Split from `./environment-class` so the pure precedence contract carries no
// filesystem import: the workspace panel is a client component and needs these
// TYPES, and a module that reaches `node:fs/promises` cannot be in that graph.
// Reading installer state lives next door.

import {
  UNDECLARED_ENVIRONMENT_CLASS,
  isInstallationEnvironmentClass,
  type InstallationEnvironmentClass,
} from "@dpf/db/installation-operating-intent";

/** PlatformConfig key holding the portal-recorded environment declaration. */
export const ENVIRONMENT_CLASS_CONFIG_KEY = "installation.environment-class.v1";

/** Process-level override, highest precedence. Set by the runtime, not the portal. */
export const ENVIRONMENT_CLASS_ENV_VAR = "DPF_ENVIRONMENT_CLASS";

/**
 * The four precedence tiers, highest first. Exported in order so callers can
 * rank tiers without restating the sequence.
 */
export const ENVIRONMENT_CLASS_TIERS = [
  "process-override",
  "installer-state",
  "portal-declaration",
  "default",
] as const;
export type EnvironmentClassTier = (typeof ENVIRONMENT_CLASS_TIERS)[number];

/**
 * The portal-recorded declaration stored at {@link ENVIRONMENT_CLASS_CONFIG_KEY}.
 *
 * It carries who declared it and when so the panel can attribute the value, and
 * so a shadowed declaration stays auditable rather than becoming an orphan.
 */
export interface PortalEnvironmentClassDeclarationV1 {
  schemaVersion: 1;
  environmentClass: InstallationEnvironmentClass;
  declaredAt: string;
  declaredByPrincipalId: string;
}

/** The resolved answer plus everything a surface needs to explain it. */
export interface EnvironmentClassResolution {
  /** The class actually in force. */
  environmentClass: InstallationEnvironmentClass;
  /** Which authority supplied it. */
  tier: EnvironmentClassTier;
  /** False only when every tier was silent and the cautious default applied. */
  declared: boolean;
  /** The installer-state value, when installer state declared one. */
  installerStateValue?: InstallationEnvironmentClass;
  /** The portal declaration, whether or not it is the value in force. */
  portalDeclaration?: PortalEnvironmentClassDeclarationV1;
  /**
   * Set when a portal declaration exists but a higher tier won, and the two
   * disagree. Agreement is not drift, so an echo of the installer's value is
   * reported as no drift at all.
   */
  shadowedPortalDeclaration?: {
    declaredClass: InstallationEnvironmentClass;
    winningTier: Exclude<EnvironmentClassTier, "portal-declaration" | "default">;
    winningClass: InstallationEnvironmentClass;
  };
}

/**
 * Parse a stored portal declaration. Returns null for anything unrecognised, so
 * a corrupt row degrades to "no declaration" instead of throwing on read.
 */
export function parsePortalEnvironmentClassDeclaration(
  raw: unknown,
): PortalEnvironmentClassDeclarationV1 | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value["schemaVersion"] !== 1) return null;
  if (!isInstallationEnvironmentClass(value["environmentClass"])) return null;
  const declaredAt = value["declaredAt"];
  if (typeof declaredAt !== "string" || Number.isNaN(Date.parse(declaredAt))) return null;
  const declaredBy = value["declaredByPrincipalId"];
  if (typeof declaredBy !== "string" || declaredBy.trim().length === 0) return null;
  return {
    schemaVersion: 1,
    environmentClass: value["environmentClass"],
    declaredAt,
    declaredByPrincipalId: declaredBy,
  };
}

/**
 * Apply the precedence order to already-read inputs.
 *
 * Pure and total, so the ordering can be tested without a filesystem or a
 * database. Every unreadable input arrives here as `undefined` and the default
 * tier answers.
 */
export function resolveEnvironmentClassPrecedence(input: {
  processOverride?: string | null;
  installerState?: InstallationEnvironmentClass;
  portalDeclaration?: PortalEnvironmentClassDeclarationV1 | null;
}): EnvironmentClassResolution {
  const portalDeclaration = input.portalDeclaration ?? undefined;
  const override = isInstallationEnvironmentClass(input.processOverride)
    ? input.processOverride
    : undefined;

  const base = {
    ...(input.installerState ? { installerStateValue: input.installerState } : {}),
    ...(portalDeclaration ? { portalDeclaration } : {}),
  };

  const shadowedBy = (
    winningTier: Exclude<EnvironmentClassTier, "portal-declaration" | "default">,
    winningClass: InstallationEnvironmentClass,
  ) =>
    portalDeclaration && portalDeclaration.environmentClass !== winningClass
      ? {
          shadowedPortalDeclaration: {
            declaredClass: portalDeclaration.environmentClass,
            winningTier,
            winningClass,
          },
        }
      : {};

  if (override) {
    return {
      environmentClass: override,
      tier: "process-override",
      declared: true,
      ...base,
      ...shadowedBy("process-override", override),
    };
  }

  if (input.installerState) {
    return {
      environmentClass: input.installerState,
      tier: "installer-state",
      declared: true,
      ...base,
      ...shadowedBy("installer-state", input.installerState),
    };
  }

  if (portalDeclaration) {
    return {
      environmentClass: portalDeclaration.environmentClass,
      tier: "portal-declaration",
      declared: true,
      ...base,
    };
  }

  return {
    environmentClass: UNDECLARED_ENVIRONMENT_CLASS,
    tier: "default",
    declared: false,
    ...base,
  };
}
