// apps/web/lib/inference/local-only.ts
//
// "Local-only inference" platform switch — the discoverable, first-class way an
// operator disables cloud AI for the WHOLE platform. When ON, every routed
// inference call (coworker chat, Build Studio ideate/plan/review, evals, …) is
// pinned to the bundled local provider via the existing `residencyPolicy:
// "local_only"` routing constraint. If no local model can satisfy a request,
// routing fails LOUDLY (NoEligibleEndpointsError) rather than silently falling
// back to a configured cloud endpoint.
//
// This is deliberately broader than "disable each cloud provider": leaving one
// provider active is the silent-fallback footgun this switch removes. It
// composes with per-provider status — a disabled provider is still excluded —
// but it does not depend on the operator having disabled them one by one.
//
// Stored in PlatformConfig (key below). Read on the hot inference path, so a
// small TTL cache avoids a DB round-trip per call; the setter invalidates it so
// the toggle takes effect promptly.

import { prisma } from "@dpf/db";

export const LOCAL_ONLY_INFERENCE_CONFIG_KEY = "inference-local-only";

type LocalOnlyConfigValue = { enabled?: boolean };

let cached: { value: boolean; at: number } | null = null;
const TTL_MS = 5_000;

async function readLocalOnlyInference(): Promise<boolean> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: LOCAL_ONLY_INFERENCE_CONFIG_KEY },
  });
  return !!(row?.value && typeof row.value === "object" && (row.value as LocalOnlyConfigValue).enabled === true);
}

/** Clear the in-memory cache (used by the setter and by tests). */
export function invalidateLocalOnlyInferenceCache(): void {
  cached = null;
}

/**
 * True when local-only inference is enabled. Defaults to false (cloud allowed).
 * Never throws — a DB error degrades to the permissive default so inference is
 * not bricked by a config-read failure.
 */
export async function getLocalOnlyInference(now: number = Date.now()): Promise<boolean> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const value = await readLocalOnlyInference();
    cached = { value, at: now };
    return value;
  } catch (err) {
    console.error("[local-only] failed to read inference-local-only config:", err);
    return false;
  }
}

/**
 * Read the sovereignty switch without the hot-path cache. Provider workers use
 * this fail-closed boundary immediately before an external async POST.
 */
export async function getLocalOnlyInferenceFresh(now: number = Date.now()): Promise<boolean> {
  const value = await readLocalOnlyInference();
  cached = { value, at: now };
  return value;
}

/** Persist the local-only inference switch and invalidate the read cache. */
export async function setLocalOnlyInference(enabled: boolean): Promise<void> {
  await prisma.platformConfig.upsert({
    where: { key: LOCAL_ONLY_INFERENCE_CONFIG_KEY },
    update: { value: { enabled } },
    create: { key: LOCAL_ONLY_INFERENCE_CONFIG_KEY, value: { enabled } },
  });
  invalidateLocalOnlyInferenceCache();
}
