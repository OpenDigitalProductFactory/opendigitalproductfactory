// apps/web/lib/integrate/code-graph/neo4j-projection.ts
// BET-5 (BI-A1E864A5): the code-graph structural projection formerly ran Cypher MERGE
// against Neo4j; it now UPSERTs into the Postgres graph mirror (`graph_node` /
// `graph_edge`) that graph-queries.ts / code-graph-access.ts read. Node identity =
// the namespaced key the extractors already mint (codeFileKey = `${graphKey}:${path}`,
// codeSymbolKey = `${graphKey}:symbol:…`, etc.) → graph_node.key. Edge facts map
// fromKey → src_key, toKey → dst_key, kind → rel_type (direction preserved from the
// old MATCH (from)-[r]->(to)). `graphKey`, `path`, `filePath`, line/confidence/
// extractor and any extractor attributes are carried in the jsonb `props`, which the
// read side filters on (props->>'graphKey', props->>'name', props->>'path', …).
import { prisma } from "@dpf/db";
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
import { getErrorMessage } from "@/lib/shared/get-error-message";

const STRUCTURAL_NODE_LABELS = [
  "CodeSymbol",
  "CodeRoute",
  "CodeTool",
  "PrismaModel",
  "PrismaField",
  "PromptTemplateSource",
  "TestFile",
  "ExternalModule",
];

type CodeFileProjection = {
  codeFileKey: string;
  graphKey: string;
  filePath: string;
  extension: string;
  checksum: string;
  indexedAt: Date;
};

export function buildCodeFileKey(graphKey: string, filePath: string): string {
  return `${graphKey}:${filePath}`;
}

// ─── Graph-mirror primitives ──────────────────────────────────────────────────

/** UPSERT a node; props shallow-merged (parity with Cypher `SET n.x = …` / `n += map`). */
async function upsertGraphNode(
  key: string,
  labels: string[],
  props: Record<string, unknown>,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO graph_node (key, labels, props)
     VALUES ($1, $2::text[], $3::jsonb)
     ON CONFLICT (key) DO UPDATE
       SET labels = excluded.labels,
           props  = graph_node.props || excluded.props`,
    key,
    labels,
    JSON.stringify(props),
  );
}

/** UPSERT a directed edge keyed by (src_key, dst_key, rel_type); props shallow-merged. */
async function upsertGraphEdge(
  srcKey: string,
  dstKey: string,
  relType: string,
  props: Record<string, unknown>,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO graph_edge (src_key, dst_key, rel_type, props)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (src_key, dst_key, rel_type) DO UPDATE
       SET props = graph_edge.props || excluded.props`,
    srcKey,
    dstKey,
    relType,
    JSON.stringify(props),
  );
}

export async function clearCodeGraph(graphKey: string): Promise<void> {
  // DETACH DELETE equivalent for every node in this graphKey (all labels).
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge
      WHERE props->>'graphKey' = $1
         OR src_key IN (SELECT key FROM graph_node WHERE props->>'graphKey' = $1)
         OR dst_key IN (SELECT key FROM graph_node WHERE props->>'graphKey' = $1)`,
    graphKey,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_node WHERE props->>'graphKey' = $1`,
    graphKey,
  );
}

export async function ensureCodeGraphNeo4jSchema(): Promise<void> {
  // No-op: the Postgres graph mirror (graph_node/graph_edge + its indexes) is
  // provisioned by the 20260714120000_bet5_graph_mirror migration, so there is no
  // per-run schema to create. Retained for call-site compatibility.
}

async function clearStructuralFactsForFile(graphKey: string, filePath: string): Promise<void> {
  // 1. Drop structural edges attributed to this file (props.graphKey + props.filePath).
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge WHERE props->>'graphKey' = $1 AND props->>'filePath' = $2`,
    graphKey,
    filePath,
  );
  // 2. DETACH the structural nodes at this path: drop any remaining incident edges…
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge
      WHERE src_key IN (
              SELECT key FROM graph_node
               WHERE props->>'graphKey' = $1 AND props->>'path' = $2 AND labels && $3::text[]
            )
         OR dst_key IN (
              SELECT key FROM graph_node
               WHERE props->>'graphKey' = $1 AND props->>'path' = $2 AND labels && $3::text[]
            )`,
    graphKey,
    filePath,
    STRUCTURAL_NODE_LABELS,
  );
  // …then the nodes themselves.
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_node
      WHERE props->>'graphKey' = $1 AND props->>'path' = $2 AND labels && $3::text[]`,
    graphKey,
    filePath,
    STRUCTURAL_NODE_LABELS,
  );
}

function keyFieldForLabel(label: string): string {
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}Key`;
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

async function projectCodeFileFacts(files: CodeFileProjection[]): Promise<void> {
  for (const file of files) {
    await upsertGraphNode(file.codeFileKey, ["CodeFile"], {
      codeFileKey: file.codeFileKey,
      graphKey: file.graphKey,
      path: file.filePath,
      extension: file.extension,
      checksum: file.checksum,
      indexedAt: file.indexedAt.toISOString(),
    });
  }
}

async function projectNodeFacts(label: CodeGraphNodeKind, facts: CodeGraphNodeFact[]): Promise<void> {
  const keyField = keyFieldForLabel(label);
  for (const fact of facts) {
    await upsertGraphNode(fact.key, [label], {
      [keyField]: fact.key,
      graphKey: fact.graphKey,
      name: fact.name,
      path: fact.filePath,
      startLine: fact.startLine,
      endLine: fact.endLine,
      extractor: fact.extractor,
      // `SET n += fact.attributes` — extractor attributes override the base props.
      ...(fact.attributes ?? {}),
    });
  }
}

async function projectEdgeFacts(kind: CodeGraphEdgeKind, facts: CodeGraphEdgeFact[]): Promise<void> {
  for (const fact of facts) {
    await upsertGraphEdge(fact.fromKey, fact.toKey, kind, {
      graphKey: fact.graphKey,
      fromKey: fact.fromKey,
      toKey: fact.toKey,
      filePath: fact.filePath,
      startLine: fact.startLine,
      endLine: fact.endLine,
      confidence: fact.confidence,
      extractor: fact.extractor,
      ...(fact.attributes ?? {}),
    });
  }
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
        message: getErrorMessage(error),
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
    // DETACH DELETE the CodeFile node (drop incident edges first, then the node).
    await prisma.$executeRawUnsafe(
      `DELETE FROM graph_edge WHERE src_key = $1 OR dst_key = $1`,
      codeFileKey,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM graph_node WHERE key = $1 AND 'CodeFile' = ANY(labels)`,
      codeFileKey,
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
