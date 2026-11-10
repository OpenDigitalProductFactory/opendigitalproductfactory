"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import type { AdoptionApplicationStatus } from "@/lib/animal-welfare/adoption";
import {
  AdoptionCommandError,
  cancelAdoptionReservation,
  completeAdoptionPlacement,
  createAdoptionApplication,
  returnAdoptedAnimal,
  transitionAdoptionApplicationCommand,
} from "@/lib/animal-welfare/adoption-repository";
import { resolveRescueOrganizationScope } from "@/lib/animal-welfare/cockpit-loader";
import { can } from "@/lib/govern/permissions";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";
import { resolveManagedResourceProfiles } from "@/lib/resource-scheduling/admin-resource-repository";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export type AdoptionActionResult = ActionResult<{ message: string }>;

const PATHS = ["/workspace/rescue/adoptions", "/workspace/rescue", "/workspace/ward", "/workspace/rescue/intake"];

async function context() {
  const session = await auth();
  const user = session?.user as (NonNullable<typeof session>["user"] & { type?: string }) | undefined;
  if (!user || user.type !== "admin" || !can(user, "operate_animal_welfare")) return null;
  const scope = await resolveRescueOrganizationScope(user.id);
  if (!scope) return null;
  const [config, principalRef] = await Promise.all([
    prisma.storefrontConfig.findUnique({ where: { organizationId: scope.organizationId }, select: { id: true, archetype: { select: { archetypeId: true, activationProfile: true } } } }),
    resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id: user.id }),
  ]);
  if (!principalRef) return null;
  const profiles = config
    ? resolveManagedResourceProfiles({ archetypeId: config.archetype.archetypeId, activationProfile: config.archetype.activationProfile, allowedKindSlugs: ["kennel", "foster-home"], capacityUnit: "animals" })
    : [];
  return { organizationId: scope.organizationId, storefrontId: config?.id ?? null, actor: { userId: user.id, principalRef }, allowedHousingKinds: profiles.map((p) => p.kindSlug) };
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optional = (formData: FormData, name: string) => field(formData, name) || null;
const messageFor = (error: unknown) => (error instanceof AdoptionCommandError ? error.message : "The adoption record could not be saved. Try again.");
const revalidate = () => PATHS.forEach((path) => revalidatePath(path));

export async function manageAdoptionAction(_previous: AdoptionActionResult | null, formData: FormData): Promise<AdoptionActionResult> {
  const resolved = await context();
  if (!resolved) return err("You do not have permission to manage adoptions for this organization.");
  const intent = field(formData, "intent");
  try {
    if (intent === "apply") {
      const result = await createAdoptionApplication({
        organizationId: resolved.organizationId,
        actor: resolved.actor,
        command: {
          animalProfileId: field(formData, "animalProfileId"),
          applicantName: field(formData, "applicantName"),
          inquiryRef: optional(formData, "inquiryRef"),
          screening: { housing: field(formData, "housing"), otherPets: field(formData, "otherPets"), children: field(formData, "children"), landlordPermission: field(formData, "landlordPermission"), experience: field(formData, "experience") },
        },
      });
      revalidate();
      return ok({ message: `Application ${result.applicationRef} recorded and ready for screening.` });
    }
    if (intent === "transition") {
      const result = await transitionAdoptionApplicationCommand({
        organizationId: resolved.organizationId,
        actor: resolved.actor,
        command: {
          applicationId: field(formData, "applicationId"),
          to: field(formData, "to") as AdoptionApplicationStatus,
          expectedVersion: Number(field(formData, "expectedVersion")),
          reason: optional(formData, "reason"),
          visitAt: optional(formData, "visitDate") ? `${field(formData, "visitDate")}T${optional(formData, "visitTime") ?? "10:00"}:00` : null,
        },
      });
      revalidate();
      return ok({ message: result.placementId ? "Approved. The animal is reserved for this applicant and no one else can be promised it." : result.visitId ? "Visit scheduled and added to the animal's work." : `Application moved to ${result.status.replaceAll("-", " ")}.` });
    }
    if (intent === "place") {
      const amount = optional(formData, "feeAmount");
      const result = await completeAdoptionPlacement({
        organizationId: resolved.organizationId,
        storefrontId: resolved.storefrontId,
        actor: resolved.actor,
        command: { applicationId: field(formData, "applicationId"), expectedVersion: Number(field(formData, "expectedVersion")), placedAt: optional(formData, "placedAt"), fee: amount ? { amount: Number(amount), currency: field(formData, "currency"), donorEmail: field(formData, "donorEmail") } : null },
      });
      revalidate();
      return ok({ message: result.donationId ? "Adoption completed. The fee is recorded as a donation toward this animal's care." : "Adoption completed. Custody is closed and the listing is withdrawn." });
    }
    if (intent === "cancel-reservation") {
      await cancelAdoptionReservation({ organizationId: resolved.organizationId, actor: resolved.actor, command: { applicationId: field(formData, "applicationId"), expectedVersion: Number(field(formData, "expectedVersion")), reason: field(formData, "reason") } });
      revalidate();
      return ok({ message: "Reservation cancelled. The animal is available again." });
    }
    if (intent === "return") {
      const result = await returnAdoptedAnimal({
        organizationId: resolved.organizationId,
        actor: resolved.actor,
        allowedHousingKinds: resolved.allowedHousingKinds,
        command: { placementId: field(formData, "placementId"), expectedVersion: Number(field(formData, "expectedVersion")), reason: field(formData, "reason"), returnedAt: optional(formData, "returnedAt"), housingResourceId: optional(formData, "housingResourceId") },
      });
      revalidate();
      return ok({ message: result.housed ? "Welcome back. Custody reopened and the animal is housed; complete the intake checklist again before placement." : "Welcome back. Custody reopened; house the animal on the board and complete the intake checklist again." });
    }
    return err("Choose an adoption action.");
  } catch (error) {
    return err(messageFor(error));
  }
}
