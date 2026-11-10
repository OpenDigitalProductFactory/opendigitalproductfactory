"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { requireCapability, requireCapabilityContext } from "./shared/guards";
import { invalidateRoutingLoaderCache } from "@/lib/routing/loader";
import { clientAddressKey } from "@/lib/security/client-address";
import { getOperatorProviderPause, pauseOperatorProvider, resumeOperatorProvider, RecentOperatorResumeError, type ClientProvenance, type PauseDuration } from "@/lib/inference/provider-operator-pause";

export async function getProviderPause(providerId: string): Promise<{ resumeAt: string | null } | null> {
  await requireCapability("view_platform");
  const pause = await getOperatorProviderPause(providerId);
  return pause ? { resumeAt: pause.resumeAt } : null;
}

/** BI-1C36C88A: the browser behind a pause or resume, recorded on the audit row.
 * The session cookie is hashed so the audit never holds a usable credential. */
async function requestProvenance(email: string | null): Promise<ClientProvenance> {
  const [requestHeaders, jar] = await Promise.all([headers(), cookies()]);
  const sessionCookie = jar.getAll().find(cookie => cookie.name.includes("session-token"))?.value;
  return {
    userAgent: requestHeaders.get("user-agent")?.slice(0, 300) ?? null,
    clientIp: clientAddressKey(requestHeaders),
    sessionFingerprint: sessionCookie ? createHash("sha256").update(sessionCookie).digest("hex").slice(0, 16) : null,
    email,
  };
}

export async function pauseProvider(providerId: string, reason: string, duration?: PauseDuration, overrideRecentResume = false) {
  const { userId, email } = await requireCapabilityContext("manage_provider_connections");
  const provenance = { ...await requestProvenance(email), reason };
  try {
    const result = await pauseOperatorProvider({ providerId, actorId: userId, duration, provenance, overrideRecentResume });
    invalidateRoutingLoaderCache();
    return { resumeAt: result.resumeAt, warning: result.deliveryPending ? "Paused now. Automatic resume may be delayed." : null, recentResume: null };
  } catch (error) {
    // Returned, not thrown: the control offers the explicit override.
    if (error instanceof RecentOperatorResumeError) return { resumeAt: null, warning: error.message, recentResume: { resumedBy: error.resumedBy, resumedAt: error.resumedAt } };
    throw error;
  }
}

export async function resumeProvider(providerId: string) {
  const { userId, email } = await requireCapabilityContext("manage_provider_connections");
  const result = await resumeOperatorProvider({ providerId, actorId: userId, provenance: await requestProvenance(email) });
  invalidateRoutingLoaderCache();
  return result;
}
