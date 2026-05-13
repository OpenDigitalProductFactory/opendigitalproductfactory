import { describe, expect, it } from "vitest";

import { CODE_GRAPH_EXTRACTORS } from ".";
import { extractNextRouteFacts, nextRouteExtractor } from "./next-routes";

describe("extractNextRouteFacts", () => {
  it("extracts route entrypoints from app router files", () => {
    const result = extractNextRouteFacts({
      graphKey: "source-code",
      filePath: "apps/web/app/(shell)/build/page.tsx",
      sourceText: "",
    });

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "CodeRoute", name: "/build" }),
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "IMPLEMENTS_ROUTE" }),
    ]));
  });

  it("is registered for projection", () => {
    expect(CODE_GRAPH_EXTRACTORS).toContain(nextRouteExtractor);
  });
});
