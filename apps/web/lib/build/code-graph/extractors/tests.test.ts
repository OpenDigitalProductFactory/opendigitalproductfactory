import { describe, expect, it } from "vitest";

import { CODE_GRAPH_EXTRACTORS } from ".";
import { extractTestFileFacts, testExtractor } from "./tests";

describe("extractTestFileFacts", () => {
  it("uses AST-resolved imports for exact TESTED_BY edges", () => {
    const result = extractTestFileFacts({
      graphKey: "source-code",
      filePath: "apps/web/lib/integrate/change-impact.test.ts",
      sourceText: 'import { analyzeChangeImpact } from "./change-impact";',
    });

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "TestFile", name: "change-impact.test.ts" }),
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "TESTED_BY",
        toKey: "source-code:apps/web/lib/integrate/change-impact.ts",
        confidence: "exact",
      }),
    ]));
  });

  it("maps TypeScript tests importing runtime .js specifiers back to indexed .ts files", () => {
    const result = extractTestFileFacts({
      graphKey: "source-code",
      filePath: "packages/db/src/seed-geographic-data.test.ts",
      sourceText: 'import { seedCityOnce } from "./seed-geographic-data.js";',
    });

    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "TESTED_BY",
        toKey: "source-code:packages/db/src/seed-geographic-data.ts",
        confidence: "exact",
      }),
    ]));
  });

  it("falls back to filename-stem matching when imports do not identify a source file", () => {
    const result = extractTestFileFacts({
      graphKey: "source-code",
      filePath: "apps/web/lib/integrate/orphan-feature.test.ts",
      sourceText: "describe('orphan', () => {});",
    });

    expect(result.edges.some((edge) => edge.confidence === "heuristic")).toBe(true);
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "TESTED_BY",
        toKey: "source-code:apps/web/lib/integrate/orphan-feature.ts",
      }),
    ]));
  });

  it("is registered for projection", () => {
    expect(CODE_GRAPH_EXTRACTORS).toContain(testExtractor);
  });
});
