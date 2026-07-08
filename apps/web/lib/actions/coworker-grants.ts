"use server";

// EP-COWORKER-RT / WS2 (coworker-management-consolidation design,
// docs/superpowers/specs/2026-06-26-coworker-management-consolidation-design.md):
// per-coworker grant + skill editing on the record's Capabilities tab. The
// global /platform/ai/skills stays the catalog/observatory; per-coworker
// granting happens HERE, behind the same least-privilege framing the HRIS spec
// established.
//
// TWO id conventions, deliberately distinct (verified against schema.prisma):
//   • AgentToolGrant.agentId → Agent.id (the cuid). FK: references [id].
//       compound unique: @@unique([agentId, grantKey]) → key `agentId_grantKey`.
//   • SkillAssignment.agentId → the BUSINESS agentId string (e.g.
//       "build-specialist"), NOT the cuid. No FK to Agent; the skill runtime
//       (lib/skills/runtime.ts getSkillsForAgent) queries it by business id, and
//       the seed (packages/db/src/seed-skills.ts ALL_AGENT_IDS) writes business
//       ids. compound unique: @@unique([skillId, agentId]) → key `skillId_agentId`.
// The callers (record page) pass the correct id for each; parameter names below
// spell out which.
//
// Every mutating action is gated by `manage_platform` FIRST (the same capability
// the record page uses for canWrite and that saveAgentModelConfig — the canonical
// editable-on-record server action — requires), then revalidates the record route.

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  applyCoworkerToolGrant,
  removeCoworkerToolGrant,
} from "@/lib/tak/coworker-tool-grant-core";

/** Revalidate every path the coworker record renders under, after a mutation. */
function revalidateRecord(agentBusinessId: string, slugId?: string | null): void {
  // The record route is /platform/ai/agent/[agentId]; it resolves by agentId OR
  // slugId, so revalidate both spellings plus the directory that shows grant counts.
  revalidatePath(`/platform/ai/agent/${agentBusinessId}`);
  if (slugId && slugId !== agentBusinessId) {
    revalidatePath(`/platform/ai/agent/${slugId}`);
  }
  revalidatePath("/platform/ai");
}

// ─── Tool grants (AgentToolGrant, keyed by Agent.id cuid) ────────────────────

/**
 * Grant a tool-authority key to a coworker. Idempotent (upsert on the
 * agentId_grantKey unique). Rejects keys outside the closed grant vocabulary so
 * a typo never persists a row that authorizes nothing.
 *
 * @param agentCuid  Agent.id (the cuid primary key) — NOT the business agentId.
 * @param grantKey   one of knownGrantKeys() (e.g. "registry_read", "backlog_write").
 * @param slugId     optional, only used to widen revalidation to the slug route.
 */
export async function grantCoworkerTool(
  agentCuid: string,
  grantKey: string,
  agentBusinessId: string,
  slugId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { userId } = await requireCapability("manage_platform");

  const res = await applyCoworkerToolGrant(agentCuid, grantKey, userId);
  if (!res.ok) return res;

  revalidateRecord(agentBusinessId, slugId);
  return { ok: true };
}

/**
 * Revoke a tool-authority key from a coworker. No-throw when the grant is
 * absent (deleteMany returns count 0), so a double-click or stale UI is safe.
 *
 * @param agentCuid  Agent.id (the cuid primary key).
 * @param grantKey   the grant key to remove.
 */
export async function revokeCoworkerTool(
  agentCuid: string,
  grantKey: string,
  agentBusinessId: string,
  slugId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { userId } = await requireCapability("manage_platform");

  await removeCoworkerToolGrant(agentCuid, grantKey, userId);

  revalidateRecord(agentBusinessId, slugId);
  return { ok: true };
}

// ─── Catalog skills (SkillAssignment, keyed by business agentId) ─────────────

/**
 * Assign a catalog skill (a SkillDefinition) to a coworker. Idempotent on the
 * skillId_agentId unique. Validates the skillId exists in the catalog so the
 * assignment always resolves to a real SkillDefinition.
 *
 * @param agentBusinessId  the business agentId string (e.g. "build-specialist") —
 *                         this is what SkillAssignment.agentId stores.
 * @param skillId          SkillDefinition.skillId (business id, e.g. "code-runner").
 */
export async function grantCoworkerSkill(
  agentBusinessId: string,
  skillId: string,
  slugId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { userId } = await requireCapability("manage_platform");

  const skill = await prisma.skillDefinition.findUnique({
    where: { skillId },
    select: { skillId: true },
  });
  if (!skill) {
    return { ok: false, error: `Unknown skill: ${skillId}` };
  }

  await prisma.skillAssignment.upsert({
    where: { skillId_agentId: { skillId, agentId: agentBusinessId } },
    update: { enabled: true }, // re-enable if a prior assignment was disabled
    create: { skillId, agentId: agentBusinessId, enabled: true, assignedBy: userId },
  });

  revalidateRecord(agentBusinessId, slugId);
  return { ok: true };
}

/**
 * Unassign a catalog skill from a coworker. No-throw when absent.
 *
 * @param agentBusinessId  the business agentId string SkillAssignment.agentId stores.
 * @param skillId          SkillDefinition.skillId to remove.
 */
export async function revokeCoworkerSkill(
  agentBusinessId: string,
  skillId: string,
  slugId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireCapability("manage_platform");

  await prisma.skillAssignment.deleteMany({
    where: { skillId, agentId: agentBusinessId },
  });

  revalidateRecord(agentBusinessId, slugId);
  return { ok: true };
}
