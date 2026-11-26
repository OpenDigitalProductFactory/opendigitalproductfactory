import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  owner: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/workroom-runtime/s5-rehearsal-owner.server", () => ({
  createS5RehearsalOwnerHandler: (ports: { withOwnerRead: (read: unknown) => unknown }) => () => ports.withOwnerRead(mocks.read),
  createS5RehearsalOwnerReads: mocks.owner,
}));

import { GET } from "./route";

describe("internal S5 admission registration", () => {
  it("keeps the owner join in a repeatable, explicitly read-only DB transaction", async () => {
    const tx = { $executeRaw: vi.fn() };
    mocks.transaction.mockImplementation((run) => run(tx));
    const result = new Response("fixture");
    mocks.read.mockResolvedValue(result);
    const owner = {};
    mocks.owner.mockReturnValue(owner);
    expect(await GET(new Request("http://localhost:3001/api/internal/s5-rehearsal-admission"))).toBe(result);
    expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
    expect(tx.$executeRaw).toHaveBeenCalledExactlyOnceWith(["SET TRANSACTION READ ONLY"]);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.owner.mock.invocationCallOrder[0]!);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(owner);
  });
});
