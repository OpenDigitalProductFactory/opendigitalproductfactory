import { describe, expect, it } from "vitest";

import {
  MAX_GRAPH_PURPOSE_SEEDS,
  appendGraphPurposeSeed,
  parseGraphPurposeContext,
  writeGraphPurposeContext,
} from "./explorer-purpose-context";

describe("graph purpose context", () => {
  it("normalizes URL state with one shared seed and depth bound", () => {
    const params = new URLSearchParams();
    for (let index = 0; index < 12; index += 1) {
      params.append("seed", `node-${index}`);
    }
    params.append("seed", "node-0");
    params.set("depth", "9");
    params.set("inspected", "node-4");

    expect(parseGraphPurposeContext(params)).toEqual({
      seedKeys: Array.from(
        { length: MAX_GRAPH_PURPOSE_SEEDS },
        (_, index) => `node-${index}`,
      ),
      depth: 1,
      inspectedKey: "node-4",
    });
  });

  it("serializes the same bounded context consumed by the oracle", () => {
    const params = new URLSearchParams("unrelated=kept");
    writeGraphPurposeContext(params, {
      seedKeys: Array.from({ length: 12 }, (_, index) => `node-${index}`),
      depth: 3,
      inspectedKey: "node-4",
    });

    expect(params.getAll("seed")).toHaveLength(MAX_GRAPH_PURPOSE_SEEDS);
    expect(params.get("depth")).toBe("3");
    expect(params.get("inspected")).toBe("node-4");
    expect(params.get("unrelated")).toBe("kept");
  });

  it("never grows an interactive seed set beyond the server bound", () => {
    const full = Array.from(
      { length: MAX_GRAPH_PURPOSE_SEEDS },
      (_, index) => `node-${index}`,
    );

    expect(appendGraphPurposeSeed(full, "node-10")).toEqual(full);
    expect(appendGraphPurposeSeed(full, "node-2")).toEqual(full);
  });
});
