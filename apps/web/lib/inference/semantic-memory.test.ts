// apps/web/lib/semantic-memory.test.ts
// Tests for semantic-memory.ts — platform knowledge storage and retrieval.

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @dpf/db — must cover all imports used by semantic-memory.ts
vi.mock("@dpf/db", () => ({
  upsertVectors: vi.fn(),
  searchSimilar: vi.fn().mockResolvedValue([]),
  scrollPoints: vi.fn().mockResolvedValue([]),
  hashToNumber: vi.fn().mockReturnValue(12345),
  QDRANT_COLLECTIONS: {
    AGENT_MEMORY: "agent-memory",
    PLATFORM_KNOWLEDGE: "platform-knowledge",
  },
}));

vi.mock("./embedding", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

describe("storeCapabilityKnowledge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("generates point ID as capability-{specRef}-{actionName} and stores structured payload", async () => {
    const { upsertVectors } = await import("@dpf/db");
    const { storeCapabilityKnowledge } = await import("./semantic-memory");

    await storeCapabilityKnowledge({
      specRef: "EP-EMP-001",
      actionName: "create_employee",
      route: "/employee",
      description: "Create a new employee",
      parameterSummary: "name, email required",
      requiredCapability: "manage_user_lifecycle",
      sideEffect: true,
      lifecycleStatus: "planned",
    });

    expect(upsertVectors).toHaveBeenCalledWith(
      "platform-knowledge",
      expect.arrayContaining([
        expect.objectContaining({
          id: "capability-EP-EMP-001-create_employee",
          payload: expect.objectContaining({
            entityType: "capability",
            route: "/employee",
            action_name: "create_employee",
            lifecycle_status: "planned",
            side_effect: true,
            spec_ref: "EP-EMP-001",
          }),
        }),
      ]),
    );
  });

  it("includes required_capability and parameter_summary in payload", async () => {
    const { upsertVectors } = await import("@dpf/db");
    const { storeCapabilityKnowledge } = await import("./semantic-memory");

    await storeCapabilityKnowledge({
      specRef: "EP-EMP-001",
      actionName: "delete_employee",
      route: "/employee",
      description: "Delete an employee",
      parameterSummary: "employee_id required",
      requiredCapability: null,
      sideEffect: true,
      lifecycleStatus: "build",
    });

    expect(upsertVectors).toHaveBeenCalledWith(
      "platform-knowledge",
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            required_capability: "",
            parameter_summary: "employee_id required",
          }),
        }),
      ]),
    );
  });

  it("does nothing when generateEmbedding returns null", async () => {
    const { generateEmbedding } = await import("./embedding");
    const { upsertVectors } = await import("@dpf/db");
    const { storeCapabilityKnowledge } = await import("./semantic-memory");

    vi.mocked(generateEmbedding).mockResolvedValueOnce(null);

    await storeCapabilityKnowledge({
      specRef: "EP-X-001",
      actionName: "test_action",
      route: "/test",
      description: "Test",
      parameterSummary: "",
      requiredCapability: null,
      sideEffect: false,
      lifecycleStatus: "planned",
    });

    expect(upsertVectors).not.toHaveBeenCalled();
  });
});

describe("lookupCapabilityByFilter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("calls scrollPoints with payload filter conditions", async () => {
    const { scrollPoints } = await import("@dpf/db");
    const { lookupCapabilityByFilter } = await import("./semantic-memory");

    await lookupCapabilityByFilter({ route: "/employee", lifecycleStatus: "production" });

    expect(scrollPoints).toHaveBeenCalledWith(
      "platform-knowledge",
      {
        must: [
          { key: "entityType", match: { value: "capability" } },
          { key: "route", match: { value: "/employee" } },
          { key: "lifecycle_status", match: { value: "production" } },
        ],
      },
      100,
    );
  });

  it("returns empty array when no filters provided", async () => {
    const { lookupCapabilityByFilter } = await import("./semantic-memory");
    const result = await lookupCapabilityByFilter({});
    expect(result).toEqual([]);
  });

  it("maps returned points to structured results", async () => {
    const { scrollPoints } = await import("@dpf/db");
    const { lookupCapabilityByFilter } = await import("./semantic-memory");

    vi.mocked(scrollPoints).mockResolvedValueOnce([
      {
        id: 12345,
        payload: {
          action_name: "create_employee",
          spec_ref: "EP-EMP-001",
          lifecycle_status: "production",
          route: "/employee",
        },
      },
    ]);

    const results = await lookupCapabilityByFilter({ specRef: "EP-EMP-001" });

    expect(results).toEqual([
      {
        actionName: "create_employee",
        specRef: "EP-EMP-001",
        lifecycleStatus: "production",
        route: "/employee",
      },
    ]);
  });

  it("builds filter with single condition when one filter given", async () => {
    const { scrollPoints } = await import("@dpf/db");
    const { lookupCapabilityByFilter } = await import("./semantic-memory");

    await lookupCapabilityByFilter({ actionName: "create_employee" });

    expect(scrollPoints).toHaveBeenCalledWith(
      "platform-knowledge",
      {
        must: [
          { key: "entityType", match: { value: "capability" } },
          { key: "action_name", match: { value: "create_employee" } },
        ],
      },
      100,
    );
  });
});

describe("governed semantic recall", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("stores the operating profile fingerprint with conversation memory payloads", async () => {
    const { upsertVectors } = await import("@dpf/db");
    const { storeConversationMemory } = await import("./semantic-memory");

    await storeConversationMemory({
      messageId: "msg-1",
      content: "Deploy it after approval.",
      role: "assistant",
      userId: "user-1",
      agentId: "build-specialist",
      routeContext: "/build",
      threadId: "thread-1",
      operatingProfileFingerprint: "fp-123",
    });

    expect(upsertVectors).toHaveBeenCalledWith(
      "agent-memory",
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            operatingProfileFingerprint: "fp-123",
          }),
        }),
      ]),
    );
  });

  it("withholds stale semantic recall when consequential use requires the current fingerprint", async () => {
    const { searchSimilar } = await import("@dpf/db");
    vi.mocked(searchSimilar).mockResolvedValue([
      {
        id: "fresh-1",
        score: 0.92,
        payload: {
          messageId: "fresh-1",
          role: "assistant",
          routeContext: "/build",
          contentPreview: "Use the rollout checklist.",
          operatingProfileFingerprint: "fp-current",
        },
      },
      {
        id: "stale-1",
        score: 0.88,
        payload: {
          messageId: "stale-1",
          role: "assistant",
          routeContext: "/build",
          contentPreview: "Skip approval and push now.",
          operatingProfileFingerprint: "fp-old",
        },
      },
    ] as never);

    const { recallGovernedContext } = await import("./semantic-memory");
    const result = await recallGovernedContext({
      query: "What should happen next?",
      userId: "user-1",
      routeContext: "/build",
      currentOperatingProfileFingerprint: "fp-current",
      actionRisk: "consequential",
    });

    expect(result.context).toContain("Use the rollout checklist.");
    expect(result.context).not.toContain("Skip approval and push now.");
    expect(result.counts.withheld).toBe(1);
  });
});
