// BI-31C1FDEC (agent dialog broker B2, spec 2026-10-27 §5–§6): who a room
// message is addressed to, how far an agent-to-agent exchange has run, and what
// the wake for it should do. Pure: the server module loads the room and applies
// the plan.
//
// The message store and read_room_messages stay the record. A wake only makes a
// recipient look sooner; anything it skips is still readable.

export const ROOM_WAKE_HOP_LIMIT = 8;
export const ROOM_WAKE_BUDGET_PER_HOUR = 30;
export const ROOM_WAKE_WINDOW_MS = 15_000;

export const ROOM_ADDRESS_ROLES = ["coordinator", "accountable"] as const;
export type RoomAddressRole = (typeof ROOM_ADDRESS_ROLES)[number];

export type RoomWakeState =
  | "pending"
  | "woken"
  | "held-for-executor"
  | "paused-budget"
  | "no-recipient";

/** Stored at structuredPayload.addressing on an addressed WorkItemMessage. */
export interface RoomMessageAddressing {
  agents: string[];
  roles: RoomAddressRole[];
  /** GAID plus `#session=` qualifiers, kept for supervised-session delivery (item D). */
  sessions: string[];
  hop: number;
  senderGaid: string | null;
  /** The user whose authority the message was posted under; a wake runs under it. */
  actingUserId: string;
  wake: { state: RoomWakeState; at: string; detail?: string; woken?: string[] };
}

export interface ParsedAddressedTo {
  agentRefs: string[];
  gaids: string[];
  roles: RoomAddressRole[];
  sessions: string[];
  invalid: string[];
}

const GAID_PATTERN = /^gaid:[a-z]+:[^:\s]+:[^:\s#]+$/i;

/** Split a caller's addressedTo list into agent ids, GAIDs, roles and session refs. */
export function parseAddressedTo(raw: unknown): ParsedAddressedTo {
  const out: ParsedAddressedTo = { agentRefs: [], gaids: [], roles: [], sessions: [], invalid: [] };
  if (raw === undefined || raw === null) return out;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const entry of list) {
    if (typeof entry !== "string" || !entry.trim()) {
      out.invalid.push(String(entry));
      continue;
    }
    const value = entry.trim();
    const role = value.toLowerCase();
    if ((ROOM_ADDRESS_ROLES as readonly string[]).includes(role)) {
      out.roles.push(role as RoomAddressRole);
    } else if (value.includes("#session=")) {
      const [gaid] = value.split("#");
      if (gaid && GAID_PATTERN.test(gaid)) {
        out.sessions.push(value);
        out.gaids.push(gaid);
      } else {
        out.invalid.push(value);
      }
    } else if (value.toLowerCase().startsWith("gaid:")) {
      if (GAID_PATTERN.test(value)) out.gaids.push(value);
      else out.invalid.push(value);
    } else if (/^[A-Za-z0-9._-]+$/.test(value)) {
      out.agentRefs.push(value);
    } else {
      out.invalid.push(value);
    }
  }
  return {
    agentRefs: [...new Set(out.agentRefs)],
    gaids: [...new Set(out.gaids)],
    roles: [...new Set(out.roles)],
    sessions: [...new Set(out.sessions)],
    invalid: out.invalid,
  };
}

export function readRoomMessageAddressing(structuredPayload: unknown): RoomMessageAddressing | null {
  if (!structuredPayload || typeof structuredPayload !== "object") return null;
  const value = (structuredPayload as Record<string, unknown>).addressing;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const wake = record.wake && typeof record.wake === "object" ? (record.wake as Record<string, unknown>) : {};
  return {
    agents: strings(record.agents),
    roles: strings(record.roles).filter((r): r is RoomAddressRole => (ROOM_ADDRESS_ROLES as readonly string[]).includes(r)),
    sessions: strings(record.sessions),
    hop: typeof record.hop === "number" && Number.isFinite(record.hop) ? record.hop : 0,
    senderGaid: typeof record.senderGaid === "string" ? record.senderGaid : null,
    actingUserId: typeof record.actingUserId === "string" ? record.actingUserId : "",
    wake: {
      state: (typeof wake.state === "string" ? wake.state : "pending") as RoomWakeState,
      at: typeof wake.at === "string" ? wake.at : "",
      ...(typeof wake.detail === "string" ? { detail: wake.detail } : {}),
      ...(Array.isArray(wake.woken) ? { woken: strings(wake.woken) } : {}),
    },
  };
}

/**
 * What read_room_messages shows about a message's addressing. GAID §11.9:
 * every coworker message carries its sender's GAID (people have none); a
 * message from before addressing existed falls back to the sender's current one.
 */
export function roomMessageAddressingView(structuredPayload: unknown, fallbackSenderGaid: string | null) {
  const addressing = readRoomMessageAddressing(structuredPayload);
  return {
    senderGaid: addressing?.senderGaid ?? fallbackSenderGaid,
    ...(addressing
      ? {
          addressedTo: [...addressing.agents, ...addressing.roles, ...addressing.sessions],
          hop: addressing.hop,
          wake: { state: addressing.wake.state, ...(addressing.wake.detail ? { detail: addressing.wake.detail } : {}) },
        }
      : {}),
  };
}

/**
 * A human message starts an exchange at hop 0. An agent's message is one hop
 * past the newest earlier message in the room that was addressed to it, so two
 * agents answering each other climb toward the limit.
 */
export function computeRoomMessageHop(args: {
  senderType: "user" | "agent";
  senderAgentId?: string | null;
  /** Earlier messages in the room, newest first. */
  recent: ReadonlyArray<{ addressing: RoomMessageAddressing | null }>;
}): number {
  if (args.senderType !== "agent" || !args.senderAgentId) return 0;
  const prior = args.recent.find((m) => m.addressing?.agents.includes(args.senderAgentId!));
  return prior?.addressing ? prior.addressing.hop + 1 : 0;
}

export type RoomWakePlan =
  | { kind: "none"; state: "no-recipient"; detail: string }
  | { kind: "hold"; state: "held-for-executor"; detail: string }
  | { kind: "pause"; state: "paused-budget"; detail: string }
  | { kind: "wake"; state: "woken"; agents: string[]; reason: "addressed" | "hop-limit"; detail: string };

/** Desktop and CLI executors work a room from outside; the platform never takes their stage. */
export function isExternalRoomExecutor(executorKind: string | null | undefined): boolean {
  return Boolean(executorKind) && executorKind !== "build-studio";
}

export function planRoomWake(args: {
  addressing: RoomMessageAddressing;
  senderAgentId: string | null;
  /** Agent ids holding each addressed role in the room. */
  roleAgents: Partial<Record<RoomAddressRole, string[]>>;
  coordinatorAgentIds: string[];
  executor: { kind: string | null; ref: string | null } | null;
  wakesLastHour: number;
  /** Agents that run outside the platform (Claude Code, Codex, Grok): reached by their own client, never a platform task. */
  externalAgentIds?: ReadonlySet<string>;
  hopLimit?: number;
  budgetPerHour?: number;
}): RoomWakePlan {
  const hopLimit = args.hopLimit ?? ROOM_WAKE_HOP_LIMIT;
  const budget = args.budgetPerHour ?? ROOM_WAKE_BUDGET_PER_HOUR;
  const addressed = [
    ...args.addressing.agents,
    ...args.addressing.roles.flatMap((role) => args.roleAgents[role] ?? []),
  ];
  let recipients = [...new Set(addressed)].filter((id) => id !== args.senderAgentId);
  let reason: "addressed" | "hop-limit" = "addressed";
  if (args.addressing.hop >= hopLimit) {
    recipients = args.coordinatorAgentIds.filter((id) => id !== args.senderAgentId);
    reason = "hop-limit";
  }

  if (args.executor && isExternalRoomExecutor(args.executor.kind)) {
    return {
      kind: "hold",
      state: "held-for-executor",
      detail: `This room is worked by ${args.executor.kind}${args.executor.ref ? ` (${args.executor.ref})` : ""}; no platform coworker is dispatched onto it. The message waits for that executor.`,
    };
  }
  const external = recipients.filter((id) => args.externalAgentIds?.has(id));
  recipients = recipients.filter((id) => !args.externalAgentIds?.has(id));
  if (recipients.length === 0 && external.length > 0) {
    return {
      kind: "hold",
      state: "held-for-executor",
      detail: `Addressed to ${external.join(", ")}, which runs outside the platform; it sees this when it next reads the room.`,
    };
  }
  if (recipients.length === 0) {
    return {
      kind: "none",
      state: "no-recipient",
      detail: reason === "hop-limit"
        ? `Reached the hop limit (${hopLimit}) and the room has no coworker coordinator to wake; the exchange stops here.`
        : "No in-platform coworker is addressed.",
    };
  }
  if (args.wakesLastHour >= budget) {
    return {
      kind: "pause",
      state: "paused-budget",
      detail: `This room has used its ${budget} wakes for the hour; delivery is pull-only until the hour rolls over.`,
    };
  }
  return {
    kind: "wake",
    state: "woken",
    agents: recipients,
    reason,
    detail: reason === "hop-limit"
      ? `Reached the hop limit (${hopLimit}); woke the coordinator instead of the addressee.`
      : `Woke ${recipients.join(", ")}.`,
  };
}

/** Wakes for one recipient in one room share an id inside a window, so bursts coalesce. */
export function roomWakeWindow(at: Date, windowMs = ROOM_WAKE_WINDOW_MS): { key: number; closesAt: Date } {
  const key = Math.floor(at.getTime() / windowMs);
  return { key, closesAt: new Date((key + 1) * windowMs) };
}

export function roomWakeEventId(workItemId: string, agentId: string, at: Date): string {
  return `room-wake:${workItemId}:${agentId}:${roomWakeWindow(at).key}`;
}

export function roomReplyTaskId(workItemId: string, agentId: string): string {
  return `room-reply-${workItemId}-${agentId}`;
}

/** A five-field cron that fires once, so the task claim deactivates it after one run. */
export function oneShotCronAt(at: Date): string {
  return `${at.getUTCMinutes()} ${at.getUTCHours()} ${at.getUTCDate()} ${at.getUTCMonth() + 1} *`;
}

export function buildRoomReplyPrompt(args: { caseKey: string; title: string; sinceCursor: string | null }): string {
  return [
    `Messages in the Work Room ${args.caseKey} ("${args.title}") are addressed to you.`,
    `Read them with read_room_messages (caseKey "${args.caseKey}"${args.sinceCursor ? `, sinceCursor "${args.sinceCursor}"` : ""}) and answer what is asked of you in the room with post_room_message.`,
    "Reply only to what is addressed to you. If nothing needs an answer, or you cannot act within your grants, say so briefly in the room. Address another coworker only when you need it to act.",
  ].join("\n");
}
