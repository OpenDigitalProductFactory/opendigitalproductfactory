import { runCypher } from "@dpf/db";
import { lazyFsPromises, lazyPath } from "@/lib/shared/lazy-node";

import { checksumContent } from "./hash";
import {
  deleteCodeGraphFileHash,
  upsertCodeGraphFileHash,
} from "./state-store";

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
    "CREATE INDEX cf_graphKey IF NOT EXISTS FOR (n:CodeFile) ON (n.graphKey)",
    "CREATE INDEX cf_path IF NOT EXISTS FOR (n:CodeFile) ON (n.path)",
  ];

  for (const statement of statements) {
    try {
      await runCypher(statement);
    } catch {
      // Reconcile can proceed if an equivalent schema object already exists.
    }
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
  } catch {
    await runCypher(
      "MATCH (f:CodeFile {codeFileKey: $codeFileKey}) DETACH DELETE f",
      { codeFileKey },
    );
    await deleteCodeGraphFileHash(graphKey, filePath);
  }
}
