// Admin > Platform Development > Edge Nodes
//
// Operator surface for managing the Edge Node registry:
//   - List all enrolled nodes with their trust state + last seen time.
//   - Issue one-time bootstrap tokens so new nodes can enroll.
//   - Approve pending nodes, quarantine suspicious nodes, revoke
//     compromised nodes.
//
// Permission: manage_platform (HR-000 or superuser). Anyone else
// hits the redirect to /403.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Approval policy
//   § Quarantine / Revocation

import { redirect } from "next/navigation";

import { prisma } from "@dpf/db";
import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadPlatformVersion } from "@/lib/platform/version";
import {
  deriveEdgeNodeReadiness,
  selectMainInstallationNode,
  type EdgeReadinessNode,
} from "@/lib/edge-node/readiness";

import { EdgeNodesAdminClient } from "@/components/platform/edge-nodes/EdgeNodesAdminClient";

export const dynamic = "force-dynamic";

type EdgeNodeRow = {
  id: string;
  nodeId: string;
  platform: string;
  installMode: string;
  version: string;
  status: string;
  trustState: string;
  lastSeenAt: string | null;
  enrolledAt: string | null;
  approvedAt: string | null;
  quarantinedAt: string | null;
  quarantineReason: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  displayName: string;
  capabilities: string[];
  /**
   * Host-network fingerprint pulled from EdgeNode.metadata.host. The
   * Edge Node submits this at enrollment per T2.4. May be null if the
   * node enrolled before T2.4 shipped, or if no real LAN address was
   * available at enroll time.
   */
  hostHostname: string | null;
  hostIpAddresses: string[] | null;
  customerAccountId: string | null;
  customerAccountName: string | null;
  customerSiteId: string | null;
  customerSiteName: string | null;
  health: ReturnType<typeof deriveEdgeNodeReadiness>["health"];
  heartbeatAgeMs: number | null;
  nextAction: ReturnType<typeof deriveEdgeNodeReadiness>["nextAction"];
  isMainInstallation: boolean;
  readinessChecks: ReturnType<typeof deriveEdgeNodeReadiness>["checks"];
};

/**
 * Narrowly extract the `host` sub-object from an EdgeNode.metadata
 * JSON blob, tolerating shape drift. Returns nulls when the shape
 * doesn't match — admin UI renders an "—" placeholder, which is
 * correct UX for nodes that enrolled pre-T2.4.
 */
function readHostMetadata(metadata: unknown): {
  hostname: string | null;
  ipAddresses: string[] | null;
} {
  if (typeof metadata !== "object" || metadata === null) {
    return { hostname: null, ipAddresses: null };
  }
  const host = (metadata as { host?: unknown }).host;
  if (typeof host !== "object" || host === null) {
    return { hostname: null, ipAddresses: null };
  }
  const hostname = (host as { hostname?: unknown }).hostname;
  const ipAddresses = (host as { ipAddresses?: unknown }).ipAddresses;
  return {
    hostname: typeof hostname === "string" ? hostname : null,
    ipAddresses:
      Array.isArray(ipAddresses)
        ? ipAddresses.filter((x): x is string => typeof x === "string")
        : null,
  };
}

type BootstrapTokenRow = {
  id: string;
  prefix: string;
  scope: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedByNodeId: string | null;
  revokedAt: string | null;
  targetCustomerAccountId: string | null;
  targetCustomerAccountName: string | null;
  targetCustomerSiteId: string | null;
  targetCustomerSiteName: string | null;
};

type CustomerAccountOption = {
  id: string;
  accountId: string;
  name: string;
  status: string;
  sites: {
    id: string;
    siteId: string;
    name: string;
    status: string;
  }[];
};

export default async function EdgeNodesAdminPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?next=/platform/edge-nodes");
  }
  const allowed = can(
    {
      platformRole: session.user.platformRole,
      isSuperuser: session.user.isSuperuser,
    },
    "manage_platform",
  );
  if (!allowed) {
    redirect("/403");
  }

  // Pull all EdgeNodes with their joined Principal for displayName.
  // Per AGENTS.md §11 Principal convergence, displayName lives on the
  // Principal, not on EdgeNode.
  const nodes = await prisma.edgeNode.findMany({
    orderBy: [{ trustState: "asc" }, { lastSeenAt: "desc" }],
    include: {
      principal: { select: { displayName: true } },
      customerAccount: { select: { name: true } },
      customerSite: { select: { name: true } },
      capabilityRows: {
        select: { capability: true, mode: true, status: true, reportedAt: true },
      },
      consumedTokens: { select: { autoApprove: true } },
    },
  });

  // Recent (non-expired, non-consumed) bootstrap tokens so the
  // operator can see what's outstanding. Limit to last 20 + filter
  // out expired/consumed unless they were recently issued — this is
  // operational visibility, not full audit history (the
  // ToolExecution table holds that).
  const bootstrapTokens = await prisma.bootstrapToken.findMany({
    where: { revokedAt: null },
    orderBy: { issuedAt: "desc" },
    take: 20,
    include: {
      consumedByEdgeNode: { select: { nodeId: true } },
      targetCustomerAccount: { select: { name: true } },
      targetCustomerSite: { select: { name: true } },
    },
  });

  const customerAccounts = await prisma.customerAccount.findMany({
    where: EXCLUDE_TOMBSTONED,
    orderBy: { name: "asc" },
    select: {
      id: true,
      accountId: true,
      name: true,
      status: true,
      customerSites: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          siteId: true,
          name: true,
          status: true,
        },
      },
    },
  });

  const readinessNodes: EdgeReadinessNode[] = nodes.map((node) => ({
    id: node.id,
    nodeId: node.nodeId,
    platform: node.platform,
    installMode: node.installMode,
    version: node.version,
    storedStatus: node.status,
    trustState: node.trustState,
    lastSeenAt: node.lastSeenAt,
    enrolledAt: node.enrolledAt,
    customerAccountId: node.customerAccountId,
    customerSiteId: node.customerSiteId,
    installerManaged: node.consumedTokens.some((token) => token.autoApprove),
    capabilities: node.capabilityRows,
  }));
  const mainInstallation = selectMainInstallationNode(readinessNodes);
  const edgeEnabled =
    process.env.DPF_EDGE_ENABLED === "1" || mainInstallation.status === "found";
  const platformVersion = await loadPlatformVersion();

  const nodeRows: EdgeNodeRow[] = nodes.map((n, index) => {
    const hostMetadata = readHostMetadata(n.metadata);
    const readinessNode = readinessNodes[index];
    if (!readinessNode) {
      throw new Error(`Missing readiness projection for Edge Node ${n.nodeId}`);
    }
    const isMainInstallation = mainInstallation.node?.id === n.id;
    const readiness = deriveEdgeNodeReadiness(readinessNode, {
      edgeEnabled,
      currentVersion: isMainInstallation ? platformVersion.version : null,
      requiredCapabilities: isMainInstallation ? ["federation.discovery"] : [],
    });
    return {
      id: n.id,
      nodeId: n.nodeId,
      platform: n.platform,
      installMode: n.installMode,
      version: n.version,
      status: n.status,
      trustState: n.trustState,
      lastSeenAt: n.lastSeenAt?.toISOString() ?? null,
      enrolledAt: n.enrolledAt?.toISOString() ?? null,
      approvedAt: n.approvedAt?.toISOString() ?? null,
      quarantinedAt: n.quarantinedAt?.toISOString() ?? null,
      quarantineReason: n.quarantineReason,
      revokedAt: n.revokedAt?.toISOString() ?? null,
      revocationReason: n.revocationReason,
      displayName: n.principal.displayName,
      capabilities: Array.isArray(n.capabilities)
        ? (n.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
      hostHostname: hostMetadata.hostname,
      hostIpAddresses: hostMetadata.ipAddresses,
      customerAccountId: n.customerAccountId,
      customerAccountName: n.customerAccount?.name ?? null,
      customerSiteId: n.customerSiteId,
      customerSiteName: n.customerSite?.name ?? null,
      health: readiness.health,
      heartbeatAgeMs: readiness.heartbeatAgeMs,
      nextAction: readiness.nextAction,
      isMainInstallation,
      readinessChecks: readiness.checks,
    };
  });

  const tokenRows: BootstrapTokenRow[] = bootstrapTokens.map((t) => ({
    id: t.id,
    prefix: t.prefix,
    scope: t.scope,
    issuedAt: t.issuedAt.toISOString(),
    expiresAt: t.expiresAt.toISOString(),
    consumedAt: t.consumedAt?.toISOString() ?? null,
    consumedByNodeId: t.consumedByEdgeNode?.nodeId ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    targetCustomerAccountId: t.targetCustomerAccountId,
    targetCustomerAccountName: t.targetCustomerAccount?.name ?? null,
    targetCustomerSiteId: t.targetCustomerSiteId,
    targetCustomerSiteName: t.targetCustomerSite?.name ?? null,
  }));

  const customerAccountOptions: CustomerAccountOption[] = customerAccounts.map(
    (account) => ({
      id: account.id,
      accountId: account.accountId,
      name: account.name,
      status: account.status,
      sites: account.customerSites.map((site) => ({
        id: site.id,
        siteId: site.siteId,
        name: site.name,
        status: site.status,
      })),
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Edge Nodes</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          See this installation&apos;s readiness and manage Edge Nodes enrolled with its Authority
          Core.
        </p>
      </div>

      <EdgeNodesAdminClient
        nodes={nodeRows}
        tokens={tokenRows}
        customerAccounts={customerAccountOptions}
        edgeEnabled={edgeEnabled}
        mainInstallationStatus={mainInstallation.status}
      />
    </div>
  );
}
