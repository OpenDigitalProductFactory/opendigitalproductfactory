"use server";

import {
  executeBootstrapDiscovery,
  normalizeDiscoveredFacts,
  persistBootstrapDiscoveryRun,
  prisma,
  type Prisma,
} from "@dpf/db";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { encryptSecret, decryptSecret } from "@/lib/govern/credential-crypto";
import {
  discoveryConnectionKey,
  normalizeDiscoveryEndpoint,
  type DiscoveryCollectorType,
} from "@/lib/discovery-connection/endpoint";

const DISCOVERY_REVALIDATE_PATHS = [
  "/platform/tools",
  "/platform/tools/discovery",
  "/inventory",
] as const;

function revalidateDiscoverySurfaces() {
  DISCOVERY_REVALIDATE_PATHS.forEach((path) => revalidatePath(path));
}

type UnifiConnectionConfiguration = {
  site: string;
  discoverClients: boolean;
  tlsInsecure: boolean;
};

function readUnifiConfiguration(configuration: unknown): UnifiConnectionConfiguration {
  const raw = (configuration ?? {}) as Record<string, unknown>;
  const site = typeof raw.site === "string" && raw.site.trim().length > 0
    ? raw.site.trim()
    : "default";

  return {
    site,
    discoverClients: typeof raw.discoverClients === "boolean" ? raw.discoverClients : true,
    tlsInsecure: typeof raw.tlsInsecure === "boolean" ? raw.tlsInsecure : false,
  };
}

function normalizeConnectionConfiguration(
  collectorType: string,
  configuration: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (collectorType !== "unifi") return configuration ?? {};
  return {
    ...(configuration ?? {}),
    ...readUnifiConfiguration(configuration),
  };
}

function formatConnectionTestMessage(status: string, fallback?: string): string {
  switch (status) {
    case "unifi_tls_error":
      return "The UniFi controller appears to use a self-signed certificate. Enable self-signed certificate support for this closed LAN, or install a trusted certificate on the controller.";
    case "unifi_auth_failed":
      return "The UniFi controller rejected the API key. Rotate the key in UniFi OS and paste the new value here.";
    case "unifi_unreachable":
      return "The portal could not reach the UniFi controller from this host. Check the controller URL and local network reachability.";
    case "unifi_no_devices":
      return "The UniFi API responded, but returned no managed network devices. The connection is degraded and cannot supply a physical topology.";
    case "unifi_no_sites":
      return "The UniFi API responded, but returned no accessible sites for this API key.";
    case "unifi_partial":
      return fallback ?? "UniFi returned a partial result. The discovered topology may be incomplete.";
    default:
      return fallback ?? status;
  }
}

type UnifiHealth = {
  testStatus: string;
  connectionStatus: string;
  healthy: boolean;
  message: string;
};

function classifyUnifiHealth(warnings: string[] | undefined, deviceCount: number): UnifiHealth {
  const values = warnings ?? [];
  const blocking = values.find((warning) =>
    warning.startsWith("unifi_auth")
      || warning === "unifi_unreachable"
      || warning === "unifi_tls_error"
      || warning.startsWith("unifi_api_error")
      || warning === "unifi_no_sites",
  );
  if (blocking) {
    return {
      testStatus: blocking,
      connectionStatus: blocking === "unifi_auth_failed" ? "auth_failed" : "unreachable",
      healthy: false,
      message: formatConnectionTestMessage(blocking, values.join(", ")),
    };
  }
  if (values.includes("unifi_no_devices") || deviceCount === 0) {
    return {
      testStatus: "unifi_no_devices",
      connectionStatus: "degraded",
      healthy: false,
      message: formatConnectionTestMessage("unifi_no_devices"),
    };
  }
  if (values.length > 0) {
    return {
      testStatus: "unifi_partial",
      connectionStatus: "degraded",
      healthy: false,
      message: formatConnectionTestMessage("unifi_partial", values.join(", ")),
    };
  }
  return {
    testStatus: "ok",
    connectionStatus: "active",
    healthy: true,
    message: `Discovered ${deviceCount} devices`,
  };
}

async function requireManageDiscovery(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  const user = session?.user;

  if (
    !user
    || !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return { ok: false, error: "Unauthorized" };
  }

  return { ok: true };
}

export async function triggerBootstrapDiscovery(): Promise<
  | { ok: false; error: string }
  | { ok: true; summary: Awaited<ReturnType<typeof persistBootstrapDiscoveryRun>> }
> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) {
    return authResult;
  }

  try {
    const summary = await executeBootstrapDiscovery(prisma as never, {
      trigger: "manual",
      decrypt: decryptSecret,
    });

    revalidateDiscoverySurfaces();
    return { ok: true, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap discovery failed";
    return { ok: false, error: message };
  }
}

// ─── Discovery Connection Management ────────────────────────────────────────

export type DiscoveryConnectionSummary = {
  id: string;
  connectionKey: string;
  name: string;
  collectorType: string;
  status: string;
  endpointUrl: string;
  hasApiKey: boolean;
  configuration: Record<string, unknown>;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  gatewayEntityId: string | null;
};

/** List all discovery connections (secrets masked). */
export async function listDiscoveryConnections(): Promise<
  | { ok: false; error: string }
  | { ok: true; connections: DiscoveryConnectionSummary[] }
> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  const rows = await prisma.discoveryConnection.findMany({
    orderBy: { createdAt: "desc" },
  });

  return {
    ok: true,
    connections: rows.map((r) => ({
      id: r.id,
      connectionKey: r.connectionKey,
      name: r.name,
      collectorType: r.collectorType,
      status: r.status,
      endpointUrl: r.endpointUrl,
      hasApiKey: !!r.encryptedApiKey,
      configuration: (r.configuration ?? {}) as Record<string, unknown>,
      lastTestedAt: r.lastTestedAt?.toISOString() ?? null,
      lastTestStatus: r.lastTestStatus,
      lastTestMessage: r.lastTestMessage,
      gatewayEntityId: r.gatewayEntityId,
    })),
  };
}

/** Keep the action boundary closed even when invoked outside the typed UI. */
function isDiscoveryCollectorType(value: string): value is DiscoveryCollectorType {
  return value === "unifi" || value === "snmp" || value === "arp_scan";
}

/**
 * Create or update a discovery connection. API key is encrypted at rest.
 *
 * Edit mode (when `id` is supplied) uses an update-by-id so the operator can
 * change endpointUrl + connectionKey without orphaning the old row. Without
 * `id`, we upsert by connectionKey (the create-from-scratch path).
 */
export async function configureDiscoveryConnection(input: {
  id?: string;
  gatewayEntityId?: string;
  name: string;
  collectorType: string;
  endpointUrl: string;
  apiKey?: string;
  configuration?: Record<string, unknown>;
}): Promise<{ ok: false; error: string } | { ok: true; connectionId: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  if (!isDiscoveryCollectorType(input.collectorType)) {
    return { ok: false, error: `Unsupported discovery method: ${input.collectorType}` };
  }
  const normalizedEndpoint = normalizeDiscoveryEndpoint(input.endpointUrl, input.collectorType);
  if (!normalizedEndpoint.ok) return normalizedEndpoint;
  const endpointUrl = normalizedEndpoint.value;
  const connectionKey = discoveryConnectionKey(input.collectorType, endpointUrl);

  const encryptedApiKey = input.apiKey ? encryptSecret(input.apiKey) : undefined;
  const configuration = normalizeConnectionConfiguration(input.collectorType, input.configuration);

  // Edit-by-id path: lets URL changes flow without splitting the row.
  if (input.id) {
    const updated = await prisma.discoveryConnection.update({
      where: { id: input.id },
      data: {
        connectionKey,
        collectorType: input.collectorType,
        name: input.name,
        endpointUrl,
        ...(encryptedApiKey ? { encryptedApiKey } : {}),
        configuration: configuration as Prisma.InputJsonValue,
        ...(encryptedApiKey ? { status: "active" } : {}),
        gatewayEntityId: input.gatewayEntityId ?? null,
      },
    });
    revalidateDiscoverySurfaces();
    return { ok: true, connectionId: updated.id };
  }

  const result = await prisma.discoveryConnection.upsert({
    where: { connectionKey },
    create: {
      connectionKey,
      name: input.name,
      collectorType: input.collectorType,
      endpointUrl,
      encryptedApiKey: encryptedApiKey ?? null,
      configuration: configuration as Prisma.InputJsonValue,
      status: encryptedApiKey ? "active" : "unconfigured",
      gatewayEntityId: input.gatewayEntityId ?? null,
    },
    update: {
      name: input.name,
      endpointUrl,
      // Only overwrite the encrypted key when a fresh one was supplied; the
      // edit-mode UX intentionally lets operators rotate URL/site without
      // pasting the API key again.
      ...(encryptedApiKey ? { encryptedApiKey } : {}),
      configuration: configuration as Prisma.InputJsonValue,
      // Only reset status when we just stored a fresh key (re-test will
      // overwrite this in seconds). Without a fresh key, preserve the
      // current status so an edit to URL/site doesn't wipe `active`.
      ...(encryptedApiKey ? { status: "active" } : {}),
      gatewayEntityId: input.gatewayEntityId ?? null,
    },
  });

  revalidateDiscoverySurfaces();
  return { ok: true, connectionId: result.id };
}

/** Test a discovery connection by attempting to fetch devices. */
export async function testDiscoveryConnection(connectionId: string): Promise<
  | { ok: false; error: string }
  | { ok: true; status: string; deviceCount?: number; message?: string }
> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  const conn = await prisma.discoveryConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) return { ok: false, error: "Connection not found" };
  const collectorType = conn.collectorType ?? "unifi";
  let testStatus = "ok";
  let deviceCount = 0;
  let testMessage = "";

  if (collectorType === "unifi") {
    if (!conn.encryptedApiKey) return { ok: false, error: "No API key configured" };

    const apiKey = decryptSecret(conn.encryptedApiKey);
    if (!apiKey) return { ok: false, error: "Cannot decrypt API key" };

    // Import collector dynamically to avoid circular deps
    const { collectUnifiDiscovery, buildDepsFromConnection } = await import("@dpf/db/discovery-collectors-unifi");

    const config = readUnifiConfiguration(conn.configuration);
    const deps = buildDepsFromConnection({
      endpointUrl: conn.endpointUrl,
      apiKey,
      configuration: {
        site: config.site,
        discoverClients: false, // never discover clients during test
        tlsInsecure: config.tlsInsecure,
      },
    });

    const result = await collectUnifiDiscovery({ sourceKind: "unifi" }, deps);
    deviceCount = result.items.filter((i) =>
      ["router", "switch", "access_point"].includes(i.itemType),
    ).length;
    const health = classifyUnifiHealth(result.warnings, deviceCount);
    testStatus = health.testStatus;
    testMessage = health.message;
  } else if (collectorType === "arp_scan") {
    const { collectArpScanDiscovery } = await import("@dpf/db/discovery-collectors-arp-scan");
    const configuration = (conn.configuration ?? {}) as Record<string, unknown>;
    const subnet = typeof configuration.subnet === "string" ? configuration.subnet : conn.endpointUrl;
    const normalizedSubnet = normalizeDiscoveryEndpoint(subnet, "arp_scan");
    if (!normalizedSubnet.ok) return normalizedSubnet;
    const result = await collectArpScanDiscovery({ sourceKind: "arp_scan" }, [{ subnet: normalizedSubnet.value }]);
    deviceCount = result.items.length;
    testMessage = result.warnings?.some((warning) => warning.startsWith("arp_scan_empty"))
      ? "ARP scan completed, but no hosts responded on that subnet"
      : `Discovered ${deviceCount} ${deviceCount === 1 ? "item" : "items"}`;
  } else if (collectorType === "snmp") {
    const { collectSnmpDiscovery } = await import("@dpf/db/discovery-collectors-snmp");
    const configuration = (conn.configuration ?? {}) as Record<string, unknown>;
    const encryptedCommunity = conn.encryptedApiKey ? decryptSecret(conn.encryptedApiKey) : null;
    const community = encryptedCommunity
      ?? (typeof configuration.community === "string" ? configuration.community : "public");
    const normalizedAddress = normalizeDiscoveryEndpoint(conn.endpointUrl, "snmp");
    if (!normalizedAddress.ok) return normalizedAddress;
    const result = await collectSnmpDiscovery({ sourceKind: "snmp" }, [{
      address: normalizedAddress.value,
      community,
    }]);
    const errorWarning = result.warnings?.find((warning) => warning.startsWith("snmp_error"));
    testStatus = errorWarning ? "snmp_error" : "ok";
    deviceCount = result.items.length;
    testMessage = errorWarning
      ? "SNMP test failed. Check the target, community string, and UDP/161 reachability."
      : `Discovered ${deviceCount} ${deviceCount === 1 ? "item" : "items"}`;
  } else {
    return { ok: false, error: `Unsupported discovery method: ${collectorType}` };
  }

  await prisma.discoveryConnection.update({
    where: { id: connectionId },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: testStatus,
      lastTestMessage: testMessage,
      status: collectorType === "unifi"
        ? classifyUnifiHealth(testStatus === "ok" ? [] : [testStatus], deviceCount).connectionStatus
        : testStatus === "ok" ? "active" : "unreachable",
    },
  });

  revalidateDiscoverySurfaces();

  if (testStatus !== "ok") {
    return { ok: true, status: testStatus, message: testMessage };
  }
  if (collectorType === "unifi") {
    return { ok: true, status: "ok", deviceCount };
  }
  return { ok: true, status: "ok", deviceCount, message: testMessage };
}

export type RerunDiscoveryResult =
  | { ok: true; runId: string; itemCount: number; relationshipCount: number; status: string }
  | { ok: false; error: string };

/** Re-run discovery for an existing connection. */
export async function rerunDiscoveryConnection(connectionId: string): Promise<RerunDiscoveryResult> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  const conn = await prisma.discoveryConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) return { ok: false, error: "Connection not found" };

  if (conn.status === "unconfigured" || conn.status === "auth_failed") {
    return { ok: false, error: `Cannot rerun discovery for connection with status "${conn.status}"` };
  }

  if (!conn.encryptedApiKey) return { ok: false, error: "No API key configured" };
  const apiKey = decryptSecret(conn.encryptedApiKey);
  if (!apiKey) return { ok: false, error: "Cannot decrypt API key" };

  const { collectUnifiDiscovery, buildDepsFromConnection } = await import("@dpf/db/discovery-collectors-unifi");
  const config = readUnifiConfiguration(conn.configuration);
  const deps = buildDepsFromConnection({
    endpointUrl: conn.endpointUrl,
    apiKey,
    configuration: {
      site: config.site,
      discoverClients: config.discoverClients,
      tlsInsecure: config.tlsInsecure,
    },
  });

  const collectorOutput = await collectUnifiDiscovery({ sourceKind: conn.collectorType as never }, deps);
  const deviceCount = collectorOutput.items.filter((item) =>
    ["router", "switch", "access_point"].includes(item.itemType),
  ).length;
  const health = classifyUnifiHealth(collectorOutput.warnings, deviceCount);
  if (deviceCount === 0) {
    await prisma.discoveryConnection.update({
      where: { id: connectionId },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: health.testStatus,
        lastTestMessage: health.message,
        status: health.connectionStatus,
      },
    });
    revalidateDiscoverySurfaces();
    return { ok: false, error: health.message };
  }
  const normalized = normalizeDiscoveredFacts(collectorOutput);

  const summary = await persistBootstrapDiscoveryRun(
    prisma as never,
    normalized,
    {
      runKey: conn.connectionKey,
      sourceSlug: conn.connectionKey,
      trigger: "manual_connection",
    },
  );

  const status = health.connectionStatus;
  await prisma.discoveryConnection.update({
    where: { id: connectionId },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: health.testStatus,
      lastTestMessage: health.healthy
        ? `Discovered ${summary.createdEntities + summary.updatedEntities} items`
        : health.message,
      status,
    },
  });

  revalidateDiscoverySurfaces();

  return {
    ok: true,
    runId: summary.runId ?? "",
    itemCount: summary.createdEntities + summary.updatedEntities,
    relationshipCount: summary.createdRelationships + summary.updatedRelationships,
    status,
  };
}

/** Delete a discovery connection. */
export async function deleteDiscoveryConnection(connectionId: string): Promise<
  | { ok: false; error: string }
  | { ok: true }
> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  await prisma.discoveryConnection.delete({ where: { id: connectionId } });
  revalidateDiscoverySurfaces();
  return { ok: true };
}
