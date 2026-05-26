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
    default:
      return fallback ?? status;
  }
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

/**
 * Strip every trailing "/" without using `replace(/\/+$/, "")` — that
 * regex tripped a CodeQL polynomial-ReDoS alert on user-supplied input,
 * and an explicit slice loop is both safer and easier to reason about.
 */
function trimTrailingSlashes(input: string): string {
  let end = input.length;
  while (end > 0 && input.charCodeAt(end - 1) === 0x2f /* "/" */) end--;
  return input.slice(0, end);
}

/** Strip a leading "http://" or "https://" without a regex (CodeQL-safe). */
function stripScheme(input: string): string {
  if (input.startsWith("https://")) return input.slice(8);
  if (input.startsWith("http://")) return input.slice(7);
  if (input.startsWith("HTTPS://")) return input.slice(8);
  if (input.startsWith("HTTP://")) return input.slice(7);
  return input;
}

/**
 * Normalize user input into a proper endpoint URL.
 * Accepts: "192.168.0.1", "http://192.168.0.1", "https://192.168.0.1:8443/"
 * Returns: "https://192.168.0.1" (HTTPS by default for UniFi/SNMP controllers)
 */
function normalizeEndpointUrl(raw: string, collectorType: string): string {
  let url = trimTrailingSlashes(raw.trim());

  // For ARP scan, the input is a subnet not a URL
  if (collectorType === "arp_scan") return url;

  // If no protocol specified, add one. Fixed-prefix checks instead of a
  // regex — no backtracking risk.
  const hasScheme = url.startsWith("http://") || url.startsWith("https://")
    || url.startsWith("HTTP://") || url.startsWith("HTTPS://");
  if (!hasScheme) {
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

  const endpointUrl = normalizeEndpointUrl(input.endpointUrl, input.collectorType);
  const connectionKey = `${input.collectorType}:${trimTrailingSlashes(stripScheme(endpointUrl))}`;

  const encryptedApiKey = input.apiKey ? encryptSecret(input.apiKey) : undefined;
  const configuration = normalizeConnectionConfiguration(input.collectorType, input.configuration);

  // Edit-by-id path: lets URL changes flow without splitting the row.
  if (input.id) {
    const updated = await prisma.discoveryConnection.update({
      where: { id: input.id },
      data: {
        connectionKey,
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
  const hasError = result.warnings?.some((w) =>
    w.startsWith("unifi_auth") || w === "unifi_unreachable" || w === "unifi_tls_error",
  );
  const testStatus = hasError
    ? (result.warnings?.find((w) => w.startsWith("unifi_")) ?? "error")
    : "ok";
  const deviceCount = result.items.filter((i) =>
    ["router", "switch", "access_point"].includes(i.itemType),
  ).length;
  const testMessage = hasError
    ? formatConnectionTestMessage(testStatus, result.warnings?.join(", "))
    : `Discovered ${deviceCount} devices`;

  await prisma.discoveryConnection.update({
    where: { id: connectionId },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: testStatus,
      lastTestMessage: testMessage,
      status: hasError ? testStatus.replace("unifi_", "") : "active",
    },
  });

  revalidateDiscoverySurfaces();

  if (hasError) {
    return { ok: true, status: testStatus, message: testMessage };
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
  revalidateDiscoverySurfaces();
  return { ok: true };
}
