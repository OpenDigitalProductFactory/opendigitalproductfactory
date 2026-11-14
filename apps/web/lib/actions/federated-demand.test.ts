import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-626A4ECA: every interest spends the installation's weekly quadratic budget,
// and an unaffordable vote is refused with its cost rather than clamped or dropped.
const { mockFindMany, mockQueue } = vi.hoisted(() => ({ mockFindMany: vi.fn(), mockQueue: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { federatedRecordMirror: { findMany: mockFindMany } } }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/federation/demand-identity", () => ({
  resolveFederationIdentity: vi.fn().mockResolvedValue({ installationId: "inst_me", projectionSecret: "s" }),
}));
vi.mock("@/lib/federation/demand-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/federation/demand-response")>()),
  queueDemandResponse: mockQueue,
}));
vi.mock("@/lib/operate/backlog-ingest", () => ({ ingestBacklogItem: vi.fn() }));

import { respondToFederatedDemandAction } from "./federated-demand";

const sentThisWeek = (ref: string, weight: number) => ({
  localRecordRef: ref,
  payload: { envelope: { responseKind: "interest", ...(weight > 1 ? { weight } : {}), createdAt: new Date().toISOString() } },
});

describe("respondToFederatedDemandAction vote budget", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockQueue.mockReset();
    mockQueue.mockResolvedValue({ action: "queued", responseId: "rsp_1" });
  });

  it("queues an affordable vote with its weight", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await respondToFederatedDemandAction({ mirrorId: "fdm_1", kind: "interest", weight: 3 });
    expect(result.ok).toBe(true);
    expect(mockQueue.mock.calls[0][1]).toMatchObject({ mirrorId: "fdm_1", kind: "interest", weight: 3 });
  });

  it("refuses a vote the week's budget cannot afford, naming the cost, and sends nothing", async () => {
    // 16 + ... : one weight-4 vote has already spent the whole default budget.
    mockFindMany.mockResolvedValue([sentThisWeek("response:fdm_other:interest", 4)]);
    const result = await respondToFederatedDemandAction({ mirrorId: "fdm_1", kind: "interest" });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toMatch(/costs 1 credits and only 0 remain/);
    expect(mockQueue).not.toHaveBeenCalled();
  });

  it("reads only this week's responses, never the whole history", async () => {
    mockFindMany.mockResolvedValue([]);
    await respondToFederatedDemandAction({ mirrorId: "fdm_1", kind: "interest" });
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ recordType: "demand-response", canonicalSide: "local" });
    expect(where.updatedAt.gte).toBeInstanceOf(Date);
  });

  it("lets a voter re-weight the same item, refunding the earlier weight", async () => {
    mockFindMany.mockResolvedValue([sentThisWeek("response:fdm_1:interest", 4)]);
    const result = await respondToFederatedDemandAction({ mirrorId: "fdm_1", kind: "interest", weight: 2 });
    expect(result.ok).toBe(true);
  });

  it("does not charge a help offer against the vote budget", async () => {
    mockFindMany.mockResolvedValue([sentThisWeek("response:fdm_other:interest", 4)]);
    const result = await respondToFederatedDemandAction({ mirrorId: "fdm_1", kind: "help-offer" });
    expect(result.ok).toBe(true);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
