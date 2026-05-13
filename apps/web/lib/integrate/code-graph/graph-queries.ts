import { runCypher } from "@dpf/db";

import { getCodeGraphFreshness } from "@/lib/integrate/code-graph-access";
import { CODE_GRAPH_GRAPH_KEY } from "./constants";
import type { CodeGraphConfidence, CodeGraphNodeKind } from "./types";

const SEARCH_NODE_LABELS = [
  "CodeFile",
  "CodeSymbol",
  "CodeRoute",
  "CodeTool",
  "PrismaModel",
  "PromptTemplateSource",
  "TestFile",
  "ExternalModule",
] as const satisfies readonly CodeGraphNodeKind[];

type CodeGraphReadiness = {
  graphKey: string;
  available: boolean;
  indexStatus: string;
  warnings: string[];
  summary: string;
};

export type CodeGraphNodeSearchResult = {
  kind: CodeGraphNodeKind;
  name: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
  extractor: string | null;
};

export type SearchCodeGraphResult = CodeGraphReadiness & {
  query: string;
  results: CodeGraphNodeSearchResult[];
};

export type CodeSurfaceSelector =
  | { kind: "route"; value: string }
  | { kind: "tool"; value: string }
  | { kind: "model"; value: string };

export type CodeSurfaceTraceFile = {
  path: string;
  relationship: string;
};

export type CodeSurfaceRelatedTest = {
  path: string;
  confidence: CodeGraphConfidence;
};

export type CodeSurfaceTraceResult = CodeGraphReadiness & {
  selector: CodeSurfaceSelector;
  surface: {
    kind: CodeGraphNodeKind;
    name: string;
    path: string;
    startLine: number | null;
    endLine: number | null;
  } | null;
  implementationFiles: CodeSurfaceTraceFile[];
  relatedTests: CodeSurfaceRelatedTest[];
};

export type RelatedTestResult = {
  path: string;
  name: string;
  confidence: CodeGraphConfidence;
  startLine: number | null;
  endLine: number | null;
};

export type FindRelatedTestsResult = CodeGraphReadiness & {
  filePath: string;
  tests: RelatedTestResult[];
};

type RawSearchRow = {
  labels?: unknown;
  name?: unknown;
  path?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  extractor?: unknown;
};

type RawTraceRow = {
  surfaceLabels?: unknown;
  surfaceName?: unknown;
  surfacePath?: unknown;
  surfaceStartLine?: unknown;
  surfaceEndLine?: unknown;
  implementationFiles?: unknown;
  relatedTests?: unknown;
};

type RawRelatedTestRow = {
  path?: unknown;
  name?: unknown;
  confidence?: unknown;
  startLine?: unknown;
  endLine?: unknown;
};

type SurfaceQueryConfig = {
  selector: CodeSurfaceSelector;
  label: "CodeRoute" | "CodeTool" | "PrismaModel";
  relationship: "IMPLEMENTS_ROUTE" | "EXPOSES_TOOL" | "DEFINES";
};

function normalizeLimit(limit: number | undefined, defaultLimit: number): number {
  if (!Number.isFinite(limit)) return defaultLimit;
  return Math.max(1, Math.min(Math.trunc(limit ?? defaultLimit), 50));
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber: unknown }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return null;
}

function pickNodeKind(labels: unknown): CodeGraphNodeKind {
  const values = Array.isArray(labels) ? labels.map(String) : [];
  return SEARCH_NODE_LABELS.find((label) => values.includes(label)) ?? "CodeFile";
}

function normalizeConfidence(value: unknown): CodeGraphConfidence {
  return value === "heuristic" ? "heuristic" : "exact";
}

async function getCodeGraphReadiness(graphKey: string): Promise<CodeGraphReadiness> {
  const freshness = await getCodeGraphFreshness(graphKey);
  const available = freshness.available && freshness.indexStatus !== "failed";
  return {
    graphKey,
    available,
    indexStatus: freshness.indexStatus,
    warnings: freshness.warnings,
    summary: freshness.summary,
  };
}

function makeUnavailableSearchResult(
  readiness: CodeGraphReadiness,
  query: string,
): SearchCodeGraphResult {
  return {
    ...readiness,
    query,
    results: [],
  };
}

function makeUnavailableTraceResult(
  readiness: CodeGraphReadiness,
  selector: CodeSurfaceSelector,
): CodeSurfaceTraceResult {
  return {
    ...readiness,
    selector,
    surface: null,
    implementationFiles: [],
    relatedTests: [],
  };
}

function makeUnavailableRelatedTestsResult(
  readiness: CodeGraphReadiness,
  filePath: string,
): FindRelatedTestsResult {
  return {
    ...readiness,
    filePath,
    tests: [],
  };
}

function mapSearchRow(row: RawSearchRow): CodeGraphNodeSearchResult {
  const path = asString(row.path);
  const name = asString(row.name, path.split("/").at(-1) ?? path);
  return {
    kind: pickNodeKind(row.labels),
    name,
    path,
    startLine: toNullableNumber(row.startLine),
    endLine: toNullableNumber(row.endLine),
    extractor: typeof row.extractor === "string" ? row.extractor : null,
  };
}

function normalizeRoute(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function resolveSurfaceQuery(input: {
  route?: string;
  tool?: string;
  model?: string;
}): SurfaceQueryConfig {
  const candidates: SurfaceQueryConfig[] = [];
  if (typeof input.route === "string" && input.route.trim()) {
    candidates.push({
      selector: { kind: "route", value: normalizeRoute(input.route) },
      label: "CodeRoute",
      relationship: "IMPLEMENTS_ROUTE",
    });
  }
  if (typeof input.tool === "string" && input.tool.trim()) {
    candidates.push({
      selector: { kind: "tool", value: input.tool.trim() },
      label: "CodeTool",
      relationship: "EXPOSES_TOOL",
    });
  }
  if (typeof input.model === "string" && input.model.trim()) {
    candidates.push({
      selector: { kind: "model", value: input.model.trim() },
      label: "PrismaModel",
      relationship: "DEFINES",
    });
  }

  if (candidates.length !== 1) {
    throw new Error("Pass exactly one of route, tool, or model.");
  }
  return candidates[0]!;
}

function mapImplementationFiles(value: unknown): CodeSurfaceTraceFile[] {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const files: CodeSurfaceTraceFile[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const path = asString((row as { path?: unknown }).path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    files.push({
      path,
      relationship: asString((row as { relationship?: unknown }).relationship),
    });
  }
  return files;
}

function mapRelatedTests(value: unknown): CodeSurfaceRelatedTest[] {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const tests: CodeSurfaceRelatedTest[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const path = asString((row as { path?: unknown }).path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    tests.push({
      path,
      confidence: normalizeConfidence((row as { confidence?: unknown }).confidence),
    });
  }
  return tests;
}

function mapTraceRow(row: RawTraceRow | undefined): Omit<
  CodeSurfaceTraceResult,
  keyof CodeGraphReadiness | "selector"
> {
  if (!row?.surfaceName) {
    return {
      surface: null,
      implementationFiles: [],
      relatedTests: [],
    };
  }

  return {
    surface: {
      kind: pickNodeKind(row.surfaceLabels),
      name: asString(row.surfaceName),
      path: asString(row.surfacePath),
      startLine: toNullableNumber(row.surfaceStartLine),
      endLine: toNullableNumber(row.surfaceEndLine),
    },
    implementationFiles: mapImplementationFiles(row.implementationFiles),
    relatedTests: mapRelatedTests(row.relatedTests),
  };
}

function mapRelatedTestRow(row: RawRelatedTestRow): RelatedTestResult {
  const path = asString(row.path);
  return {
    path,
    name: asString(row.name, path.split("/").at(-1) ?? path),
    confidence: normalizeConfidence(row.confidence),
    startLine: toNullableNumber(row.startLine),
    endLine: toNullableNumber(row.endLine),
  };
}

export async function searchCodeGraph(input: {
  query: string;
  graphKey?: string;
  limit?: number;
}): Promise<SearchCodeGraphResult> {
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const query = input.query.trim().toLowerCase();
  const readiness = await getCodeGraphReadiness(graphKey);
  if (!readiness.available) return makeUnavailableSearchResult(readiness, query);
  if (!query) {
    return {
      ...readiness,
      query,
      results: [],
      summary: "Search query was empty.",
    };
  }

  const rows = await runCypher<RawSearchRow>(
    [
      "MATCH (n)",
      "WHERE n.graphKey = $graphKey",
      "  AND any(label IN labels(n) WHERE label IN $nodeLabels)",
      "  AND (",
      "    toLower(coalesce(n.name, '')) CONTAINS $query",
      "    OR toLower(coalesce(n.path, '')) CONTAINS $query",
      "  )",
      "RETURN labels(n) AS labels,",
      "       coalesce(n.name, n.path) AS name,",
      "       n.path AS path,",
      "       n.startLine AS startLine,",
      "       n.endLine AS endLine,",
      "       n.extractor AS extractor",
      "ORDER BY CASE",
      "  WHEN toLower(coalesce(n.name, '')) = $query THEN 0",
      "  WHEN toLower(coalesce(n.path, '')) = $query THEN 1",
      "  ELSE 2",
      "END, path ASC, name ASC",
      "LIMIT $limit",
    ].join("\n"),
    {
      graphKey,
      query,
      nodeLabels: SEARCH_NODE_LABELS,
      limit: normalizeLimit(input.limit, 10),
    },
  );

  const results = rows.map(mapSearchRow);
  return {
    ...readiness,
    query,
    results,
    summary: results.length
      ? `Found ${results.length} code graph result${results.length === 1 ? "" : "s"} for "${query}".`
      : `No code graph results matched "${query}".`,
  };
}

export async function traceCodeSurface(input: {
  route?: string;
  tool?: string;
  model?: string;
  graphKey?: string;
}): Promise<CodeSurfaceTraceResult> {
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const query = resolveSurfaceQuery(input);
  const readiness = await getCodeGraphReadiness(graphKey);
  if (!readiness.available) return makeUnavailableTraceResult(readiness, query.selector);

  const rows = await runCypher<RawTraceRow>(
    [
      `MATCH (surface:${query.label} {graphKey: $graphKey, name: $surfaceName})`,
      `OPTIONAL MATCH (file:CodeFile {graphKey: $graphKey})-[rel:${query.relationship}]->(surface)`,
      "OPTIONAL MATCH (test:TestFile {graphKey: $graphKey})-[testedBy:TESTED_BY]->(file)",
      "RETURN labels(surface) AS surfaceLabels,",
      "       surface.name AS surfaceName,",
      "       surface.path AS surfacePath,",
      "       surface.startLine AS surfaceStartLine,",
      "       surface.endLine AS surfaceEndLine,",
      "       collect(DISTINCT CASE WHEN file.path IS NULL THEN null ELSE { path: file.path, relationship: type(rel) } END) AS implementationFiles,",
      "       collect(DISTINCT CASE WHEN test.path IS NULL THEN null ELSE { path: test.path, confidence: testedBy.confidence } END) AS relatedTests",
      "LIMIT 1",
    ].join("\n"),
    {
      graphKey,
      surfaceName: query.selector.value,
    },
  );

  const trace = mapTraceRow(rows[0]);
  return {
    ...readiness,
    selector: query.selector,
    ...trace,
    summary: trace.surface
      ? `Found ${query.selector.kind} "${query.selector.value}" with ${trace.implementationFiles.length} implementation file${trace.implementationFiles.length === 1 ? "" : "s"} and ${trace.relatedTests.length} related test${trace.relatedTests.length === 1 ? "" : "s"}.`
      : `No code graph surface matched ${query.selector.kind} "${query.selector.value}".`,
  };
}

export async function findRelatedTests(input: {
  filePath: string;
  graphKey?: string;
  limit?: number;
}): Promise<FindRelatedTestsResult> {
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const filePath = input.filePath.trim().replace(/\\/g, "/");
  const readiness = await getCodeGraphReadiness(graphKey);
  if (!readiness.available) return makeUnavailableRelatedTestsResult(readiness, filePath);
  if (!filePath) {
    return {
      ...readiness,
      filePath,
      tests: [],
      summary: "File path was empty.",
    };
  }

  const rows = await runCypher<RawRelatedTestRow>(
    [
      "MATCH (test:TestFile {graphKey: $graphKey})-[r:TESTED_BY]->(source:CodeFile {graphKey: $graphKey, path: $filePath})",
      "RETURN test.path AS path,",
      "       test.name AS name,",
      "       r.confidence AS confidence,",
      "       r.startLine AS startLine,",
      "       r.endLine AS endLine",
      "ORDER BY confidence ASC, path ASC",
      "LIMIT $limit",
    ].join("\n"),
    {
      graphKey,
      filePath,
      limit: normalizeLimit(input.limit, 25),
    },
  );

  const tests = rows.map(mapRelatedTestRow);
  return {
    ...readiness,
    filePath,
    tests,
    summary: tests.length
      ? `Found ${tests.length} related test${tests.length === 1 ? "" : "s"} for ${filePath}.`
      : `No related tests are linked to ${filePath}.`,
  };
}
