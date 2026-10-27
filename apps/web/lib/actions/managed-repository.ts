"use server";

// Managed repository actions (BI-985F4EC9).
// Design: docs/superpowers/specs/2026-10-14-managed-repository-connection-at-setup-design.md §3.2, §3.4.
//
// The operator names the repository this install manages; it is written to the
// existing PlatformDevConfig.upstreamRemoteUrl under the same manage_platform
// gate as savePlatformDevConfig. Login is the device flow with the
// "repository-controller" purpose (github-device-flow.ts); this module only
// saves the repository and re-checks its status on request.

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  invalidateManagedRepositoryStatus,
  loadManagedRepositoryStatus,
  managedRepositoryRemoteUrl,
  parseManagedRepositoryInput,
  type ManagedRepositoryStatusView,
} from "@/lib/forge/managed-repository-access";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { ROUTES } from "@/lib/routes";

async function authorize(): Promise<string | null> {
  try {
    return (await requireCapability("manage_platform")).userId;
  } catch {
    return null;
  }
}

/**
 * Save the managed repository the operator typed. Only an explicit save writes
 * it: the suggested repository on the form is never stored on its own. A new
 * PlatformDevConfig row is created without `configuredById`, so saving a
 * repository is not mistaken for the contribution decision.
 */
export async function saveManagedRepository(
  input: string,
): Promise<ActionResult<{ fullName: string }>> {
  if (!(await authorize())) return err("Unauthorized");
  const repository = parseManagedRepositoryInput(input);
  if (!repository) return err("Enter a GitHub repository as owner/name or its URL.");

  const upstreamRemoteUrl = managedRepositoryRemoteUrl(repository);
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: { upstreamRemoteUrl },
    create: { id: "singleton", contributionMode: "private", upstreamRemoteUrl },
  });
  invalidateManagedRepositoryStatus();
  revalidatePath(ROUTES.adminPlatformDevelopment);
  return ok({ fullName: repository.fullName });
}

/** Check the managed repository with the controller login now ("Check again"). */
export async function checkManagedRepository(): Promise<ActionResult<ManagedRepositoryStatusView>> {
  if (!(await authorize())) return err("Unauthorized");
  return ok(await loadManagedRepositoryStatus(prisma, { force: true }));
}
