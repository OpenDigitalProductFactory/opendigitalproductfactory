import type { AccountabilityEdge } from "@/lib/work-management/human-accountability";

export const COO_BROADCAST_ASK_KIND = "coo-broadcast-ask";
export const COO_BROADCAST_ACK_KIND = "coo-broadcast-ack";

export function containsDescendants(
  rootRoomId: string,
  edges: readonly Pick<AccountabilityEdge, "fromWorkroomId" | "toWorkroomId" | "relation">[],
): string[] {
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.relation !== "contains") continue;
    const list = children.get(edge.fromWorkroomId) ?? [];
    list.push(edge.toWorkroomId);
    children.set(edge.fromWorkroomId, list);
  }
  const descendants: string[] = [];
  const seen = new Set<string>([rootRoomId]);
  const stack = [...(children.get(rootRoomId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    descendants.push(current);
    for (const child of children.get(current) ?? []) stack.push(child);
  }
  return descendants;
}

export type CooBroadcastAskRow = {
  kind: typeof COO_BROADCAST_ASK_KIND;
  roomId: string;
  commandKey: string;
  commandScopeKey: string;
  summary: string;
  payload: { body: string; rootRoomId: string };
};

export function planCooBroadcast(input: {
  rootRoomId: string;
  body: string;
  commandKey: string;
  edges: readonly Pick<AccountabilityEdge, "fromWorkroomId" | "toWorkroomId" | "relation">[];
  dispatch?: (...args: unknown[]) => unknown;
}): {
  targets: Array<{ roomId: string }>;
  asks: CooBroadcastAskRow[];
  dispatchInvoked: false;
} {
  void input.dispatch;
  const targets = [input.rootRoomId, ...containsDescendants(input.rootRoomId, input.edges)]
    .filter((roomId, index, all) => all.indexOf(roomId) === index)
    .map((roomId) => ({ roomId }));
  return {
    targets,
    asks: targets.map((target) => ({
      kind: COO_BROADCAST_ASK_KIND,
      roomId: target.roomId,
      commandKey: input.commandKey,
      commandScopeKey: `${COO_BROADCAST_ASK_KIND}:${target.roomId}`,
      summary: `COO ask: ${input.body}`,
      payload: { body: input.body, rootRoomId: input.rootRoomId },
    })),
    dispatchInvoked: false,
  };
}

export function planCooBroadcastAck(input: {
  roomId: string;
  commandKey: string;
  dispatch?: (...args: unknown[]) => unknown;
}): {
  kind: typeof COO_BROADCAST_ACK_KIND;
  roomId: string;
  commandKey: string;
  commandScopeKey: string;
  summary: string;
  dispatchInvoked: false;
} {
  void input.dispatch;
  return {
    kind: COO_BROADCAST_ACK_KIND,
    roomId: input.roomId,
    commandKey: input.commandKey,
    commandScopeKey: `${COO_BROADCAST_ACK_KIND}:${input.roomId}`,
    summary: `COO acknowledgement for ${input.commandKey}`,
    dispatchInvoked: false,
  };
}

export function missingCooBroadcastAcks(
  asks: ReadonlyArray<{ commandKey: string; roomId: string }>,
  acks: ReadonlyArray<{ commandKey: string; roomId: string }>,
): Array<{ commandKey: string; roomId: string }> {
  const acked = new Set(acks.map((row) => `${row.commandKey}::${row.roomId}`));
  const seen = new Set<string>();
  const missing: Array<{ commandKey: string; roomId: string }> = [];
  for (const ask of asks) {
    const key = `${ask.commandKey}::${ask.roomId}`;
    if (acked.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push({ commandKey: ask.commandKey, roomId: ask.roomId });
  }
  return missing;
}
