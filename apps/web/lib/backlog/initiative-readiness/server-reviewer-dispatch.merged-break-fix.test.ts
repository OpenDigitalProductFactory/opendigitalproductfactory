// BI-D3BAF945 — a merged break-fix owes an independent post-implementation
// review after its Workroom retires. The platform dispatch must send it even
// when a person opened the room with no assistant, and must not leave it to a
// random sample that is mostly items owing nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const prismaMock = vi.hoisted(() => ({
  workroom: { findMany: vi.fn() },
  backlogItem: { findMany: vi.fn() },
  workroomActivity: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/work-management/workroom-shape-claim", () => ({
  readWorkShapeClaim: (claims: unknown) => (Array.isArray(claims) && claims.length > 0 ? { key: "delivery-break-fix" } : null),
}));

import { dispatchOwedIndependentReviews } from "./server-reviewer-dispatch";

const NOW = new Date("2026-10-28T07:00:00.000Z");
const breakFix = [{ workShape: "delivery-break-fix@1.0.0" }];
const aliases = (kind: string, values: Array<[string, string]>) => ({ kind, aliases: values.map(([aliasType, aliasValue]) => ({ aliasType, aliasValue })) });

/** The retired anchor room of a merged break-fix, as each query reads it. */
type Fixture = { capsuleId: string; itemId: string; requestedByPrincipal: unknown; createdByPrincipal: unknown; participants?: unknown[] };

function store(options: { live?: Fixture[]; retired?: Fixture[]; awaiting?: string[] }) {
  const live = options.live ?? [];
  const retired = options.retired ?? [];
  const row = (room: Fixture, index: number) => ({ id: `row-${room.capsuleId}`, capsuleId: room.capsuleId, backlogItemId: room.itemId,
    requestedByPrincipal: room.requestedByPrincipal, createdByPrincipal: room.createdByPrincipal, participants: room.participants ?? [],
    scopeClaims: breakFix, order: index });
  prismaMock.workroom.findMany.mockImplementation(async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => {
    const where = args.where ?? {};
    if (where.executorKind === "build-studio") return [];
    if (where.archivedAt === null) return live.map(row);
    // The merged break-fix room scan selects identity columns only.
    if (args.select && "scopeClaims" in args.select) return retired.map(row);
    const ids = ((where.capsuleId as { in?: string[] } | undefined)?.in) ?? [];
    return retired.filter((room) => ids.includes(room.capsuleId)).map(row);
  });
  prismaMock.backlogItem.findMany.mockImplementation(async (args: { where?: { itemId?: unknown; status?: unknown } }) => {
    if (args.where?.status === "awaiting-acceptance") {
      return (options.awaiting ?? retired.map((room) => room.itemId)).map((itemId) => ({ id: `item-${itemId}`, itemId }));
    }
    return live.map((room) => ({ itemId: room.itemId, status: "awaiting-acceptance" }));
  });
}

const packet = (itemId: string) => ({ targetAgent: "AGT-WS-REVIEW", objective: "review",
  requestKey: `initiative-readiness:${itemId}:post-implementation-review:abc` });
const carrierConnection = {
  token: { id: "TOK-P", scope: "write", scopes: [], userId: "user-person", agentId: "AGT-EXT-CLAUDE", authorityBindingId: "B" },
  userContext: { userId: "user-person", platformRole: "HR-000", isSuperuser: false },
  context: { agentId: "AGT-EXT-CLAUDE", apiTokenId: "TOK-P", authSource: "oauth" },
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    now: NOW,
    random: () => 0.5,
    owedRoutes: vi.fn(async (itemId: string, _agent: string | null, candidate?: { room: { capsuleId: string } }) =>
      itemId.startsWith("BI-LIVE") ? [] : [{ workroomId: candidate!.room.capsuleId, requestCoworker: packet(itemId) }]),
    findConnection: vi.fn(async () => null),
    findUserConnection: vi.fn(async () => carrierConnection as never),
    execute: vi.fn(async () => ({ success: true, message: "Requested." })),
    ...overrides,
  };
}

beforeEach(() => {
  for (const model of Object.values(prismaMock)) for (const fn of Object.values(model)) fn.mockReset();
  prismaMock.workroomActivity.findFirst.mockResolvedValue(null);
  prismaMock.workroomActivity.create.mockResolvedValue({ id: "act" });
});

const personRoom: Fixture = { capsuleId: "WC-PERSON", itemId: "BI-PERSON", requestedByPrincipal: null,
  createdByPrincipal: aliases("human", [["user", "user-person"]]) };

describe("merged break-fix review dispatch (BI-D3BAF945)", () => {
  it("carries a person-opened room's owed review on that person's live connection", async () => {
    store({ retired: [personRoom] });
    const d = deps();
    const outcomes = await dispatchOwedIndependentReviews(d);
    expect(outcomes).toEqual([expect.objectContaining({ itemId: "BI-PERSON", outcome: "dispatched", carriedByAgentId: "AGT-EXT-CLAUDE" })]);
    expect(d.findUserConnection).toHaveBeenCalledWith("user-person");
    expect(d.findConnection).not.toHaveBeenCalled();
    expect(d.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "request_coworker", rawParams: packet("BI-PERSON"), userId: "user-person" }));
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workCapsuleId: "row-WC-PERSON",
      payload: expect.objectContaining({ outcome: "dispatched" }) }) });
  });

  it("says so on the room when the person has no live connection", async () => {
    store({ retired: [personRoom] });
    const d = deps({ findUserConnection: vi.fn(async () => null) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ outcome: "no-author-connection" })]);
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workCapsuleId: "row-WC-PERSON",
      payload: expect.objectContaining({ outcome: "no-author-connection" }) }) });
  });

  it("keeps carrying an assistant-authored room on that assistant's own connection", async () => {
    const assistantRoom: Fixture = { capsuleId: "WC-AGENT", itemId: "BI-AGENT",
      requestedByPrincipal: aliases("human", [["user", "user-person"]]), createdByPrincipal: aliases("agent", [["agent", "AGT-EXT-CODEX"]]) };
    store({ retired: [assistantRoom] });
    const d = deps({ findConnection: vi.fn(async () => ({ ...carrierConnection, context: { ...carrierConnection.context, agentId: "AGT-EXT-CODEX" } }) as never) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ itemId: "BI-AGENT", outcome: "dispatched" })]);
    expect(d.findConnection).toHaveBeenCalledWith("user-person", "AGT-EXT-CODEX");
    expect(d.findUserConnection).not.toHaveBeenCalled();
  });

  it("does not leave an owed merged review to a random sample of items that owe nothing", async () => {
    const live = Array.from({ length: 12 }, (_, i): Fixture => ({ capsuleId: `WC-LIVE-${i}`, itemId: `BI-LIVE-${i}`,
      requestedByPrincipal: aliases("human", [["user", "user-other"]]), createdByPrincipal: aliases("agent", [["agent", "AGT-EXT-CODEX"]]) }));
    store({ live, retired: [personRoom], awaiting: ["BI-PERSON", ...live.map((room) => room.itemId)] });
    // Order the random sample so every live item sorts ahead of the merged one.
    let n = 0;
    const d = deps({ random: () => (n++ < 12 ? 0 : 0.99), limit: 5 });
    const outcomes = await dispatchOwedIndependentReviews(d);
    expect(outcomes.filter((o) => o.itemId === "BI-PERSON")).toEqual([expect.objectContaining({ outcome: "dispatched" })]);
    expect(outcomes.filter((o) => o.itemId.startsWith("BI-LIVE"))).toHaveLength(5);
  });

  it("does not dispatch for a retired room no person or assistant can carry", async () => {
    store({ retired: [{ capsuleId: "WC-NOBODY", itemId: "BI-NOBODY", requestedByPrincipal: null, createdByPrincipal: aliases("service", [["service", "svc"]]) }] });
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([]);
    expect(d.execute).not.toHaveBeenCalled();
  });
});
