"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { isCapabilityKey, type CapabilityActivationChoice } from "@dpf/storefront-templates";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { setCapabilityChoice } from "@/lib/storefront/capability-activation";

async function requireManageBusinessModels(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_business_models")
  ) {
    throw new Error("Unauthorized");
  }
}

/**
 * Admin "add it later" path (EP-PARTNER-CHANNEL Phase 1b): records this org's
 * enable/disable decision for an offered capability (e.g. partner-program) from
 * the storefront settings surface. Same persistence the setup wizard writes,
 * tagged decidedVia="admin".
 */
export async function updateCapabilityActivation(
  capabilityKey: string,
  choice: CapabilityActivationChoice,
): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  if (!isCapabilityKey(capabilityKey)) {
    return { ok: false, error: `Unknown capability: ${capabilityKey}` };
  }
  if (choice !== "enabled" && choice !== "disabled") {
    return { ok: false, error: `Invalid choice: ${choice}` };
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return { ok: false, error: "No organization found" };
  }

  await setCapabilityChoice({
    organizationId: org.id,
    capabilityKey,
    choice,
    decidedVia: "admin",
  });

  revalidatePath("/storefront/settings/capabilities");
  return { ok: true };
}
