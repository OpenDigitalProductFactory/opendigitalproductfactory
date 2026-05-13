import { runCypher } from "@dpf/db";
import { lazyFsPromises, lazyPath } from "@/lib/shared/lazy-node";

import { CODE_GRAPH_EXTRACTORS } from "./extractors";
import { checksumContent } from "./hash";
import {
  deleteCodeGraphFileHash,
  recordExtractionWarning,
  upsertCodeGraphFileHash,
} from "./state-store";
import {
  mergeExtractions,
  type CodeGraphEdgeFact,
  type CodeGraphExtraction,
  type CodeGraphNodeFact,
} from "./types";

const STRUCTURAL_NODE_LABELS = [
  "CodeSymbol",
  "CodeRoute",
  "CodeTool",
  "PrismaModel",
  "PromptTemplateSource",
  "TestFile",
  "ExternalModule",
];

export function buildCodeFileKey(graphKey: string, filePath: string): string {
  return `${graphKey}:${filePath}`;
}

export async function clearCodeGraph(graphKey: string): Promise<void> {
  await runCypher(
    "MATCH (n:CodeFile {graphKey: $graphKey}) DETACH DELETE n",
    { graphKey },
  );
}

export async function ensureCodeGraphNeo4jSchema(): Promise<void> {
  const statements = [
    "CREATE CONSTRAINT cf_codeFileKey IF NOT EXISTS FOR (n:CodeFile) REQUIRE n.codeFileKey IS UNIQUE",
    "CREATE CONSTRAINT cs_symbolKey IF NOT EXISTS FOR (n:CodeSymbol) REQUIRE n.codeSymbolKey IS UNIQUE",
    "CREATE CONSTRAINT cr_routeKey IF NOT EXISTS FOR (n:CodeRoute) REQUIRE n.codeRouteKey IS UNIQUE",
    "CREATE CONSTRAINT ct_toolKey IF NOT EXISTS FOR (n:CodeTool) REQUIRE n.codeToolKey IS UNIQUE",
    "CREATE CONSTRAINT pm_modelKey IF NOT EXISTS FOR (n:PrismaModel) REQUIRE n.prismaModelKey IS UNIQUE",
    "CREATE CONSTRAINT pts_promptKey IF NOT EXISTS FOR (n:PromptTemplateSource) REQUIRE n.promptTemplateSourceKey IS UNIQUE",
    "CREATE CONSTRAINT tf_testFileKey IF NOT EXISTS FOR (n:TestFile) REQUIRE n.testFileKey IS UNIQUE",
    "CREATE CONSTRAINT em_moduleKey IF NOT EXISTS FOR (n:ExternalModule) REQUIRE n.externalModuleKey IS UNIQUE",
    "CREATE INDEX cf_graphKey IF NOT EXISTS FOR (n:CodeFile) ON (n.graphKey)",
    "CREATE INDEX cf_path IF NOT EXISTS FOR (n:CodeFile) ON (n.path)",
    "CREATE INDEX cs_graphKey IF NOT EXISTS FOR (n:CodeSymbol) ON (n.graphKey)",
    "CREATE INDEX cr_graphKey IF NOT EXISTS FOR (n:CodeRoute) ON (n.graphKey)",
    "CREATE INDEX ct_graphKey IF NOT EXISTS FOR (n:CodeTool) ON (n.graphKey)",
    "CREATE INDEX pm_graphKey IF NOT EXISTS FOR (n:PrismaModel) ON (n.graphKey)",
    "CREATE INDEX pts_graphKey IF NOT EXISTS FOR (n:PromptTemplateSource) ON (n.graphKey)",
    "CREATE INDEX tf_graphKey IF NOT EXISTS FOR (n:TestFile) ON (n.graphKey)",
    "CREATE INDEX em_graphKey IF NOT EXISTS FOR (n:ExternalModule) ON (n.graphKey)",
  ];

  for (const statement of statements) {
    try {
      await runCypher(statement);
    } catch {
      // Reconcile can proceed if an equivalent schema object already exists.
    }
  }
}

async function clearStructuralFactsForFile(graphKey: string, filePath: string): Promise<void> {
  await runCypher(
    [
      "MATCH ()-[r {graphKey: $graphKey, filePath: $filePath}]-()",
      "DELETE r",
    ].join("\n"),
    { graphKey, filePath },
  );
  await runCypher(
    [
      "MATCH (n {graphKey: $graphKey, path: $filePath})",
      "WHERE any(label IN labels(n) WHERE label IN $labels)",
      "DETACH DELETE n",
    ].join("\n"),
    { graphKey, filePath, labels: STRUCTURAL_NODE_LABELS },
  );
}

function keyFieldForLabel(label: string): string {
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}Key`;
}

async function projectNodeFact(fact: CodeGraphNodeFact): Promise<void> {
  const label = fact.kind;
  const keyField = keyFieldForLabel(label);
  await runCypher(
    [
      `MERGE (n:${label} {${keyField}: $key})`,
      "SET n.graphKey = $graphKey,",
      "    n.name = $name,",
      "    n.path = $filePath,",
      "    n.startLine = $startLine,",
      "    n.endLine = $endLine,",
      "    n.extractor = $extractor",
    ].join("\n"),
    fact,
  );
}

async function projectEdgeFact(fact: CodeGraphEdgeFact): Promise<void> {
  await runCypher(
    [
      "MATCH (from {graphKey: $graphKey})",
      "WHERE any(key IN keys(from) WHERE from[key] = $fromKey)",
      "MATCH (to {graphKey: $graphKey})",
      "WHERE any(key IN keys(to) WHERE to[key] = $toKey)",
      `MERGE (from)-[r:${fact.kind} {graphKey: $graphKey, fromKey: $fromKey, toKey: $toKey}]->(to)`,
      "SET r.filePath = $filePath,",
      "    r.startLine = $startLine,",
      "    r.endLine = $endLine,",
      "    r.confidence = $confidence,",
      "    r.extractor = $extractor",
    ].join("\n"),
    fact,
  );
}

async function extractStructuralFacts(
  graphKey: string,
  filePath: string,
  sourceText: string,
): Promise<CodeGraphExtraction> {
  const extractions: CodeGraphExtraction[] = [];
  for (const extractor of CODE_GRAPH_EXTRACTORS) {
    if (!extractor.matches(filePath)) continue;
    try {
      extractions.push(extractor.extract({ graphKey, filePath, sourceText }));
    } catch (error) {
      await recordExtractionWarning({
        graphKey,
        filePath,
        extractor: extractor.name,
        message: error instanceof Error ? error.message : String(error),
        observedAt: new Date(),
      });
    }
  }
  return mergeExtractions(extractions);
}

async function projectStructuralFacts(extraction: CodeGraphExtraction): Promise<void> {
  for (const node of extraction.nodes) {
    await projectNodeFact(node);
  }
  for (const edge of extraction.edges) {
    await projectEdgeFact(edge);
  }
}

export async function syncTrackedFile(graphKey: string, gitRoot: string, filePath: string): Promise<void> {
  const { readFile } = lazyFsPromises();
  const fullPath = lazyPath().resolve(gitRoot, filePath);
  const codeFileKey = buildCodeFileKey(graphKey, filePath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const checksum = checksumContent(content);
    const indexedAt = new Date();

    await runCypher(
      [
        "MERGE (f:CodeFile {codeFileKey: $codeFileKey})",
        "SET f.graphKey = $graphKey,",
        "    f.path = $filePath,",
        "    f.extension = $extension,",
        "    f.checksum = $checksum,",
        "    f.indexedAt = datetime($indexedAt)",
      ].join("\n"),
      {
        codeFileKey,
        graphKey,
        filePath,
        extension: lazyPath().extname(filePath).toLowerCase(),
        checksum,
        indexedAt: indexedAt.toISOString(),
      },
    );

    await upsertCodeGraphFileHash({ graphKey, filePath, checksum, indexedAt });
    await clearStructuralFactsForFile(graphKey, filePath);
    await projectStructuralFacts(await extractStructuralFacts(graphKey, filePath, content));
  } catch {
    await runCypher(
      "MATCH (f:CodeFile {codeFileKey: $codeFileKey}) DETACH DELETE f",
      { codeFileKey },
    );
    await clearStructuralFactsForFile(graphKey, filePath);
    await deleteCodeGraphFileHash(graphKey, filePath);
  }
}
