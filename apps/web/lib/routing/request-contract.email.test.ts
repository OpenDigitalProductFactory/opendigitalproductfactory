import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the task-requirement loader so inferContract's behaviour is tested against
// controlled requirement contracts (no DB). quality-tiers stays real (pure).
vi.mock("./task-requirements", () => ({
  getTaskRequirement: vi.fn(),
}));

import { getTaskRequirement } from "./task-requirements";
import { inferContract } from "./request-contract";
import type { TaskRequirement } from "./task-router-types";

const mockGet = getTaskRequirement as unknown as ReturnType<typeof vi.fn>;

function req(partial: Partial<TaskRequirement>): TaskRequirement {
  return {
    taskType: "x",
    description: "",
    selectionRationale: "",
    requiredCapabilities: {},
    preferredMinScores: {},
    origin: "system",
    ...partial,
  };
}

const MSGS = [{ role: "user", content: "hello" }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inferContract honours task-requirement routing-posture defaults", () => {
  it("applies budgetClassDefault, reasoningDepthDefault, and residencyPolicy from the requirement", async () => {
    mockGet.mockResolvedValue(
      req({
        taskType: "email-triage",
        minimumTier: "adequate",
        budgetClassDefault: "minimize_cost",
        reasoningDepthDefault: "low",
        residencyPolicy: "local_only",
      })
    );
    const c = await inferContract("email-triage", MSGS);
    expect(c.budgetClass).toBe("minimize_cost");
    expect(c.reasoningDepth).toBe("low");
    expect(c.residencyPolicy).toBe("local_only");
  });

  it("lets an explicit caller routeContext override the requirement default", async () => {
    mockGet.mockResolvedValue(
      req({ taskType: "email-triage", budgetClassDefault: "minimize_cost" })
    );
    const c = await inferContract("email-triage", MSGS, undefined, undefined, {
      budgetClass: "quality_first",
    });
    expect(c.budgetClass).toBe("quality_first");
  });

  it("falls back to balanced/heuristic when the requirement sets no posture defaults (regression)", async () => {
    // Mirrors existing built-ins (e.g. summarization) that set only minimumTier.
    mockGet.mockResolvedValue(req({ taskType: "summarization", minimumTier: "adequate" }));
    const c = await inferContract("summarization", MSGS);
    expect(c.budgetClass).toBe("balanced");
    expect(c.reasoningDepth).toBe("low"); // DEFAULT_REASONING_DEPTH["summarization"]
    expect(c.residencyPolicy).toBeUndefined();
  });

  it("is non-fatal when the requirement lookup throws (no DB)", async () => {
    mockGet.mockRejectedValue(new Error("no db"));
    const c = await inferContract("conversation", MSGS);
    expect(c.budgetClass).toBe("balanced");
    expect(c.residencyPolicy).toBeUndefined();
  });
});
