import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "@dpf/db/schema-source";

import { loadReviewWindow, sensitivityOf, sensitivityUnstableOf } from "./load-review-window";

/**
 * THE BUG THIS FILE EXISTS FOR (BI-19CEC4B4).
 *
 * `load-review-window.ts` selected `sensitivityUnstable` and `sensitivity` as
 * scalar columns on DecisionInteraction. Neither is a column — both are written
 * into `outcomePayload` by kernel-consult-ledger's `outcomePayloadExtra`. So
 * every real run died at the first query:
 *
 *   Unknown field `sensitivityUnstable` for select statement on model
 *   `DecisionInteraction`
 *
 * The weekly task erred on its first scheduled tick (2026-09-24 06:00) and had
 * therefore NEVER produced a review, while 21 unit tests and two full CI runs
 * passed — because the other tests inject a fake client that returns fixtures
 * and validates nothing about the schema.
 *
 * So this suite deliberately does NOT use a fake shape. It parses the canonical
 * Prisma schema — the same files `prisma generate` reads — which is the only
 * thing that can disagree with us. Prisma 7's generated client is TypeScript
 * with no runtime `dmmf`, so the schema text is the available ground truth.
 */
function modelFieldNames(schema: string, modelName: string): Set<string> {
  const block = new RegExp(String.raw`^model\s+${modelName}\s*\{([\s\S]*?)^\}`, "m").exec(schema);
  if (!block) return new Set();
  const names = new Set<string>();
  for (const line of block[1]!.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
    const name = /^([A-Za-z_][A-Za-z0-9_]*)\s+\S/.exec(trimmed)?.[1];
    if (name) names.add(name);
  }
  return names;
}

describe("the select names only fields that exist", () => {
  const fields = modelFieldNames(readCanonicalPrismaSchema(), "DecisionInteraction");

  it("found the DecisionInteraction model in the canonical schema", () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every assertion below vacuously pass, which is the failure mode this
    // whole file exists to prevent.
    expect(fields.size).toBeGreaterThan(20);
    expect(fields.has("interactionId")).toBe(true);
  });

  /**
   * Captured from the select in loadReviewWindow. If someone adds a field there,
   * add it here too — that is the point: this list is the contract, and the
   * schema is the judge of it.
   */
  const SELECTED = [
    "interactionId",
    "profileId",
    "gateKey",
    "routeContext",
    "domainClass",
    "outcomeType",
    "riskTier",
    "question",
    "gateFallbackUsed",
    "outcomePayload",
    "recommendedOptionId",
    "chosenOptionId",
    "createdAt",
  ] as const;

  it("every selected field is a real field on the model", () => {
    expect(SELECTED.filter((f) => !fields.has(f))).toEqual([]);
  });

  /**
   * The regression, stated as a fact about the schema rather than about our code:
   * if these ever BECOME columns, this test fails and tells the next author to go
   * back to selecting them directly.
   */
  it("sensitivityUnstable and sensitivity are still NOT columns", () => {
    expect(fields.has("sensitivityUnstable")).toBe(false);
    expect(fields.has("sensitivity")).toBe(false);
  });
});

describe("sensitivity is read from the payload it is written to", () => {
  it("reads both fields out of an outcomePayload shaped like the real one", () => {
    const payload = {
      tool: "principle_decide",
      sensitivityUnstable: true,
      sensitivity: { flippingPrincipleIds: ["quick-vs-proper"] },
    };
    expect(sensitivityUnstableOf(payload)).toBe(true);
    expect(sensitivityOf(payload)).toEqual({ flippingPrincipleIds: ["quick-vs-proper"] });
  });

  /**
   * Absent must be null, never false. Only the principle_decide path records
   * these — measured on the live ledger, 30 of 703 rows in a week carry them —
   * so a measure must be able to tell "no sensitivity analysis ran" from
   * "analysis ran and said stable".
   */
  it("reports absent as null rather than false", () => {
    expect(sensitivityUnstableOf({ tool: "evaluate_profession_decision" })).toBeNull();
    expect(sensitivityOf({ tool: "evaluate_profession_decision" })).toBeNull();
  });

  it("survives a payload that is null, a string or an array", () => {
    for (const bad of [null, undefined, "unstable", ["unstable"], 7]) {
      expect(sensitivityUnstableOf(bad)).toBeNull();
      expect(sensitivityOf(bad)).toBeNull();
    }
  });

  it("ignores a non-boolean sensitivityUnstable rather than coercing it", () => {
    expect(sensitivityUnstableOf({ sensitivityUnstable: "yes" })).toBeNull();
    expect(sensitivityUnstableOf({ sensitivityUnstable: 1 })).toBeNull();
  });
});

/**
 * Proves the window still assembles rows with the payload-derived fields in
 * place, using the narrow client the module declares.
 */
describe("the window still assembles", () => {
  it("carries payload-derived sensitivity onto the row", async () => {
    const now = new Date("2026-09-24T06:00:00.000Z");
    const window = await loadReviewWindow(
      {
        decisionInteraction: {
          findMany: async () => [
            {
              interactionId: "DI-1",
              profileId: "mark-dpf-platform",
              gateKey: "kernel-consult",
              domainClass: "architecture-tradeoff",
              outcomeType: "arbitrate",
              riskTier: "medium",
              question: "q",
              gateFallbackUsed: false,
              outcomePayload: {
                sensitivityUnstable: true,
                sensitivity: { flippingPrincipleIds: ["a"] },
              },
              createdAt: now,
            },
          ],
        },
        decisionPerspectiveProfile: {
          findMany: async () => [{ profileId: "mark-dpf-platform", kind: "platform" }],
        },
        perspectiveMaterial: { groupBy: async () => [] },
      } as never,
      { now },
    );

    expect(window.rows[0]?.sensitivityUnstable).toBe(true);
    expect(window.rows[0]?.sensitivity).toEqual({ flippingPrincipleIds: ["a"] });
  });
});
