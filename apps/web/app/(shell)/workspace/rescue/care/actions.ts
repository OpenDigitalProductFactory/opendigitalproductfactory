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
import {
  VeterinaryCommandError,
  closeAnimalAppointment,
  registerPartnerPractice,
  scheduleAnimalAppointment,
} from "@/lib/animal-welfare/veterinary";
import type { VetVisitKind } from "@/lib/animal-welfare/veterinary-vocabulary";
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
  if (error instanceof DailyCareError || error instanceof VeterinaryCommandError) return error.message;
  return "The care record could not be saved. Try again.";
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
    if (intent === "practice") {
      const result = await registerPartnerPractice({
        organizationId: resolved.organizationId,
        timeZone: resolved.timeZone,
        actor: resolved.actor,
        command: { name: field(formData, "name"), contactName: optional(formData, "contactName"), phone: optional(formData, "phone"), email: optional(formData, "email"), arrangement: optional(formData, "arrangement"), address: optional(formData, "address") },
      });
      revalidatePath(CARE_PATH);
      return ok({ message: `Partner practice registered (${result.supplierId}). It is now a place a visit can be booked at and a supplier bills can be recorded against.` });
    }
    if (intent === "appointment") {
      const date = field(formData, "visitDate");
      const time = optional(formData, "visitTime") ?? "09:00";
      const duration = optional(formData, "durationMinutes");
      const recovery = optional(formData, "recoveryMinutes");
      const result = await scheduleAnimalAppointment({
        organizationId: resolved.organizationId,
        actor: resolved.actor,
        command: { animalProfileId: field(formData, "animalProfileId"), kind: field(formData, "kind") as VetVisitKind, locationId: optional(formData, "locationId"), scheduledStart: date ? `${date}T${time}:00` : "", durationMinutes: duration ? Number(duration) : null, recoveryMinutes: recovery ? Number(recovery) : null, note: optional(formData, "note") },
      });
      revalidatePath(CARE_PATH);
      revalidatePath("/workspace/rescue/intake");
      return ok({ message: `Visit booked. Recovery footprint ends ${result.footprintEnd.slice(0, 16).replace("T", " ")} UTC; the animal cannot be placed before then.` });
    }
    if (intent === "close-appointment") {
      const outcome = field(formData, "outcome") as "fulfilled" | "cancelled" | "no-show";
      const requirementKey = optional(formData, "procedureRequirement") as "sterilization" | "vaccination" | null;
      const result = await closeAnimalAppointment({
        organizationId: resolved.organizationId,
        actor: resolved.actor,
        command: {
          appointmentId: field(formData, "appointmentId"),
          expectedVersion: Number(field(formData, "expectedVersion")),
          outcome,
          reason: optional(formData, "reason"),
          procedure: outcome === "fulfilled" && requirementKey ? { requirementKey, provider: field(formData, "provider"), product: optional(formData, "product"), complication: optional(formData, "complication") } : null,
        },
      });
      revalidatePath(CARE_PATH);
      revalidatePath("/workspace/rescue/intake");
      return ok({ message: result.careRecordId ? "Visit closed and the procedure recorded on the intake checklist." : outcome === "fulfilled" ? "Visit closed as done." : "Visit closed; the recovery hold is lifted." });
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
