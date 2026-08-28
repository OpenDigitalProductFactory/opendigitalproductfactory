import { describe, expect, it } from "vitest";
import {
  SCHEDULED_AGENT_TASK_KINDS,
  isScheduledAgentTaskKind,
} from "./agent-task-kind";

describe("scheduled agent task kinds", () => {
  it("keeps the deterministic task discriminator closed", () => {
    expect(SCHEDULED_AGENT_TASK_KINDS).toEqual([
      "product-intelligence-watch",
      "product-management-playbook",
      "business-analysis-watch",
      "assurance-watch",
      "bookkeeping-cycle",
    ]);
    expect(isScheduledAgentTaskKind("product-intelligence-watch")).toBe(true);
    expect(isScheduledAgentTaskKind("product-management-playbook")).toBe(true);
    expect(isScheduledAgentTaskKind("business-analysis-watch")).toBe(true);
    expect(isScheduledAgentTaskKind("assurance-watch")).toBe(true);
    expect(isScheduledAgentTaskKind("bookkeeping-cycle")).toBe(true);
    expect(isScheduledAgentTaskKind("prompt-defined-work")).toBe(false);
  });
});
