"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

import {
  provisionBuildEngine,
  type ProvisionOutcome,
} from "@/lib/integrate/build-engine-provision";

/**
 * Provision a build-dispatch engine into the running sandbox from its registry
 * recipe (Build-Engine Provisioning, EP-2D477458, Phase 2). Operator-gated by
 * `manage_provider_connections` — the same authority that manages provider
 * credentials and toggles runners. Returns the structured outcome so the button
 * can show a precise result, and revalidates the config page so the readiness
 * badge re-renders.
 */
export async function provisionBuildEngineAction(
  engineId: string,
  offline = false,
): Promise<ProvisionOutcome> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    throw new Error(
      "Unauthorized: managing provider connections is required to provision build engines.",
    );
  }

  const outcome = await provisionBuildEngine(engineId, { offline, actorUserId: user.id });
  revalidatePath("/platform/ai/build-studio");
  return outcome;
}
