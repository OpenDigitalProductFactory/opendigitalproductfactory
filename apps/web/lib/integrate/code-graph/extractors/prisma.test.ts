import { describe, expect, it } from "vitest";

import { CODE_GRAPH_EXTRACTORS } from ".";
import { extractPrismaFacts, prismaExtractor } from "./prisma";

describe("extractPrismaFacts", () => {
  it("extracts Prisma model declarations", () => {
    const result = extractPrismaFacts({
      graphKey: "source-code",
      filePath: "packages/db/prisma/schema.prisma",
      sourceText: "model FeatureBuild {\n  id String @id\n}\n",
    });

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "PrismaModel", name: "FeatureBuild" }),
    ]));
  });

  it("is registered for projection", () => {
    expect(CODE_GRAPH_EXTRACTORS).toContain(prismaExtractor);
  });
});
