"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { resolveRescueOrganizationScope } from "@/lib/animal-welfare/cockpit-loader";
import {
  DailyCareError,
  acknowledgeCareEscalation,
  escalateMissedMedication,
  establishCareRoutine,
  recordCareRound,
  type CareRoundOutcome,
  type CareRoutineKind,
} from "@/lib/animal-welfare/daily-care";
import { can } from "@/lib/govern/permissions";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export type CareActionResult = ActionResult<{ message: string }>;

const CARE_PATH = "/workspace/rescue/care";

async function context() {
  const session = await auth();
  const user = session?.user as (NonNullable<typeof session>["user"] & { type?: string }) | undefined;
  if (!user || user.type !== "admin" || !can(user, "operate_animal_welfare")) return null;
  const scope = await resolveRescueOrganizationScope(user.id);
  if (!scope) return null;
  const principalRef = await resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id: user.id });
  if (!principalRef) return null;
  return { organizationId: scope.organizationId, timeZone: scope.timeZone, actor: { userId: user.id, principalRef } };
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optional = (formData: FormData, name: string) => field(formData, name) || null;

function messageFor(error: unknown): string {
  return error instanceof DailyCareError ? error.message : "The care record could not be saved. Try again.";
}

export async function manageCareAction(_previous: CareActionResult | null, formData: FormData): Promise<CareActionResult> {
  const resolved = await context();
  if (!resolved) return err("You do not have permission to record care for this organization.");
  const intent = field(formData, "intent");
  try {
    if (intent === "routine") {
      const forDays = optional(formData, "forDays");
      const result = await establishCareRoutine({
        organizationId: resolved.organizationId,
        timeZone: resolved.timeZone,
        actor: resolved.actor,
        command: {
          animalProfileId: field(formData, "animalProfileId"),
          kind: field(formData, "kind") as CareRoutineKind,
          timeOfDay: field(formData, "timeOfDay"),
          frequency: field(formData, "frequency") === "weekly" ? "weekly" : "daily",
          weekdays: formData.getAll("weekdays").map(String) as never,
          forDays: forDays ? Number(forDays) : null,
          instruction: optional(formData, "instruction"),
          startDate: optional(formData, "startDate"),
        },
      });
      revalidatePath(CARE_PATH);
      return ok({ message: `${result.title}: ${result.instances} round(s) scheduled over the next two weeks.` });
    }
    if (intent === "round") {
      const result = await recordCareRound({
        organizationId: resolved.organizationId,
        actor: resolved.actor,
        command: { roundId: field(formData, "roundId"), outcome: field(formData, "outcome") as CareRoundOutcome, observation: optional(formData, "observation") },
      });
      revalidatePath(CARE_PATH);
      return ok({ message: result.escalationId ? "Round recorded and a welfare follow-up raised for a person to take on." : "Round recorded." });
    }
    if (intent === "escalate-missed") {
      const result = await escalateMissedMedication({ organizationId: resolved.organizationId, actor: resolved.actor });
      revalidatePath(CARE_PATH);
      return ok({ message: result.escalated === 0 ? "No medication rounds are past their grace window." : `${result.escalated} missed medication round(s) escalated.` });
    }
    if (intent === "acknowledge") {
      await acknowledgeCareEscalation({ organizationId: resolved.organizationId, actor: resolved.actor, command: { escalationId: field(formData, "escalationId"), note: field(formData, "note") } });
      revalidatePath(CARE_PATH);
      return ok({ message: "Follow-up resolved and recorded." });
    }
    return err("Choose a care action.");
  } catch (error) {
    return err(messageFor(error));
  }
}
