"use server";

// Server actions for the Admin > Platform Development > Edge Nodes
// surface. Wraps the lifecycle helpers in lib/edge-node/* with the
// permission + auth-resolution + audit concerns that any
// operator-driven action needs.
//
// All actions require manage_platform capability (HR-000 role, or
// superuser). Reject other callers at 403.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Approval policy
//   § Quarantine / Revocation

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { issueBootstrapToken } from "@/lib/edge-node/enrollment";
import { can } from "@/lib/permissions";

const ADMIN_PATH = "/platform/edge-nodes";

type ActionFailure = {
  ok: false;
  error:
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "invalid_input"
    | "invalid_transition"
    | "internal_error";
  message: string;
};

/**
 * Resolve the calling operator's principalId for audit attribution.
 * Returns the failure shape if auth fails or the user lacks
 * manage_platform — the caller propagates it to the UI.
 */
async function assertManagePlatform(): Promise<
  | { ok: true; principalId: string; userId: string }
  | ActionFailure
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthorized", message: "Sign in required" };
  }
  if (
    !can(
      {
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      },
      "manage_platform",
    )
  ) {
    return {
      ok: false,
      error: "forbidden",
      message: "manage_platform capability required",
    };
  }

  // Map the User to a Principal for audit attribution. Every User has
  // a corresponding Principal alias by AGENTS.md §11 convergence —
  // look it up, fall back to a synthetic value if (unexpectedly)
  // missing so the action still records WHO did it (not anonymous).
  const alias = await prisma.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: session.user.id },
    select: { principalId: true },
  });
  return {
    ok: true,
    principalId: alias?.principalId ?? `user:${session.user.id}`,
    userId: session.user.id,
  };
}

// ── Bootstrap token issuance ────────────────────────────────────────────────

export type IssueBootstrapTokenAction =
  | {
      ok: true;
      tokenId: string;
      /** Plaintext — shown to operator ONCE, then discarded. */
      plaintext: string;
      prefix: string;
      expiresAt: string; // ISO
    }
  | ActionFailure;

export async function issueEdgeBootstrapTokenAction(input: {
  ttlMs?: number;
  /** Optional note for operator memory; persisted in BootstrapToken.metadata. */
  note?: string;
  /** Optional MSP customer-account install target. */
  targetCustomerAccountId?: string | null;
  /** Optional MSP customer-site install target; requires account target. */
  targetCustomerSiteId?: string | null;
}): Promise<IssueBootstrapTokenAction> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;

  const ttlMs = input.ttlMs;
  if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
    return {
      ok: false,
      error: "invalid_input",
      message: "ttlMs must be a positive number",
    };
  }
  if (input.targetCustomerSiteId && !input.targetCustomerAccountId) {
    return {
      ok: false,
      error: "invalid_input",
      message: "targetCustomerSiteId requires targetCustomerAccountId",
    };
  }
  // Spec caps bootstrap TTL at 24h; the lib enforces it server-side.

  try {
    const result = await issueBootstrapToken({
      issuedByPrincipalId: gate.principalId,
      ...(ttlMs !== undefined ? { ttlMs } : {}),
      ...(input.targetCustomerAccountId
        ? { targetCustomerAccountId: input.targetCustomerAccountId }
        : {}),
      ...(input.targetCustomerSiteId
        ? { targetCustomerSiteId: input.targetCustomerSiteId }
        : {}),
    });
    revalidatePath(ADMIN_PATH);
    return {
      ok: true,
      tokenId: result.tokenId,
      plaintext: result.plaintext,
      prefix: result.prefix,
      expiresAt: result.expiresAt.toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: "internal_error",
      message: err instanceof Error ? err.message : "issuance failed",
    };
  }
}

// ── Lifecycle actions: approve / quarantine / revoke ──────────────────────

export type LifecycleActionResult =
  | { ok: true; edgeNodeId: string; trustState: string }
  | ActionFailure;

export async function approveEdgeNodeAction(
  edgeNodeId: string,
): Promise<LifecycleActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!edgeNodeId || typeof edgeNodeId !== "string") {
    return { ok: false, error: "invalid_input", message: "edgeNodeId required" };
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: edgeNodeId },
    select: { id: true, trustState: true },
  });
  if (!node) {
    return { ok: false, error: "not_found", message: "Edge Node not found" };
  }
  if (node.trustState === "revoked") {
    return {
      ok: false,
      error: "invalid_transition",
      message: "revoked nodes cannot be approved; re-enrollment required",
    };
  }
  // Approving an already-trusted node is a no-op (idempotent); allow it.

  await prisma.edgeNode.update({
    where: { id: edgeNodeId },
    data: {
      trustState: "trusted",
      status: "active",
      approvedAt: new Date(),
      approvedByPrincipalId: gate.principalId,
      // Approving clears quarantine fields so a previously-quarantined
      // node can be re-trusted by operator action.
      quarantinedAt: null,
      quarantineReason: null,
    },
  });
  revalidatePath(ADMIN_PATH);
  return { ok: true, edgeNodeId, trustState: "trusted" };
}

export async function quarantineEdgeNodeAction(
  edgeNodeId: string,
  reason: string,
): Promise<LifecycleActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!edgeNodeId || typeof edgeNodeId !== "string") {
    return { ok: false, error: "invalid_input", message: "edgeNodeId required" };
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return {
      ok: false,
      error: "invalid_input",
      message: "quarantine reason required",
    };
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: edgeNodeId },
    select: { id: true, trustState: true },
  });
  if (!node) {
    return { ok: false, error: "not_found", message: "Edge Node not found" };
  }
  if (node.trustState === "revoked") {
    return {
      ok: false,
      error: "invalid_transition",
      message: "revoked nodes cannot be quarantined; they're already invalidated",
    };
  }

  await prisma.edgeNode.update({
    where: { id: edgeNodeId },
    data: {
      trustState: "quarantined",
      status: "quarantined",
      quarantinedAt: new Date(),
      quarantineReason: reason.trim(),
    },
  });
  revalidatePath(ADMIN_PATH);
  return { ok: true, edgeNodeId, trustState: "quarantined" };
}

export async function revokeEdgeNodeAction(
  edgeNodeId: string,
  reason: string,
): Promise<LifecycleActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!edgeNodeId || typeof edgeNodeId !== "string") {
    return { ok: false, error: "invalid_input", message: "edgeNodeId required" };
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return {
      ok: false,
      error: "invalid_input",
      message: "revocation reason required",
    };
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: edgeNodeId },
    select: { id: true, trustState: true },
  });
  if (!node) {
    return { ok: false, error: "not_found", message: "Edge Node not found" };
  }
  // Revoking an already-revoked node is idempotent (no-op).
  if (node.trustState === "revoked") {
    return { ok: true, edgeNodeId, trustState: "revoked" };
  }

  // Revoke the node + null its tokenHash so any further request
  // bearing the now-orphaned token fails at the auth-resolution
  // step (resolveEdgeNodeAuth looks up by hash and finds nothing).
  // The Phase 0 schema stores a single tokenHash per EdgeNode row —
  // there's no separate EdgeNodeToken table to clear; the hash on
  // the row IS the credential. Re-enrollment is operator-explicit
  // per spec § Re-enrollment.
  await prisma.edgeNode.update({
    where: { id: edgeNodeId },
    data: {
      trustState: "revoked",
      revokedAt: new Date(),
      revocationReason: reason.trim(),
      tokenHash: null,
      tokenPrefix: null,
      tokenRotatedAt: null,
    },
  });
  revalidatePath(ADMIN_PATH);
  return { ok: true, edgeNodeId, trustState: "revoked" };
}
