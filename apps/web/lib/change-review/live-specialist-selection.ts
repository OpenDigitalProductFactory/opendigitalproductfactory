import { ACUMEN_ROOM_SHAPES } from "@/lib/work-management/acumen-room-shapes";
import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { deriveImpactedAcumens } from "@/lib/decision-perspective/acumen-impact";
import { PROFESSION_REGISTRY, findProfessionFamilyForAgentIdentity } from "@/lib/decision-perspective/resolve-profession-profile";
import { selectableCoworkerIdentityRefs } from "@/lib/coworker-record/selectable-coworker";
import { z } from "zod";

export type LiveReviewSpecialist = { professionKey: string; agentId: string; displayName: string };
export type LiveReviewSpecialistSelection = {
  schemaVersion: 1;
  userId: string;
  capsuleId: string;
  registryVersion: string;
  authorAgentIds: string[];
  requiredProfessions: string[];
  specialists: LiveReviewSpecialist[];
  unavailableProfessions: string[];
};
const professionKey = z.string().refine(key => PROFESSION_REGISTRY.families.some(family => family.professionKey === key), "Expected a registered profession");
export const liveReviewSpecialistSelectionSchema = z.object({
  schemaVersion: z.literal(1), userId: z.string().min(1), capsuleId: z.string().min(1), registryVersion: z.string().min(1),
  authorAgentIds: z.array(z.string().min(1)).max(1000),
  requiredProfessions: z.array(professionKey).max(PROFESSION_REGISTRY.families.length),
  specialists: z.array(z.object({ professionKey, agentId: z.string().min(1), displayName: z.string().min(1) }).strict()).max(PROFESSION_REGISTRY.families.length),
  unavailableProfessions: z.array(professionKey).max(PROFESSION_REGISTRY.families.length),
}).strict().superRefine((selection, ctx) => {
  const assigned = [...selection.specialists.map(row => row.professionKey), ...selection.unavailableProfessions];
  const required = new Set(selection.requiredProfessions);
  const authors = new Set(selection.authorAgentIds.map(id => selectableCoworkerIdentityRefs(id).canonicalAgentId));
  if (required.size !== selection.requiredProfessions.length || new Set(assigned).size !== assigned.length
    || assigned.length !== required.size || assigned.some(key => !required.has(key))
    || new Set(selection.specialists.map(row => row.agentId)).size !== selection.specialists.length
    || selection.specialists.some(row => authors.has(selectableCoworkerIdentityRefs(row.agentId).canonicalAgentId))) {
    ctx.addIssue({ code: "custom", message: "Specialist selection must account for every required profession once and exclude the author" });
  }
});
type AgentRow = { agentId: string; name: string | null; slugId: string | null; status: string; archived: boolean; lifecycleStage: string };
type SelectionDb = { agent: { findMany(args: unknown): Promise<AgentRow[]> } };

/** Resolve once before immutable admission. Execution must not silently replace the saved selection. */
export async function resolveLiveReviewSpecialists(input: {
  userId: string;
  capsuleId: string;
  changedFiles: readonly string[];
  requiredProfessions?: readonly string[];
  authorAgentIds: readonly string[];
  db: SelectionDb;
}): Promise<LiveReviewSpecialistSelection> {
  const registered = new Set(PROFESSION_REGISTRY.families.map(family => family.professionKey));
  for (const profession of input.requiredProfessions ?? []) {
    if (!registered.has(profession)) throw new Error(`Required reviewer must name a registered profession: ${profession}`);
  }
  const required = new Set([...deriveImpactedAcumens(input.changedFiles), ...(input.requiredProfessions ?? [])]);
  const requiredProfessions = PROFESSION_REGISTRY.families.map(family => family.professionKey).filter(key => required.has(key));
  const authorAgentIds = [...new Set(input.authorAgentIds.map(id => selectableCoworkerIdentityRefs(id).canonicalAgentId))].sort();
  const selection: LiveReviewSpecialistSelection = { schemaVersion: 1, userId: input.userId, capsuleId: input.capsuleId, registryVersion: PROFESSION_REGISTRY.version, authorAgentIds, requiredProfessions, specialists: [], unavailableProfessions: [] };
  if (!requiredProfessions.length) return selection;
  const rows = await input.db.agent.findMany({ where: { status: "active", archived: false, lifecycleStage: "production" },
    select: { agentId: true, name: true, slugId: true, status: true, archived: true, lifecycleStage: true } });
  const eligible = rows.filter(row => row.status === "active" && !row.archived && row.lifecycleStage === "production");
  const byId = new Map(eligible.map(row => [row.agentId, row]));
  for (const professionKey of requiredProfessions) {
    const steward = ACUMEN_ROOM_SHAPES.find(shape => shape.professionKey === professionKey)?.coworkerAgentId;
    const stewardId = steward ? selectableCoworkerIdentityRefs(steward).canonicalAgentId : null;
    const family = PROFESSION_REGISTRY.families.find(family => family.professionKey === professionKey)!;
    const candidates = eligible.filter(row => {
      const pair = selectableCoworkerIdentityRefs(row.agentId);
      if ((stewardId && pair.canonicalAgentId !== stewardId) || authorAgentIds.includes(pair.canonicalAgentId) || !byId.has(pair.canonicalAgentId) || !byId.has(pair.runtimeAgentId)) return false;
      return [pair.canonicalAgentId, pair.runtimeAgentId].every(id => {
        const member = byId.get(id);
        return member && findProfessionFamilyForAgentIdentity(member)?.professionKey === professionKey;
      });
    }).sort((left, right) => {
      const rank = (row: AgentRow) => family.roles.findIndex(role => [row.name, row.slugId].includes(role));
      return rank(left) - rank(right) || left.agentId.localeCompare(right.agentId, "en");
    });
    const candidate = candidates[0];
    if (candidate) selection.specialists.push({ professionKey, agentId: selectableCoworkerIdentityRefs(candidate.agentId).canonicalAgentId, displayName: PROFESSION_REGISTRY.families.find(family => family.professionKey === professionKey)!.label });
    else selection.unavailableProfessions.push(professionKey);
  }
  return selection;
}


/** Recheck saved providers; new candidates never replace a paid-for branch. */
export async function isLiveReviewSpecialistSelectionCurrent(selection: LiveReviewSpecialistSelection, db: SelectionDb): Promise<boolean> {
  if (!liveReviewSpecialistSelectionSchema.safeParse(selection).success || selection.unavailableProfessions.length) return false;
  const ids = [...new Set(selection.specialists.flatMap(row => Object.values(selectableCoworkerIdentityRefs(row.agentId))))];
  const rows = await db.agent.findMany({ where: { agentId: { in: ids } }, select: { agentId: true, name: true, slugId: true, status: true, archived: true, lifecycleStage: true } });
  const byId = new Map(rows.map(row => [row.agentId, row]));
  return selection.specialists.every(specialist => Object.values(selectableCoworkerIdentityRefs(specialist.agentId)).every(id => {
    const row = byId.get(id);
    return row?.status === "active" && !row.archived && row.lifecycleStage === "production"
      && findProfessionFamilyForAgentIdentity(row)?.professionKey === specialist.professionKey;
  }));
}

/** Saved identity is data, never authority. No membership or grant is supplied here. */
export async function verifyLiveReviewSpecialistSelection(selection: LiveReviewSpecialistSelection): Promise<boolean> {
  const { prisma } = await import("@dpf/db");
  const { resolveHumanWorkroomAccess, resolveAgentWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
  const { getAgentToolGrantsAsync } = await import("@/lib/tak/agent-grants");
  if (!await isLiveReviewSpecialistSelectionCurrent(selection, prisma)) return false;
  const room = await prisma.workroom.findUnique({ where: { capsuleId: selection.capsuleId }, select: { id: true, archivedAt: true } });
  if (!room || room.archivedAt || (await resolveHumanWorkroomAccess({ userId: selection.userId, workroomId: room.id, requested: "content" })).decision.level !== "content") return false;
  for (const specialist of selection.specialists) {
    for (const agentId of new Set(Object.values(selectableCoworkerIdentityRefs(specialist.agentId)))) {
      if (!(await getAgentToolGrantsAsync(agentId)).includes("registry_read")
        || (await resolveAgentWorkroomAccess({ userId: selection.userId, agentId, workroomId: room.id, requested: "content" })).decision.level !== "content") return false;
    }
  }
  return true;
}


export function liveReviewSpecialistSelectionDigest(selection: LiveReviewSpecialistSelection): string {
  return createHash("sha256").update(canonicalJson(liveReviewSpecialistSelectionSchema.parse(selection))).digest("hex");
}
