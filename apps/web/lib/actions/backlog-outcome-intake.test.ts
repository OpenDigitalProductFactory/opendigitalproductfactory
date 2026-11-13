import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-B1B44777, BI-8DE5429B: the portal backlog form's create action stores the
// outcome the item delivers in its outcome field, and still files an item
// without one, with a derived draft marked derived.

const { mockPrisma, txCreate } = vi.hoisted(() => {
  const txCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: "row-1", demandStage: null }));
  return {
    txCreate,
    mockPrisma: {
      $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
        work({ backlogItem: { create: txCreate }, backlogItemActivity: { create: vi.fn() } })),
    },
  };
});

vi.mock("@dpf/db", () => ({ prisma: mockPrisma, attributeBacklogPortfolio: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1", type: "admin" } })) }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createBacklogItem } from "./backlog";

beforeEach(() => txCreate.mockClear());

const base = { title: "Overdue invoices view", type: "portfolio" as const, workType: "feature" as const, status: "open" as const };

describe("portal backlog intake captures the outcome (BI-B1B44777)", () => {
  it("stores the stated outcome in its field and keeps the notes as the body", async () => {
    await createBacklogItem({ ...base, outcome: "Finance sees every overdue invoice in one list.", body: "Asked for by finance." });
    expect(txCreate.mock.calls[0]![0].data).toMatchObject({
      outcome: "Finance sees every overdue invoice in one list.", outcomeSource: "stated", body: "Asked for by finance.",
    });
  });

  it("files an item with notes and no outcome, with a derived draft", async () => {
    await createBacklogItem({ ...base, body: "  Just notes.  " });
    expect(txCreate.mock.calls[0]![0].data).toMatchObject({
      body: "Just notes.",
      outcome: '"Overdue invoices view" is in place and working for the people it is for.',
      outcomeSource: "derived",
    });
  });
});
