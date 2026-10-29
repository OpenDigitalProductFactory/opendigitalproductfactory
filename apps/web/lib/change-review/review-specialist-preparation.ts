import { splitUnifiedDiffByFile } from "@/lib/build/private-paths";
import { reviewWorkroomIsOpen, resolveLiveReviewSpecialists, type LiveReviewSpecialistSelection } from "./live-specialist-selection";
import { resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { markedStageKeys, readStoredDriveMarking } from "@dpf/validators/workroom/marking";

type Principal = { aliases: Array<{ aliasValue: string }> } | null;
type Room = { id: string; capsuleId: string; status: string; archivedAt: Date | null; scopeClaims: unknown; workspaceState: unknown; featureBuildId: string | null;
  createdByPrincipal: Principal; participants: Array<{ principal: Principal }> };
type PreparationDb = { workroom: { findUnique(args: unknown): Promise<Room | null> };
  agent: Parameters<typeof resolveLiveReviewSpecialists>[0]["db"]["agent"];
  taskRun: { findMany(args: unknown): Promise<Array<{ initiatingAgentId: string | null; currentAgentId: string | null }>> } };
type PreparationInput = { userId: string; capsuleId: string; actorAgentId: string | null; changedFiles: readonly string[]; artifact?: string };
type PreparationDeps = { db: PreparationDb; authorize(input: PreparationInput & { workroomId: string }): Promise<boolean> };
const aliases = { select: { aliases: { where: { aliasType: "agent", issuer: "" }, select: { aliasValue: true } } } };

/** Read the pinned policy and authoritative marking; never invent a stage to qualify a review. */
function currentStageProfessions(room: Room): readonly string[] {
  const shape = resolveWorkShapeClaim(room.scopeClaims);
  if (!shape) throw new Error("A resolved Workroom shape is required to prepare specialists.");
  const state = room.workspaceState as { workroomDrive?: { stageKey?: unknown; marking?: unknown } } | null;
  const drive = state?.workroomDrive;
  if (!drive || (drive.marking === undefined && !shape.stages.some(stage => stage.key === drive.stageKey))) {
    throw new Error("A recorded current Workroom stage is required to prepare specialists.");
  }
  // Null cycle means observation only: do not start a fresh run after a concluded marking.
  const read = readStoredDriveMarking(room.workspaceState, shape, null);
  if (!read.ok) throw new Error("The Workroom stage marking is unreadable; specialist preparation remains outstanding.");
  const active = new Set(markedStageKeys(shape, read.data.marking));
  if (!active.size) throw new Error("No active Workroom stage is available to prepare specialists.");
  return shape.stages.filter(stage => active.has(stage.key)).flatMap(stage => stage.requiredProfessions ?? []);
}

/** Required crafts and author identities are resolved on the server, never supplied by a review caller. */
export async function prepareWorkroomReviewSpecialists(input: PreparationInput, deps?: PreparationDeps): Promise<LiveReviewSpecialistSelection> {
  const db = deps?.db ?? (await import("@dpf/db")).prisma;
  const room = await db.workroom.findUnique({ where: { capsuleId: input.capsuleId }, select: { id: true, capsuleId: true, status: true, archivedAt: true, scopeClaims: true, workspaceState: true, featureBuildId: true,
    createdByPrincipal: aliases, participants: { where: { lifecycle: "active", roles: { hasSome: ["contributor", "specialist"] } }, select: { principal: aliases } } } });
  if (!room || !reviewWorkroomIsOpen(room) || !await (deps?.authorize ?? authorize)({ ...input, workroomId: room.id })) throw new Error("Current Workroom action access is required to prepare specialists.");
  const requiredProfessions = currentStageProfessions(room);
  const authorAgentIds = [input.actorAgentId, ...room.createdByPrincipal?.aliases.map(row => row.aliasValue) ?? [],
    ...room.participants.flatMap(row => row.principal?.aliases.map(alias => alias.aliasValue) ?? [])].filter((id): id is string => Boolean(id));
  if (room.featureBuildId) {
    const tasks = await db.taskRun.findMany({ where: { buildId: room.featureBuildId, source: "build" }, select: { initiatingAgentId: true, currentAgentId: true } });
    authorAgentIds.push(...tasks.flatMap(row => [row.initiatingAgentId, row.currentAgentId]).filter((id): id is string => Boolean(id)));
  }
  return resolveLiveReviewSpecialists({ userId: input.userId, capsuleId: room.capsuleId, changedFiles: [...new Set([...input.changedFiles, ...splitUnifiedDiffByFile(input.artifact ?? "").blocks.flatMap(block => block.paths)])], authorAgentIds,
    requiredProfessions, db });
}

async function authorize(input: PreparationInput & { workroomId: string }): Promise<boolean> {
  const { resolveAgentWorkroomAccess, resolveHumanWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
  const access = input.actorAgentId ? await resolveAgentWorkroomAccess({ userId: input.userId, agentId: input.actorAgentId, workroomId: input.workroomId, requested: "action" })
    : await resolveHumanWorkroomAccess({ userId: input.userId, workroomId: input.workroomId, requested: "action" });
  return access.decision.level === "action";
}
