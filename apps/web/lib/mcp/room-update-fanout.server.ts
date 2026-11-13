// BI-ED52AB82 (agent dialog broker item C, spec 2026-10-27 §6.7): the
// cross-process lane that tells connected MCP clients a room they subscribe to
// has a new message.
//
//   WorkItemMessage insert ── trigger ── pg_notify('dpf_room_message') on commit
//   each portal process ── one shared LISTEN ── subscriptions for the room
//     ── admission re-checked ── notifications/resources/updated on ONE stream
//
// The message table stays the record. A missed notice is recovered by the
// listener's catch-up scan after a reconnect and by a stream's Last-Event-ID
// replay; a disconnected client still reads everything with its cursor.
import { prisma } from "@dpf/db";

import {
  parseRoomMessageNotice,
  ROOM_MESSAGE_NOTIFY_CHANNEL,
  type RoomMessageNotice,
} from "./room-resource";
import type { RoomResourceAuth } from "./room-resources.server";

/** How far a replay or catch-up reaches back past its watermark. Repeats are harmless re-read wake-ups. */
export const ROOM_REPLAY_OVERLAP_MS = 30_000;
const REPLAY_SCAN_LIMIT = 500;

export type RoomStreamHandle = {
  subscriberKey: string;
  auth: RoomResourceAuth;
  /** Send one notifications/resources/updated frame; false when the stream has closed. */
  deliver: (uri: string, at: Date) => boolean;
};

type Listen = (onPayload: (payload: string) => void, onDown: () => void) => Promise<() => void>;

// Structural: the server passes prisma; tests pass a fake with the same calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type RoomUpdateFanoutDeps = {
  db: Db;
  now: () => Date;
  admitted: (auth: RoomResourceAuth, workItemIds: string[]) => Promise<boolean>;
  /** Null when no database is configured (unit tests, build): push is then off and pull still works. */
  listen: Listen | null;
  reconnectDelayMs: (attempt: number) => number;
};

type Subscription = { subscriberKey: string; uri: string; workItemId: string };
type ChangedRow = { workItemId: string; createdAt: Date; workItem: { parentItemId: string | null } | null };

export type RoomUpdateFanout = ReturnType<typeof createRoomUpdateFanout>;

export function createRoomUpdateFanout(deps: RoomUpdateFanoutDeps) {
  const streams = new Map<string, RoomStreamHandle[]>();
  const cursors = new Map<string, number>();
  let listening: "off" | "starting" | "on" = "off";
  let attempt = 0;
  let lastNoticeAt: Date | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = (work: () => Promise<unknown>): void => {
    queue = queue.then(work).catch((error) => {
      console.warn("[mcp/room-fanout] room update not delivered; pull still serves it", error);
    });
  };

  /** Deliver on one live stream of the subscriber, rotating so no stream is favoured. */
  function deliverToOne(subscriberKey: string, uri: string, at: Date, gate: (handle: RoomStreamHandle) => Promise<boolean>) {
    return (async () => {
      const handles = streams.get(subscriberKey) ?? [];
      const start = cursors.get(subscriberKey) ?? 0;
      for (let offset = 0; offset < handles.length; offset += 1) {
        const index = (start + offset) % handles.length;
        const handle = handles[index];
        if (!handle || !(await gate(handle))) continue;
        if (handle.deliver(uri, at)) {
          cursors.set(subscriberKey, index + 1);
          return true;
        }
      }
      return false;
    })();
  }

  function admissionCache() {
    const cache = new Map<string, Promise<boolean>>();
    return (auth: RoomResourceAuth, path: string[]) => {
      const key = `${auth.tokenId}|${auth.agentId}|${path.join(",")}`;
      let decision = cache.get(key);
      if (!decision) {
        decision = deps.admitted(auth, path).catch(() => false);
        cache.set(key, decision);
      }
      return decision;
    };
  }

  async function liveSubscriptions(workItemIds: string[] | null, subscriberKeys: string[]): Promise<Subscription[]> {
    if (subscriberKeys.length === 0) return [];
    return deps.db.mcpResourceSubscription.findMany({
      where: {
        ...(workItemIds ? { workItemId: { in: workItemIds } } : {}),
        subscriberKey: { in: subscriberKeys },
        expiresAt: { gt: deps.now() },
      },
      select: { subscriberKey: true, uri: true, workItemId: true },
    });
  }

  async function handleNotice(notice: RoomMessageNotice): Promise<void> {
    if (!lastNoticeAt || notice.createdAt > lastNoticeAt) lastNoticeAt = notice.createdAt;
    const keys = [...streams.keys()];
    if (keys.length === 0) return;
    const item: { parentItemId: string | null } | null = await deps.db.workItem.findUnique({
      where: { id: notice.workItemId },
      select: { parentItemId: true },
    });
    // A child room's messages appear in its parent's read, so the parent's
    // subscribers hear them too, if admitted to both rooms.
    const rooms = [notice.workItemId, ...(item?.parentItemId ? [item.parentItemId] : [])];
    const admitted = admissionCache();
    for (const sub of await liveSubscriptions(rooms, keys)) {
      const path = sub.workItemId === notice.workItemId ? [sub.workItemId] : [sub.workItemId, notice.workItemId];
      await deliverToOne(sub.subscriberKey, sub.uri, notice.createdAt, (handle) => admitted(handle.auth, path));
    }
  }

  async function changedSince(since: Date, subs: Subscription[]): Promise<ChangedRow[]> {
    const ids = [...new Set(subs.map((sub) => sub.workItemId))];
    if (ids.length === 0) return [];
    return deps.db.workItemMessage.findMany({
      where: {
        createdAt: { gt: since },
        OR: [{ workItemId: { in: ids } }, { workItem: { parentItemId: { in: ids } } }],
      },
      orderBy: { createdAt: "desc" },
      take: REPLAY_SCAN_LIMIT,
      select: { workItemId: true, createdAt: true, workItem: { select: { parentItemId: true } } },
    });
  }

  /** One update per subscription whose room (or a child room) changed, newest first, admission checked. */
  async function deliverChanges(
    subs: Subscription[],
    rows: ChangedRow[],
    send: (sub: Subscription, at: Date, path: string[]) => Promise<boolean>,
  ): Promise<void> {
    const done = new Set<Subscription>();
    for (const row of rows) {
      for (const sub of subs) {
        if (done.has(sub)) continue;
        const direct = row.workItemId === sub.workItemId;
        if (!direct && row.workItem?.parentItemId !== sub.workItemId) continue;
        if (await send(sub, row.createdAt, direct ? [sub.workItemId] : [sub.workItemId, row.workItemId])) done.add(sub);
      }
      if (done.size === subs.length) return;
    }
  }

  /** Replay to ONE reconnecting stream what it missed since its Last-Event-ID watermark. */
  async function replay(handle: RoomStreamHandle, since: Date): Promise<void> {
    const subs = await liveSubscriptions(null, [handle.subscriberKey]);
    const rows = await changedSince(since, subs);
    const admitted = admissionCache();
    await deliverChanges(subs, rows, async (sub, at, path) =>
      (await admitted(handle.auth, path)) && handle.deliver(sub.uri, at));
  }

  /** After the listener was down, re-scan from the last notice so a dropped connection loses nothing. */
  async function catchUp(): Promise<void> {
    const since = new Date((lastNoticeAt ?? deps.now()).getTime() - ROOM_REPLAY_OVERLAP_MS);
    const subs = await liveSubscriptions(null, [...streams.keys()]);
    const rows = await changedSince(since, subs);
    const admitted = admissionCache();
    await deliverChanges(subs, rows, (sub, at, path) =>
      deliverToOne(sub.subscriberKey, sub.uri, at, (handle) => admitted(handle.auth, path)));
  }

  function onPayload(payload: string): void {
    const notice = parseRoomMessageNotice(payload);
    if (notice) enqueue(() => handleNotice(notice));
  }

  function startListening(recovering: boolean): void {
    if (!deps.listen || listening !== "off") return;
    listening = "starting";
    const listen = deps.listen;
    enqueue(async () => {
      try {
        await listen(onPayload, onDown);
        listening = "on";
        attempt = 0;
        if (recovering) await catchUp();
      } catch (error) {
        listening = "off";
        console.warn("[mcp/room-fanout] LISTEN unavailable; retrying", error);
        scheduleReconnect();
      }
    });
  }

  function scheduleReconnect(): void {
    attempt += 1;
    const timer = setTimeout(() => startListening(true), deps.reconnectDelayMs(attempt));
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  function onDown(): void {
    if (listening === "off") return;
    listening = "off";
    scheduleReconnect();
  }

  return {
    /** Register an open GET stream; returns its unregister. Opens the shared listener on first use. */
    register(handle: RoomStreamHandle): () => void {
      streams.set(handle.subscriberKey, [...(streams.get(handle.subscriberKey) ?? []), handle]);
      startListening(false);
      return () => {
        const next = (streams.get(handle.subscriberKey) ?? []).filter((candidate) => candidate !== handle);
        if (next.length === 0) {
          streams.delete(handle.subscriberKey);
          cursors.delete(handle.subscriberKey);
        } else {
          streams.set(handle.subscriberKey, next);
        }
      };
    },
    replay,
    /** Resolves once queued notices and listener work have been handled (tests, shutdown). */
    async idle(): Promise<void> {
      let seen: Promise<unknown> | null = null;
      while (seen !== queue) {
        seen = queue;
        await queue;
      }
    },
  };
}

function databaseUrl(): string | null {
  // Unit tests inject fakes; never open real sockets because .env has a URL.
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  return process.env.DATABASE_URL?.trim() || null;
}

/** One dedicated connection held for LISTEN, as the job engine's worker does. */
function postgresListen(connectionString: string): Listen {
  return async (onPayload, onDown) => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString, application_name: "dpf-mcp-room-fanout" });
    let down = false;
    const fail = () => {
      if (down) return;
      down = true;
      client.end().catch(() => {});
      onDown();
    };
    client.on("notification", (message) => {
      if (message.channel === ROOM_MESSAGE_NOTIFY_CHANNEL && message.payload) onPayload(message.payload);
    });
    client.on("error", fail);
    client.on("end", fail);
    await client.connect();
    await client.query(`LISTEN ${ROOM_MESSAGE_NOTIFY_CHANNEL}`);
    return () => {
      down = true;
      client.end().catch(() => {});
    };
  };
}

const GLOBAL_KEY = Symbol.for("dpf.mcp.roomUpdateFanout");

/** The process-wide fan-out. Kept on globalThis so every route bundle shares one listener. */
export function roomUpdateFanout(): RoomUpdateFanout {
  const holder = globalThis as unknown as Record<symbol, RoomUpdateFanout | undefined>;
  const existing = holder[GLOBAL_KEY];
  if (existing) return existing;
  const url = databaseUrl();
  const created = createRoomUpdateFanout({
    db: prisma,
    now: () => new Date(),
    admitted: async (auth, workItemIds) => {
      const { defaultRoomResourceDeps, roomPushAdmitted } = await import("./room-resources.server");
      return roomPushAdmitted(auth, workItemIds, await defaultRoomResourceDeps());
    },
    listen: url ? postgresListen(url) : null,
    reconnectDelayMs: (n) => Math.min(30_000, 1_000 * 2 ** Math.min(n - 1, 5)),
  });
  holder[GLOBAL_KEY] = created;
  return created;
}
