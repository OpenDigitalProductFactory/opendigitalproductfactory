import type { CodeGraphExtraction, CodeGraphExtractor, CodeGraphExtractorInput } from "../types";

const EXTRACTOR = "prisma-line-v1";

function lineFor(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export function extractPrismaFacts(input: CodeGraphExtractorInput): CodeGraphExtraction {
  const nodes: CodeGraphExtraction["nodes"] = [];
  const edges: CodeGraphExtraction["edges"] = [];
  const modelPattern = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm;
  let match: RegExpExecArray | null;

  while ((match = modelPattern.exec(input.sourceText)) != null) {
    const name = match[1];
    const startLine = lineFor(input.sourceText, match.index);
    const key = `${input.graphKey}:prisma-model:${name}`;
    nodes.push({
      graphKey: input.graphKey,
      kind: "PrismaModel",
      key,
      name,
      filePath: input.filePath,
      startLine,
      endLine: startLine,
      extractor: EXTRACTOR,
    });
    edges.push({
      graphKey: input.graphKey,
      kind: "DEFINES",
      fromKey: `${input.graphKey}:${input.filePath}`,
      toKey: key,
      filePath: input.filePath,
      startLine,
      endLine: startLine,
      confidence: "exact",
      extractor: EXTRACTOR,
    });
  }

  return { nodes, edges };
}

export const prismaExtractor: CodeGraphExtractor = {
  name: "prisma",
  version: "v1",
  matches(filePath) {
    return filePath.replace(/\\/g, "/").endsWith(".prisma");
  },
  extract: extractPrismaFacts,
};
