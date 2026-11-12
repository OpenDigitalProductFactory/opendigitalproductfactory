// BI-31C1FDEC (agent dialog broker B2, spec 2026-10-27 §6): an addressed room
// message wakes its in-platform recipient within seconds, through one durable
// event and a server-side path, whatever client posted it.
//
//   writer ── commit message (addressing.wake = pending) ── publish ── room/message.posted
//   dispatcher ── plan (executor, hop limit, budget) ── room/wake.requested per recipient
//   runner ── one-shot reply task ── executeScheduledAgentTask (no cron tick between)
//   sweeper ── re-publishes any wake still pending after an outage
//
// The message store stays the record: every wake only makes a recipient look
// sooner, and read_room_messages returns everything a skipped wake would have.
import type { Prisma } from "@dpf/db";

import { APPROVED_EXTERNAL_ROLES } from "@/lib/auth/oauth-identity-binding";
import {
  COWORKER_READ_BASELINE_GRANTS,
  grantsSatisfyRequirement,
  persistedAgentToolGrants,
  TOOL_TO_GRANTS,
} from "@/lib/tak/agent-grants";

import {
  buildRoomReplyPrompt,
  computeRoomMessageHop,
  isExternalRoomExecutor,
  oneShotCronAt,
  parseAddressedTo,
  planRoomWake,
  readRoomMessageAddressing,
  ROOM_POST_GRANT,
  roomReplyTaskId,
  roomWakeEventId,
  roomWakeWindow,
  type RoomAddressRole,
  type RoomMessageAddressing,
  type RoomWakePlan,
} from "./room-message-addressing";
import { encodeRoomMessageCursor } from "./room-message-cursor";

export const ROOM_MESSAGE_POSTED_EVENT = "room/message.posted";
export const ROOM_WAKE_REQUESTED_EVENT = "room/wake.requested";
const PENDING_SWEEP_GRACE_MS = 30_000;
const PENDING_SWEEP_HORIZON_MS = 24 * 60 * 60_000;

export type RoomMessagePostedEvent = { messageId: string };
export type RoomWakeRequestedEvent = {
  workItemId: string;
  agentId: string;
  /** `<workItemId>:<agentId>`: the run's concurrency lane (the job engine keys on a plain path). */
  laneKey: string;
  actingUserId: string;
  caseKey: string | null;
  title: string;
  messageId: string;
  closesAt: string;
};

type JobsSend = (event: { name: string; id: string; data: Record<string, unknown> }) => Promise<unknown>;

// Structural: the server passes prisma; tests pass a fake with the same calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface RoomWakeDeps {
  db: Db;
  send: JobsSend;
  now?: () => Date;
}

async function defaultDeps(): Promise<RoomWakeDeps> {
  const [{ prisma }, { jobs }] = await Promise.all([import("@dpf/db"), import("@/lib/jobs")]);
  return { db: prisma, send: (event) => jobs.send(event) };
}

function clock(deps: RoomWakeDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

async function writeWakeState(
  deps: RoomWakeDeps,
  message: { id: string; structuredPayload: unknown },
  addressing: RoomMessageAddressing,
  wake: RoomMessageAddressing["wake"],
): Promise<void> {
  const payload = payloadRecord(message.structuredPayload);
  await deps.db.workItemMessage.update({
    where: { id: message.id },
    data: { structuredPayload: { ...payload, addressing: { ...addressing, wake } } as Prisma.InputJsonValue },
  });
}

export type PreparedRoomAddressing =
  | { refused: false; build: (mentionedAgentIds: string[]) => RoomMessageAddressing | null }
  | { refused: true; message: string };

/**
 * Resolve a caller's addressedTo list (agent ids, GAIDs, roles, session refs)
 * and the sender's GAID and hop count, before the message is written. The
 * returned builder adds the body's @mentions, which only the writer parses.
 */
export async function prepareRoomAddressing(
  args: {
    workItemId: string;
    sender: { type: "user" | "agent"; id: string };
    actingUserId: string;
    addressedTo: unknown;
  },
  depsIn?: Pick<RoomWakeDeps, "db" | "now">,
): Promise<PreparedRoomAddressing> {
  const db = depsIn?.db ?? (await import("@dpf/db")).prisma;
  const parsed = parseAddressedTo(args.addressedTo);
  if (parsed.invalid.length > 0) {
    return { refused: true, message: `addressedTo entries must be agent ids, GAIDs, "coordinator" or "accountable": ${parsed.invalid.join(", ")}.` };
  }
  const { getAgentGaidMap, getAgentIdsForGaids } = await import("@/lib/identity/principal-linking");
  const fromGaids = await getAgentIdsForGaids(parsed.gaids, db);
  const unknownGaids = parsed.gaids.filter((gaid) => !fromGaids.has(gaid));
  if (unknownGaids.length > 0) {
    return { refused: true, message: `No coworker on this installation has GAID ${unknownGaids.join(", ")}. A remote GAID is provenance only until the estate namespace exists.` };
  }
  const explicitAgents = [...parsed.agentRefs, ...fromGaids.values()];
  if (parsed.agentRefs.length > 0) {
    const found: Array<{ agentId: string }> = await db.agent.findMany({
      where: { agentId: { in: parsed.agentRefs } },
      select: { agentId: true },
    });
    const missing = parsed.agentRefs.filter((id) => !found.some((row) => row.agentId === id));
    if (missing.length > 0) return { refused: true, message: `No coworker ${missing.join(", ")}.` };
  }
  const recentRows: Array<{ structuredPayload: unknown }> = args.sender.type === "agent"
    ? await db.workItemMessage.findMany({
      where: { workItemId: args.workItemId, structuredPayload: { path: ["addressing", "agents"], array_contains: [args.sender.id] } },
      orderBy: [{ createdAt: "desc" }, { messageId: "desc" }],
      take: 1,
      select: { structuredPayload: true },
    })
    : [];
  const hop = computeRoomMessageHop({
    senderType: args.sender.type,
    senderAgentId: args.sender.type === "agent" ? args.sender.id : null,
    recent: recentRows.map((row) => ({ addressing: readRoomMessageAddressing(row.structuredPayload) })),
  });
  const senderGaid = args.sender.type === "agent"
    ? (await getAgentGaidMap([args.sender.id], db)).get(args.sender.id) ?? null
    : null;
  const at = (depsIn?.now ? depsIn.now() : new Date()).toISOString();
  return {
    refused: false,
    build: (mentionedAgentIds) => {
      const agents = [...new Set([...explicitAgents, ...mentionedAgentIds])];
      if (agents.length === 0 && parsed.roles.length === 0) return null;
      return {
        agents,
        roles: parsed.roles,
        sessions: parsed.sessions,
        hop,
        senderGaid,
        actingUserId: args.actingUserId,
        wake: { state: "pending", at },
      };
    },
  };
}

/**
 * Send room/message.posted for a committed addressed message. Idempotent on
 * the message id, so the writer and the sweeper can both call it. A failed
 * send is left for the sweeper; it never fails the post.
 */
export async function publishRoomMessagePosted(
  messageId: string,
  depsIn?: RoomWakeDeps,
  attempt?: string,
): Promise<boolean> {
  const deps = depsIn ?? await defaultDeps();
  const message = await deps.db.workItemMessage.findUnique({
    where: { messageId },
    select: { id: true, structuredPayload: true },
  });
  const addressing = message ? readRoomMessageAddressing(message.structuredPayload) : null;
  if (!message || !addressing || addressing.wake.state !== "pending") return false;
  const id = `room-message-posted:${messageId}${attempt ? `:${attempt}` : ""}`;
  try {
    await deps.send({ name: ROOM_MESSAGE_POSTED_EVENT, id, data: { messageId } });
  } catch (error) {
    console.warn("[room-wake] room/message.posted not sent; the sweeper retries it", { messageId }, error);
    return false;
  }
  // The wake stays pending until the dispatcher decides it, so this writer can
  // never overwrite a decision; the sweeper re-sends anything still pending.
  return true;
}

// A work item can carry several Workrooms over its life, and a room can reach
// status "archived" or "abandoned" without archivedAt being set. Only a live room
// speaks for the item, so a closed room's old executor never holds a wake (seen
// live on BI-926A7E90, Nov 2026). When several rooms are live, one an external
// executor is working wins, so that executor's work is never joined by a
// platform coworker; otherwise the most recently updated room does.
const CLOSED_ROOM_STATUSES = ["abandoned", "archived"];

type RoomRow = { id: string; capsuleId: string; executorKind: string | null; executorRef: string | null };

async function loadRoomForWorkItem(deps: RoomWakeDeps, workItemId: string) {
  const select = { id: true, capsuleId: true, executorKind: true, executorRef: true };
  const liveRoomOf = async (id: string): Promise<RoomRow | null> => {
    const rooms: RoomRow[] = await deps.db.workroom.findMany({
      where: { workItemId: id, archivedAt: null, status: { notIn: CLOSED_ROOM_STATUSES } },
      orderBy: { updatedAt: "desc" },
      select,
    });
    return rooms.find((r) => isExternalRoomExecutor(r.executorKind)) ?? rooms[0] ?? null;
  };
  const own = await liveRoomOf(workItemId);
  if (own) return own;
  const item = await deps.db.workItem.findUnique({ where: { id: workItemId }, select: { parentItemId: true } });
  if (!item?.parentItemId) return null;
  return liveRoomOf(item.parentItemId);
}

/** Agent ids of the room's active participants holding each role. */
async function loadRoleAgents(
  deps: RoomWakeDeps,
  workroomId: string | null,
): Promise<Partial<Record<RoomAddressRole | "coordinator", string[]>>> {
  if (!workroomId) return {};
  const rows: Array<{ principalId: string; roles: string[] }> = await deps.db.workroomParticipant.findMany({
    where: { workroomId, lifecycle: "active" },
    select: { principalId: true, roles: true },
  });
  if (rows.length === 0) return {};
  const aliases: Array<{ principalId: string; aliasValue: string }> = await deps.db.principalAlias.findMany({
    where: { principalId: { in: rows.map((r) => r.principalId) }, aliasType: "agent" },
    select: { principalId: true, aliasValue: true },
  });
  const agentOf = new Map(aliases.map((a) => [a.principalId, a.aliasValue]));
  const out: Partial<Record<RoomAddressRole, string[]>> = {};
  for (const role of ["coordinator", "accountable"] as const) {
    out[role] = rows
      .filter((r) => r.roles.includes(role))
      .map((r) => agentOf.get(r.principalId))
      .filter((id): id is string => Boolean(id));
  }
  return out;
}

async function countWakesLastHour(deps: RoomWakeDeps, workItemId: string, now: Date): Promise<number> {
  return deps.db.workItemMessage.count({
    where: {
      workItemId,
      createdAt: { gte: new Date(now.getTime() - 60 * 60_000) },
      structuredPayload: { path: ["addressing", "wake", "state"], equals: "woken" },
    },
  });
}

/** One visible note in the room when the exchange is stopped or paused, so the room shows why. */
async function postRoomWakeNotice(deps: RoomWakeDeps, workItemId: string, plan: RoomWakePlan, now: Date) {
  const kind = plan.kind === "wake" ? "hop-limit" : plan.state;
  const recent = await deps.db.workItemMessage.count({
    where: {
      workItemId,
      messageType: "room-wake-notice",
      createdAt: { gte: new Date(now.getTime() - 60 * 60_000) },
      structuredPayload: { path: ["roomWakeNotice", "kind"], equals: kind },
      // One cannot-reply notice per hour for the same coworkers, not one per room.
      ...(plan.kind === "refuse" ? { body: plan.detail } : {}),
    },
  });
  if (recent > 0) return;
  await deps.db.workItemMessage.create({
    data: {
      workItemId,
      senderType: "system",
      messageType: "room-wake-notice",
      body: plan.detail,
      channel: "in-app",
      structuredPayload: { roomWakeNotice: { kind, at: now.toISOString() } },
    },
  });
}

/**
 * The candidates that cannot post in a room: their stored grants (less
 * revocations) plus the coworker read baseline do not satisfy post_room_message.
 * The same rule the tool surface applies, so a coworker woken here can answer.
 * An agent with no record cannot post either.
 */
async function agentsWithoutRoomPost(deps: RoomWakeDeps, candidates: string[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const required = TOOL_TO_GRANTS.post_room_message ?? [ROOM_POST_GRANT];
  const rows: Array<{ agentId: string; toolGrants: Array<{ grantKey: string }>; toolGrantRevocations: Array<{ grantKey: string }> }> =
    await deps.db.agent.findMany({
      where: { agentId: { in: candidates } },
      select: { agentId: true, toolGrants: { select: { grantKey: true } }, toolGrantRevocations: { select: { grantKey: true } } },
    });
  const able = new Set(
    rows
      .filter((row) => grantsSatisfyRequirement(required, [...persistedAgentToolGrants(row), ...COWORKER_READ_BASELINE_GRANTS]))
      .map((row) => row.agentId),
  );
  return new Set(candidates.filter((id) => !able.has(id)));
}

export type RoomMessageDispatchResult ={ messageId: string; plan: RoomWakePlan["kind"] | "skipped"; woken: string[] };

/** Decide and send the wakes for one posted message. Re-delivery is a no-op once decided. */
export async function dispatchRoomMessage(messageId: string, depsIn?: RoomWakeDeps): Promise<RoomMessageDispatchResult> {
  const deps = depsIn ?? await defaultDeps();
  const message = await deps.db.workItemMessage.findUnique({
    where: { messageId },
    select: { id: true, messageId: true, workItemId: true, senderAgentId: true, structuredPayload: true },
  });
  const addressing = message ? readRoomMessageAddressing(message.structuredPayload) : null;
  if (!message || !addressing || addressing.wake.state !== "pending") {
    return { messageId, plan: "skipped", woken: [] };
  }
  const now = clock(deps);
  const room = await loadRoomForWorkItem(deps, message.workItemId);
  const roleAgents = await loadRoleAgents(deps, room?.id ?? null);
  const externalAgentIds = new Set<string>(APPROVED_EXTERNAL_ROLES);
  const candidates = [
    ...addressing.agents,
    ...addressing.roles.flatMap((role) => roleAgents[role] ?? []),
    ...(roleAgents.coordinator ?? []),
  ].filter((id, i, all) => !externalAgentIds.has(id) && all.indexOf(id) === i);
  const plan = planRoomWake({
    addressing,
    senderAgentId: message.senderAgentId ?? null,
    roleAgents,
    coordinatorAgentIds: roleAgents.coordinator ?? [],
    executor: room ? { kind: room.executorKind ?? null, ref: room.executorRef ?? null } : null,
    wakesLastHour: await countWakesLastHour(deps, message.workItemId, now),
    externalAgentIds,
    cannotPost: await agentsWithoutRoomPost(deps, candidates),
  });

  const woken = plan.kind === "wake" ? plan.agents : [];
  await writeWakeState(deps, message, addressing, {
    state: plan.state,
    at: now.toISOString(),
    detail: plan.detail,
    ...(woken.length ? { woken } : {}),
  });
  // A person who addressed a coworker reads the room, not the wake state, so a
  // refused wake is said in the room as the stopped and paused ones are.
  if (plan.kind === "pause" || plan.kind === "refuse" || (plan.kind === "wake" && plan.reason === "hop-limit") || (plan.kind === "none" && addressing.hop > 0)) {
    await postRoomWakeNotice(deps, message.workItemId, plan, now);
  }
  if (plan.kind !== "wake") return { messageId, plan: plan.kind, woken };

  const payload = payloadRecord(message.structuredPayload);
  const workroom = payloadRecord(payload.workroom);
  const item = await deps.db.workItem.findUnique({ where: { id: message.workItemId }, select: { title: true } });
  const { closesAt } = roomWakeWindow(now);
  for (const agentId of woken) {
    const data: RoomWakeRequestedEvent = {
      workItemId: message.workItemId,
      agentId,
      laneKey: `${message.workItemId}:${agentId}`,
      actingUserId: addressing.actingUserId,
      caseKey: typeof workroom.caseKey === "string" ? workroom.caseKey : null,
      title: item?.title ?? "Work Room",
      messageId,
      closesAt: closesAt.toISOString(),
    };
    await deps.send({ name: ROOM_WAKE_REQUESTED_EVENT, id: roomWakeEventId(message.workItemId, agentId, now), data });
  }
  return { messageId, plan: plan.kind, woken };
}

export const AGENT_TASK_RUN_NOW_EVENT = "agent/task.run-now";

export type RoomWakeRunResult =
  | { outcome: "requested"; taskId: string }
  | { outcome: "skipped"; reason: string };

/**
 * Wake one coworker for one room: schedule a one-shot reply task under the
 * poster's authority and ask agent/task-run-now to run it at once. That runs it
 * through the scheduled-task executor the drive uses, so the drive's grants,
 * funding and quiescence gates apply; a drain leaves it due for the cron.
 */
export async function runRoomWake(event: RoomWakeRequestedEvent, depsIn?: RoomWakeDeps): Promise<RoomWakeRunResult> {
  const deps = depsIn ?? await defaultDeps();
  if (!event.caseKey) return { outcome: "skipped", reason: "The message has no room case key to reply in." };
  const [agent, owner] = await Promise.all([
    deps.db.agent.findUnique({ where: { agentId: event.agentId }, select: { agentId: true, status: true } }),
    deps.db.user.findUnique({ where: { id: event.actingUserId }, select: { id: true } }),
  ]);
  if (!agent) return { outcome: "skipped", reason: `No coworker ${event.agentId}.` };
  if (agent.status && agent.status !== "active") return { outcome: "skipped", reason: `${event.agentId} is ${agent.status}.` };
  if (!owner) return { outcome: "skipped", reason: "The poster's account no longer exists." };

  const lastOwn = await deps.db.workItemMessage.findFirst({
    where: { workItemId: event.workItemId, senderAgentId: event.agentId },
    orderBy: [{ createdAt: "desc" }, { messageId: "desc" }],
    select: { createdAt: true, messageId: true },
  });
  const now = clock(deps);
  const taskId = roomReplyTaskId(event.workItemId, event.agentId);
  const fields = {
    agentId: event.agentId,
    title: `Reply in ${event.caseKey}`,
    prompt: buildRoomReplyPrompt({
      caseKey: event.caseKey,
      title: event.title,
      sinceCursor: lastOwn ? encodeRoomMessageCursor(lastOwn) : null,
    }),
    schedule: oneShotCronAt(now),
    ownerUserId: event.actingUserId,
    nextRunAt: now,
    isActive: true,
    taskConfig: { roomReply: { workItemId: event.workItemId, caseKey: event.caseKey, messageId: event.messageId } },
  };
  await deps.db.scheduledAgentTask.upsert({
    where: { taskId },
    create: { taskId, routeContext: `/workspace/cases/${event.caseKey}`, timezone: "UTC", ...fields },
    update: fields,
  });

  await deps.send({ name: AGENT_TASK_RUN_NOW_EVENT, id: `run-now:${taskId}:${now.getTime()}`, data: { taskId } });
  return { outcome: "requested", taskId };
}

/**
 * Re-publish addressed messages whose wake was never decided: the outbox half
 * of AC-3. A wake still pending this long after posting means the send failed
 * or the dispatcher never ran (a drain skipped it). Each sweep uses a fresh
 * event id, because the engine ignores a repeat of an id it already holds; the
 * dispatcher only acts on a pending wake, so a duplicate decides nothing twice.
 */
export async function sweepPendingRoomWakes(depsIn?: RoomWakeDeps): Promise<{ republished: number; pending: number }> {
  const deps = depsIn ?? await defaultDeps();
  const now = clock(deps);
  const rows: Array<{ messageId: string }> = await deps.db.workItemMessage.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - PENDING_SWEEP_HORIZON_MS), lte: new Date(now.getTime() - PENDING_SWEEP_GRACE_MS) },
      structuredPayload: { path: ["addressing", "wake", "state"], equals: "pending" },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { messageId: true },
  });
  let republished = 0;
  const sweepId = `sweep-${now.getTime()}`;
  for (const row of rows) if (await publishRoomMessagePosted(row.messageId, deps, sweepId)) republished += 1;
  return { republished, pending: rows.length };
}
