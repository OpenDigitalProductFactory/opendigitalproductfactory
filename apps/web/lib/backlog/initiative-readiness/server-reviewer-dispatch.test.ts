// BI-A835D300 — the platform routes the independent review a delivered item
// owes through the author's own live connection, once per request per window,
// and records why when it cannot.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const prismaMock = vi.hoisted(() => ({
  workroom: { findMany: vi.fn() },
  backlogItem: { findMany: vi.fn() },
  workroomActivity: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

import { dispatchOwedIndependentReviews, dispatchReviewerRequest, REVIEW_DISPATCH_ACTIVITY_KIND } from "./server-reviewer-dispatch";

const NOW = new Date("2026-09-24T02:00:00.000Z");
const alias = (kind: string, value: string) => ({ kind, aliases: [{ aliasValue: value }] });

function room(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1", capsuleId: "WC-1", backlogItemId: "BI-1",
    requestedByPrincipal: alias("human", "user-1"),
    createdByPrincipal: alias("agent", "AGT-EXT-CODEX"),
    participants: [],
    ...overrides,
  };
}

const packet = {
  targetAgent: "AGT-WS-REVIEW",
  objective: "review",
  requestKey: "initiative-readiness:BI-1:post-implementation-review:abc",
  initiativeReviewBinding: { itemId: "BI-1" },
};
const connection = {
  token: { id: "TOK-1", scope: "write", scopes: [], userId: "user-1", agentId: "AGT-EXT-CODEX", authorityBindingId: "BIND-1" },
  userContext: { userId: "user-1", platformRole: "HR-000", isSuperuser: false },
  context: { agentId: "AGT-EXT-CODEX", apiTokenId: "TOK-1", authSource: "oauth" },
};

/** Rooms per query: the author query (any room) and the Build Studio candidate query (executorKind filter). */
function roomsByQuery(authorRooms: unknown[], buildStudioRooms: unknown[] = []) {
  prismaMock.workroom.findMany.mockImplementation(async (args: { where?: { executorKind?: string } }) =>
    args?.where?.executorKind === "build-studio" ? buildStudioRooms : authorRooms);
}

beforeEach(() => {
  for (const model of Object.values(prismaMock)) for (const fn of Object.values(model)) fn.mockReset();
  roomsByQuery([room()]);
  prismaMock.backlogItem.findMany.mockResolvedValue([{ itemId: "BI-1" }]);
  prismaMock.workroomActivity.findFirst.mockResolvedValue(null);
  prismaMock.workroomActivity.create.mockResolvedValue({ id: "act" });
});

function deps(overrides: Record<string, unknown> = {}) {
  return {
    now: NOW,
    random: () => 0.5,
    owedRoutes: vi.fn(async () => [{ workroomId: "WC-1", requestCoworker: packet }]),
    findConnection: vi.fn(async () => connection as never),
    findUserConnection: vi.fn(async () => null),
    execute: vi.fn(async () => ({ success: true, message: "Requested." })),
    ...overrides,
  };
}

describe("dispatchOwedIndependentReviews", () => {
  it("sends the exact server-issued request through the author's own connection and records it", async () => {
    const d = deps();
    const outcomes = await dispatchOwedIndependentReviews(d);
    expect(outcomes).toEqual([expect.objectContaining({ itemId: "BI-1", outcome: "dispatched", requestKey: packet.requestKey })]);
    expect(d.owedRoutes).toHaveBeenCalledWith("BI-1", "AGT-EXT-CODEX", expect.objectContaining({ target: "completion" }));
    expect(d.findConnection).toHaveBeenCalledWith("user-1", "AGT-EXT-CODEX");
    expect(d.execute).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "request_coworker", rawParams: packet, userId: "user-1", source: "external-jsonrpc",
      context: expect.objectContaining({ apiTokenId: "TOK-1", authSource: "oauth" }),
    }));
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workCapsuleId: "row-1", kind: REVIEW_DISPATCH_ACTIVITY_KIND,
      payload: expect.objectContaining({ outcome: "dispatched", requestKey: packet.requestKey, source: "platform-reviewer-dispatch" }),
    }) });
  });

  it("does not send the same request again inside the window", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue({ id: "recent" });
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ outcome: "cooling-down" })]);
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("leaves the review for its author, and says so, when the assistant has no live connection", async () => {
    const d = deps({ findConnection: vi.fn(async () => null) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ outcome: "no-author-connection" })]);
    expect(d.execute).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      summary: expect.stringContaining("no live authorized connection"),
    }) });
  });

  it("records a refusal from the governed lane without retrying it inside the window", async () => {
    const d = deps({ execute: vi.fn(async () => ({ success: false, error: "independent_review_request_denied", message: "Not admitted." })) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({
      outcome: "refused", detail: "independent_review_request_denied",
    })]);
  });

  it("does nothing for an item that owes no independent review", async () => {
    const d = deps({ owedRoutes: vi.fn(async () => []) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ outcome: "nothing-owed" })]);
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("never dispatches for a room whose author cannot be identified", async () => {
    roomsByQuery([room({ requestedByPrincipal: null })]);
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([]);
    expect(d.owedRoutes).not.toHaveBeenCalled();
  });

  it("uses the item's newest assistant-authored room when a newer room names no assistant", async () => {
    roomsByQuery([
      room({ id: "row-new", capsuleId: "WC-NEW", requestedByPrincipal: null, createdByPrincipal: alias("human", "user-1") }),
      room(),
    ]);
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ capsuleId: "WC-1", outcome: "dispatched" })]);
    expect(d.owedRoutes).toHaveBeenCalledWith("BI-1", "AGT-EXT-CODEX", expect.objectContaining({ target: "completion" }));
  });

  it("only considers items still awaiting acceptance", async () => {
    prismaMock.backlogItem.findMany.mockResolvedValue([]);
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([]);
    expect(prismaMock.backlogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: { in: ["BI-1"] }, status: "awaiting-acceptance" },
    }));
  });
});

describe("dispatchOwedIndependentReviews — Build Studio builds in plan (BI-926A7E90)", () => {
  // Build Studio rooms record the item's ROW id, not its BI- id.
  // Build Studio rooms record the item's ROW id and no requesting principal; the build records its creator.
  const buildRoom = { id: "row-bs", capsuleId: "WC-BS", backlogItemId: "cuid-item-bs", requestedByPrincipal: null, featureBuild: { createdById: "user-1" } };
  const revisionPacket = {
    targetAgent: "AGT-WS-REVIEW",
    objective: "review the design revision",
    requestKey: "initiative-readiness:BI-BS:spec-approval:sha256:design",
    initiativeReviewBinding: { itemId: "BI-BS", artifactRef: { kind: "feature-build-revision", revisionId: "rev_1" } },
  };
  const userConnection = {
    ...connection,
    token: { ...connection.token, agentId: "AGT-EXT-CLAUDE" },
    context: { agentId: "AGT-EXT-CLAUDE", apiTokenId: "TOK-CLAUDE", authSource: "oauth" },
  };

  beforeEach(() => {
    roomsByQuery([], [buildRoom]);
    prismaMock.backlogItem.findMany.mockResolvedValue([{ id: "cuid-item-bs", itemId: "BI-BS" }]);
  });

  it("routes the build's owed design reviews on a live connection of the person who requested it, and records the carrier", async () => {
    const d = deps({
      owedRoutes: vi.fn(async () => [{ workroomId: "WC-BS", requestCoworker: revisionPacket }]),
      findUserConnection: vi.fn(async () => userConnection as never),
    });
    const outcomes = await dispatchOwedIndependentReviews(d);
    expect(outcomes).toEqual([expect.objectContaining({
      itemId: "BI-BS", capsuleId: "WC-BS", outcome: "dispatched", requestKey: revisionPacket.requestKey, carriedByAgentId: "AGT-EXT-CLAUDE",
    })]);
    expect(d.owedRoutes).toHaveBeenCalledWith("BI-BS", "AGT-WS-BUILD", expect.objectContaining({ target: "implementation" }));
    expect(d.findUserConnection).toHaveBeenCalledWith("user-1");
    expect(d.findConnection).not.toHaveBeenCalled();
    expect(d.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "request_coworker", rawParams: revisionPacket, userId: "user-1" }));
    expect(prismaMock.backlogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ itemId: { in: ["cuid-item-bs"] } }, { id: { in: ["cuid-item-bs"] } }], status: { in: ["open", "in-progress"] } },
    }));
    expect(prismaMock.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ executorKind: "build-studio", featureBuild: { is: { phase: "plan" } } }),
    }));
  });

  it("says who must reconnect when the requesting person has no live connection", async () => {
    const d = deps({
      owedRoutes: vi.fn(async () => [{ workroomId: "WC-BS", requestCoworker: revisionPacket }]),
      findUserConnection: vi.fn(async () => null),
    });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ outcome: "no-author-connection" })]);
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workCapsuleId: "row-bs", summary: expect.stringContaining("person who requested the build"),
    }) });
  });

  it("keeps the cooldown: the same design yields the same key and is not re-requested inside the window (AC-4)", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue({ id: "recent" });
    const d = deps({ owedRoutes: vi.fn(async () => [{ workroomId: "WC-BS", requestCoworker: revisionPacket }]), findUserConnection: vi.fn(async () => userConnection as never) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ outcome: "cooling-down" })]);
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("skips a Build Studio room whose item is no longer open", async () => {
    prismaMock.backlogItem.findMany.mockResolvedValue([]);
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([]);
    expect(d.owedRoutes).not.toHaveBeenCalled();
  });
});

// BI-2C8750FC: the room drive's review stage sends one packet through the same runner.
describe("dispatchReviewerRequest (the drive's review-stage dispatch)", () => {
  const personRoom = { roomId: "row-1", capsuleId: "WC-1", userId: "user-1", agentId: null };

  it("carries person-authored work on the person's own live connection", async () => {
    const d = deps({ findUserConnection: vi.fn(async () => connection as never) });
    const outcome = await dispatchReviewerRequest({ room: personRoom, itemId: "BI-1", requestCoworker: packet, carrier: "requesting-user", now: NOW, deps: d });
    expect(outcome).toMatchObject({ outcome: "dispatched", requestKey: packet.requestKey, capsuleId: "WC-1" });
    expect(d.findUserConnection).toHaveBeenCalledWith("user-1");
    expect(d.findConnection).not.toHaveBeenCalled();
    expect(d.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "request_coworker", rawParams: packet }));
  });

  it("is idempotent on the request key within the cooldown", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue({ id: "recent" });
    const d = deps({ findUserConnection: vi.fn(async () => connection as never) });
    const outcome = await dispatchReviewerRequest({ room: personRoom, itemId: "BI-1", requestCoworker: packet, carrier: "requesting-user", now: NOW, deps: d });
    expect(outcome.outcome).toBe("cooling-down");
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("refuses a packet with no request key and records why it could not send without a connection", async () => {
    const d = deps();
    expect((await dispatchReviewerRequest({ room: personRoom, itemId: "BI-1", requestCoworker: { targetAgent: "AGT-WS-REVIEW" }, carrier: "requesting-user", now: NOW, deps: d })).outcome)
      .toBe("refused");
    const outcome = await dispatchReviewerRequest({ room: personRoom, itemId: "BI-1", requestCoworker: packet, carrier: "requesting-user", now: NOW, deps: d });
    expect(outcome.outcome).toBe("no-author-connection");
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ summary: expect.stringContaining("no live authorized connection") }) });
    expect(d.execute).not.toHaveBeenCalled();
  });
});
