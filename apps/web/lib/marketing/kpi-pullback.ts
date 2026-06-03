// Marketing execution loop — KPI pullback.
//
// For a given channel, walk OutboundPublication rows still inside their
// analytics window, call the adapter's fetchEngagement, update the row's
// lastMetricsSnapshot + lastMetricsPolledAt, and aggregate into a fresh
// MarketingKpiCheckpoint so the next Marketing Strategist review sees
// real numbers via get_marketing_summary.

import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { getAdapter } from "./channels/registry";
import type { ChannelCredentialBundle } from "./channels/contracts";

const DEFAULT_ANALYTICS_WINDOW_DAYS = 30;

export type PullChannelKpisResult = {
  ok: boolean;
  snapshotsWritten: number;
  checkpointsWritten: number;
  failures: Array<{ publicationId: string; error: string }>;
};

export async function pullChannelKpis(input: {
  channelId: string;
  sinceDaysAgo?: number;
}): Promise<PullChannelKpisResult> {
  const adapter = getAdapter(input.channelId);
  if (!adapter) {
    return {
      ok: false,
      snapshotsWritten: 0,
      checkpointsWritten: 0,
      failures: [{ publicationId: "", error: `unknown_channel: ${input.channelId}` }],
    };
  }
  if (!adapter.fetchEngagement) {
    return {
      ok: false,
      snapshotsWritten: 0,
      checkpointsWritten: 0,
      failures: [{ publicationId: "", error: "adapter_does_not_support_fetch_engagement" }],
    };
  }

  const credentialRow = await prisma.integrationCredential.findUnique({
    where: { integrationId: adapter.credentialIntegrationId },
  });
  if (!credentialRow || credentialRow.status !== "connected") {
    return {
      ok: false,
      snapshotsWritten: 0,
      checkpointsWritten: 0,
      failures: [{ publicationId: "", error: "credential_not_connected" }],
    };
  }
  const fields = decryptJson<Record<string, unknown>>(credentialRow.fieldsEnc) ?? {};
  const tokens = credentialRow.tokenCacheEnc
    ? (decryptJson<Record<string, unknown>>(credentialRow.tokenCacheEnc) ?? {})
    : {};
  const credential: ChannelCredentialBundle = {
    credentialId: credentialRow.id,
    integrationId: credentialRow.integrationId,
    provider: credentialRow.provider,
    status: credentialRow.status,
    fields,
    tokens,
  };

  const windowDays = input.sinceDaysAgo ?? DEFAULT_ANALYTICS_WINDOW_DAYS;
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const publications = await prisma.outboundPublication.findMany({
    where: {
      channelId: input.channelId,
      publishedAt: { gte: windowStart },
    },
    orderBy: { publishedAt: "desc" },
  });

  let snapshotsWritten = 0;
  const failures: Array<{ publicationId: string; error: string }> = [];
  const aggregate: Record<string, number> = {
    impressions: 0,
    clicks: 0,
    costInUsdCents: 0,
    conversions: 0,
  };

  for (const pub of publications) {
    try {
      const snapshot = await adapter.fetchEngagement!(pub, credential);
      const channelMetadata = pub.channelMetadata && typeof pub.channelMetadata === "object"
        ? (pub.channelMetadata as Record<string, unknown>)
        : {};
      const nextMetadata: Record<string, unknown> = { ...channelMetadata };
      // Update spendCents from real costInUsdCents now that we have data.
      if (typeof snapshot.metrics.costInUsdCents === "number" && snapshot.metrics.costInUsdCents > 0) {
        nextMetadata.spendCents = snapshot.metrics.costInUsdCents;
      }
      await prisma.outboundPublication.update({
        where: { publicationId: pub.publicationId },
        data: {
          lastMetricsPolledAt: snapshot.polledAt,
          lastMetricsSnapshot: snapshot.metrics as import("@dpf/db").Prisma.InputJsonValue,
          channelMetadata: nextMetadata as import("@dpf/db").Prisma.InputJsonValue,
        },
      });
      snapshotsWritten++;
      for (const key of Object.keys(aggregate)) {
        aggregate[key]! += snapshot.metrics[key] ?? 0;
      }
    } catch (err) {
      failures.push({
        publicationId: pub.publicationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Aggregate into MarketingKpiCheckpoint. Skip if zero publications or
  // we couldn't read the strategy (no anchor for the checkpoint).
  let checkpointsWritten = 0;
  if (snapshotsWritten > 0) {
    try {
      const strategy = await prisma.marketingStrategy.findFirst({
        orderBy: { lastReviewedAt: "desc" },
        select: { strategyId: true, organizationId: true },
      });
      if (strategy) {
        const cpcCents = aggregate.clicks! > 0
          ? Math.round(aggregate.costInUsdCents! / aggregate.clicks!)
          : 0;
        const notes = `Pulled ${snapshotsWritten} ${input.channelId} publication${snapshotsWritten === 1 ? "" : "s"} on ${new Date().toISOString().slice(0, 10)}: ${aggregate.impressions} impressions, ${aggregate.clicks} clicks, $${(aggregate.costInUsdCents! / 100).toFixed(2)} spend, ${aggregate.conversions} conversions, CPC $${(cpcCents / 100).toFixed(2)}.`;
        await prisma.marketingKpiCheckpoint.create({
          data: {
            organizationId: strategy.organizationId,
            strategyId: strategy.strategyId,
            metric: `${input.channelId}-rollup`,
            target: null,
            cadence: null,
            notes,
            status: "active",
            createdByAgentId: "marketing-specialist",
          },
        });
        checkpointsWritten = 1;
      }
    } catch (err) {
      failures.push({
        publicationId: "checkpoint",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: failures.length === 0,
    snapshotsWritten,
    checkpointsWritten,
    failures,
  };
}
