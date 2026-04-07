import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTaskRequirement, BUILT_IN_TASK_REQUIREMENTS } from "./task-requirements";

const mockPrisma = {
  taskRequirement: {
    findUnique: vi.fn(),
  },
};
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

describe("BUILT_IN_TASK_REQUIREMENTS", () => {
  it("assigns adequate tier to simple conversation tasks", () => {
    expect(BUILT_IN_TASK_REQUIREMENTS["greeting"]?.minimumTier).toBe("adequate");
    expect(BUILT_IN_TASK_REQUIREMENTS["status-query"]?.minimumTier).toBe("adequate");
    expect(BUILT_IN_TASK_REQUIREMENTS["summarization"]?.minimumTier).toBe("adequate");
  });

  it("assigns strong tier to moderate tasks", () => {
    expect(BUILT_IN_TASK_REQUIREMENTS["data-extraction"]?.minimumTier).toBe("strong");
    expect(BUILT_IN_TASK_REQUIREMENTS["web-search"]?.minimumTier).toBe("strong");
    expect(BUILT_IN_TASK_REQUIREMENTS["creative"]?.minimumTier).toBe("strong");
  });

  it("assigns frontier tier to complex tasks", () => {
    expect(BUILT_IN_TASK_REQUIREMENTS["reasoning"]?.minimumTier).toBe("frontier");
    expect(BUILT_IN_TASK_REQUIREMENTS["code-gen"]?.minimumTier).toBe("frontier");
    expect(BUILT_IN_TASK_REQUIREMENTS["tool-action"]?.minimumTier).toBe("frontier");
  });

  it("marks cheap tasks as preferCheap=true", () => {
    expect(BUILT_IN_TASK_REQUIREMENTS["greeting"]?.preferCheap).toBe(true);
    expect(BUILT_IN_TASK_REQUIREMENTS["status-query"]?.preferCheap).toBe(true);
    expect(BUILT_IN_TASK_REQUIREMENTS["web-search"]?.preferCheap).toBe(true);
  });

  it("marks complex tasks as preferCheap=false", () => {
    expect(BUILT_IN_TASK_REQUIREMENTS["reasoning"]?.preferCheap).toBe(false);
    expect(BUILT_IN_TASK_REQUIREMENTS["code-gen"]?.preferCheap).toBe(false);
    expect(BUILT_IN_TASK_REQUIREMENTS["tool-action"]?.preferCheap).toBe(false);
  });
});

describe("getTaskRequirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level cache between tests
    vi.resetModules();
  });

  it("returns undefined for an unknown task type", async () => {
    mockPrisma.taskRequirement.findUnique.mockResolvedValueOnce(null);
    const { getTaskRequirement: get } = await import("./task-requirements");
    const result = await get("nonexistent-task");
    expect(result).toBeUndefined();
  });

  it("returns built-in requirement when DB returns null", async () => {
    mockPrisma.taskRequirement.findUnique.mockResolvedValueOnce(null);
    const { getTaskRequirement: get } = await import("./task-requirements");
    const result = await get("greeting");
    expect(result?.taskType).toBe("greeting");
    expect(result?.minimumTier).toBe("adequate");
  });

  it("returns DB row when one exists, overriding built-in", async () => {
    const dbRow = {
      taskType: "greeting",
      description: "Custom greeting from DB",
      selectionRationale: "DB override",
      requiredCapabilities: {},
      preferredMinScores: { conversational: 60 },
      minimumTier: "strong",  // admin upgraded the tier
      preferCheap: false,
      origin: "user",
    };
    mockPrisma.taskRequirement.findUnique.mockResolvedValueOnce(dbRow);
    const { getTaskRequirement: get } = await import("./task-requirements");
    const result = await get("greeting");
    expect(result?.minimumTier).toBe("strong");
    expect(result?.description).toBe("Custom greeting from DB");
  });
});
