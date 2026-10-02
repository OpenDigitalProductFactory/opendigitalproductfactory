"use server";

// The switch for sharing this install's country with the organizations it
// federates under (BI-06EA3167). Platform administrators only.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { setDeploymentCountrySharing } from "@/lib/federation/deployment-declaration.server";
import { can } from "@/lib/permissions";

export type DeploymentCountrySharingResult =
  | { ok: true; enabled: boolean; queued: number }
  | { ok: false; error: "forbidden" | "no-country" };

export async function setDeploymentCountrySharingAction(enabled: boolean): Promise<DeploymentCountrySharingResult> {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")) {
    return { ok: false, error: "forbidden" };
  }
  const result = await setDeploymentCountrySharing(enabled === true);
  if (!result.ok) return { ok: false, error: result.reason };
  revalidatePath("/platform/federation-links");
  revalidatePath("/customer/footprint");
  return { ok: true, enabled: enabled === true, queued: result.queued };
}
