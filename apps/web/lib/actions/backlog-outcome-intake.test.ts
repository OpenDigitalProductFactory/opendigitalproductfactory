import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-B1B44777: the portal backlog form's create action stores the outcome the
// item delivers at the top of its body, and still files an item without one.

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
  it("writes the outcome first and keeps the notes", async () => {
    await createBacklogItem({ ...base, outcome: "Finance sees every overdue invoice in one list.", body: "Asked for by finance." });
    expect(txCreate.mock.calls[0]![0].data.body)
      .toBe("## Outcome\nFinance sees every overdue invoice in one list.\n\nAsked for by finance.");
  });

  it("files an item with notes and no outcome exactly as before", async () => {
    await createBacklogItem({ ...base, body: "  Just notes.  " });
    expect(txCreate.mock.calls[0]![0].data.body).toBe("Just notes.");
  });
});
