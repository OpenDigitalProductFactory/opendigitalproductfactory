"use server";

// The switch for sharing this install's country with the organizations it
// federates under (BI-06EA3167). Platform administrators only.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { setDeploymentCountrySharing } from "@/lib/federation/deployment-declaration.server";
import { can } from "@/lib/permissions";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export async function setDeploymentCountrySharingAction(
  enabled: boolean,
): Promise<ActionResult<{ enabled: boolean; queued: number }>> {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")) {
    return err("forbidden");
  }
  const result = await setDeploymentCountrySharing(enabled === true);
  if ("refused" in result) return err(result.refused);
  revalidatePath("/platform/federation-links");
  revalidatePath("/customer/footprint");
  return ok({ enabled: enabled === true, queued: result.queued });
}
