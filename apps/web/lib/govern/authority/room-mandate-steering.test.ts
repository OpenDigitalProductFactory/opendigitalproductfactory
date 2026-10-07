// BI-C1781121 — a Workroom stage's declared writes steer its scheduled run.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { resolveSteering } from "./resolve-coworker-tool-authority";

describe("resolveSteering — a room stage mandate", () => {
  const base = {
    initiativeReviewBinding: null,
    roomAuthority: null,
    taskRunId: "TR-SCHED-1234ABCD",
    agentId: "AGT-WS-PORTFOLIO",
    roomMandatedTools: ["record_execution_evidence", "record_workroom_evidence"],
  };

  it("steers a declared write on a scheduled run", () => {
    expect(resolveSteering({ ...base, toolName: "record_workroom_evidence" })).toBe("scheduled-mandate");
  });

  // BI-7C7E8CAC: the runtime check a small item's acceptance owner records.
  it("steers record_execution_evidence for the room-bound coworker on its scheduled run", () => {
    expect(resolveSteering({ ...base, agentId: "AGT-WS-OPS", toolName: "record_execution_evidence" })).toBe("scheduled-mandate");
  });

  it("does not steer an undeclared write, or a run that is not scheduled", () => {
    expect(resolveSteering({ ...base, toolName: "record_initiative_evidence" })).toBe("none");
    expect(resolveSteering({ ...base, toolName: "record_workroom_evidence", taskRunId: "TR-MCP-abc" })).toBe("none");
    expect(resolveSteering({ ...base, toolName: "record_workroom_evidence", roomMandatedTools: null })).toBe("none");
  });
});
