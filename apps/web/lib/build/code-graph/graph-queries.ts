import { prisma } from "@dpf/db";

import { getCodeGraphFreshness } from "@/lib/build/code-graph-access";
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

  const limit = normalizeLimit(input.limit, 10);
  const rows = (await prisma.$queryRawUnsafe(
    [
      "SELECT n.labels AS labels,",
      "       coalesce(n.props->>'name', n.props->>'path') AS name,",
      "       n.props->>'path' AS path,",
      "       (n.props->>'startLine')::int AS \"startLine\",",
      "       (n.props->>'endLine')::int AS \"endLine\",",
      "       n.props->>'extractor' AS extractor",
      "  FROM graph_node n",
      " WHERE n.props->>'graphKey' = $1",
      "   AND n.labels && $2::text[]",
      "   AND (",
      "     strpos(lower(coalesce(n.props->>'name', '')), $3) > 0",
      "     OR strpos(lower(coalesce(n.props->>'path', '')), $3) > 0",
      "   )",
      " ORDER BY CASE",
      "     WHEN lower(coalesce(n.props->>'name', '')) = $3 THEN 0",
      "     WHEN lower(coalesce(n.props->>'path', '')) = $3 THEN 1",
      "     ELSE 2",
      "   END, n.props->>'path' ASC, coalesce(n.props->>'name', n.props->>'path') ASC",
      `LIMIT ${limit}`,
    ].join("\n"),
    graphKey,
    [...SEARCH_NODE_LABELS],
    query,
  )) as RawSearchRow[];

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

  // 1. Locate the surface node (label + graphKey + name).
  const surfaceRows = (await prisma.$queryRawUnsafe(
    [
      "SELECT n.key AS key, n.labels AS \"surfaceLabels\",",
      "       n.props->>'name' AS \"surfaceName\",",
      "       n.props->>'path' AS \"surfacePath\",",
      "       (n.props->>'startLine')::int AS \"surfaceStartLine\",",
      "       (n.props->>'endLine')::int AS \"surfaceEndLine\"",
      "  FROM graph_node n",
      " WHERE $1 = ANY(n.labels) AND n.props->>'graphKey' = $2 AND n.props->>'name' = $3",
      " LIMIT 1",
    ].join("\n"),
    query.label,
    graphKey,
    query.selector.value,
  )) as Array<{
    key: string;
    surfaceLabels: string[];
    surfaceName: string | null;
    surfacePath: string | null;
    surfaceStartLine: number | null;
    surfaceEndLine: number | null;
  }>;

  let traceRow: RawTraceRow | undefined;
  const surface = surfaceRows[0];
  if (surface) {
    // 2. Implementation files: (file:CodeFile)-[rel:relationship]->(surface).
    const implRows = (await prisma.$queryRawUnsafe(
      [
        "SELECT DISTINCT f.key AS \"fileKey\", f.props->>'path' AS path, e.rel_type AS relationship",
        "  FROM graph_edge e",
        "  JOIN graph_node f ON f.key = e.src_key AND 'CodeFile' = ANY(f.labels) AND f.props->>'graphKey' = $1",
        " WHERE e.dst_key = $2 AND e.rel_type = $3",
      ].join("\n"),
      graphKey,
      surface.key,
      query.relationship,
    )) as Array<{ fileKey: string; path: string | null; relationship: string | null }>;

    // 3. Related tests: (test:TestFile)-[TESTED_BY]->(file) for the impl files.
    const fileKeys = implRows.map((r) => r.fileKey);
    const testRows = fileKeys.length
      ? ((await prisma.$queryRawUnsafe(
          [
            "SELECT DISTINCT t.props->>'path' AS path, e.props->>'confidence' AS confidence",
            "  FROM graph_edge e",
            "  JOIN graph_node t ON t.key = e.src_key AND 'TestFile' = ANY(t.labels) AND t.props->>'graphKey' = $1",
            " WHERE e.rel_type = 'TESTED_BY' AND e.dst_key = ANY($2::text[])",
          ].join("\n"),
          graphKey,
          fileKeys,
        )) as Array<{ path: string | null; confidence: string | null }>)
      : [];

    traceRow = {
      surfaceLabels: surface.surfaceLabels,
      surfaceName: surface.surfaceName,
      surfacePath: surface.surfacePath,
      surfaceStartLine: surface.surfaceStartLine,
      surfaceEndLine: surface.surfaceEndLine,
      implementationFiles: implRows.map((r) => ({ path: r.path, relationship: r.relationship })),
      relatedTests: testRows.map((r) => ({ path: r.path, confidence: r.confidence })),
    };
  }

  const trace = mapTraceRow(traceRow);
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

  const limit = normalizeLimit(input.limit, 25);
  const rows = (await prisma.$queryRawUnsafe(
    [
      "SELECT t.props->>'path' AS path,",
      "       t.props->>'name' AS name,",
      "       e.props->>'confidence' AS confidence,",
      "       (e.props->>'startLine')::int AS \"startLine\",",
      "       (e.props->>'endLine')::int AS \"endLine\"",
      "  FROM graph_edge e",
      "  JOIN graph_node t ON t.key = e.src_key AND 'TestFile' = ANY(t.labels) AND t.props->>'graphKey' = $1",
      "  JOIN graph_node s ON s.key = e.dst_key AND 'CodeFile' = ANY(s.labels)",
      "       AND s.props->>'graphKey' = $1 AND s.props->>'path' = $2",
      " WHERE e.rel_type = 'TESTED_BY'",
      " ORDER BY confidence ASC, path ASC",
      `LIMIT ${limit}`,
    ].join("\n"),
    graphKey,
    filePath,
  )) as RawRelatedTestRow[];

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
