"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

import {
  provisionBuildEngine,
  type ProvisionOutcome,
} from "@/lib/build/build-engine-provision";
import {
  probeBuildEngineReadiness,
  type BuildEngineReadinessRow,
} from "@/lib/build/build-engine-readiness";

/** Shared operator gate: managing provider connections. Throws if not held. */
async function requireManageProviders(): Promise<{ id: string }> {
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
      "Unauthorized: managing provider connections is required to manage build engines.",
    );
  }
  return { id: user.id };
}

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
  const user = await requireManageProviders();
  const outcome = await provisionBuildEngine(engineId, { offline, actorUserId: user.id });
  revalidatePath("/platform/ai/build-studio");
  return outcome;
}

/**
 * Live-probe the sandbox readiness of the given build engines — or all of them
 * when `engineIds` is omitted — and return fresh rows including the failure
 * reason (BI-805D01E4, EP-BS-UX-HARDENING). Backs the config page's proactive
 * probe on load and its one-click "Probe all engines" action, so an operator
 * sees which engine will actually work BEFORE selecting one and starting a
 * build, instead of discovering a broken engine when the build fails mid-flight.
 *
 * Operator-gated by `manage_provider_connections` — the same authority that
 * provisions engines and manages provider credentials (a probe runs
 * `docker exec … --version` in the sandbox). Revalidates the config page so a
 * subsequent server render reflects the newly persisted BuildEngineState.
 */
export async function probeBuildEnginesAction(
  engineIds?: string[],
): Promise<BuildEngineReadinessRow[]> {
  await requireManageProviders();
  const rows = await probeBuildEngineReadiness({ engineIds });
  revalidatePath("/platform/ai/build-studio");
  return rows;
}
