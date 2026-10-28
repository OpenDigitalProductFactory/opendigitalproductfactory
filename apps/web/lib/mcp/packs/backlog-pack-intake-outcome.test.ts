import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-B1B44777: create_backlog_item — the intake every agent, coworker and
// Build Studio brief files through — carries the outcome to the shared front
// door and prompts, without refusing, when none is stated.

const ingest = vi.hoisted(() => ({ ingestBacklogItem: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/operate/backlog-ingest", () => ({
  ingestBacklogItem: (...args: unknown[]) => ingest.ingestBacklogItem(...args),
}));

import { backlogPack } from "./backlog-pack";
import { backlogPackDefinitions } from "./backlog-pack-definitions";

beforeEach(() => {
  ingest.ingestBacklogItem.mockReset();
});

describe("create_backlog_item captures the outcome (BI-B1B44777)", () => {
  it("declares outcome and howWeKnow as optional inputs and names the contractual tag", () => {
    const tool = backlogPackDefinitions.find((entry) => entry.name === "create_backlog_item")!;
    const properties = (tool.inputSchema as { properties: Record<string, unknown>; required: string[] }).properties;
    expect(properties).toHaveProperty("outcome");
    expect(properties).toHaveProperty("howWeKnow");
    expect((tool.inputSchema as { required: string[] }).required).not.toContain("outcome");
    expect(tool.description).toContain("contractual");
  });

  it("passes the outcome to the front door and does not prompt for it", async () => {
    ingest.ingestBacklogItem.mockResolvedValue({ itemId: "BI-NEW", id: "row", created: true, outcomeStated: true });
    const result = await backlogPack.handlers.create_backlog_item!(
      { title: "Overdue invoices view", type: "portfolio", workType: "feature",
        outcome: "Finance sees every overdue invoice in one list.", howWeKnow: "No more spreadsheet exports." },
      "user-1",
    );
    expect(result.success).toBe(true);
    expect(ingest.ingestBacklogItem).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "Finance sees every overdue invoice in one list.",
      howWeKnow: "No more spreadsheet exports.",
    }));
    expect(result.message).not.toContain("No outcome stated");
  });

  it("files an item with no outcome and prompts for one", async () => {
    ingest.ingestBacklogItem.mockResolvedValue({ itemId: "BI-NEW", id: "row", created: true, outcomeStated: false });
    const result = await backlogPack.handlers.create_backlog_item!(
      { title: "Something", type: "portfolio", workType: "bug", body: "Broken." },
      "user-1",
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("No outcome stated");
  });
});
