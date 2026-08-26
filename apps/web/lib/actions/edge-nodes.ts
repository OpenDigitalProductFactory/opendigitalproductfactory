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

import { resolveAppBaseUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { issueBootstrapToken } from "@/lib/edge-node/enrollment";
import { resolveNativeReleaseAssets } from "@/lib/edge-node/native-release-assets";
import {
  buildRemoteProvisioningPlan,
  EDGE_HOST_OSES,
  type EdgeHostOs,
  type RemoteProvisioningPlan,
} from "@/lib/edge-node/remote-provisioning";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
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

  // Map the User to a Principal for audit attribution. Every User must
  // have a matching Principal + PrincipalAlias per AGENTS.md §11
  // (Principal convergence). The install seed creates one for the
  // bootstrap admin, but pre-§11 installs can be missing the row.
  //
  // Self-heal: if no alias exists, call syncUserPrincipal to create the
  // Principal + alias from the User row. This avoids the prior fallback
  // ("user:<userId>") which produced a string that violates the hard
  // FK in BootstrapToken_issuedByPrincipalId_fkey and similar columns,
  // causing the action to crash with a Prisma error leaking to the UI.
  const alias = await prisma.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: session.user.id },
    select: { principalId: true },
  });
  if (alias?.principalId) {
    return { ok: true, principalId: alias.principalId, userId: session.user.id };
  }
  const synced = await syncUserPrincipal(session.user.id);
  return { ok: true, principalId: synced.id, userId: session.user.id };
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
  const targetCustomerAccountId = input.targetCustomerAccountId?.trim() || null;
  const targetCustomerSiteId = input.targetCustomerSiteId?.trim() || null;
  if (targetCustomerSiteId && !targetCustomerAccountId) {
    return {
      ok: false,
      error: "invalid_input",
      message: "targetCustomerSiteId requires targetCustomerAccountId",
    };
  }
  // Spec caps bootstrap TTL at 24h; the lib enforces it server-side.

  try {
    if (targetCustomerAccountId) {
      const account = await prisma.customerAccount.findUnique({
        where: { id: targetCustomerAccountId },
        select: { id: true },
      });
      if (!account) {
        return {
          ok: false,
          error: "invalid_input",
          message: "Customer account target not found",
        };
      }
    }
    if (targetCustomerAccountId && targetCustomerSiteId) {
      const site = await prisma.customerSite.findFirst({
        where: { id: targetCustomerSiteId, accountId: targetCustomerAccountId },
        select: { id: true },
      });
      if (!site) {
        return {
          ok: false,
          error: "invalid_input",
          message: "Customer site target must belong to the selected customer account",
        };
      }
    }

    const result = await issueBootstrapToken({
      issuedByPrincipalId: gate.principalId,
      ...(ttlMs !== undefined ? { ttlMs } : {}),
      ...(targetCustomerAccountId ? { targetCustomerAccountId } : {}),
      ...(targetCustomerSiteId ? { targetCustomerSiteId } : {}),
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

// ── Easy remote provisioning ────────────────────────────────────────────────

export type PrepareRemoteEdgeProvisioningAction =
  | {
      ok: true;
      tokenId: string;
      prefix: string;
      expiresAt: string; // ISO
      /** The ready-to-run command(s) + URL assessment for the chosen host. */
      plan: RemoteProvisioningPlan;
    }
  | ActionFailure;

/**
 * Prepare an Edge Node on *separate hardware* (BI-D18DD7A9 / edge-topology
 * design §8): issue a scoped, short-TTL bootstrap token through the running
 * Authority (so no host-side `@dpf/db` import — EP-BUILD-D78835 — is needed)
 * and render a copy-paste install command with the Authority URL + token
 * already baked in. The operator never clones the repo or edits a `.env`.
 *
 * Reuses `issueEdgeBootstrapTokenAction` for the manage_platform gate, scope
 * validation, and issuance; this only adds OS validation + URL resolution +
 * command rendering on top.
 */
export async function prepareRemoteEdgeProvisioningAction(input: {
  os: EdgeHostOs;
  nodeName?: string;
  ttlMs?: number;
  targetCustomerAccountId?: string | null;
  targetCustomerSiteId?: string | null;
  /** Git ref for the raw standalone-compose URL; defaults to `main`. */
  composeRef?: string;
}): Promise<PrepareRemoteEdgeProvisioningAction> {
  if (!EDGE_HOST_OSES.includes(input.os)) {
    return {
      ok: false,
      error: "invalid_input",
      message: "os must be one of: linux, macos, windows",
    };
  }

  // Delegate the gate + scope validation + token mint to the existing action
  // so there is exactly one issuance path. Only mint after OS validation so a
  // bad request never consumes a token.
  const issued = await issueEdgeBootstrapTokenAction({
    ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
    targetCustomerAccountId: input.targetCustomerAccountId ?? null,
    targetCustomerSiteId: input.targetCustomerSiteId ?? null,
  });
  if (!issued.ok) return issued;

  // Ask the release what it actually publishes, rather than believing a
  // hardcoded list (BI-BB919901). Null — offline, rate-limited, air-gapped —
  // renders the container path only and never blocks issuance.
  const nativeRelease = await resolveNativeReleaseAssets();

  const plan = buildRemoteProvisioningPlan({
    resolvedAuthorityUrl: resolveAppBaseUrl(),
    bootstrapToken: issued.plaintext,
    os: input.os,
    ...(nativeRelease ? { nativeRelease } : {}),
    ...(input.nodeName?.trim() ? { nodeName: input.nodeName.trim() } : {}),
    ...(input.composeRef?.trim() ? { composeRef: input.composeRef.trim() } : {}),
  });

  return {
    ok: true,
    tokenId: issued.tokenId,
    prefix: issued.prefix,
    expiresAt: issued.expiresAt,
    plan,
  };
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

  const approvedAt = new Date();
  await prisma.$transaction([
    prisma.edgeNode.update({
      where: { id: edgeNodeId },
      data: {
        trustState: "trusted",
        status: "active",
        approvedAt,
        approvedByPrincipalId: gate.principalId,
        // Approving clears quarantine fields so a previously-quarantined
        // node can be re-trusted by operator action.
        quarantinedAt: null,
        quarantineReason: null,
      },
    }),
    prisma.edgeNodeCertificate.updateMany({
      where: { edgeNodeId, status: "quarantined", validUntil: { gt: approvedAt } },
      data: { status: "active", revokedAt: null, revocationReason: null },
    }),
  ]);
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

  const quarantineReason = reason.trim();
  const quarantinedAt = new Date();
  await prisma.$transaction([
    prisma.edgeNode.update({
      where: { id: edgeNodeId },
      data: {
        trustState: "quarantined",
        status: "quarantined",
        quarantinedAt,
        quarantineReason,
      },
    }),
    prisma.edgeNodeCertificate.updateMany({
      where: { edgeNodeId, status: "active" },
      data: {
        status: "quarantined",
        revokedAt: quarantinedAt,
        revocationReason: `node_quarantined:${quarantineReason}`,
      },
    }),
  ]);
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
  const revocationReason = reason.trim();
  const revokedAt = new Date();
  await prisma.$transaction([
    prisma.edgeNode.update({
      where: { id: edgeNodeId },
      data: {
        trustState: "revoked",
        revokedAt,
        revocationReason,
        tokenHash: null,
        tokenPrefix: null,
        tokenRotatedAt: null,
      },
    }),
    prisma.edgeNodeCertificate.updateMany({
      where: { edgeNodeId, status: { not: "revoked" } },
      data: {
        status: "revoked",
        revokedAt,
        revocationReason: `node_revoked:${revocationReason}`,
      },
    }),
  ]);
  revalidatePath(ADMIN_PATH);
  return { ok: true, edgeNodeId, trustState: "revoked" };
}
