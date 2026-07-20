"use server";

// EP-MSP-FEDERATION · B1 operator surface — server actions for
// Platform > Federation Links. Mirrors lib/actions/edge-nodes.ts: a
// manage_platform permission guard + principal resolution for audit, wrapping
// the federation enrollment lib (lib/federation/enrollment). All mutations
// revalidate the admin path so the UI sees fresh state.

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";
import {
  isFederationRelationshipPreset,
  isFederationRole,
  isRoleAllowedForRelationship,
  type FederationRelationshipPreset,
  type FederationRole,
} from "@dpf/db/federation-link-types";

import { resolveAppBaseUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import {
  approveFederationLinkLocal,
  issueFederationBootstrap,
  quarantineFederationLink,
  revokeFederationLink,
} from "@/lib/federation/enrollment";
import { enrollWithPeer, relayApprovalToPeer } from "@/lib/federation/outbound";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { can } from "@/lib/permissions";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

const ADMIN_PATH = "/platform/federation-links";

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

async function assertManagePlatform(): Promise<
  { ok: true; principalId: string; userId: string } | ActionFailure
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthorized", message: "Sign in required" };
  }
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_platform",
    )
  ) {
    return { ok: false, error: "forbidden", message: "manage_platform capability required" };
  }
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

// ── Bootstrap (invitation) issuance ──────────────────────────────────────────

export type IssueFederationBootstrapActionResult =
  | { ok: true; tokenId: string; plaintext: string; prefix: string; expiresAt: string }
  | ActionFailure;

export async function issueFederationBootstrapAction(input: {
  relationshipPreset: string;
  offeredRole: string;
  ttlMs?: number;
}): Promise<IssueFederationBootstrapActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (
    !isFederationRelationshipPreset(input.relationshipPreset) ||
    !isFederationRole(input.offeredRole) ||
    !isRoleAllowedForRelationship(input.relationshipPreset, input.offeredRole)
  ) {
    return { ok: false, error: "invalid_input", message: "relationship preset and offered role do not match" };
  }
  const ttlMs = input.ttlMs;
  if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
    return { ok: false, error: "invalid_input", message: "ttlMs must be a positive number" };
  }
  try {
    const result = await issueFederationBootstrap({
      issuedByPrincipalId: gate.principalId,
      offeredRole: input.offeredRole as FederationRole,
      proposedProjection:
        DEMAND_PROJECTION_TEMPLATES[
          input.relationshipPreset as FederationRelationshipPreset
        ] as unknown as Record<string, unknown>,
      ...(ttlMs !== undefined ? { ttlMs } : {}),
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
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "issuance failed" };
  }
}

// ── Lifecycle (approve-local / quarantine / revoke) ──────────────────────────

export type LinkLifecycleResult = { ok: true; linkId: string; linkState: string } | ActionFailure;

async function loadLink(linkId: string) {
  if (!linkId || typeof linkId !== "string") return null;
  return prisma.federationLink.findUnique({ where: { linkId }, select: { linkId: true, linkState: true } });
}

export async function approveFederationLinkAction(linkId: string): Promise<LinkLifecycleResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const link = await loadLink(linkId);
  if (!link) return { ok: false, error: "not_found", message: "Federation link not found" };
  if (link.linkState === "revoked") {
    return { ok: false, error: "invalid_transition", message: "revoked links cannot be approved" };
  }
  try {
    const linkState = await approveFederationLinkLocal(linkId, gate.principalId);
    // Relay our approval to the peer so they flip their approvedAtPeer. Best-effort:
    // a relay failure must never fail our local approval (the peer can be re-notified).
    if (envFlagEnabled(process.env, "DPF_FEDERATION_EXCHANGE_ENABLED")) {
      const full = await prisma.federationLink.findUnique({
        where: { linkId },
        select: { linkId: true, peerAuthorityUrl: true, peerTokenEnc: true },
      });
      if (full?.peerTokenEnc) {
        try {
          await relayApprovalToPeer(full);
        } catch {
          /* best-effort relay */
        }
      }
    }
    revalidatePath(ADMIN_PATH);
    return { ok: true, linkId, linkState };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "approve failed" };
  }
}

export async function quarantineFederationLinkAction(
  linkId: string,
  reason: string,
): Promise<LinkLifecycleResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return { ok: false, error: "invalid_input", message: "quarantine reason required" };
  }
  const link = await loadLink(linkId);
  if (!link) return { ok: false, error: "not_found", message: "Federation link not found" };
  if (link.linkState === "revoked") {
    return { ok: false, error: "invalid_transition", message: "revoked links cannot be quarantined" };
  }
  try {
    const linkState = await quarantineFederationLink(linkId, reason.trim());
    revalidatePath(ADMIN_PATH);
    return { ok: true, linkId, linkState };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "quarantine failed" };
  }
}

export async function revokeFederationLinkAction(
  linkId: string,
  reason: string,
): Promise<LinkLifecycleResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return { ok: false, error: "invalid_input", message: "revocation reason required" };
  }
  const link = await loadLink(linkId);
  if (!link) return { ok: false, error: "not_found", message: "Federation link not found" };
  if (link.linkState === "revoked") {
    return { ok: true, linkId, linkState: "revoked" }; // idempotent
  }
  try {
    const linkState = await revokeFederationLink(linkId, reason.trim());
    revalidatePath(ADMIN_PATH);
    return { ok: true, linkId, linkState };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "revoke failed" };
  }
}

// ── Connect to a peer (outbound enroll) ──────────────────────────────────────

export type EnrollWithPeerActionResult =
  | { ok: true; linkId: string; linkState: string; role: string }
  | ActionFailure;

/** Redeem a peer's invitation token to establish our side of a link. The
 *  peer-issued link token is stored encrypted for outbound calls. */
export async function enrollWithPeerAction(input: {
  peerAuthorityUrl: string;
  bootstrapToken: string;
  displayName: string;
  peerOrganizationRef?: string | null;
}): Promise<EnrollWithPeerActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!input.peerAuthorityUrl?.trim() || !input.bootstrapToken?.trim() || !input.displayName?.trim()) {
    return { ok: false, error: "invalid_input", message: "peer URL, invitation token, and a name are required" };
  }
  const localAuthorityUrl = resolveAppBaseUrl();
  if (!localAuthorityUrl) {
    return { ok: false, error: "internal_error", message: "this deployment's base URL is not configured (set APP_URL)" };
  }
  try {
    const result = await enrollWithPeer({
      peerAuthorityUrl: input.peerAuthorityUrl.trim(),
      bootstrapToken: input.bootstrapToken.trim(),
      localAuthorityUrl,
      displayName: input.displayName.trim(),
      ...(input.peerOrganizationRef ? { peerOrganizationRef: input.peerOrganizationRef } : {}),
    });
    if (!result.ok) return { ok: false, error: "internal_error", message: result.message };
    revalidatePath(ADMIN_PATH);
    return { ok: true, linkId: result.linkId, linkState: result.linkState, role: result.role };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "enroll failed" };
  }
}

export type SetFederationDiscoveryActionResult =
  | { ok: true; updated: number; enabled: boolean }
  | ActionFailure;

/** Authority-owned kill switch for native nearby discovery. Existing Edge
 * nodes advertise support through heartbeat; this action decides whether the
 * capability is accepted. */
export async function setFederationDiscoveryEnabledAction(
  enabled: boolean,
): Promise<SetFederationDiscoveryActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const rows = await prisma.edgeNodeCapability.findMany({
    where: {
      capability: "federation.discovery",
      node: { installMode: "native", trustState: "trusted", revokedAt: null },
    },
    select: { id: true },
  });
  if (rows.length === 0) {
    return {
      ok: false,
      error: "not_found",
      message: "No trusted native Edge Node has registered nearby discovery yet",
    };
  }
  const result = await prisma.edgeNodeCapability.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { mode: enabled ? "enabled" : "disabled" },
  });
  revalidatePath(ADMIN_PATH);
  revalidatePath("/platform/edge-nodes");
  return { ok: true, updated: result.count, enabled };
}
