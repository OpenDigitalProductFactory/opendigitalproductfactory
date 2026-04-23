// apps/web/lib/deliberation/registry.test.ts
// Task 4 — Deliberation registry tests.
//
// Covers:
//   - DB-first load with file fallback
//   - persona prompt composition via loadPrompt()
//   - recipe extraction from pattern providerStrategyHints metadata

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
// Prisma is mocked so the registry can be exercised without a live DB.
vi.mock("@dpf/db", () => ({
  prisma: {
    deliberationPattern: {
      findMany: vi.fn(),
    },
  },
}));

// Mock the file-backed seeder helpers used when DB has no rows.
vi.mock("@dpf/db/seed-deliberation", () => ({
  discoverDeliberationFiles: vi.fn(),
  parseDeliberationContent: vi.fn(),
}));

// Mock the filesystem read used by the file fallback.
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

// Mock the prompt loader so persona text is deterministic.
vi.mock("../tak/prompt-loader", () => ({
  loadPrompt: vi.fn(),
  invalidatePromptCache: vi.fn(),
}));

import { prisma } from "@dpf/db";
import {
  discoverDeliberationFiles,
  parseDeliberationContent,
} from "@dpf/db/seed-deliberation";
import { readFileSync } from "node:fs";
import { loadPrompt } from "../tak/prompt-loader";
import {
  listPatterns,
  getPattern,
  extractRoleRecipes,
  invalidateDeliberationRegistryCache,
} from "./registry";

const mockFindMany = vi.mocked(prisma.deliberationPattern.findMany);
const mockDiscover = vi.mocked(discoverDeliberationFiles);
const mockParse = vi.mocked(parseDeliberationContent);
const mockReadFileSync = vi.mocked(readFileSync);
const mockLoadPrompt = vi.mocked(loadPrompt);

// Typed as `any` because Prisma's generated row type carries columns
// (sourceFile, isOverridden, createdAt, updatedAt) the registry's select
// projection does not pull; tests only need the subset under test.
function dbRow(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: "db-pattern-review",
    slug: "review",
    name: "Peer Review",
    status: "active",
    purpose: "Structured multi-agent critique before a normal HITL gate.",
    defaultRoles: [
      { roleId: "author", count: 1, required: true },
      { roleId: "reviewer", count: 2, required: true },
      { roleId: "adjudicator", count: 1, required: true },
    ],
    topologyTemplate: { rootNodeType: "review" },
    activationPolicyHints: { stageDefaults: ["build-review"] },
    evidenceRequirements: { strictness: "standard" },
    outputContract: { adjudicationMode: "synthesis" },
    providerStrategyHints: {
      preferredDiversityMode: "multi-model-same-provider",
      strategyProfile: "balanced",
    },
    ...overrides,
  };
}

describe("deliberation registry", () => {
  beforeEach(() => {
    invalidateDeliberationRegistryCache();
    mockFindMany.mockReset();
    mockDiscover.mockReset();
    mockParse.mockReset();
    mockReadFileSync.mockReset();
    mockLoadPrompt.mockReset();
    mockLoadPrompt.mockImplementation(async (_category: string, slug: string) => `persona:${slug}`);
  });

  describe("DB-first load with file fallback", () => {
    it("loads patterns from DB when rows exist", async () => {
      mockFindMany.mockResolvedValue([dbRow()]);

      const patterns = await listPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].slug).toBe("review");
      expect(patterns[0].source).toBe("db");
      expect(patterns[0].patternId).toBe("db-pattern-review");
      expect(mockDiscover).not.toHaveBeenCalled();
    });

    it("falls back to file-backed patterns when DB has no rows", async () => {
      mockFindMany.mockResolvedValue([]);
      mockDiscover.mockReturnValue([
        { slug: "review", filePath: "/repo/deliberation/review.deliberation.md" },
      ]);
      mockReadFileSync.mockReturnValue("---\nraw file contents\n---\nbody");
      mockParse.mockReturnValue({
        slug: "review",
        name: "Peer Review",
        purpose: "File fallback purpose",
        status: "active",
        defaultRoles: [
          { roleId: "author", count: 1, required: true },
          { roleId: "reviewer", count: 2, required: true },
        ],
        topologyTemplate: { rootNodeType: "review" },
        activationPolicyHints: {},
        evidenceRequirements: {},
        outputContract: {},
        providerStrategyHints: {},
        sourceFile: "deliberation/review.deliberation.md",
      });

      const patterns = await listPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].slug).toBe("review");
      expect(patterns[0].source).toBe("file");
      expect(patterns[0].purpose).toBe("File fallback purpose");
      expect(mockDiscover).toHaveBeenCalled();
      expect(mockParse).toHaveBeenCalled();
    });

    it("falls back to file-backed patterns when DB read throws", async () => {
      mockFindMany.mockRejectedValue(new Error("DB offline"));
      mockDiscover.mockReturnValue([
        { slug: "debate", filePath: "/repo/deliberation/debate.deliberation.md" },
      ]);
      mockReadFileSync.mockReturnValue("---\nstub\n---\nbody");
      mockParse.mockReturnValue({
        slug: "debate",
        name: "Structured Debate",
        purpose: "Two opposed positions.",
        status: "active",
        defaultRoles: [
          { roleId: "debater", count: 2, required: true },
          { roleId: "adjudicator", count: 1, required: true },
        ],
        topologyTemplate: { rootNodeType: "debate" },
        activationPolicyHints: {},
        evidenceRequirements: {},
        outputContract: {},
        providerStrategyHints: {},
        sourceFile: "deliberation/debate.deliberation.md",
      });

      const patterns = await listPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].slug).toBe("debate");
      expect(patterns[0].source).toBe("file");
    });

    it("caches results for subsequent calls within TTL", async () => {
      mockFindMany.mockResolvedValue([dbRow()]);

      await listPatterns();
      await listPatterns();
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    it("re-queries after invalidateDeliberationRegistryCache()", async () => {
      mockFindMany.mockResolvedValue([dbRow()]);

      await listPatterns();
      invalidateDeliberationRegistryCache();
      await listPatterns();
      expect(mockFindMany).toHaveBeenCalledTimes(2);
    });
  });

  describe("persona prompt composition", () => {
    it("populates personaText via loadPrompt() for each default role", async () => {
      mockFindMany.mockResolvedValue([dbRow()]);

      const pattern = await getPattern("review");
      expect(pattern).not.toBeNull();
      expect(pattern!.defaultRoles).toHaveLength(3);
      for (const role of pattern!.defaultRoles) {
        expect(role.personaText).toBe(`persona:${role.roleId}`);
      }
      // Called once per distinct role
      expect(mockLoadPrompt).toHaveBeenCalledWith("deliberation", "author");
      expect(mockLoadPrompt).toHaveBeenCalledWith("deliberation", "reviewer");
      expect(mockLoadPrompt).toHaveBeenCalledWith("deliberation", "adjudicator");
    });

    it("returns empty personaText when the prompt loader returns empty", async () => {
      mockFindMany.mockResolvedValue([dbRow()]);
      mockLoadPrompt.mockResolvedValue("");

      const pattern = await getPattern("review");
      expect(pattern).not.toBeNull();
      for (const role of pattern!.defaultRoles) {
        expect(role.personaText).toBe("");
      }
    });
  });

  describe("recipe extraction from seed file metadata", () => {
    it("returns an empty map when the pattern has no rolesRecipes", async () => {
      mockFindMany.mockResolvedValue([dbRow()]);

      const pattern = await getPattern("review");
      const recipes = extractRoleRecipes(pattern!);
      expect(recipes.size).toBe(0);
    });

    it("extracts per-role routing recipes when rolesRecipes is present", async () => {
      mockFindMany.mockResolvedValue([
        dbRow({
          providerStrategyHints: {
            preferredDiversityMode: "multi-provider-heterogeneous",
            rolesRecipes: {
              reviewer: {
                capabilityTier: "high",
                taskType: "review",
              },
              adjudicator: {
                capabilityTier: "high",
                taskType: "synthesis",
                requireProviderDiversity: true,
              },
            },
          },
        }),
      ]);

      const pattern = await getPattern("review");
      const recipes = extractRoleRecipes(pattern!);
      expect(recipes.size).toBe(2);
      expect(recipes.get("reviewer")).toMatchObject({
        roleId: "reviewer",
        capabilityTier: "high",
        taskType: "review",
      });
      expect(recipes.get("adjudicator")).toMatchObject({
        roleId: "adjudicator",
        capabilityTier: "high",
        taskType: "synthesis",
        requireProviderDiversity: true,
      });
    });

    it("silently ignores malformed rolesRecipes entries", async () => {
      mockFindMany.mockResolvedValue([
        dbRow({
          providerStrategyHints: {
            rolesRecipes: {
              reviewer: { capabilityTier: "high" },
              broken: "not-an-object",
            },
          },
        }),
      ]);

      const pattern = await getPattern("review");
      const recipes = extractRoleRecipes(pattern!);
      expect(recipes.size).toBe(1);
      expect(recipes.get("reviewer")).toBeDefined();
      expect(recipes.has("broken")).toBe(false);
    });
  });
});
