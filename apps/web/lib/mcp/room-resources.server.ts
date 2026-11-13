// BI-ED52AB82 (agent dialog broker item C, spec 2026-10-27 §6.7): MCP
// resources for Work Rooms. resources/read and resources/subscribe go through
// the governed read_room_messages call, so token scope, coworker grants, user
// capability, room admission and audit apply exactly as for tools/call. A
// subscription is stored per auth context; every push re-checks admission.
import { prisma } from "@dpf/db";

import { expandGrants, getToolGrantMapping, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import type { WorkroomAccessLevel } from "@/lib/work-management/room-participation";

import { JSONRPC_INVALID_PARAMS, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND } from "./jsonrpc-response";
import {
  mcpSubscriberKey,
  parseRoomResourceUri,
  roomResourceUri,
  ROOM_RESOURCE_MIME_TYPE,
  ROOM_RESOURCE_TEMPLATE,
} from "./room-resource";

/** MCP 2025-11-25 server/resources, "Error Handling": resource not found. */
export const MCP_RESOURCE_NOT_FOUND = -32002;

export const ROOM_SUBSCRIPTION_TTL_MS = 24 * 60 * 60_000;
export const MAX_ROOM_SUBSCRIPTIONS_PER_SUBSCRIBER = 100;
const ROOM_LIST_LIMIT = 20;
const READ_TOOL = "read_room_messages";

export type RoomResourceAuth = {
  tokenId: string;
  userId: string;
  agentId: string | null;
  oauthFamilyKey?: string | null;
  scope: string;
  capability: string;
  scopes: readonly string[];
};

/** The governed read_room_messages call, made by the MCP route with the caller's context. */
export type GovernedRoomRead = (args: Record<string, unknown>) => Promise<
  | { kind: "ok"; data: unknown }
  | { kind: "refused"; error: string; message: string }
  | { kind: "response"; response: Response }
>;

export type RoomResourceOutcome =
  | { kind: "ok"; result: Record<string, unknown> }
  | { kind: "error"; code: number; message: string; data?: Record<string, unknown> }
  | { kind: "response"; response: Response };

type RoomWorkItem = {
  id: string;
  itemId?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  title?: string | null;
  evidence?: unknown;
  assignedToAgentId?: string | null;
  assignedToUserId?: string | null;
};

// Structural: the server passes prisma; tests pass a fake with the same calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type RoomResourceDeps = {
  db: Db;
  now: () => Date;
  resolveWorkItem: (caseKey: string) => Promise<{ id: string } | null>;
  agentPrincipalId: (agentId: string) => Promise<string | null>;
  agentGrants: (agentId: string) => Promise<string[]>;
  roomAccess: (
    who: { agentId: string; userId: string },
    workItem: RoomWorkItem,
  ) => Promise<WorkroomAccessLevel>;
};

const ROOM_ITEM_SELECT = {
  id: true,
  itemId: true,
  sourceType: true,
  sourceId: true,
  title: true,
  evidence: true,
  assignedToAgentId: true,
  assignedToUserId: true,
} as const;

let defaultDepsPromise: Promise<RoomResourceDeps> | null = null;

export function defaultRoomResourceDeps(): Promise<RoomResourceDeps> {
  defaultDepsPromise ??= (async () => {
    const [{ resolveRoomMessagingWorkItem }, { ensureAgentPrincipalIdentity }, { getAgentToolGrantsAsync }, { resolveAgentRoomAccess }] =
      await Promise.all([
        import("@/lib/work-management/room-participant-invitation-preflight.server"),
        import("@/lib/identity/principal-linking"),
        import("@/lib/tak/agent-grants"),
        import("@/lib/work-management/room-agent-access.server"),
      ]);
    return {
      db: prisma,
      now: () => new Date(),
      resolveWorkItem: (caseKey) => resolveRoomMessagingWorkItem(caseKey),
      agentPrincipalId: async (agentId) => (await ensureAgentPrincipalIdentity(agentId))?.id ?? null,
      agentGrants: (agentId) => getAgentToolGrantsAsync(agentId),
      roomAccess: async (who, workItem) =>
        (await resolveAgentRoomAccess({
          agentId: who.agentId,
          userId: who.userId,
          requested: "content",
          workItem: {
            id: workItem.id,
            evidence: workItem.evidence ?? null,
            assignedToAgentId: workItem.assignedToAgentId ?? null,
            assignedToUserId: workItem.assignedToUserId ?? null,
            sourceType: workItem.sourceType ?? null,
            sourceId: workItem.sourceId ?? null,
          },
        })).decision.level,
    };
  })();
  return defaultDepsPromise;
}

function invalidUri(uri: unknown): RoomResourceOutcome {
  return {
    kind: "error",
    code: JSONRPC_INVALID_PARAMS,
    message: `uri must be a room resource, ${ROOM_RESOURCE_TEMPLATE}.`,
    data: { uri: typeof uri === "string" ? uri : null },
  };
}

function refusal(uri: string, outcome: { error: string; message: string }): RoomResourceOutcome {
  if (outcome.error === "not_found") {
    return { kind: "error", code: MCP_RESOURCE_NOT_FOUND, message: outcome.message, data: { uri } };
  }
  return { kind: "error", code: JSONRPC_INVALID_REQUEST, message: outcome.message, data: { uri, error: outcome.error } };
}

export async function readRoomResource(
  params: Record<string, unknown> | undefined,
  read: GovernedRoomRead,
): Promise<RoomResourceOutcome> {
  const uri = params?.uri;
  const caseKey = parseRoomResourceUri(uri);
  if (!caseKey) return invalidUri(uri);
  const outcome = await read({ caseKey });
  if (outcome.kind === "response") return outcome;
  if (outcome.kind === "refused") return refusal(uri as string, outcome);
  return {
    kind: "ok",
    result: { contents: [{ uri, mimeType: ROOM_RESOURCE_MIME_TYPE, text: JSON.stringify(outcome.data ?? null) }] },
  };
}

export async function subscribeRoomResource(
  params: Record<string, unknown> | undefined,
  auth: RoomResourceAuth,
  read: GovernedRoomRead,
  deps: RoomResourceDeps,
): Promise<RoomResourceOutcome> {
  const uri = params?.uri;
  const caseKey = parseRoomResourceUri(uri);
  if (!caseKey || typeof uri !== "string") return invalidUri(uri);
  // Admission is proven by the same governed read a client would make, so a
  // refused subscriber stores nothing and the refusal is the read's own.
  const proof = await read({ caseKey, limit: 1 });
  if (proof.kind === "response") return proof;
  if (proof.kind === "refused") return refusal(uri, proof);

  const item = await deps.resolveWorkItem(caseKey);
  if (!item) return refusal(uri, { error: "not_found", message: `No Work Room found for ${caseKey}.` });
  const subscriberKey = mcpSubscriberKey(auth);
  const now = deps.now();
  const live = await deps.db.mcpResourceSubscription.count({
    where: { subscriberKey, expiresAt: { gt: now }, NOT: { uri } },
  });
  if (live >= MAX_ROOM_SUBSCRIPTIONS_PER_SUBSCRIBER) {
    return {
      kind: "error",
      code: JSONRPC_INVALID_REQUEST,
      message: `This client already follows ${MAX_ROOM_SUBSCRIPTIONS_PER_SUBSCRIBER} rooms. Unsubscribe from one first.`,
      data: { uri, error: "subscription_limit" },
    };
  }
  const expiresAt = new Date(now.getTime() + ROOM_SUBSCRIPTION_TTL_MS);
  await deps.db.mcpResourceSubscription.upsert({
    where: { subscriberKey_uri: { subscriberKey, uri } },
    create: { subscriberKey, uri, caseKey, workItemId: item.id, expiresAt },
    update: { workItemId: item.id, caseKey, expiresAt },
  });
  return { kind: "ok", result: {} };
}

export async function unsubscribeRoomResource(
  params: Record<string, unknown> | undefined,
  auth: RoomResourceAuth,
  deps: Pick<RoomResourceDeps, "db">,
): Promise<RoomResourceOutcome> {
  const uri = params?.uri;
  if (!parseRoomResourceUri(uri) || typeof uri !== "string") return invalidUri(uri);
  await deps.db.mcpResourceSubscription.deleteMany({ where: { subscriberKey: mcpSubscriberKey(auth), uri } });
  return { kind: "ok", result: {} };
}

/** The rooms the acting coworker takes part in and may currently read, newest first. */
export async function listRoomResources(auth: RoomResourceAuth, deps: RoomResourceDeps): Promise<RoomResourceOutcome> {
  const agentId = auth.agentId;
  if (!agentId || !credentialAdmitsRead(auth)) return { kind: "ok", result: { resources: [] } };
  if (!isToolAllowedByGrants(READ_TOOL, await deps.agentGrants(agentId))) return { kind: "ok", result: { resources: [] } };
  const principalId = await deps.agentPrincipalId(agentId);
  if (!principalId) return { kind: "ok", result: { resources: [] } };
  const rows: Array<{ workroom: { workItem: RoomWorkItem | null } | null }> = await deps.db.workroomParticipant.findMany({
    where: { principalId, lifecycle: "active", workroom: { archivedAt: null, workItemId: { not: null } } },
    orderBy: { updatedAt: "desc" },
    take: ROOM_LIST_LIMIT,
    select: { workroom: { select: { workItem: { select: ROOM_ITEM_SELECT } } } },
  });
  const resources: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const item = row.workroom?.workItem;
    if (!item?.sourceType || !item.sourceId || seen.has(item.id)) continue;
    seen.add(item.id);
    if ((await deps.roomAccess({ agentId, userId: auth.userId }, item)) !== "content") continue;
    const caseKey = `${item.sourceType}:${item.sourceId}`;
    resources.push({
      uri: roomResourceUri(caseKey),
      name: caseKey,
      ...(item.title ? { title: item.title } : {}),
      mimeType: ROOM_RESOURCE_MIME_TYPE,
    });
  }
  return { kind: "ok", result: { resources } };
}

export function listRoomResourceTemplates(): { resourceTemplates: Array<Record<string, unknown>> } {
  return {
    resourceTemplates: [{
      uriTemplate: ROOM_RESOURCE_TEMPLATE,
      name: "work-room-messages",
      title: "Work Room messages",
      description:
        "The newest messages in a Work Room. Subscribe to be told when the room gets a new message; "
        + "the notice carries no content, so read the room with read_room_messages and your cursor.",
      mimeType: ROOM_RESOURCE_MIME_TYPE,
    }],
  };
}

function credentialAdmitsRead(auth: RoomResourceAuth): boolean {
  // read_room_messages has no side effect, so any token scope reaches it; the
  // granular grants must still name it, expanded as tools/call expands them.
  const required = getToolGrantMapping()[READ_TOOL] ?? [];
  const expanded = expandGrants([...auth.scopes]);
  return required.some((grant) => expanded.includes(grant));
}

async function credentialIsLive(auth: RoomResourceAuth, deps: RoomResourceDeps): Promise<boolean> {
  // A session JWT is verified by signature and expiry when its stream opens and
  // has no row to revoke; every other credential is an McpApiToken row.
  if (auth.tokenId.startsWith("session:")) return true;
  const row: { revokedAt: Date | null; expiresAt: Date | null } | null = await deps.db.mcpApiToken.findUnique({
    where: { id: auth.tokenId },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!row || row.revokedAt) return false;
  return !row.expiresAt || row.expiresAt.getTime() > deps.now().getTime();
}

/**
 * Whether a push about these rooms may reach this subscriber now. Called on
 * every notification and replay, so a revoked participant, grant or credential
 * stops hearing the room at once. `workItemIds` is the subscribed room and,
 * for a child room's message, the child: read_room_messages needs both.
 */
export async function roomPushAdmitted(
  auth: RoomResourceAuth,
  workItemIds: readonly string[],
  deps: RoomResourceDeps,
): Promise<boolean> {
  const agentId = auth.agentId;
  if (!agentId || workItemIds.length === 0) return false;
  if (!credentialAdmitsRead(auth)) return false;
  if (!(await credentialIsLive(auth, deps))) return false;
  if (!isToolAllowedByGrants(READ_TOOL, await deps.agentGrants(agentId))) return false;
  for (const id of new Set(workItemIds)) {
    const item: RoomWorkItem | null = await deps.db.workItem.findUnique({ where: { id }, select: ROOM_ITEM_SELECT });
    if (!item) return false;
    if ((await deps.roomAccess({ agentId, userId: auth.userId }, item)) !== "content") return false;
  }
  return true;
}

/**
 * A governed read made through the MCP route's own tools/call handler, so a
 * resource read meets every check a read_room_messages call meets: token
 * scope and step-up, grants, quiescence, room binding, admission, audit and
 * the untrusted-content sanitizer. `callTool` returns that handler's Response.
 */
export function governedReadVia(
  callTool: (name: string, args: Record<string, unknown>) => Promise<Response>,
): GovernedRoomRead {
  return async (args) => {
    const response = await callTool(READ_TOOL, args);
    let body: { error?: unknown; result?: { isError?: boolean; content?: Array<{ text?: unknown }> } } | null = null;
    try {
      body = await response.clone().json();
    } catch {
      body = null;
    }
    if (response.status !== 200 || !body || body.error || !body.result) return { kind: "response", response };
    const text = typeof body.result.content?.[0]?.text === "string" ? body.result.content[0].text : "";
    type ToolText = { message?: unknown; error?: unknown; data?: unknown };
    let parsed: ToolText | null = null;
    try {
      const value = JSON.parse(text) as unknown;
      parsed = value && typeof value === "object" && !Array.isArray(value) ? (value as ToolText) : null;
    } catch {
      parsed = null;
    }
    if (body.result.isError) {
      return {
        kind: "refused",
        error: typeof parsed?.error === "string" ? parsed.error : "forbidden",
        message: typeof parsed?.message === "string" ? parsed.message : text || "The room read was refused.",
      };
    }
    return { kind: "ok", data: parsed?.data ?? null };
  };
}

export const ROOM_RESOURCE_METHODS = [
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "resources/subscribe",
  "resources/unsubscribe",
] as const;

export function isRoomResourceMethod(method: string): method is (typeof ROOM_RESOURCE_METHODS)[number] {
  return (ROOM_RESOURCE_METHODS as readonly string[]).includes(method);
}

/** Route one resources/* method; anything else is method-not-found. */
export async function dispatchRoomResourceMethod(
  method: string,
  params: Record<string, unknown> | undefined,
  auth: RoomResourceAuth,
  read: GovernedRoomRead,
  deps: RoomResourceDeps,
): Promise<RoomResourceOutcome> {
  switch (method) {
    case "resources/list":
      return listRoomResources(auth, deps);
    case "resources/templates/list":
      return { kind: "ok", result: listRoomResourceTemplates() };
    case "resources/read":
      return readRoomResource(params, read);
    case "resources/subscribe":
      return subscribeRoomResource(params, auth, read, deps);
    case "resources/unsubscribe":
      return unsubscribeRoomResource(params, auth, deps);
    default:
      return { kind: "error", code: JSONRPC_METHOD_NOT_FOUND, message: `unknown method: ${method}` };
  }
}
