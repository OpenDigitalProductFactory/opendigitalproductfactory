"use server";

import { prisma, resolveCanonicalInventoryEntityId } from "@dpf/db";
import { revalidatePath } from "next/cache";

type ActionResult = { ok: true } | { ok: false; error: string };

// Confirm support status for a device. Used when the operator has
// independently verified the device is in active support (warranty
// valid, vendor still shipping firmware) and wants to clear the
// "unknown support posture" attention flag without changing the
// underlying discovery evidence.
export async function confirmSupportStatus(
  entityId: string,
  status: "supported" | "approaching_end" | "expired" | "coverage_gap",
): Promise<ActionResult> {
  if (!entityId) return { ok: false, error: "entityId required" };
  const valid = ["supported", "approaching_end", "expired", "coverage_gap"] as const;
  if (!valid.includes(status)) return { ok: false, error: "invalid status" };

  const canonicalEntityId = await resolveCanonicalInventoryEntityId(prisma, entityId);
  if (!canonicalEntityId) return { ok: false, error: "inventory entity not found" };

  await prisma.inventoryEntity.update({
    where: { id: canonicalEntityId },
    data: { supportStatus: status },
  });

  revalidatePath(`/inventory/entity/${entityId}`);
  revalidatePath(`/inventory/entity/${canonicalEntityId}`);
  revalidatePath("/inventory");
  return { ok: true };
}

// Operator override of the version that discovery wasn't able to read
// (firmware version on a closed device, application version behind an
// opaque endpoint, etc.).
export async function setObservedVersion(
  entityId: string,
  version: string,
): Promise<ActionResult> {
  if (!entityId) return { ok: false, error: "entityId required" };
  const trimmed = version.trim();
  if (!trimmed) return { ok: false, error: "version cannot be empty" };

  const canonicalEntityId = await resolveCanonicalInventoryEntityId(prisma, entityId);
  if (!canonicalEntityId) return { ok: false, error: "inventory entity not found" };

  await prisma.inventoryEntity.update({
    where: { id: canonicalEntityId },
    data: { observedVersion: trimmed, normalizedVersion: trimmed },
  });

  revalidatePath(`/inventory/entity/${entityId}`);
  revalidatePath(`/inventory/entity/${canonicalEntityId}`);
  revalidatePath("/inventory");
  return { ok: true };
}
