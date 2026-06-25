"use server";

// EP-MSP-FEDERATION · B1 operator surface — server actions for
// Platform > Federation Links. Mirrors lib/actions/edge-nodes.ts: a
// manage_platform permission guard + principal resolution for audit, wrapping
// the federation enrollment lib (lib/federation/enrollment). All mutations
// revalidate the admin path so the UI sees fresh state.

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import { isFederationRole, type FederationRole } from "@dpf/db/federation-link-types";

import { auth } from "@/lib/auth";
import {
  approveFederationLinkLocal,
  issueFederationBootstrap,
  quarantineFederationLink,
  revokeFederationLink,
} from "@/lib/federation/enrollment";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { can } from "@/lib/permissions";

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
  offeredRole: string;
  ttlMs?: number;
}): Promise<IssueFederationBootstrapActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!isFederationRole(input.offeredRole)) {
    return { ok: false, error: "invalid_input", message: "offeredRole must be 'manages' or 'managed-by'" };
  }
  const ttlMs = input.ttlMs;
  if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
    return { ok: false, error: "invalid_input", message: "ttlMs must be a positive number" };
  }
  try {
    const result = await issueFederationBootstrap({
      issuedByPrincipalId: gate.principalId,
      offeredRole: input.offeredRole as FederationRole,
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
