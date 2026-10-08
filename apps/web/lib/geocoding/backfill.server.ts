import "server-only";

// The opt-in geocoding backfill, run in the background (BI-560128FB,
// AC-CMAP-PROVIDER-1/2). The provider is the administrator's choice in
// PlatformConfig; progress is stored beside it so the page can show counts.
// One run sweeps every address still missing coordinates once.

import { prisma } from "@dpf/db";

import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { runGeocodingBackfillPass, type BackfillDb } from "./backfill";
import {
  GEOCODING_PROVIDER_KEY,
  parseGeocodingConfig,
  resolveGeocodingProvider,
  type GeocodingConfig,
  type GeocodingProvider,
} from "./providers";

export const GEOCODING_BACKFILL_STATUS_KEY = "geocoding.backfill.status";

export type GeocodingBackfillStatus = {
  state: "idle" | "running" | "done" | "failed";
  placed: number;
  notFound: number;
  remaining: number | null;
  updatedAt: string | null;
};

const IDLE: GeocodingBackfillStatus = { state: "idle", placed: 0, notFound: 0, remaining: null, updatedAt: null };

async function writeStatus(status: GeocodingBackfillStatus) {
  await prisma.platformConfig.upsert({
    where: { key: GEOCODING_BACKFILL_STATUS_KEY },
    create: { key: GEOCODING_BACKFILL_STATUS_KEY, value: status },
    update: { value: status },
  });
}

function parseStatus(value: unknown): GeocodingBackfillStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return IDLE;
  const record = value as Partial<GeocodingBackfillStatus>;
  const states = ["idle", "running", "done", "failed"] as const;
  return {
    state: states.includes(record.state as never) ? (record.state as GeocodingBackfillStatus["state"]) : "idle",
    placed: Number(record.placed) || 0,
    notFound: Number(record.notFound) || 0,
    remaining: typeof record.remaining === "number" ? record.remaining : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

export async function readGeocodingSettings(): Promise<{
  config: GeocodingConfig;
  opencageKeyConfigured: boolean;
  status: GeocodingBackfillStatus;
}> {
  const [configRow, statusRow, opencage] = await Promise.all([
    prisma.platformConfig.findUnique({ where: { key: GEOCODING_PROVIDER_KEY }, select: { value: true } }),
    prisma.platformConfig.findUnique({ where: { key: GEOCODING_BACKFILL_STATUS_KEY }, select: { value: true } }),
    prisma.credentialEntry.findUnique({ where: { providerId: "opencage" }, select: { id: true } }),
  ]);
  return {
    config: parseGeocodingConfig(configRow?.value),
    opencageKeyConfigured: Boolean(opencage),
    status: parseStatus(statusRow?.value),
  };
}

export async function saveGeocodingConfig(value: unknown): Promise<GeocodingConfig> {
  const config = parseGeocodingConfig(value);
  await prisma.platformConfig.upsert({
    where: { key: GEOCODING_PROVIDER_KEY },
    create: { key: GEOCODING_PROVIDER_KEY, value: config },
    update: { value: config },
  });
  return config;
}

/** The administrator's provider, with its key when it needs one. `enabled` is false for `none`. */
export async function activeProvider(): Promise<GeocodingProvider> {
  const { config } = await readGeocodingSettings();
  const opencageKey = config.provider === "opencage" ? (await getDecryptedCredential("opencage"))?.secretRef ?? undefined : undefined;
  return resolveGeocodingProvider(config, { opencageKey });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Start a backfill run in the background and return at once. Refuses when
 * the provider is `none` (or missing its key), or when a run is in progress.
 */
export async function startGeocodingBackfill(): Promise<{ started: boolean; reason?: "no-provider" | "already-running" }> {
  const provider = await activeProvider();
  if (!provider.enabled) return { started: false, reason: "no-provider" };
  const { status } = await readGeocodingSettings();
  const stale = !status.updatedAt || Date.now() - Date.parse(status.updatedAt) > 15 * 60_000;
  if (status.state === "running" && !stale) return { started: false, reason: "already-running" };

  const totals = { placed: 0, notFound: 0 };
  await writeStatus({ state: "running", ...totals, remaining: null, updatedAt: new Date().toISOString() });
  void (async () => {
    let afterId: string | undefined;
    try {
      for (;;) {
        const pass = await runGeocodingBackfillPass(prisma as unknown as BackfillDb, provider, { fetchImpl: fetch, sleep, afterId });
        totals.placed += pass.placed;
        totals.notFound += pass.notFound;
        afterId = pass.lastId;
        await writeStatus({
          state: pass.exhausted ? "done" : "running",
          ...totals,
          remaining: pass.remaining,
          updatedAt: new Date().toISOString(),
        });
        if (pass.exhausted || !pass.ran) break;
      }
    } catch (error) {
      console.warn("[geocoding] backfill failed:", getErrorMessage(error));
      await writeStatus({ state: "failed", ...totals, remaining: null, updatedAt: new Date().toISOString() }).catch(() => {});
    }
  })();
  return { started: true };
}
