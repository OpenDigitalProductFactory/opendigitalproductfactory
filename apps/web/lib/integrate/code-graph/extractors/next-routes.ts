import type { CodeGraphExtraction, CodeGraphExtractor, CodeGraphExtractorInput } from "../types";

const EXTRACTOR = "next-routes-v1";
const ENTRYPOINT_PATTERN = /^apps\/web\/app\/(.+)\/(page|layout|route)\.[jt]sx?$/;

function routeFromFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(ENTRYPOINT_PATTERN);
  if (!match) return null;
  const segments = match[1]
    .split("/")
    .filter((segment) => segment.length > 0 && !segment.startsWith("("));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export function extractNextRouteFacts(input: CodeGraphExtractorInput): CodeGraphExtraction {
  const route = routeFromFilePath(input.filePath);
  if (!route) return { nodes: [], edges: [] };

  const routeKey = `${input.graphKey}:route:${route}`;
  return {
    nodes: [{
      graphKey: input.graphKey,
      kind: "CodeRoute",
      key: routeKey,
      name: route,
      filePath: input.filePath,
      startLine: null,
      endLine: null,
      extractor: EXTRACTOR,
    }],
    edges: [{
      graphKey: input.graphKey,
      kind: "IMPLEMENTS_ROUTE",
      fromKey: `${input.graphKey}:${input.filePath}`,
      toKey: routeKey,
      filePath: input.filePath,
      startLine: null,
      endLine: null,
      confidence: "exact",
      extractor: EXTRACTOR,
    }],
  };
}

export const nextRouteExtractor: CodeGraphExtractor = {
  name: "next-routes",
  version: "v1",
  matches(filePath) {
    return routeFromFilePath(filePath) != null;
  },
  extract: extractNextRouteFacts,
};
