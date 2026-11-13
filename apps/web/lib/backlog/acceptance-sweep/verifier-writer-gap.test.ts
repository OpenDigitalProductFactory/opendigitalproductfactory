// BI-1D5FCEBE: the production writer check reads stored grants the way the
// scheduler attaches tools, implications included. Live, PROD 2026-11-13:
// AGT-102 holds no grant authorizing record_workroom_evidence; AGT-903 holds
// work_capsule_write (implies workroom_evidence_write) and backlog_write
// (implies build_evidence).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tak/agent-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tak/agent-grants")>();
  const HELD: Record<string, string[]> = {
    "AGT-102": ["backlog_read", "backlog_write", "registry_read"],
    "AGT-903": ["backlog_write", "work_capsule_write", "registry_read"],
  };
  return { ...actual, getAgentToolGrantsAsync: vi.fn(async (agentId: string) => HELD[agentId] ?? []) };
});

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { storedGrantWriterGap } from "./acceptance-sweep-task";

describe("storedGrantWriterGap (BI-1D5FCEBE)", () => {
  const writers = ["record_workroom_evidence", "record_execution_evidence"];

  it("names the stage writer a coworker's stored grants do not authorize", async () => {
    expect(await storedGrantWriterGap("AGT-102", writers)).toEqual(["record_workroom_evidence"]);
  });

  it("counts implied grants, so a coworker holding work_capsule_write and backlog_write lacks nothing", async () => {
    expect(await storedGrantWriterGap("AGT-903", writers)).toEqual([]);
  });

  it("treats an unknown coworker as holding nothing", async () => {
    expect(await storedGrantWriterGap("AGT-NONE", writers)).toEqual(writers);
  });
});
