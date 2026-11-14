import { prisma } from "@dpf/db";
import { createSseResponse } from "@/lib/sse/sse-stream";
import { mcpTaskNotificationBus } from "@/lib/mcp-task-notification-bus";
import { MCP_TASK_SELECT, toMcpTaskObject } from "./tasks-lifecycle";
import {
  decodeStreamEventId,
  encodeStreamEventId,
  mcpSubscriberKey,
  newStreamId,
} from "./room-resource";
import { ROOM_SUBSCRIPTION_TTL_MS, type RoomResourceAuth } from "./room-resources.server";
import { ROOM_REPLAY_OVERLAP_MS, type RoomStreamHandle } from "./room-update-fanout.server";

export type McpTaskStreamOwner = {
  tokenId: string;
  userId: string;
  /** Room lane (BI-ED52AB82): present on a credential with an acting coworker. */
  agentId?: string | null;
  oauthFamilyKey?: string | null;
  scope?: string;
  capability?: string;
  scopes?: readonly string[];
};

type RoomLane = {
  register: (handle: RoomStreamHandle) => () => void;
  replay: (handle: RoomStreamHandle, since: Date) => Promise<void>;
};

const STREAM_MAX_AGE_MS = 15 * 60_000;
/** Reconnect delay a client is asked to use after the server closes the connection. */
const STREAM_RETRY_MS = 3_000;

/**
 * Auth-bound Streamable HTTP GET lane (MCP 2025-11-25 basic/transports). It
 * carries notifications/tasks/status (BI-2014236E) and, for a credential with
 * an acting coworker, notifications/resources/updated for subscribed rooms
 * (BI-ED52AB82). Every frame has an id `<streamId>.<epochMs>`; a reconnect
 * with Last-Event-ID keeps its stream id and replays the room updates that
 * stream missed. Notifications are wake-ups only: TaskRun, tasks/get|list and
 * read_room_messages remain the durable reconciliation path.
 */
export async function openMcpTaskStatusStream(
  request: Request,
  owner: McpTaskStreamOwner,
  options: { rooms?: RoomLane | null; now?: () => Date } = {},
): Promise<Response> {
  const accept = request.headers.get("accept");
  if (accept && !accept.includes("text/event-stream") && !accept.includes("*/*")) {
    return new Response("Not Acceptable — GET requires text/event-stream", {
      status: 406,
      headers: { Accept: "text/event-stream" },
    });
  }
  const now = options.now ?? (() => new Date());

  const snapshots = await prisma.taskRun.findMany({
    where: {
      userId: owner.userId,
      source: "external-mcp",
      a2aMetadata: { path: ["apiTokenId"], equals: owner.tokenId },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: MCP_TASK_SELECT,
  });
  const notification = (task: Parameters<typeof toMcpTaskObject>[0]) => ({
    jsonrpc: "2.0" as const,
    method: "notifications/tasks/status" as const,
    params: toMcpTaskObject(task),
  });

  const resumed = decodeStreamEventId(request.headers.get("last-event-id"));
  const streamId = resumed?.streamId ?? newStreamId();
  // A resumed stream keeps its id, so its counter starts past anything the
  // earlier connection could have sent, keeping every id unique.
  let sequence = resumed ? now().getTime() % 1_000_000_000 : 0;
  const eventId = (ms: number) => encodeStreamEventId(streamId, ms, (sequence += 1));

  const rooms = options.rooms && owner.agentId ? options.rooms : null;
  const roomAuth: RoomResourceAuth | null = rooms && owner.agentId
    ? {
        tokenId: owner.tokenId,
        userId: owner.userId,
        agentId: owner.agentId,
        oauthFamilyKey: owner.oauthFamilyKey ?? null,
        scope: owner.scope ?? "read",
        capability: owner.capability ?? "read",
        scopes: owner.scopes ?? [],
      }
    : null;
  const subscriberKey = roomAuth ? mcpSubscriberKey(roomAuth) : null;
  if (subscriberKey) {
    // An open stream keeps its client's subscriptions alive; they lapse a day
    // after the client last subscribed or listened.
    const at = now();
    await prisma.mcpResourceSubscription.updateMany({
      where: { subscriberKey, expiresAt: { gt: at } },
      data: { expiresAt: new Date(at.getTime() + ROOM_SUBSCRIPTION_TTL_MS) },
    });
  }

  return createSseResponse({
    signal: request.signal,
    maxAgeMs: STREAM_MAX_AGE_MS,
    headers: { "MCP-Protocol-Version": "2025-11-25" },
    start: (stream) => {
      // Priming event: an id the client can resume from, and the retry delay
      // to use when the server closes the connection at max age.
      if (!stream.sendEvent({ id: eventId(now().getTime()), retry: STREAM_RETRY_MS })) return;
      // Durable replay closes commit→subscribe; live delivery is advisory.
      for (const snapshot of snapshots.slice().reverse()) {
        if (!stream.sendEvent({ id: eventId(now().getTime()), data: notification(snapshot) })) return;
      }
      const unsubscribeTasks = mcpTaskNotificationBus.subscribe(owner.tokenId, (task) => {
        return stream.sendEvent({ id: eventId(now().getTime()), data: notification(task) });
      });
      if (!rooms || !roomAuth || !subscriberKey) return unsubscribeTasks;

      const handle: RoomStreamHandle = {
        subscriberKey,
        auth: roomAuth,
        deliver: (uri, at) => stream.sendEvent({
          id: eventId(at.getTime()),
          data: { jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri } },
        }),
      };
      const unregister = rooms.register(handle);
      if (resumed) {
        void rooms.replay(handle, new Date(resumed.ms - ROOM_REPLAY_OVERLAP_MS)).catch((error) => {
          console.warn("[mcp/stream] room replay failed; read_room_messages still serves it", error);
        });
      }
      return () => {
        unsubscribeTasks();
        unregister();
      };
    },
  });
}
