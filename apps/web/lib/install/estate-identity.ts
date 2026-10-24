// EP-1FABA22D · BI-7626A660 / BI-C7151B1B
// Reading the estate identity from its authorities, and resolving the ONE
// installation identity every surface reads.
//
// Server-only: this module touches the filesystem. The pure contract it applies
// lives in `./estate-identity-contract` and is re-exported so existing server
// callers keep one import. The shell header must import the CONTRACT, never this
// module — a `"use client"` graph that reaches `node:fs/promises` fails the
// production build and nothing else catches it.

import { readFile } from "node:fs/promises";

import type { InstallationEnvironmentClass } from "@dpf/db/installation-operating-intent";

import {
  ESTATE_IDENTITY_CONFIG_KEY,
  ESTATE_NAME_ENV_VAR,
  formatInstallationBadge,
  normalizeEstateName,
  parsePortalEstateIdentityDeclaration,
  resolveEstateNamePrecedence,
  type EstateNameResolution,
  type PortalEstateIdentityDeclarationV1,
  type ResolvedInstallationIdentity,
} from "@/lib/install/estate-identity-contract";
import {
  INSTALL_STATE_PATH,
  loadEnvironmentClassResolution,
} from "@/lib/install/environment-class";

export * from "@/lib/install/estate-identity-contract";

/**
 * Read the estate name the installer recorded, if any.
 *
 * Unlike the environment class there is no cautious default: an unnamed
 * installation is a real, reportable state, and inventing a name would be worse
 * than showing a role-only badge.
 */
export async function readInstallEstateName(options: {
  readText?: (path: string) => Promise<string>;
} = {}): Promise<string | null> {
  const readText = options.readText ?? ((path: string) => readFile(path, "utf8"));
  try {
    const raw = JSON.parse(await readText(INSTALL_STATE_PATH)) as Record<string, unknown>;
    return normalizeEstateName(raw["estateName"]);
  } catch {
    return null;
  }
}

/** The read this module needs from PlatformConfig, kept Prisma-free. */
export interface EstateIdentityStore {
  readConfig(key: string): Promise<unknown>;
  /**
   * The Organization row's name from setup, the lowest speaking tier
   * (BI-CA54ACC8). Optional so a store that only carries PlatformConfig keeps
   * working; such a store simply cannot fall back to the organization name.
   */
  readOrganizationName?(): Promise<string | null>;
}

/**
 * Read every tier and resolve the estate name in force.
 *
 * Each read is independently guarded, matching `loadEnvironmentClassResolution`:
 * one failed tier drops that tier, never the whole answer.
 */
export async function loadEstateNameResolution(
  store: EstateIdentityStore,
  options: {
    env?: Record<string, string | undefined>;
    readText?: (path: string) => Promise<string>;
  } = {},
): Promise<EstateNameResolution> {
  const env = options.env ?? process.env;

  let installerState: string | null = null;
  try {
    installerState = await readInstallEstateName({ readText: options.readText });
  } catch {
    installerState = null;
  }

  let portalDeclaration: PortalEstateIdentityDeclarationV1 | null = null;
  try {
    portalDeclaration = parsePortalEstateIdentityDeclaration(
      await store.readConfig(ESTATE_IDENTITY_CONFIG_KEY),
    );
  } catch {
    portalDeclaration = null;
  }

  let organizationName: string | null = null;
  if (store.readOrganizationName) {
    try {
      organizationName = await store.readOrganizationName();
    } catch {
      organizationName = null;
    }
  }

  return resolveEstateNamePrecedence({
    processOverride: env[ESTATE_NAME_ENV_VAR],
    installerState,
    portalDeclaration,
    organizationName,
  });
}

/**
 * The reads every Prisma-backed caller composes: the PlatformConfig declaration
 * and the Organization row's name. One builder so no surface forgets the
 * organization tier and answers "unnamed" for an installation that was named at
 * setup (BI-CA54ACC8).
 */
export function prismaEstateIdentityStore(prisma: {
  platformConfig: { findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null> };
  organization: { findFirst(args: { select: { name: true } }): Promise<{ name: string } | null> };
}): EstateIdentityStore {
  return {
    readConfig: async (key) => (await prisma.platformConfig.findUnique({ where: { key }, select: { value: true } }))?.value ?? null,
    readOrganizationName: async () => (await prisma.organization.findFirst({ select: { name: true } }))?.name ?? null,
  };
}

/**
 * Resolve the whole installation identity: who operates this install, what kind
 * it is, and its cryptographic device id.
 *
 * This is the single resolver behind the header badge, the operations page and
 * the MCP handshake. No surface re-derives either half — a header that could
 * disagree with the operations page about the environment class would be worse
 * than no header at all.
 *
 * `shortDeviceId` is best-effort and independently guarded. It must NEVER be the
 * reason identity fails to resolve: the device id is minted lazily on first
 * federation read, so an install that has never federated legitimately has none,
 * and the handshake still has to be able to say which installation it is.
 */
export async function resolveInstallationIdentity(input: {
  store: EstateIdentityStore;
  environmentClass: InstallationEnvironmentClass;
  readDeviceId?: () => Promise<string | null>;
  env?: Record<string, string | undefined>;
  readText?: (path: string) => Promise<string>;
}): Promise<ResolvedInstallationIdentity> {
  const estate = await loadEstateNameResolution(input.store, {
    ...(input.env ? { env: input.env } : {}),
    ...(input.readText ? { readText: input.readText } : {}),
  });

  let shortDeviceId: string | null = null;
  if (input.readDeviceId) {
    try {
      shortDeviceId = await input.readDeviceId();
    } catch {
      shortDeviceId = null;
    }
  }

  return {
    estateName: estate.estateName,
    environmentClass: input.environmentClass,
    isProduction: input.environmentClass === "production",
    shortDeviceId,
  };
}

/**
 * Resolve the header badge for this installation, or null on production.
 *
 * The shell layout calls this once per render and passes the result to `Header`
 * as a plain string. Both halves come from the SAME resolvers the operations
 * page uses, so the header cannot claim an environment class the detail page
 * would contradict.
 *
 * Fails safe rather than open: any unreadable tier degrades toward the cautious
 * environment class, which is `production` — and a production install renders no
 * badge. A resolution failure therefore hides the badge; it can never invent one,
 * and it can never mislabel a production box as development.
 */
export async function loadInstallationBadge(
  store: EstateIdentityStore,
  options: {
    env?: Record<string, string | undefined>;
    readText?: (path: string) => Promise<string>;
  } = {},
): Promise<string | null> {
  try {
    const [environment, estate] = await Promise.all([
      loadEnvironmentClassResolution(store, options),
      loadEstateNameResolution(store, options),
    ]);
    return formatInstallationBadge({
      estateName: estate.estateName,
      environmentClass: environment.environmentClass,
    });
  } catch {
    return null;
  }
}
