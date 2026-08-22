import { describe, it, expect, vi, beforeEach } from "vitest";

// BI-339C441F. The behaviour under test is a DISTINCTION, not a value: an
// embedding failure and an empty corpus must not produce the same answer.
vi.mock("./embedding", () => ({
  generateEmbedding: vi.fn(),
  generateEmbeddingDetailed: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  searchSimilar: vi.fn(async () => []),
  upsertVectors: vi.fn(async () => undefined),
  scrollPoints: vi.fn(async () => []),
  QDRANT_COLLECTIONS: { PLATFORM_KNOWLEDGE: "platform-knowledge", AGENT_MEMORY: "agent-memory" },
  prisma: {},
  semanticMemoryOps: {},
}));

const { generateEmbeddingDetailed } = await import("./embedding");
const { searchPlatformKnowledge } = await import("./semantic-memory");

beforeEach(() => vi.clearAllMocks());

describe("searchPlatformKnowledge reports that it could not look", () => {
  it("returns unavailable with a reason when the query cannot be embedded", async () => {
    vi.mocked(generateEmbeddingDetailed).mockResolvedValue({ status: "failed", reason: "the embedding backend returned no vector" });

    const search = await searchPlatformKnowledge({ query: "anything" });

    expect(search.status).toBe("unavailable");
    expect(search.results).toEqual([]);
    if (search.status === "unavailable") expect(search.reason).toBeTruthy();
  });

  it("returns ok with an empty list when the corpus genuinely holds nothing", async () => {
    vi.mocked(generateEmbeddingDetailed).mockResolvedValue({ status: "ok", embedding: [0.1, 0.2, 0.3] });

    const search = await searchPlatformKnowledge({ query: "anything" });

    expect(search.status).toBe("ok");
    expect(search.results).toEqual([]);
  });

  it("distinguishes the two — the regression is that both looked identical", async () => {
    vi.mocked(generateEmbeddingDetailed).mockResolvedValue({ status: "failed", reason: "the embedding backend returned no vector" });
    const broken = await searchPlatformKnowledge({ query: "q" });

    vi.mocked(generateEmbeddingDetailed).mockResolvedValue({ status: "ok", embedding: [0.1] });
    const empty = await searchPlatformKnowledge({ query: "q" });

    // Both carry no results. Only the status tells a caller whether "no
    // results" is evidence of anything.
    expect(broken.results).toEqual(empty.results);
    expect(broken.status).not.toBe(empty.status);
  });
});

describe("a capacity deferral is not a model failure (BI-339C441F root cause)", () => {
  it("names local-CI capacity, and says it is retryable", async () => {
    // The root cause: embeddings come from the LOCAL provider, so
    // assertLocalProviderCapacityAvailable throws whenever a
    // local-integration-ci lease is active or queued. That was collapsed to
    // null, then to [], then reported as "No matching knowledge found."
    vi.mocked(generateEmbeddingDetailed).mockResolvedValue({
      status: "deferred",
      reason: "local-ci-active-capacity-reservation",
    });

    const search = await searchPlatformKnowledge({ query: "anything" });

    expect(search.status).toBe("unavailable");
    if (search.status === "unavailable") {
      expect(search.reason).toContain("local CI");
      expect(search.reason).toContain("retryable");
      // Must NOT blame the model — the backend is healthy throughout.
      expect(search.reason).not.toContain("failed");
    }
  });

  it("distinguishes a deferral from a genuine embedding failure", async () => {
    vi.mocked(generateEmbeddingDetailed).mockResolvedValue({
      status: "deferred", reason: "local-ci-active-capacity-reservation",
    });
    const deferred = await searchPlatformKnowledge({ query: "q" });

    vi.mocked(generateEmbeddingDetailed).mockResolvedValue({
      status: "failed", reason: "the embedding backend returned HTTP 500",
    });
    const failed = await searchPlatformKnowledge({ query: "q" });

    // Both are unavailable and both carry no results. Only the reason tells an
    // operator whether to retry or to go look at the backend.
    expect(deferred.status).toBe(failed.status);
    if (deferred.status === "unavailable" && failed.status === "unavailable") {
      expect(deferred.reason).not.toBe(failed.reason);
    }
  });
});
