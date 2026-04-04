// connection-collectors.ts
// Loads DiscoveryConnection records from the database and runs the appropriate
// collector for each active connection. This bridges the DB-stored connections
// to the collector functions that accept dependency-injected deps.

import {
  collectUnifiDiscovery,
  buildDepsFromConnection,
} from "../discovery-collectors/unifi";
import { mergeCollectorOutputs } from "../discovery-runner";
import type { CollectorOutput } from "../discovery-types";

// Minimal DB interface — only what we need to load connections + decrypt keys.
// Avoids importing Prisma client directly so tests can mock it.
export type ConnectionLoaderDb = {
  discoveryConnection: {
    findMany(args: {
      where: { status: string };
      select: {
        id: true;
        connectionKey: true;
        collectorType: true;
        endpointUrl: true;
        encryptedApiKey: true;
        configuration: true;
        status: true;
      };
    }): Promise<Array<{
      id: string;
      connectionKey: string;
      collectorType: string;
      endpointUrl: string;
      encryptedApiKey: string | null;
      configuration: unknown;
      status: string;
    }>>;
    update(args: {
      where: { id: string };
      data: {
        lastTestedAt: Date;
        lastTestStatus: string;
        lastTestMessage?: string;
        status: string;
      };
    }): Promise<unknown>;
  };
};

export type DecryptFn = (encrypted: string) => string | null;

/**
 * Load all active discovery connections from the DB, decrypt credentials,
 * run the appropriate collector for each, and return merged output.
 * Updates connection status based on collector results.
 */
export async function runConnectionCollectors(
  db: ConnectionLoaderDb,
  decrypt: DecryptFn,
): Promise<CollectorOutput> {
  let connections: Awaited<ReturnType<ConnectionLoaderDb["discoveryConnection"]["findMany"]>>;
  try {
    connections = await db.discoveryConnection.findMany({
      where: { status: "active" },
      select: {
        id: true,
        connectionKey: true,
        collectorType: true,
        endpointUrl: true,
        encryptedApiKey: true,
        configuration: true,
        status: true,
      },
    });
  } catch {
    // Table may not exist yet (pre-migration). Silent skip.
    return { items: [], relationships: [] };
  }

  if (connections.length === 0) {
    return { items: [], relationships: [] };
  }

  const outputs: CollectorOutput[] = [];

  for (const conn of connections) {
    if (conn.collectorType !== "unifi") continue;
    if (!conn.encryptedApiKey) continue;

    const apiKey = decrypt(conn.encryptedApiKey);
    if (!apiKey) {
      console.warn(`[discovery] Connection ${conn.connectionKey}: cannot decrypt API key — skipping`);
      try {
        await db.discoveryConnection.update({
          where: { id: conn.id },
          data: {
            lastTestedAt: new Date(),
            lastTestStatus: "decrypt_failed",
            lastTestMessage: "Cannot decrypt API key — encryption key may have changed",
            status: "auth_failed",
          },
        });
      } catch { /* non-fatal */ }
      continue;
    }

    const config = (conn.configuration ?? {}) as Record<string, unknown>;
    const deps = buildDepsFromConnection({
      endpointUrl: conn.endpointUrl,
      apiKey,
      configuration: {
        site: (config.site as string) ?? "default",
        discoverClients: (config.discoverClients as boolean) ?? false,
      },
    });

    const result = await collectUnifiDiscovery({ sourceKind: "unifi" }, deps);

    // Update connection status based on result
    const hasError = result.warnings?.some((w) =>
      w.startsWith("unifi_auth") || w === "unifi_unreachable" || w === "unifi_tls_error",
    );
    const testStatus = hasError
      ? (result.warnings?.find((w) => w.startsWith("unifi_")) ?? "error")
      : "ok";

    try {
      await db.discoveryConnection.update({
        where: { id: conn.id },
        data: {
          lastTestedAt: new Date(),
          lastTestStatus: testStatus,
          lastTestMessage: hasError ? `Warnings: ${result.warnings?.join(", ")}` : undefined,
          status: hasError ? testStatus.replace("unifi_", "") : "active",
        },
      });
    } catch { /* non-fatal */ }

    outputs.push(result);
  }

  return mergeCollectorOutputs(outputs);
}
