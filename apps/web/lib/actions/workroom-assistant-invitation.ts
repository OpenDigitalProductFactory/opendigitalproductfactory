"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "./shared/guards";
import { ok, err } from "@/lib/shared/action-result";
import { WorkroomAssistantInvitationError, listWorkroomAssistantChoices, inviteWorkroomAssistant,
  type WorkroomAssistantInvitation } from "@/lib/work-management/workroom-assistant-invitation";

export async function getWorkroomAssistantChoices(workroomId: string) {
  const userId = await requireUserId();
  try { return ok(await listWorkroomAssistantChoices(userId, workroomId)); }
  catch (error) { return err(error instanceof WorkroomAssistantInvitationError ? error.message : "Could not load access. Try again."); }
}

export async function saveWorkroomAssistantInvitation(input: WorkroomAssistantInvitation) {
  const userId = await requireUserId();
  try {
    const result = await inviteWorkroomAssistant(userId, input);
    revalidatePath("/workspace", "layout");
    return ok(result);
  } catch (error) {
    return err(error instanceof WorkroomAssistantInvitationError ? error.message : "Access was not saved. Refresh and review the room's current settings.");
  }
}
