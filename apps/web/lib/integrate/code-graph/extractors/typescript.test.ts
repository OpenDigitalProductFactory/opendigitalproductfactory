import { describe, expect, it } from "vitest";

import { CODE_GRAPH_EXTRACTORS } from ".";
import { extractTypeScriptFacts, typeScriptExtractor } from "./typescript";

describe("extractTypeScriptFacts", () => {
  it("extracts imports and exported symbols", () => {
    const result = extractTypeScriptFacts({
      graphKey: "source-code",
      filePath: "apps/web/lib/example.ts",
      sourceText: [
        'import { prisma } from "@dpf/db";',
        'import { helper } from "./helper";',
        "export function getThing() { return helper(prisma); }",
      ].join("\n"),
    });

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "CodeSymbol", name: "getThing" }),
      expect.objectContaining({ kind: "ExternalModule", key: "source-code:module:@dpf/db" }),
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "IMPORTS", toKey: "source-code:module:@dpf/db" }),
      expect.objectContaining({ kind: "IMPORTS", toKey: "source-code:module:apps/web/lib/helper" }),
    ]));
  });

  it("is registered for projection", () => {
    expect(CODE_GRAPH_EXTRACTORS).toContain(typeScriptExtractor);
  });
});
