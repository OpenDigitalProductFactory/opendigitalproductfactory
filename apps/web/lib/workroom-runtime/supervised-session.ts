// BI-F5D58F29 (agent dialog broker item D, spec 2026-10-27 §7.1): the durable
// supervision record a room keeps for its runtime session, how a room message
// names that session, and the turn a named message becomes. Pure: the
// supervisor stores the record and the dispatcher applies the decision.
//
// A session is operating state of its provider client (GAID §6.9), never a
// subject of its own: it is addressed as `<client GAID>#session=<threadId>`.

import type { RuntimeProvider } from "./types";

export const DEFAULT_RUNTIME_CWD = "/workspace";
/** Room-wide messages folded into one turn, newest kept. */
export const SUPERVISED_TURN_CONTEXT_LIMIT = 20;
const CONTEXT_BODY_LIMIT = 600;
const ADDRESSED_BODY_LIMIT = 8000;

export type SupervisionStatus = "supervised" | "supervision-lost" | "closed";

export type SupervisionActor = { userId: string; agentId: string | null; principalId: string | null };

export type StoredRuntimeSession = {
  provider: RuntimeProvider;
  threadId: string | null;
  tokenId: string;
  status: SupervisionStatus;
  openedAt: string;
  closedAt?: string;
  cwd: string;
  /** Who started supervision: a re-attach runs as the same person, never a wider one. */
  actor?: SupervisionActor;
  /** `<client GAID>#session=<threadId>`: how a room message names this session. */
  addressedAs?: string | null;
  lastHeartbeatAt?: string;
  /** The newest room message already handed to the session, as a turn or as its context. */
  deliveredCursor?: string | null;
  lostReason?: string;
};

/** The provider client agent a session runs as; a session qualifier hangs from its GAID. */
export function providerClientAgentId(provider: RuntimeProvider): "AGT-EXT-CLAUDE" | "AGT-EXT-CODEX" {
  return provider === "claude" ? "AGT-EXT-CLAUDE" : "AGT-EXT-CODEX";
}

export function sessionQualifier(clientGaid: string | null, threadId: string | null): string | null {
  return clientGaid && threadId ? `${clientGaid}#session=${threadId}` : null;
}

function readActor(value: unknown): SupervisionActor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record["userId"] !== "string" || !record["userId"]) return undefined;
  return {
    userId: record["userId"],
    agentId: typeof record["agentId"] === "string" ? record["agentId"] : null,
    principalId: typeof record["principalId"] === "string" ? record["principalId"] : null,
  };
}

function readStatus(value: unknown): SupervisionStatus {
  // Before BI-F5D58F29 a running session was stored as "open".
  if (value === "open" || value === "supervised") return "supervised";
  return value === "supervision-lost" ? "supervision-lost" : "closed";
}

export function readStoredRuntimeSession(workspaceState: unknown): StoredRuntimeSession | null {
  if (!workspaceState || typeof workspaceState !== "object" || Array.isArray(workspaceState)) return null;
  const stored = (workspaceState as Record<string, unknown>)["runtimeSession"];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  if ((record["provider"] !== "codex" && record["provider"] !== "claude") || typeof record["tokenId"] !== "string") return null;
  const str = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : undefined);
  const actor = readActor(record["actor"]);
  return {
    provider: record["provider"],
    threadId: str("threadId") ?? null,
    tokenId: record["tokenId"],
    status: readStatus(record["status"]),
    openedAt: str("openedAt") ?? "",
    cwd: str("cwd") ?? DEFAULT_RUNTIME_CWD,
    ...(str("closedAt") ? { closedAt: str("closedAt") } : {}),
    ...(actor ? { actor } : {}),
    addressedAs: str("addressedAs") ?? null,
    ...(str("lastHeartbeatAt") ? { lastHeartbeatAt: str("lastHeartbeatAt") } : {}),
    deliveredCursor: str("deliveredCursor") ?? null,
    ...(str("lostReason") ? { lostReason: str("lostReason") } : {}),
  };
}

/** The addressing fields a supervised-session decision reads. */
export type SessionAddressing = { agents: string[]; sessions: string[]; hop: number };

/**
 * Does this message name the stored session? Its exact qualifier does. Its
 * provider client's agent id does too, when the message qualifies no session of
 * that client: an unqualified address reaches the room's supervised session. A
 * qualifier for another thread of the same client does not.
 */
export function messageNamesSession(addressing: SessionAddressing, stored: StoredRuntimeSession | null): boolean {
  if (!stored?.addressedAs) return false;
  if (addressing.sessions.includes(stored.addressedAs)) return true;
  const clientGaid = stored.addressedAs.split("#")[0]!;
  const qualifiesClient = addressing.sessions.some((ref) => ref.split("#")[0] === clientGaid);
  return !qualifiesClient && addressing.agents.includes(providerClientAgentId(stored.provider));
}

export type SupervisedTurnDecision =
  | { kind: "not-named" }
  | { kind: "deliver"; addressedAs: string }
  | { kind: "held"; detail: string }
  | { kind: "paused"; detail: string };

export function decideSupervisedTurn(args: {
  addressing: SessionAddressing;
  stored: StoredRuntimeSession | null;
  /** The session is open in this portal process: re-attached on boot, or started since. */
  live: boolean;
  hopLimit: number;
  wakesLastHour: number;
  budgetPerHour: number;
}): SupervisedTurnDecision {
  const { stored } = args;
  if (!stored || !messageNamesSession(args.addressing, stored)) {
    if (args.addressing.sessions.length > 0) {
      return { kind: "held", detail: `No supervised session in this room answers to ${args.addressing.sessions.join(", ")}; the message waits on the cursor.` };
    }
    return { kind: "not-named" };
  }
  const addressedAs = stored.addressedAs!;
  if (stored.status === "supervision-lost") {
    return { kind: "held", detail: `Supervision of ${addressedAs} was lost${stored.lostReason ? ` (${stored.lostReason})` : ""}; the message waits on the cursor until the runtime is started again.` };
  }
  if (stored.status !== "supervised" || !args.live) {
    return { kind: "held", detail: `${addressedAs} is not under supervision in this portal; the message waits on the cursor.` };
  }
  if (args.addressing.hop >= args.hopLimit) {
    return { kind: "held", detail: `Reached the hop limit (${args.hopLimit}); ${addressedAs} is not given another turn.` };
  }
  if (args.wakesLastHour >= args.budgetPerHour) {
    return { kind: "paused", detail: `This room has used its ${args.budgetPerHour} wakes for the hour; ${addressedAs} reads the message from the cursor.` };
  }
  return { kind: "deliver", addressedAs };
}

export type RoomContextMessage = { senderLabel: string; body: string; createdAt: Date };

const trim = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

/** One turn: the addressed message first, then the room-wide messages posted since the session last heard the room. */
export function buildSupervisedTurnPrompt(args: {
  caseKey: string | null;
  senderLabel: string;
  body: string;
  context: RoomContextMessage[];
}): string {
  const where = args.caseKey ? `the Work Room ${args.caseKey}` : "this Work Room";
  const lines = [`A message in ${where} is addressed to you, from ${args.senderLabel}:`, "", trim(args.body, ADDRESSED_BODY_LIMIT)];
  const context = args.context.slice(-SUPERVISED_TURN_CONTEXT_LIMIT);
  if (context.length > 0) {
    lines.push("", "Also posted in the room since you last heard it (oldest first):");
    for (const m of context) lines.push(`- [${m.createdAt.toISOString()}] ${m.senderLabel}: ${trim(m.body.replace(/\s+/g, " "), CONTEXT_BODY_LIMIT)}`);
  }
  lines.push("", `Answer what is asked of you in the room with post_room_message${args.caseKey ? ` (caseKey "${args.caseKey}")` : ""}. Read more with read_room_messages if you need it.`);
  return lines.join("\n");
}
