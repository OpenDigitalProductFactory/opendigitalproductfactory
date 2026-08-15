import {
  parseInstallationOperatingIntent,
  type InstallationOperatingIntentV1,
} from "@dpf/db/installation-operating-intent";

export const INSTALLATION_OPERATING_INTENT_KEY = "installation.operating-intent.v1";

type InstallationIntentDb = {
  platformConfig: {
    findUnique(args: {
      where: { key: string };
      select: { value: true };
    }): Promise<{ value: unknown } | null>;
  };
};

export type LoadedInstallationOperatingIntent =
  | { status: "valid"; intent: InstallationOperatingIntentV1 }
  | { status: "missing" }
  | { status: "invalid"; error: string };

export type InvestmentFundingAuthority =
  | { allowed: true }
  | { allowed: false; error: "installation_authority_required"; message: string };

export async function loadInstallationOperatingIntent(
  db: InstallationIntentDb,
): Promise<LoadedInstallationOperatingIntent> {
  const row = await db.platformConfig.findUnique({
    where: { key: INSTALLATION_OPERATING_INTENT_KEY },
    select: { value: true },
  });
  if (!row) return { status: "missing" };

  const parsed = parseInstallationOperatingIntent(row.value);
  return parsed.ok
    ? { status: "valid", intent: parsed.value }
    : { status: "invalid", error: parsed.error };
}

/**
 * Installation intent never grants funding permission. This prerequisite only
 * proves that an already-authorized caller is acting on the confirmed business
 * installation before WWWD decides whether the investment should proceed.
 */
export function resolveInvestmentFundingAuthority(
  loaded: LoadedInstallationOperatingIntent,
): InvestmentFundingAuthority {
  if (
    loaded.status === "valid"
    && loaded.intent.confirmation.status === "confirmed"
    && loaded.intent.primaryPurpose === "operate-organization"
  ) {
    return { allowed: true };
  }

  const reason = loaded.status === "missing"
    ? "This installation has not confirmed its operating purpose."
    : loaded.status === "invalid"
      ? "This installation's operating-purpose record is invalid."
      : loaded.intent.confirmation.status !== "confirmed"
        ? "This installation's operating purpose still needs owner confirmation."
        : "Investment funding is owned by the confirmed organization-operating installation.";

  return {
    allowed: false,
    error: "installation_authority_required",
    message: `${reason} This installation may still contribute demand and evidence, but it cannot make the canonical funding decision.`,
  };
}
