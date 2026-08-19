import ts from "typescript";

import type { CodeGraphExtraction, CodeGraphExtractor, CodeGraphExtractorInput } from "../types";

const EXTRACTOR = "mcp-tools-ast-v1";

function lineFor(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

export function extractMcpToolFacts(input: CodeGraphExtractorInput): CodeGraphExtraction {
  const sourceFile = ts.createSourceFile(input.filePath, input.sourceText, ts.ScriptTarget.Latest, true);
  const nodes: CodeGraphExtraction["nodes"] = [];
  const edges: CodeGraphExtraction["edges"] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "name" &&
      ts.isStringLiteralLike(node.initializer) &&
      /^[a-z][a-z0-9_]*$/.test(node.initializer.text)
    ) {
      const name = node.initializer.text;
      const key = `${input.graphKey}:tool:${name}`;
      const startLine = lineFor(sourceFile, node.getStart(sourceFile));
      const endLine = lineFor(sourceFile, node.getEnd());
      nodes.push({
        graphKey: input.graphKey,
        kind: "CodeTool",
        key,
        name,
        filePath: input.filePath,
        startLine,
        endLine,
        extractor: EXTRACTOR,
      });
      edges.push({
        graphKey: input.graphKey,
        kind: "EXPOSES_TOOL",
        fromKey: `${input.graphKey}:${input.filePath}`,
        toKey: key,
        filePath: input.filePath,
        startLine,
        endLine,
        confidence: "exact",
        extractor: EXTRACTOR,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { nodes, edges };
}

export const mcpToolExtractor: CodeGraphExtractor = {
  name: "mcp-tools",
  version: "v1",
  matches(filePath) {
    return filePath.replace(/\\/g, "/") === "apps/web/lib/mcp-tools.ts";
  },
  extract: extractMcpToolFacts,
};
