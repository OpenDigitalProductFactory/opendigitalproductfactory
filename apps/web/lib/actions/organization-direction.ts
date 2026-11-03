"use server";
// The owner saves the instance's direction: mission, vision and top-level
// outcomes (BI-916216E7; spec docs/superpowers/specs/2026-10-28-instance-direction-design.md).
//
// An ordinary owner action, the same authority as the rest of the business
// context form (an admin session). It is the only write path for instance
// outcomes: no MCP tool and no agent writes them. After the save, Block 0 is
// re-rendered so every coworker reads the new direction on its next turn.
// Domain errors are returned as values, never thrown (use-server rule).

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { applyMissionPrompt } from "@/lib/onboarding/apply-mission-prompt";
import {
  loadOrganizationDirection,
  sanitizeDirectionInput,
  saveOrganizationDirection,
  type DirectionReadClient,
  type DirectionSource,
  type DirectionWriteClient,
  type OrganizationDirection,
} from "@/lib/organization-direction/direction";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export async function saveDirectionAction(
  raw: unknown,
  source: DirectionSource,
): Promise<ActionResult<{ version: number; outcomes: OrganizationDirection["outcomes"] }>> {
  const session = await auth();
  const user = session?.user as { id?: string; type?: string } | undefined;
  if (!user?.id || user.type !== "admin") return err("Only the organization's owner can change its direction.");

  const parsed = sanitizeDirectionInput(raw);
  if (!parsed.ok) return parsed;

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return err("Set up your organization first.");

  const { version } = await saveOrganizationDirection(prisma as unknown as DirectionWriteClient, {
    organizationId: org.id,
    direction: parsed.data,
    changedByUserId: user.id,
    source: source === "setup" ? "setup" : "settings",
  });
  const saved = await loadOrganizationDirection(prisma as unknown as DirectionReadClient, org.id);

  // Fail-open: the direction is saved; a prompt-store hiccup only delays when
  // coworkers see it (setup completion and the next save re-render it).
  await applyMissionPrompt({ mission: saved.mission, direction: saved, updatedBy: "owner" }).catch(() => null);
  revalidatePath("/storefront/settings/business");

  return ok({ version, outcomes: saved.outcomes });
}
