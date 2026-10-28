// BI-AA47C672 — a merged break-fix's owed post-implementation review must not
// wait for the author's client. With no live author or requester connection,
// the dispatcher hands the same server-issued packet to the platform's own
// reviewer; it records `no-author-connection` only when no in-platform
// reviewer can take it, and then says why.
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

const NOW = new Date("2026-10-28T09:00:00.000Z");
const aliases = (kind: string, values: Array<[string, string]>) => ({ kind, aliases: values.map(([aliasType, aliasValue]) => ({ aliasType, aliasValue })) });

/** One retired break-fix room, opened by a person whose only connections lapsed. */
function store(room: { capsuleId: string; itemId: string; requestedByPrincipal: unknown; createdByPrincipal: unknown }) {
  const row = { id: `row-${room.capsuleId}`, capsuleId: room.capsuleId, backlogItemId: room.itemId,
    requestedByPrincipal: room.requestedByPrincipal, createdByPrincipal: room.createdByPrincipal, participants: [],
    scopeClaims: [{ workShape: "delivery-break-fix@1.0.0" }] };
  prismaMock.workroom.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const where = args.where ?? {};
    if (where.executorKind === "build-studio" || where.archivedAt === null) return [];
    return [row];
  });
  prismaMock.backlogItem.findMany.mockImplementation(async (args: { where?: { status?: unknown } }) =>
    args.where?.status === "awaiting-acceptance" ? [{ id: `item-${room.itemId}`, itemId: room.itemId }] : []);
}

const pirPacket = (itemId: string) => ({ targetAgent: "AGT-WS-REVIEW", objective: "review",
  requestKey: `initiative-readiness:${itemId}:post-implementation-review:abc`,
  initiativeReviewBinding: { writerToolName: "record_initiative_post_implementation_review", gate: "post-implementation-review", itemId } });

function deps(overrides: Record<string, unknown> = {}) {
  return {
    now: NOW,
    random: () => 0.5,
    owedRoutes: vi.fn(async (itemId: string, _agent: string | null, candidate?: { room: { capsuleId: string } }) =>
      [{ workroomId: candidate!.room.capsuleId, requestCoworker: pirPacket(itemId) }]),
    findConnection: vi.fn(async () => null),
    findUserConnection: vi.fn(async () => null),
    execute: vi.fn(async () => ({ success: true, message: "Requested." })),
    routeToPlatformReviewer: vi.fn(async () => ({ kind: "routed", capsuleId: "WC-PIR-ADMIN", targetAgent: "AGT-WS-REVIEW", issued: "issued" })),
    ...overrides,
  };
}

beforeEach(() => {
  for (const model of Object.values(prismaMock)) for (const fn of Object.values(model)) fn.mockReset();
  prismaMock.workroomActivity.findFirst.mockResolvedValue(null);
  prismaMock.workroomActivity.create.mockResolvedValue({ id: "act" });
});

const adminRoom = { capsuleId: "WC-ADMIN", itemId: "BI-ADMIN", requestedByPrincipal: null,
  createdByPrincipal: aliases("human", [["user", "user-admin"]]) };

describe("platform reviewer when no author client is connected (BI-AA47C672)", () => {
  it("hands the owed review to the platform's own reviewer, for the identity readiness issued it to", async () => {
    store(adminRoom);
    const d = deps();
    const outcomes = await dispatchOwedIndependentReviews(d as never);
    expect(outcomes).toEqual([expect.objectContaining({ itemId: "BI-ADMIN", outcome: "platform-reviewer",
      carriedByAgentId: "AGT-WS-REVIEW", detail: expect.stringContaining("WC-PIR-ADMIN") })]);
    expect(d.routeToPlatformReviewer).toHaveBeenCalledWith(expect.objectContaining({ itemId: "BI-ADMIN",
      requestCoworker: pirPacket("BI-ADMIN"), issuer: { userId: "user-admin", agentId: null } }));
    expect(d.execute).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workCapsuleId: "row-WC-ADMIN",
      payload: expect.objectContaining({ outcome: "platform-reviewer" }) }) });
  });

  it("records no-author-connection, naming what is missing, when no in-platform reviewer can take it", async () => {
    store(adminRoom);
    const detail = "The reviewer readiness named, AGT-EXT-X, runs only outside the platform.";
    const d = deps({ routeToPlatformReviewer: vi.fn(async () => ({ kind: "ineligible", detail })) });
    await expect(dispatchOwedIndependentReviews(d as never)).resolves.toEqual([expect.objectContaining({ outcome: "no-author-connection", detail })]);
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      payload: expect.objectContaining({ outcome: "no-author-connection", detail }) }) });
  });

  it("keeps the author's live connection first", async () => {
    store(adminRoom);
    const connection = { token: { userId: "user-admin" }, userContext: {}, context: { agentId: "AGT-EXT-GROK", apiTokenId: "T", authSource: "oauth" } };
    const d = deps({ findUserConnection: vi.fn(async () => connection) });
    await expect(dispatchOwedIndependentReviews(d as never)).resolves.toEqual([expect.objectContaining({ outcome: "dispatched" })]);
    expect(d.routeToPlatformReviewer).not.toHaveBeenCalled();
  });

  it("collapses a repeated platform hand-off into one room record", async () => {
    store(adminRoom);
    prismaMock.workroomActivity.findFirst.mockResolvedValue({ id: "prev", recordedAt: new Date(NOW.getTime() - 7 * 3600_000),
      payload: { outcome: "platform-reviewer", detail: "The platform asked AGT-WS-REVIEW to review it in WC-PIR-ADMIN.", attempts: 2,
        nextAttemptAt: new Date(NOW.getTime() - 1000).toISOString() } });
    await dispatchOwedIndependentReviews(deps() as never);
    expect(prismaMock.workroomActivity.create).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.update).toHaveBeenCalledWith({ where: { id: "prev" }, data: { payload: expect.objectContaining({ attempts: 3 }) } });
  });
});
