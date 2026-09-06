import { describe, expect, it, vi } from "vitest";

const { mockSupersede } = vi.hoisted(() => ({ mockSupersede: vi.fn() }));

vi.mock("@dpf/db", () => ({ prisma: { edgeNode: {}, edgeNodeCertificate: {}, $transaction: vi.fn() } }));
vi.mock("@/lib/edge-node/stale-supersession", () => ({ supersedeStaleInstallerNodes: mockSupersede }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: vi.fn(async () => ({ proceed: true })) }));
vi.mock("../inngest-client", () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
  },
}));

import { edgeNodeJanitor } from "./edge-node-janitor";

describe("edgeNodeJanitor (BI-D4F79CE2)", () => {
  it("is an hourly cron that runs the stale-enrollment supersession as one step", async () => {
    const fn = edgeNodeJanitor as unknown as {
      config: { id: string; triggers: Array<{ cron?: string }> };
      handler: (ctx: { step: { run: (name: string, f: () => Promise<unknown>) => Promise<unknown> } }) => Promise<unknown>;
    };
    expect(fn.config.id).toBe("ops/edge-node-janitor");
    expect(JSON.stringify(fn.config.triggers)).toContain("33 * * * *");

    mockSupersede.mockResolvedValue({ decision: { liveNodeIds: ["edge_native"], retire: [], skipped: null }, revoked: ["edge_container"] });
    const run = vi.fn(async (_name: string, f: () => Promise<unknown>) => f());
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await fn.handler({ step: { run } });

    expect(run).toHaveBeenCalledWith("supersede-stale-installer-nodes", expect.any(Function));
    expect(mockSupersede).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ supersession: { revoked: ["edge_container"] } });
    expect(info).toHaveBeenCalledWith(expect.stringContaining("edge_container"));
    info.mockRestore();
  });
});
