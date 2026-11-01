// BI-A835D300 — the platform routes the independent review a delivered item
// owes through the author's own live connection, once per request per window,
// and records why when it cannot.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const prismaMock = vi.hoisted(() => ({
  workroom: { findMany: vi.fn() },
  backlogItem: { findMany: vi.fn() },
  workroomActivity: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: prismaMock }));
const recoveryMock = vi.hoisted(() => ({ getBacklogItem: vi.fn(), resolveTerminalInitiativeRecovery: vi.fn() }));
vi.mock("@/lib/mcp/packs/backlog-pack-read-tools", () => ({ getBacklogItem: recoveryMock.getBacklogItem }));
vi.mock("./terminal-recovery", () => ({ resolveTerminalInitiativeRecovery: recoveryMock.resolveTerminalInitiativeRecovery }));

import {
  dispatchOwedIndependentReviews,
  dispatchReviewerRequest,
  REVIEW_DISPATCH_ACTIVITY_KIND,
  REVIEW_DISPATCH_COOLDOWN_MS,
  REVIEW_DISPATCH_MAX_BACKOFF_MS,
} from "./server-reviewer-dispatch";

const NOW = new Date("2026-09-24T02:00:00.000Z");
/** A dispatch recorded inside the cooldown window. */
const RECENT_DISPATCH = { id: "recent", recordedAt: new Date(NOW.getTime() - 60_000), payload: { outcome: "dispatched" } };
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
  recoveryMock.getBacklogItem.mockReset();
  recoveryMock.resolveTerminalInitiativeRecovery.mockReset();
  for (const model of Object.values(prismaMock)) for (const fn of Object.values(model)) fn.mockReset();
  roomsByQuery([room()]);
  prismaMock.backlogItem.findMany.mockResolvedValue([{ itemId: "BI-1", status: "awaiting-acceptance" }]);
  prismaMock.workroomActivity.findFirst.mockResolvedValue(null);
  prismaMock.workroomActivity.create.mockResolvedValue({ id: "act" });
  prismaMock.workroomActivity.update.mockResolvedValue({ id: "act" });
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
  it("records an uncertain idempotent replay as held instead of a new reviewer dispatch", async () => {
    const d = deps({ execute: vi.fn(async () => ({ success: true, data: {
      taskRunId: "TR-ORIGINAL", idempotentReplay: true, resumable: false,
      waitReason: "execution-uncertain", status: "input-required" } })) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toMatchObject([{ outcome: "refused", detail: expect.stringMatching(/existing execution/i) }]);
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      summary: expect.stringMatching(/existing execution/i), payload: expect.objectContaining({ outcome: "refused" }),
    }) });
    expect(d.execute).toHaveBeenCalledTimes(1);
  });
  it("supplies the recorded requesting person to body acceptance recovery", async () => {
    recoveryMock.getBacklogItem.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: { verdict: "input-required" } } } } });
    recoveryMock.resolveTerminalInitiativeRecovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, workroomId: "WC-1", requestCoworker: packet }] });
    const d = deps({ owedRoutes: undefined });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toMatchObject([{ outcome: "dispatched" }]);
    expect(recoveryMock.getBacklogItem).toHaveBeenCalledWith({ itemId: "BI-1" }, "AGT-EXT-CODEX", "user-1");
    expect(recoveryMock.resolveTerminalInitiativeRecovery).toHaveBeenCalledWith(expect.objectContaining({ currentUserId: "user-1" }));
  });

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
    prismaMock.workroomActivity.findFirst.mockResolvedValue(RECENT_DISPATCH);
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

  it("only considers items awaiting acceptance or still in design and delivery", async () => {
    prismaMock.backlogItem.findMany.mockResolvedValue([]);
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([]);
    expect(prismaMock.backlogItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: { in: ["BI-1"] }, status: { in: ["awaiting-acceptance", "open", "in-progress"] } },
    }));
  });
});

// BI-3A462B04: owed design-stage reviews no longer wait on the author's client.
describe("dispatchOwedIndependentReviews — design-stage reviews of open items (BI-3A462B04)", () => {
  const designPacket = { ...packet, requestKey: "initiative-readiness:BI-1:spec-approval:def" };

  it("sends an open item's owed design review on the author's live connection", async () => {
    prismaMock.backlogItem.findMany.mockResolvedValue([{ itemId: "BI-1", status: "open" }]);
    const d = deps({ owedRoutes: vi.fn(async () => [{ workroomId: "WC-1", requestCoworker: designPacket }]) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([
      expect.objectContaining({ itemId: "BI-1", outcome: "dispatched", requestKey: designPacket.requestKey }),
    ]);
    expect(d.owedRoutes).toHaveBeenCalledWith("BI-1", "AGT-EXT-CODEX", expect.objectContaining({ target: "design" }));
    // The author's own consent-bound connection carries it, never another person's.
    expect(d.findConnection).toHaveBeenCalledWith("user-1", "AGT-EXT-CODEX");
    expect(d.findUserConnection).not.toHaveBeenCalled();
    expect(d.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "request_coworker", rawParams: designPacket }));
  });

  it("records why, and leaves it for the author, when the author has no live connection", async () => {
    prismaMock.backlogItem.findMany.mockResolvedValue([{ itemId: "BI-1", status: "in-progress" }]);
    const d = deps({ findConnection: vi.fn(async () => null), owedRoutes: vi.fn(async () => [{ workroomId: "WC-1", requestCoworker: designPacket }]) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ outcome: "no-author-connection" })]);
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("does nothing for an open item whose design reviews are not owed", async () => {
    prismaMock.backlogItem.findMany.mockResolvedValue([{ itemId: "BI-1", status: "open" }]);
    const d = deps({ owedRoutes: vi.fn(async () => []) });
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ outcome: "nothing-owed" })]);
    expect(d.execute).not.toHaveBeenCalled();
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
    prismaMock.workroomActivity.findFirst.mockResolvedValue(RECENT_DISPATCH);
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
    prismaMock.workroomActivity.findFirst.mockResolvedValue(RECENT_DISPATCH);
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

// BI-CD53F5F5 AC-2: a refusal for one request is recorded once, then re-attempted
// on a growing back-off instead of writing a new room row every tick (1,879 rows
// for 79 requests in three days on the dev install, 2026-10-27).
describe("dispatchReviewerRequest — a standing refusal is recorded once, with back-off (BI-CD53F5F5)", () => {
  const personRoom = { roomId: "row-1", capsuleId: "WC-1", userId: "user-1", agentId: null };
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const send = (now: Date, d = deps()) =>
    dispatchReviewerRequest({ room: personRoom, itemId: "BI-1", requestCoworker: packet, carrier: "requesting-user", now, deps: d });
  const standing = (attempts: number, lastAttemptAt: Date, nextAttemptAt: Date, extra: Record<string, unknown> = {}) => ({
    id: "act-standing",
    recordedAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
    payload: {
      itemId: "BI-1", capsuleId: "WC-1", requestKey: packet.requestKey, outcome: "no-author-connection", source: "platform-reviewer-dispatch",
      attempts, lastAttemptAt: lastAttemptAt.toISOString(), nextAttemptAt: nextAttemptAt.toISOString(), ...extra,
    },
  });

  it("records the first refusal once, with its next attempt one cooldown away", async () => {
    await expect(send(NOW)).resolves.toMatchObject({ outcome: "no-author-connection" });
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      payload: expect.objectContaining({ attempts: 1, nextAttemptAt: at(REVIEW_DISPATCH_COOLDOWN_MS).toISOString() }),
    }) });
  });

  it("does not re-attempt before the standing refusal's next attempt is due", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue(standing(3, at(-60_000), at(60_000)));
    const d = deps();
    await expect(send(NOW, d)).resolves.toMatchObject({ outcome: "cooling-down" });
    expect(d.findUserConnection).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.create).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.update).not.toHaveBeenCalled();
  });

  it("re-attempts when due and, refused the same way again, updates the one row with a doubled back-off instead of writing another", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue(standing(2, at(-REVIEW_DISPATCH_COOLDOWN_MS * 2), at(-1)));
    const d = deps();
    await expect(send(NOW, d)).resolves.toMatchObject({ outcome: "no-author-connection" });
    expect(d.findUserConnection).toHaveBeenCalledWith("user-1");
    expect(prismaMock.workroomActivity.create).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.update).toHaveBeenCalledWith({
      where: { id: "act-standing" },
      data: { payload: expect.objectContaining({
        outcome: "no-author-connection", attempts: 3,
        lastAttemptAt: NOW.toISOString(), nextAttemptAt: at(REVIEW_DISPATCH_COOLDOWN_MS * 4).toISOString(),
      }) },
    });
  });

  it("caps the back-off", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue(standing(40, at(-REVIEW_DISPATCH_MAX_BACKOFF_MS), at(-1)));
    await send(NOW);
    expect(prismaMock.workroomActivity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { payload: expect.objectContaining({ attempts: 41, nextAttemptAt: at(REVIEW_DISPATCH_MAX_BACKOFF_MS).toISOString() }) },
    }));
  });

  it("treats a pre-back-off refusal row as one attempt, due one cooldown after it was recorded", async () => {
    const legacy = { id: "act-legacy", recordedAt: at(-REVIEW_DISPATCH_COOLDOWN_MS - 1),
      payload: { requestKey: packet.requestKey, outcome: "no-author-connection", source: "platform-reviewer-dispatch" } };
    prismaMock.workroomActivity.findFirst.mockResolvedValue(legacy);
    await send(NOW);
    expect(prismaMock.workroomActivity.create).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "act-legacy" }, data: { payload: expect.objectContaining({ attempts: 2 }) },
    }));
  });

  // BI-D1DAB5AF: a refusal recorded by the code the portal ran before this
  // process started may already be fixed (47 Build Studio plan rooms waited up
  // to 5.5h after #6707 booted on 2026-10-28). Retry it once on the new code.
  it("re-attempts a standing refusal recorded before this process started, even inside its back-off", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue(standing(5, at(-60 * 60 * 1000), at(3 * 60 * 60 * 1000)));
    const d = deps({ processStartedAt: at(-5 * 60 * 1000) });
    await expect(send(NOW, d)).resolves.toMatchObject({ outcome: "no-author-connection" });
    expect(d.findUserConnection).toHaveBeenCalledWith("user-1");
    expect(prismaMock.workroomActivity.update).toHaveBeenCalledWith({
      where: { id: "act-standing" },
      data: { payload: expect.objectContaining({
        attempts: 6, lastAttemptAt: NOW.toISOString(), nextAttemptAt: at(REVIEW_DISPATCH_MAX_BACKOFF_MS).toISOString(),
      }) },
    });
  });

  it("keeps the back-off for a refusal this process recorded itself", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue(standing(5, at(-60_000), at(3 * 60 * 60 * 1000)));
    const d = deps({ processStartedAt: at(-5 * 60 * 1000) });
    await expect(send(NOW, d)).resolves.toMatchObject({ outcome: "cooling-down" });
    expect(d.findUserConnection).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.update).not.toHaveBeenCalled();
  });

  it("keeps the ordinary cooldown after a dispatch, whatever the process start", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue(RECENT_DISPATCH);
    const d = deps({ processStartedAt: at(-1000) });
    await expect(send(NOW, d)).resolves.toMatchObject({ outcome: "cooling-down" });
    expect(d.findUserConnection).not.toHaveBeenCalled();
  });

  it("records a new row when the outcome changes: the request is finally sent", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue(standing(4, at(-REVIEW_DISPATCH_COOLDOWN_MS * 8), at(-1)));
    const d = deps({ findUserConnection: vi.fn(async () => connection as never) });
    await expect(send(NOW, d)).resolves.toMatchObject({ outcome: "dispatched" });
    expect(prismaMock.workroomActivity.update).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      payload: expect.objectContaining({ outcome: "dispatched" }),
    }) });
  });

  it("records a new row when a different refusal replaces the standing one", async () => {
    prismaMock.workroomActivity.findFirst.mockResolvedValue(standing(2, at(-REVIEW_DISPATCH_COOLDOWN_MS * 2), at(-1)));
    const d = deps({
      findUserConnection: vi.fn(async () => connection as never),
      execute: vi.fn(async () => ({ success: false, error: "independent_review_request_denied" })),
    });
    await expect(send(NOW, d)).resolves.toMatchObject({ outcome: "refused" });
    expect(prismaMock.workroomActivity.update).not.toHaveBeenCalled();
    expect(prismaMock.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      payload: expect.objectContaining({ outcome: "refused", attempts: 1 }),
    }) });
  });

  it("reads only this room's newest record for this request key", async () => {
    await send(NOW);
    expect(prismaMock.workroomActivity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { workCapsuleId: "row-1", kind: REVIEW_DISPATCH_ACTIVITY_KIND, payload: { path: ["requestKey"], equals: packet.requestKey } },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    }));
  });
});
