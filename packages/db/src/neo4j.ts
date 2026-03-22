// packages/db/src/neo4j.ts
// Neo4j driver singleton — Bolt connection to the local Neo4j 5 instance.
// All graph operations go through this module; it is never the authoritative
// source of truth — Postgres/Prisma is. Neo4j is a projection for traversal
// and impact analysis only.

import neo4j, { type Driver, type Session } from "neo4j-driver";

let _driver: Driver | null = null;

function getDriver(): Driver {
  if (_driver) return _driver;

  const uri  = process.env["NEO4J_URI"]      ?? "bolt://localhost:7687";
  const user = process.env["NEO4J_USER"]     ?? "neo4j";
  const pass = process.env["NEO4J_PASSWORD"] ?? "dpf_dev_password";
  if (pass === "dpf_dev_password" && process.env.NODE_ENV === "production") {
    console.warn(
      "WARNING: Using default Neo4j password in production. Set NEO4J_PASSWORD environment variable."
    );
  }

  _driver = neo4j.driver(uri, neo4j.auth.basic(user, pass), {
    maxConnectionPoolSize: 50,
    connectionAcquisitionTimeout: 10_000,
  });

  return _driver;
}

/** Open a new session. Caller is responsible for closing it. */
export function neo4jSession(): Session {
  return getDriver().session();
}

/** Gracefully close the driver — call on process exit. */
export async function closeNeo4j(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}

/** Run a single Cypher query and return all records. */
export async function runCypher<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session = neo4jSession();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}
