// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// Reading the environment class from its authorities.
//
// Server-only: this module touches the filesystem. The pure precedence contract
// it applies lives in `./environment-class-contract`, and is re-exported here so
// existing server callers keep one import.
//
// The portal never writes `/dpf-state/install-state.json`. Local drift is
// repaired FROM installer state, not into it.

import { readFile } from "node:fs/promises";

import {
  UNDECLARED_ENVIRONMENT_CLASS,
  isInstallationEnvironmentClass,
  type InstallationEnvironmentClass,
} from "@dpf/db/installation-operating-intent";

import {
  ENVIRONMENT_CLASS_CONFIG_KEY,
  ENVIRONMENT_CLASS_ENV_VAR,
  parsePortalEnvironmentClassDeclaration,
  resolveEnvironmentClassPrecedence,
  type EnvironmentClassResolution,
  type PortalEnvironmentClassDeclarationV1,
} from "@/lib/install/environment-class-contract";

export * from "@/lib/install/environment-class-contract";

/** In-container path to the governed install snapshot. */
export const INSTALL_STATE_PATH = "/dpf-state/install-state.json";

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
