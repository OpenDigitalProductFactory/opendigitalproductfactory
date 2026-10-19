"use server";

// Set the organization's accountable owner — Organization.topAccountablePrincipalId,
// the root of the human-accountability lineage every Workroom inherits from
// (apps/web/lib/work-management/human-accountability.ts). First-install setup
// records the owner account here when nothing is recorded yet
// (setup-entities.ts createOwnerAccount); this is the governed way to change it
// afterwards. Gated like the other organization-level settings (manage_platform)
// and written to the compliance audit trail with the before/after value.

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

const INVALID_TARGET = "Choose an active person as the accountable owner.";

export async function setOrganizationAccountableOwner(
  principalId: string,
): Promise<ActionResult<{ principalId: string; displayName: string; changed: boolean }>> {
  const { userId } = await requireCapability("manage_platform");

  const targetId = typeof principalId === "string" ? principalId.trim() : "";
  if (!targetId) return err(INVALID_TARGET);

  const target = await prisma.principal.findUnique({
    where: { id: targetId },
    select: { id: true, kind: true, status: true, displayName: true },
  });
  if (!target || target.kind !== "human" || target.status !== "active") return err(INVALID_TARGET);

  // Same single-organization resolution as the organization readers
  // (organization-accountable.server.ts) and the COO-name setting.
  const org = await prisma.organization.findFirst({
    select: { id: true, topAccountablePrincipalId: true },
  });
  if (!org) return err("No organization is recorded for this install yet.");

  const result = { principalId: target.id, displayName: target.displayName };
  if (org.topAccountablePrincipalId === target.id) return ok({ ...result, changed: false });

  const actor = await prisma.employeeProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: org.id },
      data: { topAccountablePrincipalId: target.id },
      select: { id: true },
    }),
    prisma.complianceAuditLog.create({
      data: {
        entityType: "organization",
        entityId: org.id,
        action: "accountable-owner-changed",
        field: "topAccountablePrincipalId",
        oldValue: org.topAccountablePrincipalId,
        newValue: target.id,
        performedByEmployeeId: actor?.id ?? null,
        agentId: null,
        notes: `Accountable owner set to ${target.displayName}`,
      },
    }),
  ]);

  revalidatePath("/admin/settings");
  // Workroom headers and workforce panels read the inherited owner.
  revalidatePath("/workspace", "layout");
  return ok({ ...result, changed: true });
}
