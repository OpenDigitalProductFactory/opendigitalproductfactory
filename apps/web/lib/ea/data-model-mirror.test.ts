import { describe, expect, it } from "vitest";

import { parsePrismaSchema } from "../integrate/code-graph/extractors/prisma-schema-adapter";
import {
  buildDesiredState,
  planMirror,
  summarizePlan,
  modelSourceKey,
  type ExistingMirrorRow,
} from "./data-model-mirror";

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

const facts = parsePrismaSchema(SCHEMA);

/** Build existing mirror rows that exactly match the desired state. */
function existingMatching(): { elements: ExistingMirrorRow[]; relationships: ExistingMirrorRow[] } {
  const desired = buildDesiredState(facts);
  return {
    elements: desired.elements.map((entry, i) => ({
      id: `el-${i}`,
      sourceKey: entry.sourceKey,
      descriptor: entry.descriptor,
      removed: false,
    })),
    relationships: desired.relationships.map((entry, i) => ({
      id: `rel-${i}`,
      sourceKey: entry.sourceKey,
      descriptor: entry.descriptor,
      removed: false,
    })),
  };
}

describe("planMirror", () => {
  it("first run against an empty mirror creates everything (material)", () => {
    const plan = planMirror(facts, { elements: [], relationships: [] });
    expect(plan.blocked).toBe(false);
    expect(plan.material).toBe(true);
    expect(plan.elementOps.every((op) => op.kind === "create")).toBe(true);
    expect(plan.elementOps).toHaveLength(2); // User, Post
    expect(plan.relationshipOps.length).toBeGreaterThanOrEqual(2); // User->Post, Post->User
    expect(plan.relationshipOps.every((op) => op.kind === "create")).toBe(true);
  });

  it("is idempotent — re-running against a matching mirror yields no ops and is not material", () => {
    const plan = planMirror(facts, existingMatching());
    expect(plan.elementOps).toHaveLength(0);
    expect(plan.relationshipOps).toHaveLength(0);
    expect(plan.material).toBe(false);
    expect(plan.blocked).toBe(false);
  });

  it("creates only the newly-added model", () => {
    const existing = existingMatching();
    // Drop Post so it looks newly added.
    const postKey = modelSourceKey("Post");
    existing.elements = existing.elements.filter((e) => e.sourceKey !== postKey);
    existing.relationships = existing.relationships.filter((r) => !r.sourceKey.includes(":Post:"));

    const plan = planMirror(facts, existing);
    const created = plan.elementOps.filter((op) => op.kind === "create");
    expect(created).toHaveLength(1);
    expect(created[0].kind === "create" && created[0].desired.name).toBe("Post");
    expect(plan.material).toBe(true);
  });

  it("updates a model whose descriptor changed", () => {
    const existing = existingMatching();
    const userRow = existing.elements.find((e) => e.sourceKey === modelSourceKey("User"))!;
    userRow.descriptor = "stale-descriptor";

    const plan = planMirror(facts, existing);
    const updates = plan.elementOps.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].kind === "update" && updates[0].id).toBe(userRow.id);
  });

  it("marks removed a mirror element no longer in the schema", () => {
    const existing = existingMatching();
    existing.elements.push({
      id: "el-orphan",
      sourceKey: modelSourceKey("DeletedModel"),
      descriptor: "whatever",
      removed: false,
    });

    const plan = planMirror(facts, existing);
    const removals = plan.elementOps.filter((op) => op.kind === "remove");
    expect(removals).toHaveLength(1);
    expect(removals[0].kind === "remove" && removals[0].id).toBe("el-orphan");
  });

  it("revives a previously-removed element that reappears in the schema", () => {
    const existing = existingMatching();
    const userRow = existing.elements.find((e) => e.sourceKey === modelSourceKey("User"))!;
    userRow.removed = true;

    const plan = planMirror(facts, existing);
    const revives = plan.elementOps.filter((op) => op.kind === "revive");
    expect(revives).toHaveLength(1);
    expect(revives[0].kind === "revive" && revives[0].id).toBe(userRow.id);
  });

  it("does not re-remove an already-removed orphan (idempotent removal)", () => {
    const existing = existingMatching();
    existing.elements.push({
      id: "el-orphan",
      sourceKey: modelSourceKey("DeletedModel"),
      descriptor: "whatever",
      removed: true,
    });
    const plan = planMirror(facts, existing);
    expect(plan.elementOps.filter((op) => op.kind === "remove")).toHaveLength(0);
    expect(plan.material).toBe(false);
  });

  it("blocks (no ops) when a source key maps to duplicate active rows", () => {
    const existing = existingMatching();
    const userRow = existing.elements.find((e) => e.sourceKey === modelSourceKey("User"))!;
    existing.elements.push({ ...userRow, id: "el-dup" });

    const plan = planMirror(facts, existing);
    expect(plan.blocked).toBe(true);
    expect(plan.elementOps).toHaveLength(0);
    expect(plan.relationshipOps).toHaveLength(0);
    expect(plan.material).toBe(false);
    expect(plan.duplicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "element", sourceKey: modelSourceKey("User") }),
      ]),
    );
  });

  it("summarizePlan counts ops by kind", () => {
    const plan = planMirror(facts, { elements: [], relationships: [] });
    const summary = summarizePlan(plan);
    expect(summary.created).toBeGreaterThan(0);
    expect(summary.updated).toBe(0);
    expect(summary.removed).toBe(0);
  });
});
