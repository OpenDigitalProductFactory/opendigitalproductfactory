// BI-ED52AB82 (agent dialog broker item C, spec 2026-10-27 §6.7): the pure
// shapes behind MCP room resources and the resumable GET stream. One room is
// one resource, dpf://rooms/<caseKey>/messages; a stream event id names the
// stream it came from and a time watermark, so a reconnect with Last-Event-ID
// replays only what that stream missed (MCP 2025-11-25 basic/transports,
// "Resumability and Redelivery").
import { randomUUID } from "node:crypto";

import { decodeWorkCaseKey } from "@/lib/work-management/case-key";

export const ROOM_RESOURCE_TEMPLATE = "dpf://rooms/{caseKey}/messages";
export const ROOM_MESSAGE_NOTIFY_CHANNEL = "dpf_room_message";
export const ROOM_RESOURCE_MIME_TYPE = "application/json";

const ROOM_URI_RE = /^dpf:\/\/rooms\/([^/]+)\/messages$/;
const MAX_CASE_KEY_LENGTH = 200;

export function roomResourceUri(caseKey: string): string {
  return `dpf://rooms/${encodeURIComponent(caseKey)}/messages`;
}

/** The case key a room resource URI names, or null for anything else. */
export function parseRoomResourceUri(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const match = ROOM_URI_RE.exec(uri);
  if (!match?.[1]) return null;
  let caseKey: string;
  try {
    caseKey = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (caseKey.length === 0 || caseKey.length > MAX_CASE_KEY_LENGTH) return null;
  try {
    return decodeWorkCaseKey(caseKey) ? caseKey : null;
  } catch {
    return null;
  }
}

export function newStreamId(): string {
  return randomUUID().replaceAll("-", "");
}

/**
 * `<streamId>.<epochMs>[.<seq>]`. The time is the replay watermark; the
 * per-stream sequence keeps two frames sent in one millisecond distinct, since
 * MCP requires an event id to be unique across all of a client's streams.
 */
export function encodeStreamEventId(streamId: string, ms: number, seq?: number): string {
  const base = `${streamId}.${Math.max(0, Math.floor(ms))}`;
  return seq === undefined ? base : `${base}.${Math.max(0, Math.floor(seq))}`;
}

const EVENT_ID_RE = /^([A-Za-z0-9]{16,64})\.(\d{1,16})(?:\.\d{1,12})?$/;

export function decodeStreamEventId(value: unknown): { streamId: string; ms: number } | null {
  if (typeof value !== "string") return null;
  const match = EVENT_ID_RE.exec(value);
  if (!match?.[1] || !match[2]) return null;
  const ms = Number(match[2]);
  return Number.isSafeInteger(ms) ? { streamId: match[1], ms } : null;
}

/**
 * Who a subscription belongs to. The endpoint keeps no MCP session, so it is
 * the auth context: the OAuth refresh family when there is one, so an access
 * token rotation keeps the subscription, else the credential itself.
 */
export function mcpSubscriberKey(token: { tokenId: string; oauthFamilyKey?: string | null }): string {
  return token.oauthFamilyKey ? `family:${token.oauthFamilyKey}` : `token:${token.tokenId}`;
}

export type RoomMessageNotice = { workItemId: string; messageId: string; createdAt: Date };

/** Parse the work_item_message_notify_room trigger payload. Never throws. */
export function parseRoomMessageNotice(payload: unknown): RoomMessageNotice | null {
  if (typeof payload !== "string" || payload.length === 0) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { workItemId, messageId, createdAt } = parsed;
    if (typeof workItemId !== "string" || !workItemId) return null;
    if (typeof messageId !== "string" || !messageId) return null;
    if (typeof createdAt !== "string") return null;
    const at = new Date(createdAt);
    return Number.isNaN(at.getTime()) ? null : { workItemId, messageId, createdAt: at };
  } catch {
    return null;
  }
}
