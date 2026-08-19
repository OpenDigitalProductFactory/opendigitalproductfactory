import { describe, expect, it } from "vitest";

import { CODE_GRAPH_EXTRACTORS } from ".";
import { extractPrismaFacts, prismaExtractor } from "./prisma";

const SCHEMA = `
model User {
  id    String @id
  posts Post[]
}

model Post {
  id       String @id
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
  @@index([authorId])
}
`;

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

  it("emits PrismaField nodes with type/flag attributes", () => {
    const result = extractPrismaFacts({
      graphKey: "source-code",
      filePath: "packages/db/prisma/schema.prisma",
      sourceText: SCHEMA,
    });

    const authorId = result.nodes.find(
      (n) => n.kind === "PrismaField" && n.key.endsWith("Post.authorId"),
    );
    expect(authorId).toBeDefined();
    expect(authorId?.attributes).toMatchObject({ model: "Post", fieldKind: "scalar", rawType: "String" });
  });

  it("emits HAS_FIELD edges from model to field", () => {
    const result = extractPrismaFacts({
      graphKey: "source-code",
      filePath: "packages/db/prisma/schema.prisma",
      sourceText: SCHEMA,
    });

    const hasField = result.edges.find(
      (e) => e.kind === "HAS_FIELD" && e.toKey.endsWith("Post.authorId"),
    );
    expect(hasField).toBeDefined();
    expect(hasField?.fromKey).toContain("prisma-model:Post");
  });

  it("emits RELATES_TO edges carrying derived cardinality and FK index status", () => {
    const result = extractPrismaFacts({
      graphKey: "source-code",
      filePath: "packages/db/prisma/schema.prisma",
      sourceText: SCHEMA,
    });

    const relatesTo = result.edges.filter((e) => e.kind === "RELATES_TO");
    const postToUser = relatesTo.find(
      (e) => e.fromKey.endsWith("prisma-model:Post") && e.toKey.endsWith("prisma-model:User"),
    );
    expect(postToUser?.attributes).toMatchObject({ cardinality: "many-to-one", isFkIndexed: true });

    const userToPost = relatesTo.find(
      (e) => e.fromKey.endsWith("prisma-model:User") && e.toKey.endsWith("prisma-model:Post"),
    );
    expect(userToPost?.attributes).toMatchObject({ cardinality: "one-to-many" });
  });

  it("keeps the DEFINES edge for backward compatibility", () => {
    const result = extractPrismaFacts({
      graphKey: "source-code",
      filePath: "packages/db/prisma/schema.prisma",
      sourceText: SCHEMA,
    });
    expect(result.edges.some((e) => e.kind === "DEFINES")).toBe(true);
  });

  it("is registered for projection", () => {
    expect(CODE_GRAPH_EXTRACTORS).toContain(prismaExtractor);
  });
});
