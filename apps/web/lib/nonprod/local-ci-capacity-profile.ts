import {
  isInstallationEnvironmentClass,
  parseOperatingIntent,
} from "@dpf/db/installation-operating-intent";
import { ENVIRONMENT_CLASS_CONFIG_KEY } from "@/lib/install/environment-class-contract";
import { INSTALLATION_OPERATING_INTENT_KEY } from "@/lib/installation-journey/operating-intent";
import { isRecord } from "../shared/is-record.mjs";
import type { LocalCiInstallationProfile } from "./local-ci-pool-policy";

/**
 * Reads what this installation has declared itself to be, for the local-CI
 * capacity derivation in `local-ci-pool-policy` (BI-D908DA0A).
 *
 * The derivation itself lives in the policy module, which deliberately keeps a
 * runtime import graph of relative `.mjs`/`.json` only so the raw-Node script
 * tests can load it. This module is the IO edge: it owns the `@dpf/db` parsers
 * and the path aliases, and nothing in the policy depends on it.
 *
 * Both keys are written by paths that already exist — the environment class by
 * the installer or the portal identity panel, the operating intent by the
 * identity declaration action. Neither is invented here.
 */
type PlatformConfigReader = {
  findUnique: (args: {
    where: { key: string };
    select: { value: true };
  }) => Promise<{ value: unknown } | null>;
};

/**
 * Returns null when either declaration is missing or unreadable, so an
 * installation that has not said what it is keeps the compatibility singleton
 * rather than inheriting a guess.
 */
export async function readLocalCiInstallationProfile(input: {
  platformConfig: PlatformConfigReader;
}): Promise<LocalCiInstallationProfile | null> {
  const [environmentRow, intentRow] = await Promise.all([
    input.platformConfig.findUnique({
      where: { key: ENVIRONMENT_CLASS_CONFIG_KEY },
      select: { value: true },
    }),
    input.platformConfig.findUnique({
      where: { key: INSTALLATION_OPERATING_INTENT_KEY },
      select: { value: true },
    }),
  ]);

  const environmentClass = isRecord(environmentRow?.value)
    ? environmentRow.value["environmentClass"]
    : null;
  if (!isInstallationEnvironmentClass(environmentClass)) return null;

  const intent = parseOperatingIntent(intentRow?.value);
  if (!intent) return null;

  return {
    environmentClass,
    primaryPurpose: intent.primaryPurpose,
    secondaryPurposes: intent.secondaryPurposes,
  };
}
