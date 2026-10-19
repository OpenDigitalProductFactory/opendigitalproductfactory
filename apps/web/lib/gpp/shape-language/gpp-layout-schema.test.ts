// The GPP layout sidecar (PR-3a-1, BI-6DA17863). Presentation only: the
// compiler never reads it. Types and validator only in Phase 3 — no published
// layout schema is committed until the canvas lands (Phase 4).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { gppLayoutSchema } from "./gpp-layout-schema";

type JsonObject = Record<string, unknown>;

function workedLayout(): JsonObject {
  return JSON.parse(
    readFileSync(join(__dirname, "__fixtures__", "inquiry-response-watch.worked-example.layout.json"), "utf8"),
  ) as JsonObject;
}

describe("GPP layout sidecar schema", () => {
  it("the §4.3 example validates", () => {
    const parsed = gppLayoutSchema.safeParse(workedLayout());
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it("an unknown top-level field is rejected", () => {
    const layout = workedLayout();
    layout.unexpectedField = true;
    expect(gppLayoutSchema.safeParse(layout).success).toBe(false);
  });

  it("an unknown field on a node or the viewport is rejected", () => {
    const onNode = workedLayout();
    (onNode.nodes as Record<string, JsonObject>)["stage:draft"].colour = "red";
    expect(gppLayoutSchema.safeParse(onNode).success).toBe(false);

    const onViewport = workedLayout();
    (onViewport.viewport as JsonObject).rotation = 0;
    expect(gppLayoutSchema.safeParse(onViewport).success).toBe(false);
  });

  it("the format is fixed and the shape reference is <key>@<version>", () => {
    const wrongFormat = workedLayout();
    wrongFormat.format = "gpp-layout/0.2";
    expect(gppLayoutSchema.safeParse(wrongFormat).success).toBe(false);

    const bareKey = workedLayout();
    bareKey.shape = "inquiry-response-watch";
    expect(gppLayoutSchema.safeParse(bareKey).success).toBe(false);
  });
});
