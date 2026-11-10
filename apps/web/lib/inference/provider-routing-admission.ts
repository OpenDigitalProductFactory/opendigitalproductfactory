import { prisma } from "@dpf/db";
import { InferenceError } from "@/lib/routing/inference-error";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { resolveRuntimeConnectionStatus } from "@/lib/routing/provider-suitability/onboarding-recommendation";

/** A routing hold is retryable, not evidence of a failed provider connection. */
export class ProviderRoutingDeferredError extends InferenceError {
  readonly reason: string;
  constructor(providerId: string, local: boolean, connectionStatus?: string, eligibilityFailure?: { cause: unknown }) {
    const unavailableReason = "Provider routing eligibility could not be verified. Retry when routing state is available.";
    super(
      eligibilityFailure ? unavailableReason : local ? "Local provider is not enabled for routing" : "Provider account is not enabled for routing",
      eligibilityFailure ? "transient" : "provider_error",
      providerId,
    );
    this.name = "ProviderRoutingDeferredError";
    this.reason = eligibilityFailure ? unavailableReason : connectionStatus === "paused"
      ? "Provider routing is paused by an operator. Resume the provider before retrying."
      : "Provider routing is disabled or not configured. Enable the provider before retrying.";
    if (eligibilityFailure) this.cause = eligibilityFailure.cause;
  }
}

/** Fresh read immediately before inference; never cache operator intent. Does not reserve host capacity. */
export async function readEnabledRoutingProvider(providerId: string) {
  if (!isLocalProviderId(providerId)) {
    const [connection, lifecycle] = await Promise.all([
      prisma.aiProviderConnection.findUnique({
        where: { connectionId: `provider-default-${providerId}` }, select: { status: true },
      }),
      prisma.modelProvider.findUnique({ where: { providerId }, select: { status: true } }),
    ]);
    // Legacy direct callers can predate the default account. An existing account
    // and provider lifecycle both remain authoritative after admission. Resuming
    // an operator pause must not clear an independent automatic provider hold.
    const effectiveStatus = lifecycle
      ? connection ? resolveRuntimeConnectionStatus(lifecycle.status, connection.status) : lifecycle.status
      : connection?.status;
    if ((connection || lifecycle) && !["active", "degraded"].includes(effectiveStatus ?? "")) {
      throw new ProviderRoutingDeferredError(providerId, false, connection?.status);
    }
    return null;
  }
  const [provider, connection] = await Promise.all([
    prisma.modelProvider.findUnique({ where: { providerId } }),
    prisma.aiProviderConnection.findUnique({
      where: { connectionId: `provider-default-${providerId}` },
      select: { status: true },
    }),
  ]);
  if (!provider || !["active", "degraded"].includes(provider.status)
    || !connection || !["active", "degraded"].includes(connection.status)) {
    throw new ProviderRoutingDeferredError(providerId, true, connection?.status);
  }
  return provider;
}
