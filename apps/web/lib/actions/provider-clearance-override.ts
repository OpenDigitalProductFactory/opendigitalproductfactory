"use server";

import { prisma } from "@dpf/db";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  parseAcceptedSensitivities,
  RISK_OVERRIDE_STATUS,
} from "@/lib/govern/clearance-overrides";

// Break-glass grant/revoke (BI-4512E7D2 / BI-BD88A142). These are the ONLY writers
// of ProviderClearanceOverride. Operator-gated (manage_provider_connections), and
// deliberately verbose about the risk: an override records that we accept a
// provider is NOT verified-safe for a sensitivity — never that it is safe.

// Overriding "public"/"development" is meaningless (a public-cleared provider
// already serves them), so an override may only accept these higher levels.
const OVERRIDABLE_SENSITIVITIES = ["internal", "confidential", "restricted"] as const;

export type GrantClearanceOverrideInput = {
  providerId: string;
  acceptedSensitivities: string[];
  rationale: string;
  acknowledgedRisk: string;
  acknowledged: boolean;
  expiresAt: string; // ISO timestamp
};

export async function grantProviderClearanceOverride(
  input: GrantClearanceOverrideInput,
): Promise<{ error?: string; overrideId?: string }> {
  const { userId } = await requireCapability("manage_provider_connections");

  if (!input.acknowledged) {
    return { error: "You must explicitly acknowledge the risk to create an override." };
  }
  const rationale = input.rationale?.trim() ?? "";
  if (rationale.length < 10) {
    return { error: "A justification (at least 10 characters) is required." };
  }
  const acknowledgedRisk = input.acknowledgedRisk?.trim() ?? "";
  if (!acknowledgedRisk) {
    return { error: "The acknowledged-risk statement is required." };
  }
  const accepted = parseAcceptedSensitivities(input.acceptedSensitivities).filter(
    (level): level is (typeof OVERRIDABLE_SENSITIVITIES)[number] =>
      (OVERRIDABLE_SENSITIVITIES as readonly string[]).includes(level),
  );
  if (accepted.length === 0) {
    return { error: "Choose at least one sensitivity to accept (internal, confidential, or restricted)." };
  }
  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return { error: "An expiry in the future is required — an override cannot be indefinite." };
  }

  const provider = await prisma.modelProvider.findUnique({
    where: { providerId: input.providerId },
    select: { providerId: true },
  });
  if (!provider) return { error: "Provider not found." };

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { error: "No organization is configured." };

  const created = await prisma.providerClearanceOverride.create({
    data: {
      organizationId: org.id,
      providerId: input.providerId,
      acceptedSensitivities: accepted,
      status: RISK_OVERRIDE_STATUS.active,
      rationale,
      acknowledgedRisk,
      approverRef: userId,
      expiresAt,
      provenance: { source: "operator-break-glass", actorUserId: userId },
    },
    select: { id: true },
  });

  await writeAudit(userId, "grantProviderClearanceOverride", "success", {
    overrideId: created.id,
    providerId: input.providerId,
    acceptedSensitivities: accepted,
    expiresAt: expiresAt.toISOString(),
  });

  return { overrideId: created.id };
}

export async function revokeProviderClearanceOverride(
  input: { overrideId: string },
): Promise<{ error?: string }> {
  const { userId } = await requireCapability("manage_provider_connections");

  const existing = await prisma.providerClearanceOverride.findUnique({
    where: { id: input.overrideId },
    select: { id: true, status: true, providerId: true },
  });
  if (!existing) return { error: "Override not found." };
  if (existing.status !== RISK_OVERRIDE_STATUS.active) {
    return { error: "This override is not active." };
  }

  await prisma.providerClearanceOverride.update({
    where: { id: existing.id },
    data: {
      status: RISK_OVERRIDE_STATUS.revoked,
      revokedAt: new Date(),
      revokedByRef: userId,
    },
  });

  await writeAudit(userId, "revokeProviderClearanceOverride", "success", {
    overrideId: input.overrideId,
    providerId: existing.providerId,
  });

  return {};
}

export type ClearanceOverrideView = {
  overrideId: string;
  providerId: string;
  acceptedSensitivities: string[];
  rationale: string;
  acknowledgedRisk: string;
  approverRef: string | null;
  acknowledgedAt: string;
  expiresAt: string;
  status: string;
};

/** Read the active overrides for the operator surface. */
export async function listActiveProviderClearanceOverrides(
  providerId?: string,
): Promise<ClearanceOverrideView[]> {
  await requireCapability("manage_provider_connections");
  const rows = await prisma.providerClearanceOverride.findMany({
    where: {
      status: RISK_OVERRIDE_STATUS.active,
      expiresAt: { gt: new Date() },
      ...(providerId ? { providerId } : {}),
    },
    orderBy: { acknowledgedAt: "desc" },
  });
  return rows.map((row) => ({
    overrideId: row.id,
    providerId: row.providerId,
    acceptedSensitivities: parseAcceptedSensitivities(row.acceptedSensitivities),
    rationale: row.rationale,
    acknowledgedRisk: row.acknowledgedRisk,
    approverRef: row.approverRef,
    acknowledgedAt: row.acknowledgedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
  }));
}

async function writeAudit(
  userId: string,
  toolName: string,
  result: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.adminActivity.create({
      data: {
        userId,
        toolName,
        parameters: parameters as import("@dpf/db").Prisma.InputJsonValue,
        result,
        tier: 3,
        summary: null,
      },
    });
  } catch {
    // The durable consent record IS the audit of record; a failed activity-log
    // write must not fail the grant/revoke itself.
  }
}
