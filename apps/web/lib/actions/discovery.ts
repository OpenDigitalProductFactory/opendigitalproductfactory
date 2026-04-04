"use server";

import {
  executeBootstrapDiscovery,
  persistBootstrapDiscoveryRun,
  prisma,
  type Prisma,
} from "@dpf/db";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { encryptSecret, decryptSecret } from "@/lib/govern/credential-crypto";

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

    revalidatePath("/inventory");
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

/**
 * Normalize user input into a proper endpoint URL.
 * Accepts: "192.168.0.1", "http://192.168.0.1", "https://192.168.0.1:8443/"
 * Returns: "https://192.168.0.1" (HTTPS by default for UniFi/SNMP controllers)
 */
function normalizeEndpointUrl(raw: string, collectorType: string): string {
  let url = raw.trim().replace(/\/+$/, "");

  // For ARP scan, the input is a subnet not a URL
  if (collectorType === "arp_scan") return url;

  // If no protocol specified, add one
  if (!/^https?:\/\//i.test(url)) {
    // UniFi controllers always use HTTPS
    const protocol = collectorType === "unifi" ? "https" : "http";
    url = `${protocol}://${url}`;
  }

  // UniFi should always be HTTPS (common mistake to use http://)
  if (collectorType === "unifi" && url.startsWith("http://")) {
    url = url.replace("http://", "https://");
  }

  return url;
}

/** Create or update a discovery connection. API key is encrypted at rest. */
export async function configureDiscoveryConnection(input: {
  gatewayEntityId?: string;
  name: string;
  collectorType: string;
  endpointUrl: string;
  apiKey?: string;
  configuration?: Record<string, unknown>;
}): Promise<{ ok: false; error: string } | { ok: true; connectionId: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  const endpointUrl = normalizeEndpointUrl(input.endpointUrl, input.collectorType);
  const connectionKey = `${input.collectorType}:${endpointUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  const encryptedApiKey = input.apiKey ? encryptSecret(input.apiKey) : undefined;

  const result = await prisma.discoveryConnection.upsert({
    where: { connectionKey },
    create: {
      connectionKey,
      name: input.name,
      collectorType: input.collectorType,
      endpointUrl,
      encryptedApiKey: encryptedApiKey ?? null,
      configuration: (input.configuration ?? {}) as Prisma.InputJsonValue,
      status: encryptedApiKey ? "active" : "unconfigured",
      gatewayEntityId: input.gatewayEntityId ?? null,
    },
    update: {
      name: input.name,
      endpointUrl,
      ...(encryptedApiKey ? { encryptedApiKey } : {}),
      configuration: (input.configuration ?? {}) as Prisma.InputJsonValue,
      status: encryptedApiKey ? "active" : "unconfigured",
      gatewayEntityId: input.gatewayEntityId ?? null,
    },
  });

  revalidatePath("/inventory");
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
  if (!conn.encryptedApiKey) return { ok: false, error: "No API key configured" };

  const apiKey = decryptSecret(conn.encryptedApiKey);
  if (!apiKey) return { ok: false, error: "Cannot decrypt API key" };

  // Import collector dynamically to avoid circular deps
  const { collectUnifiDiscovery, buildDepsFromConnection } = await import("@dpf/db/discovery-collectors-unifi");

  const config = (conn.configuration ?? {}) as Record<string, unknown>;
  const deps = buildDepsFromConnection({
    endpointUrl: conn.endpointUrl,
    apiKey,
    configuration: {
      site: (config.site as string) ?? "default",
      discoverClients: false, // never discover clients during test
    },
  });

  const result = await collectUnifiDiscovery({ sourceKind: "unifi" }, deps);
  const hasError = result.warnings?.some((w) =>
    w.startsWith("unifi_auth") || w === "unifi_unreachable" || w === "unifi_tls_error",
  );
  const testStatus = hasError
    ? (result.warnings?.find((w) => w.startsWith("unifi_")) ?? "error")
    : "ok";
  const deviceCount = result.items.filter((i) =>
    ["router", "switch", "access_point"].includes(i.itemType),
  ).length;

  await prisma.discoveryConnection.update({
    where: { id: connectionId },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: testStatus,
      lastTestMessage: hasError
        ? `Warnings: ${result.warnings?.join(", ")}`
        : `Discovered ${deviceCount} devices`,
      status: hasError ? testStatus.replace("unifi_", "") : "active",
    },
  });

  revalidatePath("/inventory");

  if (hasError) {
    return { ok: true, status: testStatus, message: result.warnings?.join(", ") };
  }
  return { ok: true, status: "ok", deviceCount };
}

/** Delete a discovery connection. */
export async function deleteDiscoveryConnection(connectionId: string): Promise<
  | { ok: false; error: string }
  | { ok: true }
> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  await prisma.discoveryConnection.delete({ where: { id: connectionId } });
  revalidatePath("/inventory");
  return { ok: true };
}
