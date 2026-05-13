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

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

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
    include: { principal: { select: { displayName: true } } },
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
    },
  });

  const nodeRows: EdgeNodeRow[] = nodes.map((n) => {
    const hostMetadata = readHostMetadata(n.metadata);
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
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Edge Nodes</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Host-resident agents that enroll against this Authority Core and submit discovery
          observations. Issue one-time bootstrap tokens to onboard new nodes; approve,
          quarantine, or revoke existing ones from the table below.
        </p>
      </div>

      <EdgeNodesAdminClient nodes={nodeRows} tokens={tokenRows} />
    </div>
  );
}
