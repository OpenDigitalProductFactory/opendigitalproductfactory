"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import { formatMoney } from "@/lib/org-locale/org-locale";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

// BI-F3B6713F / DI-666409F895C5: the owner-set daily allowance for paid AI.
// One installation-wide amount in USD replaces raising 87 hard-coded agent
// caps through a code release. Only per-token-priced usage counts against it.
// Setting it is a spending decision, so it needs both the platform and the
// finance capability, and every change records who, when and why.
const MAX_DAILY_ALLOWANCE_USD = 100_000;

export async function savePaidInferenceAllowance(input: {
  /** USD per UTC day; null clears it so the registry per-agent caps apply again. */
  dailyUsd: number | null;
  reason: string;
}): Promise<ActionResult<{ dailyUsd: number | null }>> {
  const { userId } = await requireCapability("manage_platform");
  await requireCapability("manage_finance");
  const reason = input.reason.trim();
  if (!reason) return err("Say why this allowance is right; the reason is recorded with it.");
  let dailyUsd: number | null = null;
  if (input.dailyUsd !== null) {
    const parsed = Number(input.dailyUsd);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_DAILY_ALLOWANCE_USD) {
      return err(`The daily allowance must be an amount from ${formatMoney(0, "USD")} to ${formatMoney(MAX_DAILY_ALLOWANCE_USD, "USD")}.`);
    }
    dailyUsd = Math.round(parsed * 100) / 100;
  }
  const data = {
    paidInferenceDailyUsdAllowance: dailyUsd,
    paidInferenceAllowanceReason: reason,
    paidInferenceAllowanceSetAt: new Date(),
    paidInferenceAllowanceSetById: userId,
  };
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
  revalidatePath("/admin/platform-development");
  return ok({ dailyUsd });
}
