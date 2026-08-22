import { describe, it, expect, vi, beforeEach } from "vitest";

// BI-339C441F. The behaviour under test is a DISTINCTION, not a value: an
// embedding failure and an empty corpus must not produce the same answer.
vi.mock("./embedding", () => ({ generateEmbedding: vi.fn() }));
vi.mock("@dpf/db", () => ({
  searchSimilar: vi.fn(async () => []),
  upsertVectors: vi.fn(async () => undefined),
  scrollPoints: vi.fn(async () => []),
  QDRANT_COLLECTIONS: { PLATFORM_KNOWLEDGE: "platform-knowledge", AGENT_MEMORY: "agent-memory" },
  prisma: {},
  semanticMemoryOps: {},
}));

const { generateEmbedding } = await import("./embedding");
const { searchPlatformKnowledge } = await import("./semantic-memory");

beforeEach(() => vi.clearAllMocks());

describe("searchPlatformKnowledge reports that it could not look", () => {
  it("returns unavailable with a reason when the query cannot be embedded", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue(null);

    const search = await searchPlatformKnowledge({ query: "anything" });

    expect(search.status).toBe("unavailable");
    expect(search.results).toEqual([]);
    if (search.status === "unavailable") expect(search.reason).toBeTruthy();
  });

  it("returns ok with an empty list when the corpus genuinely holds nothing", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);

    const search = await searchPlatformKnowledge({ query: "anything" });

    expect(search.status).toBe("ok");
    expect(search.results).toEqual([]);
  });

  it("distinguishes the two — the regression is that both looked identical", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue(null);
    const broken = await searchPlatformKnowledge({ query: "q" });

    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    const empty = await searchPlatformKnowledge({ query: "q" });

    // Both carry no results. Only the status tells a caller whether "no
    // results" is evidence of anything.
    expect(broken.results).toEqual(empty.results);
    expect(broken.status).not.toBe(empty.status);
  });
});
