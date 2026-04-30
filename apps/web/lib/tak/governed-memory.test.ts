import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity/aidoc-resolver", () => ({
  resolveAIDocForAgent: vi.fn(),
}));

vi.mock("@/lib/tak/user-facts", () => ({
  loadGovernedUserFacts: vi.fn(),
  formatFactsAsContext: vi.fn(),
  formatFactsCompressed: vi.fn(),
}));

vi.mock("@/lib/semantic-memory", () => ({
  recallGovernedContext: vi.fn(),
}));

describe("buildGovernedMemoryContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives consequential risk from portable authorization classes and threads the fingerprint into both memory sources", async () => {
    const { resolveAIDocForAgent } = await import("@/lib/identity/aidoc-resolver");
    const { loadGovernedUserFacts, formatFactsAsContext, formatFactsCompressed } = await import("@/lib/tak/user-facts");
    const { recallGovernedContext } = await import("@/lib/semantic-memory");

    vi.mocked(resolveAIDocForAgent).mockResolvedValue({
      authorization_classes: ["observe", "approve"],
      operating_profile_fingerprint: "fp-123",
    } as never);
    vi.mocked(loadGovernedUserFacts).mockResolvedValue({
      facts: [],
      includedFacts: [],
      excludedFacts: [],
      counts: {
        total: 0,
        current: 0,
        pendingRevalidation: 0,
        legacyUntracked: 0,
      },
    } as never);
    vi.mocked(formatFactsAsContext).mockReturnValue("FACTS");
    vi.mocked(formatFactsCompressed).mockReturnValue("FACTS-COMPACT");
    vi.mocked(recallGovernedContext).mockResolvedValue({
      context: "MEMORY",
      compressedContext: "MEMORY-COMPACT",
      counts: {
        included: 1,
        withheld: 2,
        current: 1,
        legacy: 0,
      },
    } as never);

    const { buildGovernedMemoryContext } = await import("./governed-memory");
    const result = await buildGovernedMemoryContext({
      userId: "user-1",
      agentId: "build-specialist",
      routeContext: "/build",
      query: "Can you deploy this?",
      excludeMessageIds: new Set(["msg-1"]),
    });

    expect(result.actionRisk).toBe("consequential");
    expect(result.operatingProfileFingerprint).toBe("fp-123");
    expect(loadGovernedUserFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        currentOperatingProfileFingerprint: "fp-123",
        actionRisk: "consequential",
      }),
    );
    expect(recallGovernedContext).toHaveBeenCalledWith(
      expect.objectContaining({
        currentOperatingProfileFingerprint: "fp-123",
        actionRisk: "consequential",
      }),
    );
  });
});
