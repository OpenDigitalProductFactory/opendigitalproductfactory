"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { validateCooConversationalName } from "@/lib/coworker-presentation/coo-name";

export async function saveCooConversationalName({
  name,
  setupProgressId,
}: {
  name: string | null;
  setupProgressId?: string;
}): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  await requireCapability("manage_platform");

  let organizationId: string | null = null;
  if (setupProgressId) {
    const progress = await prisma.platformSetupProgress.findUnique({
      where: { id: setupProgressId },
      select: { organizationId: true },
    });
    organizationId = progress?.organizationId ?? null;
  } else {
    organizationId = (await prisma.organization.findFirst({ select: { id: true } }))?.id ?? null;
  }
  if (!organizationId) return { ok: false, error: "No organization is linked to this setup." };

  const validation = validateCooConversationalName(name);
  if (!validation.ok) return validation;
  if (validation.value) {
    const employeeCollision = await prisma.employeeProfile.findFirst({
      where: { displayName: { equals: validation.value, mode: "insensitive" } },
      select: { id: true },
    });
    if (employeeCollision) {
      return {
        ok: false,
        error: "Choose a name that is not already used by a person in your organization.",
      };
    }
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { cooConversationalName: validation.value },
    select: { cooConversationalName: true },
  });

  revalidatePath("/workspace");
  revalidatePath("/platform/ai/agent/AGT-ORCH-000");
  revalidatePath("/platform/ai/agent/coo");
  return validation;
}
