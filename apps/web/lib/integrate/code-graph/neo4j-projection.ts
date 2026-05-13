import { runCypher } from "@dpf/db";
import { lazyFsPromises, lazyPath } from "@/lib/shared/lazy-node";

import { CODE_GRAPH_EXTRACTORS } from "./extractors";
import { checksumContent } from "./hash";
import {
  deleteCodeGraphFileHash,
  insertCodeGraphFileHashes,
  recordExtractionWarning,
  upsertCodeGraphFileHash,
} from "./state-store";
import {
  mergeExtractions,
  type CodeGraphEdgeKind,
  type CodeGraphEdgeFact,
  type CodeGraphExtraction,
  type CodeGraphNodeKind,
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
const PROJECTION_BATCH_SIZE = 100;
const EDGE_PROJECTION_BATCH_SIZE = 50;

type CodeFileProjection = {
  codeFileKey: string;
  graphKey: string;
  filePath: string;
  extension: string;
  checksum: string;
  indexedAt: Date;
};

type NodeEndpointProjection = {
  label: CodeGraphNodeKind;
  keyField: string;
};

export function buildCodeFileKey(graphKey: string, filePath: string): string {
  return `${graphKey}:${filePath}`;
}

export async function clearCodeGraph(graphKey: string): Promise<void> {
  await runCypher(
    "MATCH (n {graphKey: $graphKey}) DETACH DELETE n",
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

function endpointForKey(graphKey: string, key: string): NodeEndpointProjection | null {
  const typedPrefixes: Array<{ prefix: string; label: CodeGraphNodeKind }> = [
    { prefix: `${graphKey}:symbol:`, label: "CodeSymbol" },
    { prefix: `${graphKey}:route:`, label: "CodeRoute" },
    { prefix: `${graphKey}:tool:`, label: "CodeTool" },
    { prefix: `${graphKey}:prisma-model:`, label: "PrismaModel" },
    { prefix: `${graphKey}:test:`, label: "TestFile" },
    { prefix: `${graphKey}:module:`, label: "ExternalModule" },
  ];
  const match = typedPrefixes.find((entry) => key.startsWith(entry.prefix));
  const label = match?.label ?? (key.startsWith(`${graphKey}:`) ? "CodeFile" : null);
  if (!label) return null;
  return { label, keyField: keyFieldForLabel(label) };
}

function groupByKind<T extends { kind: string }>(facts: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const fact of facts) {
    const group = groups.get(fact.kind);
    if (group) {
      group.push(fact);
    } else {
      groups.set(fact.kind, [fact]);
    }
  }
  return groups;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function projectCodeFileFacts(files: CodeFileProjection[]): Promise<void> {
  for (const batch of chunks(files, PROJECTION_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    await runCypher(
      [
        "UNWIND $files AS file",
        "MERGE (f:CodeFile {codeFileKey: file.codeFileKey})",
        "SET f.graphKey = file.graphKey,",
        "    f.path = file.filePath,",
        "    f.extension = file.extension,",
        "    f.checksum = file.checksum,",
        "    f.indexedAt = datetime(file.indexedAt)",
      ].join("\n"),
      {
        files: batch.map((file) => ({
          ...file,
          indexedAt: file.indexedAt.toISOString(),
        })),
      },
    );
  }
}

async function projectNodeFacts(label: CodeGraphNodeKind, facts: CodeGraphNodeFact[]): Promise<void> {
  const keyField = keyFieldForLabel(label);
  for (const batch of chunks(facts, PROJECTION_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    await runCypher(
      [
        "UNWIND $facts AS fact",
        `MERGE (n:${label} {${keyField}: fact.key})`,
        "SET n.graphKey = fact.graphKey,",
        "    n.name = fact.name,",
        "    n.path = fact.filePath,",
        "    n.startLine = fact.startLine,",
        "    n.endLine = fact.endLine,",
        "    n.extractor = fact.extractor",
      ].join("\n"),
      { facts: batch },
    );
  }
}

async function projectTypedEdgeFacts(
  kind: CodeGraphEdgeKind,
  from: NodeEndpointProjection,
  to: NodeEndpointProjection,
  facts: CodeGraphEdgeFact[],
): Promise<void> {
  for (const batch of chunks(facts, EDGE_PROJECTION_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    await runCypher(
      [
        "UNWIND $facts AS fact",
        `MATCH (from:${from.label} {${from.keyField}: fact.fromKey})`,
        `MATCH (to:${to.label} {${to.keyField}: fact.toKey})`,
        `MERGE (from)-[r:${kind} {graphKey: fact.graphKey, fromKey: fact.fromKey, toKey: fact.toKey}]->(to)`,
        "SET r.filePath = fact.filePath,",
        "    r.startLine = fact.startLine,",
        "    r.endLine = fact.endLine,",
        "    r.confidence = fact.confidence,",
        "    r.extractor = fact.extractor",
      ].join("\n"),
      { facts: batch },
    );
  }
}

async function projectGenericEdgeFacts(kind: CodeGraphEdgeKind, facts: CodeGraphEdgeFact[]): Promise<void> {
  for (const batch of chunks(facts, EDGE_PROJECTION_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    await runCypher(
      [
        "UNWIND $facts AS fact",
        "MATCH (from {graphKey: fact.graphKey})",
        "WHERE any(key IN keys(from) WHERE from[key] = fact.fromKey)",
        "MATCH (to {graphKey: fact.graphKey})",
        "WHERE any(key IN keys(to) WHERE to[key] = fact.toKey)",
        `MERGE (from)-[r:${kind} {graphKey: fact.graphKey, fromKey: fact.fromKey, toKey: fact.toKey}]->(to)`,
        "SET r.filePath = fact.filePath,",
        "    r.startLine = fact.startLine,",
        "    r.endLine = fact.endLine,",
        "    r.confidence = fact.confidence,",
        "    r.extractor = fact.extractor",
      ].join("\n"),
      { facts: batch },
    );
  }
}

async function projectEdgeFacts(kind: CodeGraphEdgeKind, facts: CodeGraphEdgeFact[]): Promise<void> {
  const typedGroups = new Map<string, {
    from: NodeEndpointProjection;
    to: NodeEndpointProjection;
    facts: CodeGraphEdgeFact[];
  }>();
  const genericFacts: CodeGraphEdgeFact[] = [];

  for (const fact of facts) {
    const from = endpointForKey(fact.graphKey, fact.fromKey);
    const to = endpointForKey(fact.graphKey, fact.toKey);
    if (!from || !to) {
      genericFacts.push(fact);
      continue;
    }

    const groupKey = `${from.label}:${to.label}`;
    const group = typedGroups.get(groupKey);
    if (group) {
      group.facts.push(fact);
    } else {
      typedGroups.set(groupKey, { from, to, facts: [fact] });
    }
  }

  for (const group of typedGroups.values()) {
    await projectTypedEdgeFacts(kind, group.from, group.to, group.facts);
  }
  await projectGenericEdgeFacts(kind, genericFacts);
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
  for (const [kind, facts] of groupByKind(extraction.nodes)) {
    await projectNodeFacts(kind as CodeGraphNodeKind, facts);
  }
  for (const [kind, facts] of groupByKind(extraction.edges)) {
    await projectEdgeFacts(kind as CodeGraphEdgeKind, facts);
  }
}

export async function syncTrackedFile(
  graphKey: string,
  gitRoot: string,
  filePath: string,
  options: { skipStructuralClear?: boolean } = {},
): Promise<void> {
  const { readFile } = lazyFsPromises();
  const fullPath = lazyPath().resolve(gitRoot, filePath);
  const codeFileKey = buildCodeFileKey(graphKey, filePath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const checksum = checksumContent(content);
    const indexedAt = new Date();
    const codeFile: CodeFileProjection = {
      codeFileKey,
      graphKey,
      filePath,
      extension: lazyPath().extname(filePath).toLowerCase(),
      checksum,
      indexedAt,
    };

    await projectCodeFileFacts([codeFile]);
    await upsertCodeGraphFileHash({ graphKey, filePath, checksum, indexedAt });
    if (!options.skipStructuralClear) {
      await clearStructuralFactsForFile(graphKey, filePath);
    }
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

export async function syncTrackedFilesFull(graphKey: string, gitRoot: string, filePaths: string[]): Promise<void> {
  const { readFile } = lazyFsPromises();
  const path = lazyPath();
  const codeFiles: CodeFileProjection[] = [];
  const nodes: CodeGraphNodeFact[] = [];
  const edges: CodeGraphEdgeFact[] = [];

  for (const filePath of filePaths) {
    const fullPath = path.resolve(gitRoot, filePath);
    try {
      const content = await readFile(fullPath, "utf-8");
      const checksum = checksumContent(content);
      const indexedAt = new Date();
      codeFiles.push({
        codeFileKey: buildCodeFileKey(graphKey, filePath),
        graphKey,
        filePath,
        extension: path.extname(filePath).toLowerCase(),
        checksum,
        indexedAt,
      });
      const extraction = await extractStructuralFacts(graphKey, filePath, content);
      nodes.push(...extraction.nodes);
      edges.push(...extraction.edges);
    } catch {
      await deleteCodeGraphFileHash(graphKey, filePath);
    }
  }

  await insertCodeGraphFileHashes(codeFiles);
  await projectCodeFileFacts(codeFiles);
  await projectStructuralFacts({ nodes, edges });
}
