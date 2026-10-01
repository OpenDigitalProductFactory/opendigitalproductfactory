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

import { dispatchOwedIndependentReviews, REVIEW_DISPATCH_ACTIVITY_KIND } from "./server-reviewer-dispatch";

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

beforeEach(() => {
  for (const model of Object.values(prismaMock)) for (const fn of Object.values(model)) fn.mockReset();
  prismaMock.workroom.findMany.mockResolvedValue([room()]);
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
    execute: vi.fn(async () => ({ success: true, message: "Requested." })),
    ...overrides,
  };
}

describe("dispatchOwedIndependentReviews", () => {
  it("sends the exact server-issued request through the author's own connection and records it", async () => {
    const d = deps();
    const outcomes = await dispatchOwedIndependentReviews(d);
    expect(outcomes).toEqual([expect.objectContaining({ itemId: "BI-1", outcome: "dispatched", requestKey: packet.requestKey })]);
    expect(d.owedRoutes).toHaveBeenCalledWith("BI-1", "AGT-EXT-CODEX");
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
    prismaMock.workroom.findMany.mockResolvedValue([room({ requestedByPrincipal: null })]);
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([]);
    expect(d.owedRoutes).not.toHaveBeenCalled();
  });

  it("uses the item's newest assistant-authored room when a newer room names no assistant", async () => {
    prismaMock.workroom.findMany.mockResolvedValue([
      room({ id: "row-new", capsuleId: "WC-NEW", requestedByPrincipal: null, createdByPrincipal: alias("human", "user-1") }),
      room(),
    ]);
    const d = deps();
    await expect(dispatchOwedIndependentReviews(d)).resolves.toEqual([expect.objectContaining({ capsuleId: "WC-1", outcome: "dispatched" })]);
    expect(d.owedRoutes).toHaveBeenCalledWith("BI-1", "AGT-EXT-CODEX");
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
