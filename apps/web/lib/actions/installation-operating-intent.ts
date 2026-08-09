"use server";

import { revalidatePath } from "next/cache";

import { prisma, type Prisma } from "@dpf/db";
import {
  INSTALLATION_OPERATING_PURPOSES,
  parseInstallationOperatingIntent,
  type InstallationOperatingIntentV1,
  type InstallationOperatingPurpose,
} from "@dpf/db/installation-operating-intent";
import { requireCapability } from "@/lib/actions/shared/guards";
import { resolvePrincipalIdForUser } from "@/lib/identity/principal-linking";
import { INSTALLATION_OPERATING_INTENT_KEY } from "@/lib/installation-journey/operating-intent";

export type ConfirmInstallationPurposeResult =
  | { ok: true; primaryPurpose: InstallationOperatingPurpose }
  | { ok: false; error: string };

export async function confirmInstallationOperatingPurpose(
  requestedPurpose: string,
): Promise<ConfirmInstallationPurposeResult> {
  if (!(INSTALLATION_OPERATING_PURPOSES as readonly string[]).includes(requestedPurpose)) {
    return { ok: false, error: "Choose a recognized installation purpose." };
  }

  const { userId } = await requireCapability("manage_platform");
  const principalId = (await resolvePrincipalIdForUser(userId)) ?? userId;
  const primaryPurpose = requestedPurpose as InstallationOperatingPurpose;
  const existing = await prisma.platformConfig.findUnique({
    where: { key: INSTALLATION_OPERATING_INTENT_KEY },
    select: { value: true },
  });
  const parsed = parseInstallationOperatingIntent(existing?.value);
  const now = new Date().toISOString();

  const value: InstallationOperatingIntentV1 = {
    schemaVersion: 1,
    primaryPurpose,
    secondaryPurposes: parsed.ok
      ? parsed.value.secondaryPurposes.filter((purpose) => purpose !== primaryPurpose)
      : [],
    relationshipIntents: parsed.ok ? parsed.value.relationshipIntents : [],
    ...(parsed.ok && parsed.value.pairedProductionInstallationRef
      ? { pairedProductionInstallationRef: parsed.value.pairedProductionInstallationRef }
      : {}),
    evidence: [
      ...(parsed.ok ? parsed.value.evidence : []),
      {
        source: "human",
        claim: `The operator confirmed ${primaryPurpose} as this installation's primary purpose.`,
        observedAt: now,
      },
    ],
    confidence: "high",
    confirmation: {
      status: "confirmed",
      confirmedAt: now,
      confirmedByPrincipalId: principalId,
    },
  };

  await prisma.platformConfig.upsert({
    where: { key: INSTALLATION_OPERATING_INTENT_KEY },
    update: { value: value as unknown as Prisma.InputJsonValue },
    create: {
      key: INSTALLATION_OPERATING_INTENT_KEY,
      value: value as unknown as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/workspace");
  return { ok: true, primaryPurpose };
}
