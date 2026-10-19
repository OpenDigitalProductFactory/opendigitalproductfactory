"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

// BI-CEFF2535: the governed backlog lane (auto-approved drafts + the daily
// tee-up sweep) was read in five places and written nowhere, so the only way
// to turn Build Studio autonomy on was a database edit. This is its writer.
const GOVERNED_BACKLOG_CAP_MAX = 50;

async function requireManagePlatform(): Promise<string> {
  return (await requireCapability("manage_platform")).userId;
}

export async function saveGovernedBacklogSettings(input: {
  enabled: boolean;
  dailyCap?: number | null;
  /** BI-9AC1F99B: the capacity drain switch. Omitted keeps the stored value. */
  capacityDrainEnabled?: boolean | null;
}): Promise<ActionResult<{ enabled: boolean; dailyCap: number | null; capacityDrainEnabled: boolean | null }>> {
  const userId = await requireManagePlatform();
  const enabled = input.enabled === true;
  // The cap column is NOT NULL (default 3): an omitted cap keeps the stored one.
  let dailyCap: number | null = null;
  if (input.dailyCap != null) {
    const parsed = Number(input.dailyCap);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > GOVERNED_BACKLOG_CAP_MAX) {
      return err(`Daily cap must be a whole number from 0 to ${GOVERNED_BACKLOG_CAP_MAX}.`);
    }
    dailyCap = parsed;
  }
  const capPatch = dailyCap == null ? {} : { backlogTeeUpDailyCap: dailyCap };
  const capacityDrainEnabled = typeof input.capacityDrainEnabled === "boolean" ? input.capacityDrainEnabled : null;
  const drainPatch = capacityDrainEnabled == null ? {} : { capacityDrainEnabled };
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: {
      governedBacklogEnabled: enabled,
      ...capPatch,
      ...drainPatch,
      configuredAt: new Date(),
      configuredById: userId,
    },
    create: {
      id: "singleton",
      governedBacklogEnabled: enabled,
      ...capPatch,
      ...drainPatch,
      configuredAt: new Date(),
      configuredById: userId,
    },
  });
  revalidatePath("/admin/platform-development");
  revalidatePath("/build");
  return ok({ enabled, dailyCap, capacityDrainEnabled });
}

