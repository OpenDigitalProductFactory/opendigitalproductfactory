"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolveRescueOrganizationScope } from "@/lib/animal-welfare/cockpit-loader";
import {
  IntakeCommandError,
  markAnimalPlacementReady,
  recordAnimalCareEvidence,
  recordAnimalIntake,
  releaseAnimalHold,
  type AnimalIntakeCommand,
  type IntakeClient,
} from "@/lib/animal-welfare/intake-repository";
import type { AnimalIntakeRequirementKey } from "@/lib/animal-welfare/intake-policy";
import type { CareRecordKind } from "@/lib/animal-welfare/care";
import { can } from "@/lib/govern/permissions";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";
import { resolveManagedResourceProfiles } from "@/lib/resource-scheduling/admin-resource-repository";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { newId } from "@/lib/shared/new-id";

export type IntakeActionResult = ActionResult<{ message: string }>;

const INTAKE_PATH = "/workspace/rescue/intake";

/**
 * Every fact that carries authority is derived here from the session, never
 * from the form: organization, storefront, acting principal, housing kinds.
 */
async function context() {
  const session = await auth();
  const user = session?.user as (typeof session extends null ? never : NonNullable<typeof session>["user"] & { type?: string }) | undefined;
  if (!user || user.type !== "admin") return null;
  if (!can(user, "operate_animal_welfare")) return null;
  const scope = await resolveRescueOrganizationScope(user.id);
  if (!scope) return null;
  const [config, actorPrincipalId] = await Promise.all([
    prisma.storefrontConfig.findUnique({
      where: { organizationId: scope.organizationId },
      select: { id: true, archetype: { select: { archetypeId: true, activationProfile: true } } },
    }),
    resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id: user.id }),
  ]);
  if (!config || !actorPrincipalId) return null;
  const profiles = resolveManagedResourceProfiles({
    archetypeId: config.archetype.archetypeId,
    activationProfile: config.archetype.activationProfile,
    allowedKindSlugs: ["kennel", "foster-home"],
    capacityUnit: "animals",
  });
  return {
    organizationId: scope.organizationId,
    storefrontId: config.id,
    actorPrincipalId,
    allowedHousingKinds: profiles.map((profile) => profile.kindSlug),
  };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function optional(formData: FormData, name: string): string | null {
  const value = field(formData, name);
  return value === "" ? null : value;
}

function messageFor(error: unknown): string {
  if (error instanceof IntakeCommandError) return error.message;
  return "The intake could not be saved. Try again.";
}

const REQUIREMENT_KINDS: Record<AnimalIntakeRequirementKey, CareRecordKind | null> = {
  "identity-check": "observation",
  "intake-examination": "observation",
  "weight-condition": "weight",
  vaccination: "vaccination",
  "parasite-treatment": "medication",
  sterilization: "procedure",
  "behaviour-assessment": "behavior",
  housing: null,
};

function evidenceDetail(formData: FormData, key: AnimalIntakeRequirementKey): unknown {
  const provider = field(formData, "provider");
  switch (key) {
    case "identity-check":
      return { microchipScanned: field(formData, "microchipScanned") === "yes", microchipNumber: optional(formData, "microchipNumber"), provider };
    case "intake-examination":
      return { provider, findings: field(formData, "outcome") };
    case "weight-condition": {
      const bcs = optional(formData, "bodyConditionScore");
      return { bodyConditionScore: bcs ? Number(bcs) : null };
    }
    case "vaccination":
      return { product: field(formData, "product"), provider, nextDueAt: optional(formData, "nextDueAt") };
    case "parasite-treatment":
      return { product: field(formData, "product"), provider, outcome: field(formData, "outcome") };
    case "sterilization":
      return {
        provider,
        outcome: field(formData, "procedureOutcome"),
        recoveryUntil: optional(formData, "recoveryUntil"),
        costReference: optional(formData, "costReference"),
        complication: optional(formData, "complication"),
      };
    case "behaviour-assessment":
      return { provider, outcome: field(formData, "outcome") };
    case "housing":
      return {};
  }
}

export async function manageIntakeAction(
  _previous: IntakeActionResult | null,
  formData: FormData,
): Promise<IntakeActionResult> {
  const resolved = await context();
  if (!resolved) return err("You do not have permission to run intake for this organization.");
  const db = prisma as unknown as IntakeClient;
  const intent = field(formData, "intent");

  try {
    if (intent === "admit") {
      const existingId = optional(formData, "existingAnimalProfileId");
      const holdKind = optional(formData, "holdKind");
      const command: AnimalIntakeCommand = {
        animal: existingId
          ? { mode: "existing", animalProfileId: existingId }
          : {
              mode: "new",
              name: field(formData, "name"),
              species: field(formData, "species"),
              breed: optional(formData, "breed"),
              sex: optional(formData, "sex"),
              birthDate: optional(formData, "birthDate"),
              microchipNumber: optional(formData, "microchipNumber"),
            },
        intakeType: field(formData, "intakeType") as AnimalIntakeCommand["intakeType"],
        sourceName: optional(formData, "sourceName"),
        arrivedAt: optional(formData, "arrivedAt") ?? new Date().toISOString(),
        initialHousingResourceId: field(formData, "initialHousingResourceId"),
        hold: holdKind === "legal" || holdKind === "policy"
          ? { kind: holdKind, source: field(formData, "holdSource"), reason: field(formData, "holdReason"), effectiveUntil: optional(formData, "holdUntil") }
          : null,
        idempotencyKey: optional(formData, "idempotencyKey") ?? newId(),
      };
      const result = await recordAnimalIntake({ db, context: resolved, command });
      revalidatePath(INTAKE_PATH);
      revalidatePath("/workspace/ward");
      return ok({ message: result.replayed ? `${result.animalRef} was already admitted.` : `${result.animalRef} admitted and housed. Complete the checklist before placement.` });
    }

    if (intent === "evidence") {
      const key = field(formData, "requirementKey") as AnimalIntakeRequirementKey;
      const kind = REQUIREMENT_KINDS[key];
      if (!kind) return err("Choose a checklist requirement that takes a care record.");
      const result = await recordAnimalCareEvidence({
        db,
        context: resolved,
        command: {
          animalProfileId: field(formData, "animalProfileId"),
          requirementKey: key,
          kind,
          value: optional(formData, "value"),
          unit: optional(formData, "unit"),
          effectiveAt: optional(formData, "effectiveAt"),
          detail: evidenceDetail(formData, key),
        },
      });
      revalidatePath(INTAKE_PATH);
      return ok({ message: `${result.requirementKey.replaceAll("-", " ")} recorded.` });
    }

    if (intent === "release-hold") {
      await releaseAnimalHold({
        db,
        context: resolved,
        command: { animalProfileId: field(formData, "animalProfileId"), expectedVersion: Number(field(formData, "expectedVersion")), reason: field(formData, "reason") },
      });
      revalidatePath(INTAKE_PATH);
      return ok({ message: "Hold released. The animal continues through intake." });
    }

    if (intent === "mark-ready") {
      await markAnimalPlacementReady({
        db,
        context: resolved,
        command: { animalProfileId: field(formData, "animalProfileId"), expectedVersion: Number(field(formData, "expectedVersion")) },
      });
      revalidatePath(INTAKE_PATH);
      revalidatePath("/workspace/rescue/adoptions");
      return ok({ message: "Placement readiness verified. The animal can now be offered for adoption." });
    }

    return err("Choose an intake action.");
  } catch (error) {
    return err(messageFor(error));
  }
}
