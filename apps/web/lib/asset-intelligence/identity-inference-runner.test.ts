import { describe, expect, it } from "vitest";

import { parseProposals } from "./identity-inference-runner";

const ids = new Set(["e1", "e2"]);

describe("parseProposals", () => {
  it("parses a plain JSON array of proposals", () => {
    const content = JSON.stringify([
      { entityId: "e1", manufacturer: "PostgreSQL Global Dev Group", product: "PostgreSQL", productVersion: "16", edition: null, part: "a", confidence: 0.95 },
    ]);
    const out = parseProposals(content, ids);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ entityId: "e1", manufacturer: "PostgreSQL Global Dev Group", product: "PostgreSQL", part: "a", confidence: 0.95 });
  });

  it("strips markdown code fences", () => {
    const content = "```json\n[{\"entityId\":\"e1\",\"manufacturer\":\"Nginx\",\"product\":\"Nginx\",\"confidence\":0.9}]\n```";
    expect(parseProposals(content, ids)).toHaveLength(1);
  });

  it("tolerates leading prose before the array", () => {
    const content = 'Here are the identifications:\n[{"entityId":"e2","manufacturer":"Redis","product":"Redis","confidence":0.8}]';
    const out = parseProposals(content, ids);
    expect(out[0].entityId).toBe("e2");
  });

  it("drops proposals for entities not in the batch", () => {
    const content = JSON.stringify([
      { entityId: "e1", manufacturer: "A", product: "B", confidence: 0.9 },
      { entityId: "STRAY", manufacturer: "C", product: "D", confidence: 0.9 },
    ]);
    const out = parseProposals(content, ids);
    expect(out.map((p) => p.entityId)).toEqual(["e1"]);
  });

  it("drops proposals missing manufacturer or product", () => {
    const content = JSON.stringify([
      { entityId: "e1", manufacturer: "", product: "B", confidence: 0.9 },
      { entityId: "e2", manufacturer: "C", product: "", confidence: 0.9 },
    ]);
    expect(parseProposals(content, ids)).toHaveLength(0);
  });

  it("clamps confidence to [0,1] and defaults an invalid part to 'a'", () => {
    const content = JSON.stringify([
      { entityId: "e1", manufacturer: "A", product: "B", part: "x", confidence: 5 },
    ]);
    const out = parseProposals(content, ids);
    expect(out[0].confidence).toBe(1);
    expect(out[0].part).toBe("a");
  });

  it("defaults a missing/invalid confidence to 0", () => {
    const content = JSON.stringify([{ entityId: "e1", manufacturer: "A", product: "B" }]);
    expect(parseProposals(content, ids)[0].confidence).toBe(0);
  });

  it("returns [] on non-JSON or non-array content", () => {
    expect(parseProposals("I could not identify these.", ids)).toEqual([]);
    expect(parseProposals('{"entityId":"e1"}', ids)).toEqual([]);
    expect(parseProposals("", ids)).toEqual([]);
  });
});
