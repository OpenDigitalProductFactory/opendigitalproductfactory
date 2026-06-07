// Marketing execution loop — spend gate.
//
// Hard backstop for paid channels. Two layers:
//   1. Per-placement: caller asserts proposedSpendCents matches what the
//      operator approved (validated by the adapter against the third-party
//      API's budget field).
//   2. Weekly per-channel ceiling: this module. Sums OutboundPublication
//      .channelMetadata.spendCents for the channel over the rolling 7-day
//      window ending now and refuses if proposed + current > ceiling.
//
// The gate REFUSES when no ceiling row exists for the (org, channel)
// pair — operators must explicitly set a weekly cap before any paid
// placement can fire. This is intentional: a missing ceiling is not a
// missing constraint, it's a missing decision.

import { prisma } from "@dpf/db";

export type SpendGateResult =
  | {
      ok: true;
      ceilingCents: number;
      currentSpendCents: number;
      headroomCents: number;
    }
  | {
      ok: false;
      reason: string;
      ceilingCents?: number;
      currentSpendCents?: number;
    };

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function assertSpendWithinCeiling(input: {
  organizationId: string;
  channelId: string;
  proposedSpendCents: number;
  now?: Date;
}): Promise<SpendGateResult> {
  if (input.proposedSpendCents <= 0) {
    return { ok: false, reason: "proposedSpendCents must be > 0" };
  }

  const ceiling = await prisma.marketingChannelSpendCeiling.findUnique({
    where: {
      organizationId_channelId: {
        organizationId: input.organizationId,
        channelId: input.channelId,
      },
    },
    select: { weeklyCapCents: true },
  });
  if (!ceiling) {
    return {
      ok: false,
      reason: `No weekly spend ceiling configured for ${input.channelId}. Set one in /customer/marketing before placing paid ads — a missing ceiling is a missing decision, not an unlimited budget.`,
    };
  }

  const now = input.now ?? new Date();
  const windowStart = new Date(now.getTime() - SEVEN_DAYS_MS);
  const recentPublications = await prisma.outboundPublication.findMany({
    where: {
      channelId: input.channelId,
      publishedAt: { gte: windowStart, lte: now },
    },
    select: { channelMetadata: true },
  });

  const currentSpendCents = recentPublications.reduce((sum, row) => {
    const meta = (row.channelMetadata ?? {}) as { spendCents?: unknown };
    const spend = typeof meta.spendCents === "number" ? meta.spendCents : 0;
    return sum + Math.max(0, spend);
  }, 0);

  const wouldBeTotal = currentSpendCents + input.proposedSpendCents;
  if (wouldBeTotal > ceiling.weeklyCapCents) {
    const overByCents = wouldBeTotal - ceiling.weeklyCapCents;
    return {
      ok: false,
      reason: `Placement would exceed the weekly ${formatUsd(ceiling.weeklyCapCents)} ceiling for ${input.channelId} by ${formatUsd(overByCents)}. Current 7-day spend: ${formatUsd(currentSpendCents)}. Proposed: ${formatUsd(input.proposedSpendCents)}. Raise the ceiling in /customer/marketing or wait until older placements roll off the window.`,
      ceilingCents: ceiling.weeklyCapCents,
      currentSpendCents,
    };
  }

  return {
    ok: true,
    ceilingCents: ceiling.weeklyCapCents,
    currentSpendCents,
    headroomCents: ceiling.weeklyCapCents - wouldBeTotal,
  };
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function readSpendCeiling(input: {
  organizationId: string;
  channelId: string;
}): Promise<{ weeklyCapCents: number; currentSpendCents: number; headroomCents: number } | null> {
  const ceiling = await prisma.marketingChannelSpendCeiling.findUnique({
    where: {
      organizationId_channelId: {
        organizationId: input.organizationId,
        channelId: input.channelId,
      },
    },
    select: { weeklyCapCents: true },
  });
  if (!ceiling) return null;

  const now = new Date();
  const windowStart = new Date(now.getTime() - SEVEN_DAYS_MS);
  const recent = await prisma.outboundPublication.findMany({
    where: {
      channelId: input.channelId,
      publishedAt: { gte: windowStart, lte: now },
    },
    select: { channelMetadata: true },
  });
  const currentSpendCents = recent.reduce((sum, row) => {
    const meta = (row.channelMetadata ?? {}) as { spendCents?: unknown };
    return sum + (typeof meta.spendCents === "number" ? Math.max(0, meta.spendCents) : 0);
  }, 0);
  return {
    weeklyCapCents: ceiling.weeklyCapCents,
    currentSpendCents,
    headroomCents: Math.max(0, ceiling.weeklyCapCents - currentSpendCents),
  };
}

export async function setSpendCeiling(input: {
  organizationId: string;
  channelId: string;
  weeklyCapCents: number;
  userId: string;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.weeklyCapCents < 0) {
    return { ok: false, error: "weeklyCapCents must be >= 0" };
  }
  await prisma.marketingChannelSpendCeiling.upsert({
    where: {
      organizationId_channelId: {
        organizationId: input.organizationId,
        channelId: input.channelId,
      },
    },
    create: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      weeklyCapCents: input.weeklyCapCents,
      lastSetByUserId: input.userId,
      notes: input.notes ?? null,
    },
    update: {
      weeklyCapCents: input.weeklyCapCents,
      lastSetByUserId: input.userId,
      lastSetAt: new Date(),
      notes: input.notes ?? null,
    },
  });
  return { ok: true };
}
