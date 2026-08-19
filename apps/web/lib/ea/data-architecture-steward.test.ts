import { describe, expect, it } from "vitest";

import { parsePrismaSchema } from "../build/code-graph/extractors/prisma-schema-adapter";
import {
  detectDrift,
  detectFkWithoutIndex,
  detectMissingInverseRelation,
  detectOrphanModels,
  detectIgnoredModels,
  summarizeFindings,
} from "./data-architecture-steward";

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

model Comment {
  id     String @id
  postId String
  post   Post   @relation(fields: [postId], references: [id])
}

model Loner {
  id   String @id
  name String
}

model Legacy {
  id String @id
  @@ignore
}
`;

const facts = parsePrismaSchema(SCHEMA);

describe("data-architecture steward detectors", () => {
  it("flags foreign keys without a covering index (and not indexed ones)", () => {
    const findings = detectFkWithoutIndex(facts);
    const keys = findings.map((f) => f.issueKey);
    expect(keys).toContain("fk-without-index:Comment.postId"); // no index
    expect(keys).not.toContain("fk-without-index:Post.authorId"); // @@index present
    expect(findings.every((f) => f.severity === "warn")).toBe(true);
  });

  it("flags relations missing an inverse on the target model", () => {
    const findings = detectMissingInverseRelation(facts);
    const keys = findings.map((f) => f.issueKey);
    // Post has no `comments Comment[]` back-reference.
    expect(keys).toContain("missing-inverse:Comment.post");
    // Post.author <-> User.posts is bidirectional → not flagged.
    expect(keys).not.toContain("missing-inverse:Post.author");
  });

  it("flags models with no relations (orphans), excluding ignored models", () => {
    const findings = detectOrphanModels(facts);
    const keys = findings.map((f) => f.issueKey);
    expect(keys).toEqual(["orphan-model:Loner"]);
  });

  it("flags @@ignore'd models", () => {
    const findings = detectIgnoredModels(facts);
    expect(findings.map((f) => f.issueKey)).toEqual(["ignored-model:Legacy"]);
  });

  it("detectDrift aggregates all detectors and is deterministic", () => {
    const first = detectDrift(facts);
    const second = detectDrift(facts);
    expect(first.map((f) => f.issueKey).sort()).toEqual(second.map((f) => f.issueKey).sort());
    const summary = summarizeFindings(first);
    expect(summary["fk-without-index"]).toBeGreaterThanOrEqual(1);
    expect(summary["orphan-model"]).toBe(1);
    expect(summary["ignored-model"]).toBe(1);
  });

  it("every finding has a stable key and a model source key", () => {
    for (const f of detectDrift(facts)) {
      expect(f.issueKey.length).toBeGreaterThan(0);
      expect(f.targetSourceKey).toMatch(/^prisma:model:/);
    }
  });

  it("a clean schema produces no FK-index or inverse findings", () => {
    const clean = parsePrismaSchema(`
model A {
  id String @id
  bs B[]
}
model B {
  id  String @id
  aId String
  a   A      @relation(fields: [aId], references: [id])
  @@index([aId])
}
`);
    expect(detectFkWithoutIndex(clean)).toHaveLength(0);
    expect(detectMissingInverseRelation(clean)).toHaveLength(0);
    expect(detectOrphanModels(clean)).toHaveLength(0);
  });
});
