"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";
import { readActivationProfile } from "@dpf/storefront-templates";

import { auth } from "@/lib/auth";
import {
  ResourceCommandError,
  createAdminResource,
  updateAdminResource,
  type AdminResourceClient,
} from "@/lib/resource-scheduling/admin-resource-repository";
import {
  OccupancyCommandError,
  placeResourceOccupant,
  releaseResourceOccupant,
  type OccupancyClient,
} from "@/lib/resource-scheduling/resource-occupancy";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { newId } from "@/lib/shared/new-id";

export type HousingActionResult = ActionResult<{ message: string }>;

async function context() {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") return null;
  const config = await prisma.storefrontConfig.findFirst({
    select: { id: true, organizationId: true, archetype: { select: { activationProfile: true } } },
  });
  const activation = readActivationProfile(config?.archetype.activationProfile);
  const profiles = activation?.processProfile.resourceKinds.filter(
    (kind) => ["kennel", "foster-home"].includes(kind.kindSlug) && kind.capacityUnit === "animals",
  ) ?? [];
  return config && profiles.length > 0 ? { config, profiles } : null;
}

function messageFor(error: unknown): string {
  if (error instanceof ResourceCommandError || error instanceof OccupancyCommandError) {
    return error.message;
  }
  return "Housing could not be updated. Try again.";
}

export async function manageHousingAction(
  _previous: HousingActionResult | null,
  formData: FormData,
): Promise<HousingActionResult> {
  const resolved = await context();
  if (!resolved) return err("You do not have permission to manage housing.");
  const { config, profiles } = resolved;
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "create") {
      const resource = await createAdminResource({
        db: prisma as unknown as AdminResourceClient,
        organizationId: config.organizationId,
        storefrontId: config.id,
        domain: "care",
        profiles,
        command: {
          label: String(formData.get("label") ?? ""),
          kindSlug: String(formData.get("kindSlug") ?? ""),
          serviceArea: String(formData.get("serviceArea") ?? "") || null,
          capacity: Number(formData.get("capacity")),
          idempotencyKey: String(formData.get("idempotencyKey") ?? newId()),
        },
      });
      revalidatePath("/workspace/ward");
      return ok({ message: `${resource.label} is ready for placement.` });
    }

    if (intent === "place") {
      const placement = await placeResourceOccupant({
        db: prisma as unknown as OccupancyClient,
        organizationId: config.organizationId,
        allowedKinds: profiles.map((profile) => profile.kindSlug),
        command: {
          animalRef: String(formData.get("animalRef") ?? ""),
          destinationResourceId: String(formData.get("destinationResourceId") ?? ""),
          placedAt: new Date(),
          idempotencyKey: String(formData.get("idempotencyKey") ?? newId()),
        },
      });
      revalidatePath("/workspace/ward");
      return ok({ message: `Placement saved. ${placement.capacity.available} spaces remain there.` });
    }

    if (intent === "release") {
      await releaseResourceOccupant({
        db: prisma as unknown as OccupancyClient,
        organizationId: config.organizationId,
        command: {
          allocationId: String(formData.get("allocationId") ?? ""),
          expectedResourceId: String(formData.get("resourceId") ?? ""),
          releasedAt: new Date(),
          reason: String(formData.get("reason") ?? "left-care"),
          idempotencyKey: String(formData.get("idempotencyKey") ?? newId()),
        },
      });
      revalidatePath("/workspace/ward");
      return ok({ message: "The housing stay is closed and remains in history." });
    }

    if (["update", "block", "unblock", "retire"].includes(intent)) {
      const resource = await updateAdminResource({
        db: prisma as unknown as AdminResourceClient,
        organizationId: config.organizationId,
        domain: "care",
        profiles,
        resourceId: String(formData.get("resourceId") ?? ""),
        command: {
          expectedVersion: Number(formData.get("expectedVersion")),
          ...(intent === "update"
            ? {
                label: String(formData.get("label") ?? ""),
                serviceArea: String(formData.get("serviceArea") ?? "") || null,
                capacity: Number(formData.get("capacity")),
              }
            : {}),
          ...(intent === "block" || intent === "unblock"
            ? {
                blockedReason:
                  intent === "block"
                    ? String(formData.get("blockedReason") ?? "Out of service")
                    : null,
              }
            : {}),
          ...(intent === "retire" ? { lifecycle: "retired" as const } : {}),
          idempotencyKey: String(formData.get("idempotencyKey") ?? newId()),
        },
      });
      revalidatePath("/workspace/ward");
      return ok({ message: `${resource.label} was updated.` });
    }

    return err("Choose a housing action.");
  } catch (error) {
    return err(messageFor(error));
  }
}
