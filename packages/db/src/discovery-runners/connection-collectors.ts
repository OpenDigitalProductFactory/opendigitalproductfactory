// connection-collectors.ts
// Loads DiscoveryConnection records from the database and runs the appropriate
// collector for each active connection. Supports UniFi, SNMP, and ARP scan.

import {
  collectUnifiDiscovery,
  buildDepsFromConnection,
} from "../discovery-collectors/unifi";
import { collectSnmpDiscovery } from "../discovery-collectors/snmp";
import { collectArpScanDiscovery } from "../discovery-collectors/arp-scan";
import { mergeCollectorOutputs } from "../discovery-runner";
import type { CollectorOutput } from "../discovery-types";

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
    return { items: [], relationships: [] };
  }

  if (connections.length === 0) {
    return { items: [], relationships: [] };
  }

  const outputs: CollectorOutput[] = [];

  for (const conn of connections) {
    try {
      const result = await runSingleConnection(conn, decrypt);
      if (result) {
        outputs.push(result);
        await updateConnectionStatus(db, conn.id, result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery] Connection ${conn.connectionKey} failed:`, msg);
      try {
        await db.discoveryConnection.update({
          where: { id: conn.id },
          data: {
            lastTestedAt: new Date(),
            lastTestStatus: "error",
            lastTestMessage: msg.slice(0, 500),
            status: "unreachable",
          },
        });
      } catch { /* non-fatal */ }
    }
  }

  return mergeCollectorOutputs(outputs);
}

type Connection = {
  id: string;
  connectionKey: string;
  collectorType: string;
  endpointUrl: string;
  encryptedApiKey: string | null;
  configuration: unknown;
};

async function runSingleConnection(
  conn: Connection,
  decrypt: DecryptFn,
): Promise<CollectorOutput | null> {
  const config = (conn.configuration ?? {}) as Record<string, unknown>;

  switch (conn.collectorType) {
    case "unifi": {
      if (!conn.encryptedApiKey) return null;
      const apiKey = decrypt(conn.encryptedApiKey);
      if (!apiKey) {
        console.warn(`[discovery] Connection ${conn.connectionKey}: cannot decrypt API key`);
        return null;
      }
      const deps = buildDepsFromConnection({
        endpointUrl: conn.endpointUrl,
        apiKey,
        configuration: {
          site: (config.site as string) ?? "default",
          discoverClients: (config.discoverClients as boolean) ?? false,
        },
      });
      return collectUnifiDiscovery({ sourceKind: "unifi" }, deps);
    }

    case "snmp": {
      const community = conn.encryptedApiKey
        ? decrypt(conn.encryptedApiKey) ?? "public"
        : (config.community as string) ?? "public";
      return collectSnmpDiscovery({ sourceKind: "snmp" }, [{
        address: conn.endpointUrl,
        community,
      }]);
    }

    case "arp_scan": {
      const subnet = (config.subnet as string) ?? conn.endpointUrl;
      return collectArpScanDiscovery({ sourceKind: "arp_scan" }, [{
        subnet,
      }]);
    }

    default:
      console.warn(`[discovery] Unknown collector type: ${conn.collectorType}`);
      return null;
  }
}

async function updateConnectionStatus(
  db: ConnectionLoaderDb,
  connId: string,
  result: CollectorOutput,
): Promise<void> {
  const hasError = result.warnings?.some((w) =>
    w.includes("unreachable") || w.includes("auth") || w.includes("tls_error") || w.includes("error"),
  );
  try {
    await db.discoveryConnection.update({
      where: { id: connId },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: hasError ? "error" : "ok",
        lastTestMessage: hasError ? `Warnings: ${result.warnings?.join(", ")}` : `Discovered ${result.items.length} items`,
        status: hasError ? "unreachable" : "active",
      },
    });
  } catch { /* non-fatal */ }
}
