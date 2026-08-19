export type CodeGraphNodeKind =
  | "CodeFile"
  | "CodeSymbol"
  | "CodeRoute"
  | "CodeTool"
  | "PrismaModel"
  | "PrismaField"
  | "PromptTemplateSource"
  | "TestFile"
  | "ExternalModule";

export type CodeGraphEdgeKind =
  | "DEFINES"
  | "IMPORTS"
  | "REFERENCES"
  | "IMPLEMENTS_ROUTE"
  | "EXPOSES_TOOL"
  | "USES_MODEL"
  | "USES_PROMPT"
  | "TESTED_BY"
  | "HAS_FIELD"
  | "RELATES_TO";

export type CodeGraphConfidence = "exact" | "heuristic";

/**
 * Optional primitive metadata projected onto a node/edge (Neo4j `SET n += map`).
 * Values are limited to primitives so they map cleanly to graph properties.
 */
export type CodeGraphAttributes = Record<string, string | number | boolean>;

export type CodeGraphNodeFact = {
  graphKey: string;
  kind: CodeGraphNodeKind;
  key: string;
  name: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  extractor: string;
  /** Optional primitive metadata (e.g. Prisma field type/flags). */
  attributes?: CodeGraphAttributes;
};

export type CodeGraphEdgeFact = {
  graphKey: string;
  kind: CodeGraphEdgeKind;
  fromKey: string;
  toKey: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  confidence: CodeGraphConfidence;
  extractor: string;
  /** Optional primitive metadata (e.g. relation cardinality / FK info). */
  attributes?: CodeGraphAttributes;
};

export type CodeGraphExtraction = {
  nodes: CodeGraphNodeFact[];
  edges: CodeGraphEdgeFact[];
};

export function mergeExtractions(extractions: CodeGraphExtraction[]): CodeGraphExtraction {
  return {
    nodes: extractions.flatMap((entry) => entry.nodes),
    edges: extractions.flatMap((entry) => entry.edges),
  };
}

export type CodeGraphExtractorInput = {
  graphKey: string;
  filePath: string;
  sourceText: string;
};

export type CodeGraphExtractor = {
  name: string;
  version: string;
  matches(filePath: string): boolean;
  extract(input: CodeGraphExtractorInput): CodeGraphExtraction;
};
