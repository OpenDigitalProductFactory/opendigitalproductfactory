"use server";

import { prisma } from "@dpf/db";
import { BOOTSTRAP_TOKEN_DEFAULT_TTL_MS, BOOTSTRAP_TOKEN_MAX_TTL_MS } from "@dpf/db/edge-node-types";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { issueBootstrapToken } from "@/lib/edge-node/enrollment";
import { can } from "@/lib/permissions";

// ─── Auth ────────────────────────────────────────────────────────────────────

type AuthedPrincipal = { userId: string; principalId: string };

/**
 * Gate every Edge Node admin action on `manage_platform`. Returns the
 * caller's userId AND the Principal id that corresponds to the user
 * (which we record on BootstrapToken.issuedByPrincipalId so audit can
 * trace issuance back to the operator who acted).
 */
async function requireManagePlatform(): Promise<AuthedPrincipal> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_platform",
    )
  ) {
    throw new Error("Unauthorized");
  }
  // The caller's Principal is created lazily for users that don't yet
  // have one; we look it up via their `User` alias.
  const alias = await prisma.principalAlias.findUnique({
    where: {
      aliasType_aliasValue_issuer: {
        aliasType: "user",
        aliasValue: user.id!,
        issuer: "",
      },
    },
    include: { principal: true },
  });
  let principalId = alias?.principalId;
  if (!principalId) {
    // Defensive: provision the Principal + alias if missing. This
    // can happen on legacy installs predating the principal-convergence
    // migration. Single-row create; no transaction needed.
    const newPrincipal = await prisma.principal.create({
      data: {
        principalId: `principal_user_${user.id}`,
        kind: "user",
        displayName: user.email ?? user.id!,
      },
    });
    await prisma.principalAlias.create({
      data: {
        principalId: newPrincipal.id,
        aliasType: "user",
        aliasValue: user.id!,
      },
    });
    principalId = newPrincipal.id;
  }
  return { userId: user.id!, principalId };
}

// ─── List ────────────────────────────────────────────────────────────────────

export type EdgeNodeRow = {
  id: string;
  nodeId: string;
  displayName: string;
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
  capabilities: string[];
};

/**
 * List all Edge Nodes (most recently seen first). Operator-only.
 * Returns ISO timestamps for clean JSON serialization.
 */
export async function listEdgeNodes(): Promise<EdgeNodeRow[]> {
  await requireManagePlatform();
  const rows = await prisma.edgeNode.findMany({
    orderBy: [
      { lastSeenAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
  });
  return rows.map((row) => ({
    id: row.id,
    nodeId: row.nodeId,
    displayName: row.displayName,
    platform: row.platform,
    installMode: row.installMode,
    version: row.version,
    status: row.status,
    trustState: row.trustState,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    enrolledAt: row.enrolledAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    quarantinedAt: row.quarantinedAt?.toISOString() ?? null,
    quarantineReason: row.quarantineReason,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    capabilities: Array.isArray(row.capabilities) ? (row.capabilities as string[]) : [],
  }));
}

// ─── Issue bootstrap token ──────────────────────────────────────────────────

export type IssueBootstrapResult = {
  /** Plaintext token. SHOWN TO OPERATOR EXACTLY ONCE. */
  plaintext: string;
  /** Visual ID prefix (first 12 chars). */
  prefix: string;
  /** ISO expiry. */
  expiresAt: string;
};

export type IssueBootstrapInput = {
  /** Operator-set TTL in minutes. Default 15. Server caps at 1440 (24h). */
  ttlMinutes?: number;
};

const MIN_TTL_MINUTES = 1;
const DEFAULT_TTL_MINUTES = Math.floor(BOOTSTRAP_TOKEN_DEFAULT_TTL_MS / 60_000);
const MAX_TTL_MINUTES = Math.floor(BOOTSTRAP_TOKEN_MAX_TTL_MS / 60_000);

export async function issueEdgeNodeBootstrapToken(
  input: IssueBootstrapInput = {},
): Promise<IssueBootstrapResult> {
  const { principalId } = await requireManagePlatform();
  const requested = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  if (!Number.isFinite(requested)) {
    throw new Error("ttlMinutes must be a finite number");
  }
  const clamped = Math.min(Math.max(Math.floor(requested), MIN_TTL_MINUTES), MAX_TTL_MINUTES);
  const result = await issueBootstrapToken({
    issuedByPrincipalId: principalId,
    ttlMs: clamped * 60_000,
  });
  revalidatePath("/admin/edge-nodes");
  return {
    plaintext: result.plaintext,
    prefix: result.prefix,
    expiresAt: result.expiresAt.toISOString(),
  };
}

// ─── Quarantine / Unquarantine ──────────────────────────────────────────────

export type QuarantineInput = {
  edgeNodeId: string;
  reason: string;
};

export async function quarantineEdgeNode(input: QuarantineInput): Promise<void> {
  await requireManagePlatform();
  if (!input.reason.trim()) {
    throw new Error("A reason is required for quarantine");
  }
  await prisma.edgeNode.update({
    where: { id: input.edgeNodeId },
    data: {
      trustState: "quarantined",
      status: "quarantined",
      quarantinedAt: new Date(),
      quarantineReason: input.reason.trim(),
    },
  });
  revalidatePath("/admin/edge-nodes");
}

export type UnquarantineInput = {
  edgeNodeId: string;
};

/**
 * Reverse quarantine — restore the node to `trusted` if it was
 * previously approved; otherwise back to `pending`. Operator-decided
 * (this action is the explicit re-trust step).
 */
export async function unquarantineEdgeNode(input: UnquarantineInput): Promise<void> {
  await requireManagePlatform();
  const node = await prisma.edgeNode.findUnique({
    where: { id: input.edgeNodeId },
    select: { approvedAt: true, trustState: true },
  });
  if (!node) {
    throw new Error("Edge Node not found");
  }
  if (node.trustState !== "quarantined") {
    throw new Error(`Cannot unquarantine a node in trustState=${node.trustState}`);
  }
  await prisma.edgeNode.update({
    where: { id: input.edgeNodeId },
    data: {
      trustState: node.approvedAt ? "trusted" : "pending",
      status: "active",
      quarantinedAt: null,
      quarantineReason: null,
    },
  });
  revalidatePath("/admin/edge-nodes");
}

// ─── Revoke ─────────────────────────────────────────────────────────────────

export type RevokeInput = {
  edgeNodeId: string;
  reason: string;
};

/**
 * Revoke an Edge Node. Tokens are invalidated server-side; the row is
 * preserved for audit. The agent will receive 401 on next heartbeat
 * and clear its local state. Re-enrollment is operator-explicit per
 * spec § Re-enrollment.
 */
export async function revokeEdgeNode(input: RevokeInput): Promise<void> {
  await requireManagePlatform();
  if (!input.reason.trim()) {
    throw new Error("A reason is required for revocation");
  }
  await prisma.edgeNode.update({
    where: { id: input.edgeNodeId },
    data: {
      trustState: "revoked",
      status: "offline",
      revokedAt: new Date(),
      revocationReason: input.reason.trim(),
      // Clear the token hash so an agent that still has the plaintext
      // can't authenticate even if the trustState check were bypassed.
      tokenHash: null,
      tokenPrefix: null,
    },
  });
  revalidatePath("/admin/edge-nodes");
}

// ─── Approve (for pending nodes) ────────────────────────────────────────────

export type ApproveInput = {
  edgeNodeId: string;
};

/**
 * Approve a node currently in trustState=pending. Required for
 * non-auto-approved enrollments (the default for remote nodes per
 * spec § Approval policy).
 */
export async function approveEdgeNode(input: ApproveInput): Promise<void> {
  const { principalId } = await requireManagePlatform();
  const node = await prisma.edgeNode.findUnique({
    where: { id: input.edgeNodeId },
    select: { trustState: true },
  });
  if (!node) {
    throw new Error("Edge Node not found");
  }
  if (node.trustState !== "pending") {
    throw new Error(`Cannot approve a node in trustState=${node.trustState}`);
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.edgeNode.update({
      where: { id: input.edgeNodeId },
      data: {
        trustState: "trusted",
        approvedAt: now,
        approvedByPrincipalId: principalId,
      },
    });
    // Flip the capability rows from disabled (the default for pending
    // nodes) to enabled. The agent picks up the new accepted set on
    // its next heartbeat.
    await tx.edgeNodeCapability.updateMany({
      where: { edgeNodeId: input.edgeNodeId, mode: "disabled" },
      data: { mode: "enabled" },
    });
  });
  revalidatePath("/admin/edge-nodes");
}
