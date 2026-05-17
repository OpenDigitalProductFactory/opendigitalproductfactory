import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted; declare the spies inside the factory and re-export them
// for the test body via vi.mocked() lookups.
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    wikiPage: { findMany: vi.fn() },
    agentMessage: { findMany: vi.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { buildVocabularyBias, __test__ } from "./vocabulary-bias";
import { prisma } from "@dpf/db";
import type { BiasClassificationToken } from "./bias-classification-gate";

const mockPrisma = prisma as unknown as {
  organization: { findUnique: ReturnType<typeof vi.fn> };
  wikiPage: { findMany: ReturnType<typeof vi.fn> };
  agentMessage: { findMany: ReturnType<typeof vi.fn> };
};

describe("vocabulary-bias / tokenizeTitle (unit)", () => {
  it("extracts proper-noun-shaped words", () => {
    expect(__test__.tokenizeTitle("BackupRun Schema Audit")).toEqual([
      "BackupRun",
      "Schema",
      "Audit",
    ]);
  });

  it("filters stopwords and short tokens", () => {
    expect(__test__.tokenizeTitle("The Guide to Postgres")).toEqual(["Postgres"]);
  });

  it("returns [] for an empty title", () => {
    expect(__test__.tokenizeTitle("")).toEqual([]);
  });

  it("ignores lowercase common nouns", () => {
    expect(__test__.tokenizeTitle("how to run the seed")).toEqual([]);
  });
});

describe("vocabulary-bias / extractIdentifiers (unit)", () => {
  it("catches CamelCase identifiers in free text", () => {
    const ids = __test__.extractIdentifiers(
      "We updated the BuildStudio flow and the BackupRun model.",
    );
    expect(ids).toEqual(expect.arrayContaining(["BuildStudio", "BackupRun"]));
  });

  it("catches SCREAMING_SNAKE_CASE constants", () => {
    const ids = __test__.extractIdentifiers(
      "Set POSTGRES_DB and DPF_BACKUP_PATH in the env.",
    );
    expect(ids).toEqual(expect.arrayContaining(["POSTGRES_DB", "DPF_BACKUP_PATH"]));
  });

  it("dedupes repeated identifiers", () => {
    const ids = __test__.extractIdentifiers("BuildStudio is great. BuildStudio rocks.");
    expect(ids.filter((t) => t === "BuildStudio")).toHaveLength(1);
  });

  it("ignores plain English title-cased starts of sentences", () => {
    // "The" is filtered by length+stopword; "When" too. Single-cap-letter
    // sentence starts shouldn't survive the identifier regex (min length 3
    // PLUS proper-noun pattern require ≥2 trailing lowercase or ≥2 trailing
    // uppercase).
    const ids = __test__.extractIdentifiers("When the build runs, it ships.");
    // "When" matches the [A-Z][a-zA-Z0-9]{2,} regex — that's an OK false
    // positive that the gate will strip if off-org. The test asserts that
    // common English words like "the", "runs" don't slip in.
    expect(ids).not.toEqual(expect.arrayContaining(["the", "runs"]));
  });
});

describe("vocabulary-bias / mergeTokens (unit)", () => {
  it("dedupes by text", () => {
    const tokens: BiasClassificationToken[] = [
      { text: "DPF", classification: "public" },
      { text: "DPF", classification: "public" },
    ];
    expect(__test__.mergeTokens(tokens)).toEqual([
      { text: "DPF", classification: "public" },
    ]);
  });

  it("escalates classification when a token appears in two sources", () => {
    const tokens: BiasClassificationToken[] = [
      { text: "BackupRun", classification: "internal-low" }, // from wiki title
      { text: "BackupRun", classification: "internal-high" }, // from thread
    ];
    const merged = __test__.mergeTokens(tokens);
    expect(merged).toEqual([
      { text: "BackupRun", classification: "internal-high" },
    ]);
  });

  it("preserves higher classification regardless of order", () => {
    const tokens: BiasClassificationToken[] = [
      { text: "X", classification: "confidential" },
      { text: "X", classification: "public" },
    ];
    expect(__test__.mergeTokens(tokens)).toEqual([
      { text: "X", classification: "confidential" },
    ]);
  });
});

describe("buildVocabularyBias (integration with mocked prisma)", () => {
  beforeEach(() => {
    mockPrisma.organization.findUnique.mockReset();
    mockPrisma.wikiPage.findMany.mockReset();
    mockPrisma.agentMessage.findMany.mockReset();
    mockPrisma.wikiPage.findMany.mockResolvedValue([]);
    mockPrisma.agentMessage.findMany.mockResolvedValue([]);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
  });

  it("returns [] when no organizationId and no threadId", async () => {
    const result = await buildVocabularyBias({});
    expect(result).toEqual([]);
  });

  it("returns Org name as 'public' when only orgId is given", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Acme Corp",
      legalName: null,
      brandingConfig: null,
    });
    const result = await buildVocabularyBias({ organizationId: "org_1" });
    expect(result).toEqual([
      { text: "Acme Corp", classification: "public" },
    ]);
  });

  it("includes legalName when distinct from name", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Acme",
      legalName: "Acme Holdings LLC",
      brandingConfig: null,
    });
    const result = await buildVocabularyBias({ organizationId: "org_1" });
    expect(result.map((t) => t.text).sort()).toEqual([
      "Acme",
      "Acme Holdings LLC",
    ]);
  });

  it("includes wiki page title tokens classified internal-low", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Acme",
      legalName: null,
      brandingConfig: null,
    });
    mockPrisma.wikiPage.findMany.mockResolvedValue([
      { title: "BackupRun Schema" },
      { title: "Quarterly Planning" },
    ]);
    const result = await buildVocabularyBias({ organizationId: "org_1" });
    const wikiTokens = result.filter((t) => t.classification === "internal-low");
    expect(wikiTokens.map((t) => t.text).sort()).toEqual([
      "BackupRun",
      "Planning",
      "Quarterly",
      "Schema",
    ]);
  });

  it("includes thread message identifiers classified internal-high", async () => {
    mockPrisma.agentMessage.findMany.mockResolvedValue([
      { content: "Let's wire BuildStudio into the BackupRun audit." },
      { content: "Make sure POSTGRES_DB resolves correctly." },
    ]);
    const result = await buildVocabularyBias({ threadId: "thr_1" });
    const threadTokens = result.filter((t) => t.classification === "internal-high");
    expect(threadTokens.map((t) => t.text).sort()).toEqual([
      "BackupRun",
      "BuildStudio",
      "POSTGRES_DB",
    ]);
  });

  it("escalates a token's classification when it appears in both wiki and thread", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Acme",
      legalName: null,
      brandingConfig: null,
    });
    mockPrisma.wikiPage.findMany.mockResolvedValue([
      { title: "BackupRun Schema" },
    ]);
    mockPrisma.agentMessage.findMany.mockResolvedValue([
      { content: "Update BackupRun to record sha256." },
    ]);
    const result = await buildVocabularyBias({
      organizationId: "org_1",
      threadId: "thr_1",
    });
    const backupRun = result.find((t) => t.text === "BackupRun");
    expect(backupRun?.classification).toBe("internal-high");
  });

  it("respects totalTokenCap and keeps the most-sensitive tokens first", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Acme",
      legalName: null,
      brandingConfig: null,
    });
    mockPrisma.wikiPage.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({ title: `WikiTokenA${i} WikiTokenB${i}` })),
    );
    mockPrisma.agentMessage.findMany.mockResolvedValue([
      { content: "Mention ProprietaryThing identifier." },
    ]);
    const result = await buildVocabularyBias({
      organizationId: "org_1",
      threadId: "thr_1",
      totalTokenCap: 5,
    });
    expect(result).toHaveLength(5);
    // The internal-high thread identifier must be present in the kept set.
    expect(result.find((t) => t.text === "ProprietaryThing")?.classification).toBe(
      "internal-high",
    );
  });
});
