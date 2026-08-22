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
// The portal never writes `/dpf-state/install-state.json`. Local drift is
// repaired FROM installer state, not into it.

import { readFile } from "node:fs/promises";

import {
  UNDECLARED_ENVIRONMENT_CLASS,
  isInstallationEnvironmentClass,
  type InstallationEnvironmentClass,
} from "@dpf/db/installation-operating-intent";

/** In-container path to the governed install snapshot. */
export const INSTALL_STATE_PATH = "/dpf-state/install-state.json";

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
 * Read the canonical environment class for this host.
 *
 * Installer state owns this fact. When it is absent or unreadable the caller
 * gets `production` — the cautious default — rather than a guess. `declared`
 * distinguishes "the installer said production" from "nobody said anything", so
 * the precedence resolver can rank a silent installer below a portal
 * declaration without losing the safe fallback.
 */
export async function readInstallEnvironmentClass(options: {
  readText?: (path: string) => Promise<string>;
} = {}): Promise<{ environmentClass: InstallationEnvironmentClass; declared: boolean }> {
  const readText = options.readText ?? ((path: string) => readFile(path, "utf8"));
  try {
    const raw = JSON.parse(await readText(INSTALL_STATE_PATH)) as Record<string, unknown>;
    const value = raw["environmentClass"];
    if (isInstallationEnvironmentClass(value)) {
      return { environmentClass: value, declared: true };
    }
  } catch {
    // fall through to the cautious default
  }
  return { environmentClass: UNDECLARED_ENVIRONMENT_CLASS, declared: false };
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

/** The read this module needs from PlatformConfig, kept Prisma-free. */
export interface EnvironmentClassStore {
  readConfig(key: string): Promise<unknown>;
}

/**
 * Read every tier and resolve the class in force.
 *
 * Each read is independently guarded: a failure drops that one tier rather than
 * the whole resolution, so the answer degrades toward the cautious default
 * instead of throwing on a surface an operator is trying to repair.
 */
export async function loadEnvironmentClassResolution(
  store: EnvironmentClassStore,
  options: {
    env?: Record<string, string | undefined>;
    readText?: (path: string) => Promise<string>;
  } = {},
): Promise<EnvironmentClassResolution> {
  const env = options.env ?? process.env;

  let installerState: InstallationEnvironmentClass | undefined;
  try {
    const read = await readInstallEnvironmentClass({ readText: options.readText });
    if (read.declared) installerState = read.environmentClass;
  } catch {
    installerState = undefined;
  }

  let portalDeclaration: PortalEnvironmentClassDeclarationV1 | null = null;
  try {
    portalDeclaration = parsePortalEnvironmentClassDeclaration(
      await store.readConfig(ENVIRONMENT_CLASS_CONFIG_KEY),
    );
  } catch {
    portalDeclaration = null;
  }

  return resolveEnvironmentClassPrecedence({
    processOverride: env[ENVIRONMENT_CLASS_ENV_VAR],
    installerState,
    portalDeclaration,
  });
}
