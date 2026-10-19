"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "./shared/guards";
import { ok, err } from "@/lib/shared/action-result";
import { CoworkerDataAccessError, setCoworkerDataAccess, type CoworkerDataAccessInput } from "@/lib/identity/coworker-data-access";

export async function updateCoworkerDataAccess(input: CoworkerDataAccessInput) {
  const userId = await requireUserId();
  try {
    const result = await setCoworkerDataAccess(userId, input);
    revalidatePath("/platform/identity/agents");
    return ok(result);
  } catch (error) {
    return err(error instanceof CoworkerDataAccessError ? error.message
      : "Access was not changed. Refresh to check your permissions and the coworker's current settings.");
  }
}
