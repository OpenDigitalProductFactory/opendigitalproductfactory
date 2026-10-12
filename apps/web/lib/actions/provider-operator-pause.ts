"use server";

import { requireCapability } from "./shared/guards";
import { invalidateRoutingLoaderCache } from "@/lib/routing/loader";
import { getLocalProviderPause, pauseLocalProvider, resumeLocalProvider, type PauseDuration } from "@/lib/inference/provider-operator-pause";

export async function getProviderPause(providerId: string): Promise<{ resumeAt: string | null } | null> {
  await requireCapability("view_platform");
  const pause = await getLocalProviderPause(providerId);
  return pause ? { resumeAt: pause.resumeAt } : null;
}

export async function pauseProvider(providerId: string, duration?: PauseDuration) {
  const { userId } = await requireCapability("manage_provider_connections");
  const result = await pauseLocalProvider({ providerId, actorId: userId, duration });
  invalidateRoutingLoaderCache();
  return { resumeAt: result.resumeAt, warning: result.deliveryPending ? "Paused now. Automatic resume may be delayed." : null };
}

export async function resumeProvider(providerId: string) {
  const { userId } = await requireCapability("manage_provider_connections");
  const result = await resumeLocalProvider({ providerId, actorId: userId });
  invalidateRoutingLoaderCache();
  return result;
}
