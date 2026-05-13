export type CodeGraphNodeKind =
  | "CodeFile"
  | "CodeSymbol"
  | "CodeRoute"
  | "CodeTool"
  | "PrismaModel"
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
  | "TESTED_BY";

export type CodeGraphConfidence = "exact" | "heuristic";

export type CodeGraphNodeFact = {
  graphKey: string;
  kind: CodeGraphNodeKind;
  key: string;
  name: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  extractor: string;
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
