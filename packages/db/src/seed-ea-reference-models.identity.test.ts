import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";

// BI-B470264D AC-1: the seed imports the SAME IT4IT reference model from the
// committed JSON that it imported from the workbook.
//
// The pinned digest below was captured by running the pre-change seed
// (origin/main dfc6c3f8, which parsed docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx
// with read-excel-file) against this same recording Prisma double. It is the
// sha256 of every IT4IT element upsert, in order, with its full where/update/create
// arguments. The full call sequence of both seeds (1,093 Prisma calls, IT4IT and
// BIAN) was also compared byte for byte when this change was made.
//
// If the workbook is intentionally changed and the JSON regenerated, this digest
// changes with it: re-capture it and say so in the PR.
const PINNED_IT4IT_ELEMENT_COUNT = 688;
const PINNED_IT4IT_ELEMENT_DIGEST = "44b3c43015bb1ab2d8995924e07b8a50b19bf09fb1a77f622dce8dc59510b0d5";
const IT4IT_MODEL_ID = "model:it4it_v3_0_1";

const { elementUpserts } = vi.hoisted(() => ({ elementUpserts: [] as unknown[] }));

vi.mock("./client.js", () => ({
  prisma: {
    portfolio: { findMany: vi.fn(async () => []) },
    eaAssessmentScope: { upsert: vi.fn(async () => ({})) },
    eaReferenceModel: {
      upsert: vi.fn(async (args: { where: { slug: string } }) => ({ id: `model:${args.where.slug}` })),
    },
    eaReferenceModelArtifact: { upsert: vi.fn(async () => ({})) },
    eaReferenceModelElement: {
      upsert: vi.fn(async (args: { where: { modelId_slug: { modelId: string; slug: string } } }) => {
        elementUpserts.push(JSON.parse(JSON.stringify(args)));
        return { id: `el:${args.where.modelId_slug.modelId}:${args.where.modelId_slug.slug}` };
      }),
      count: vi.fn(async () => 1),
    },
    // A non-banking install: only IT4IT elements are imported.
    storefrontConfig: { findFirst: vi.fn(async () => null) },
    storefrontArchetype: { findUnique: vi.fn(async () => null) },
  },
}));

import { seedEaReferenceModels } from "./seed-ea-reference-models.js";

describe("seedEaReferenceModels from committed JSON", () => {
  it("imports exactly the IT4IT elements the workbook-parsing seed imported", async () => {
    await seedEaReferenceModels();

    const it4it = elementUpserts.filter(
      (args) => (args as { where: { modelId_slug: { modelId: string } } }).where.modelId_slug.modelId === IT4IT_MODEL_ID,
    );
    expect(it4it).toHaveLength(PINNED_IT4IT_ELEMENT_COUNT);
    expect(createHash("sha256").update(JSON.stringify(it4it)).digest("hex")).toBe(PINNED_IT4IT_ELEMENT_DIGEST);
  });
});
