import { describe, it, expect } from "vitest";
import { formatPhaseMessage, formatBuildCompleteMessage } from "./build-orchestrator";

describe("orchestrator communication templates", () => {
  it("formats specialist completion message", () => {
    const msg = formatPhaseMessage("data-architect", "Created Complaint model with 8 fields, 2 indexes, migration applied.");
    expect(msg).toBe("Data Architect complete: Created Complaint model with 8 fields, 2 indexes, migration applied.");
  });

  it("formats build complete message", () => {
    const msg = formatBuildCompleteMessage({
      totalTasks: 4,
      completedTasks: 4,
      failedTasks: 0,
      specialistSummaries: [
        { role: "data-architect", status: "DONE", outcome: "Complaint model with 8 fields" },
        { role: "software-engineer", status: "DONE", outcome: "4 API routes" },
        { role: "frontend-engineer", status: "DONE", outcome: "ComplaintList page" },
        { role: "qa-engineer", status: "DONE", outcome: "12 tests pass, typecheck clean" },
      ],
    });
    expect(msg).toContain("Build complete");
    expect(msg).toContain("4/4 tasks done");
    expect(msg).toContain("Ready for review");
  });

  it("formats partial failure message", () => {
    const msg = formatBuildCompleteMessage({
      totalTasks: 4,
      completedTasks: 3,
      failedTasks: 1,
      specialistSummaries: [
        { role: "data-architect", status: "DONE", outcome: "Complaint model with 8 fields" },
        { role: "software-engineer", status: "BLOCKED", outcome: "FAILED: Migration not found" },
        { role: "frontend-engineer", status: "DONE", outcome: "ComplaintList page" },
        { role: "qa-engineer", status: "DONE_WITH_CONCERNS", outcome: "8 tests pass, 4 failed" },
      ],
    });
    expect(msg).toContain("3/4 tasks done");
    expect(msg).toContain("1 failed");
    expect(msg).not.toContain("Ready for review");
  });
});
