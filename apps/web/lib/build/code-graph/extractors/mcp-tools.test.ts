import { describe, expect, it } from "vitest";

import { CODE_GRAPH_EXTRACTORS } from ".";
import { extractMcpToolFacts, mcpToolExtractor } from "./mcp-tools";

describe("extractMcpToolFacts", () => {
  it("extracts MCP tool definitions by name", () => {
    const result = extractMcpToolFacts({
      graphKey: "source-code",
      filePath: "apps/web/lib/mcp-tools.ts",
      sourceText: 'const tools = [{ name: "get_code_graph_freshness", description: "Get graph" }];',
    });

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "CodeTool", name: "get_code_graph_freshness" }),
    ]));
  });

  it("is registered for projection", () => {
    expect(CODE_GRAPH_EXTRACTORS).toContain(mcpToolExtractor);
  });
});
