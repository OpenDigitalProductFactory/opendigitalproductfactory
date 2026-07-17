"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/actions/shared/guards";
import {
  saveWeeklyDigestDisposition,
  type WeeklyDigestDisposition,
} from "@/lib/attention/weekly-digest-preferences";
import { ROUTES } from "@/lib/routes";
import { err, ok } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export async function setWeeklyDigestDisposition(
  reviewOnIso: string,
  disposition: WeeklyDigestDisposition,
) {
  try {
    const user = await requireUser();
    if (disposition !== "cleared" && disposition !== "snoozed") {
      return err("Choose a valid weekly review action");
    }
    await saveWeeklyDigestDisposition(prisma, user.id, reviewOnIso, disposition);
    revalidatePath(`${ROUTES.workspace}/inbox`);
    return ok();
  } catch (error) {
    return err(getErrorMessage(error));
  }
}
