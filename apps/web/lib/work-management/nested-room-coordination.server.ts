import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { resolveHumanWorkroomAccess } from "./workroom-agent-access.server";
import { loadAncestorClosure, type RoomWorkforceDb } from "./room-workforce.server";
import { projectNestedRoomCoordination, type CoordinationActor, type NestedRoomCoordination } from "./nested-room-coordination";

type Reader = { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
export type RoomCoordinationDb = Pick<RoomWorkforceDb, "workroomRelation" | "workroomParticipant"> & {
  agent: Reader; platformRole: Reader; principal: Reader;
  user: { findUnique(args: unknown): Promise<unknown> };
};

function actorFrom(row: Record<string, unknown>): CoordinationActor | null {
  if (row.status !== "active" || (row.kind !== "human" && row.kind !== "agent")) return null;
  const aliases = Array.isArray(row.aliases) ? row.aliases as Array<Record<string, unknown>> : [];
  const agentIds = [...new Set(aliases.filter(alias => alias.aliasType === "agent")
    .map(alias => coworkerAuthorityAgentId(String(alias.aliasValue))))];
  return { principalId: String(row.id), displayName: String(row.displayName),
    kind: row.kind === "human" ? "person" : "agent", agentId: agentIds.length === 1 ? agentIds[0]! : null };
}

/** Reads only an admitted lineage; this projection neither sends a notification nor grants access. */
export async function loadNestedRoomCoordination(db: RoomCoordinationDb, input: {
  roomId: string; canReadRoom: (roomId: string) => Promise<boolean>;
}): Promise<NestedRoomCoordination> {
  if (!await input.canReadRoom(input.roomId)) return { delegations: [], escalation: {
    state: "setup-required", reason: "incomplete-responsibility-lineage", steps: [],
  } };
  const { roomIds, edges, unresolvedRoomIds } = await loadAncestorClosure(db, input.roomId, input.canReadRoom);
  if (unresolvedRoomIds.length) return { delegations: [], escalation: {
    state: "setup-required", reason: "incomplete-responsibility-lineage", steps: [],
  } };
  const participants = await db.workroomParticipant.findMany({
    where: { workroomId: { in: roomIds }, lifecycle: "active", roles: { has: "coordinator" } },
    select: { workroomId: true, roles: true, principal: { select: {
      id: true, displayName: true, kind: true, status: true,
      aliases: { where: { aliasType: "agent", issuer: "" }, select: { aliasType: true, aliasValue: true } },
    } } }, take: 1001,
  });
  if (participants.length > 1000) return { delegations: [], escalation: {
    state: "setup-required", reason: "coordinator-read-incomplete", steps: [],
  } };
  const rooms = roomIds.map(roomId => ({ roomId, coordinators: participants
    .filter(row => row.workroomId === roomId && Array.isArray(row.roles) && row.roles.includes("coordinator"))
    .flatMap(row => { const actor = actorFrom(row.principal as Record<string, unknown>); return actor ? [actor] : []; }) }));
  // Recorded human coordinators need no agent-registry or role lookup.
  const preliminary = projectNestedRoomCoordination({ roomId: input.roomId, rooms, edges, agents: [], humanRoles: [] });
  if (preliminary.escalation.state === "resolved" || preliminary.escalation.reason !== "agent-not-recorded") return preliminary;
  const agentRows = await db.agent.findMany({ where: { archived: false, status: "active" },
    select: { agentId: true, displayName: true, escalatesTo: true }, take: 1001 });
  if (agentRows.length > 1000) return { delegations: preliminary.delegations, escalation: {
    state: "setup-required", reason: "agent-read-incomplete", steps: preliminary.escalation.steps,
  } };
  const agents = agentRows.map(row => ({ agentId: String(row.agentId), displayName: String(row.displayName),
    escalatesTo: typeof row.escalatesTo === "string" ? row.escalatesTo : null }));
  const context = { roomId: input.roomId, rooms, edges, agents };
  const projected = projectNestedRoomCoordination({ ...context, humanRoles: [] });
  if (projected.escalation.state === "resolved" || projected.escalation.reason !== "human-role-not-recorded"
    || !projected.escalation.targetRef) return projected;
  const roles = await db.platformRole.findMany({ where: { roleId: projected.escalation.targetRef },
    select: { roleId: true, name: true, users: { where: { user: { isActive: true } },
      select: { userId: true }, take: 101 } }, take: 2 });
  const role = roles.length === 1 ? roles[0] : null;
  const bindings = role && Array.isArray(role.users) ? role.users as Array<{ userId: string }> : [];
  if (!role || bindings.length > 100) return projected;
  const activeUsers: string[] = [];
  for (const binding of bindings) {
    const user = await currentUserContext(binding.userId, db as never);
    if (user?.platformRoles?.includes(String(role.roleId))) activeUsers.push(binding.userId);
  }
  const humans = activeUsers.length ? await db.principal.findMany({ where: { kind: "human", status: "active",
    aliases: { some: { aliasType: "user", issuer: "", aliasValue: { in: activeUsers } } } },
    select: { id: true, kind: true, status: true, displayName: true }, take: 101 }) : [];
  return projectNestedRoomCoordination({ ...context, humanRoles: [{ roleId: String(role.roleId),
    displayName: String(role.name), holders: humans.flatMap(row => { const actor = actorFrom(row); return actor ? [actor] : []; }) }] });
}

/** Internal drive effect over its existing database authority; never an external access resolver. */
export async function resolveNestedRoomStallRecipient(db: RoomCoordinationDb & { principalAlias: Reader },
  input: { roomId: string },
): Promise<string | null> {
  const coordination = await loadNestedRoomCoordination(db, { roomId: input.roomId, canReadRoom: async () => true });
  if (coordination.escalation.state !== "resolved") return null;
  const terminal = coordination.escalation.steps.at(-1);
  if (terminal?.kind !== "human") return null;
  const aliases = await db.principalAlias.findMany({ where: { principalId: terminal.ref, aliasType: "user", issuer: "",
    principal: { kind: "human", status: "active" } }, select: { aliasValue: true }, take: 2 });
  if (aliases.length !== 1 || typeof aliases[0]?.aliasValue !== "string") return null;
  const userId = aliases[0].aliasValue;
  const user = await currentUserContext(userId, db as never);
  if (!user) return null;
  const role = coordination.escalation.steps.filter(step => step.kind === "human-role").at(-1);
  if (role && !user.platformRoles?.includes(role.ref)) return null;
  const access = await resolveHumanWorkroomAccess({ userId, workroomId: input.roomId, requested: "content" }, db as never);
  if (access.decision.level !== "content") return null;
  return userId;
}
