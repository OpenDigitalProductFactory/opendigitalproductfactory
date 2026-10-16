"use server";

import { prisma, setProviderStatusWithDefaultConnection } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { invalidateRoutingLoaderCache } from "@/lib/routing/loader";
import { resolveRuntimeConnectionStatus } from "@/lib/routing/provider-suitability/onboarding-recommendation";

export async function toggleProviderStatus(
  providerId: string,
): Promise<{ status: string; warning: string | null }> {
  const { userId } = await requireCapability("manage_provider_connections");

  const provider = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: { status: true, endpointType: true },
  });
  if (!provider) throw new Error("Provider not found");

  const connection = provider.endpointType === "transcription" ? null
    : await prisma.aiProviderConnection.findUnique({ where: { connectionId: `provider-default-${providerId}` }, select: { status: true } });
  const effectiveStatus = connection?.status ? resolveRuntimeConnectionStatus(provider.status, connection.status) : provider.status;
  const newStatus = effectiveStatus === "active" || effectiveStatus === "degraded" ? "inactive" : "active";
  if (newStatus === "active") {
    if (connection?.status === "paused") {
      const { resumeOperatorProvider } = await import("@/lib/inference/provider-operator-pause");
      const result = await resumeOperatorProvider({ providerId, actorId: userId });
      if (result.outcome !== "resumed") throw new Error("The pause changed. Refresh before resuming.");
      invalidateRoutingLoaderCache();
      return { status: result.status ?? "inactive", warning: ["active", "degraded"].includes(result.status ?? "") ? null : "Pause ended. The provider is still unavailable." };
    }
  }
  if (provider.endpointType === "transcription") {
    // Transcription has no canonical model-routing connection.
    await prisma.modelProvider.update({ where: { providerId }, data: { status: newStatus } });
  } else {
    await setProviderStatusWithDefaultConnection(prisma, { providerId, status: newStatus });
  }
  invalidateRoutingLoaderCache();

  // EP-AGENT-CAP-002: Warn if activated provider has no models with active capabilities
  let warning: string | null = null;
  if (newStatus === "active") {
    const activeModels = await prisma.modelProfile.findMany({
      where: { providerId, modelStatus: { in: ["active", "degraded"] } },
      select: { capabilities: true },
    });

    const hasActiveCapability = activeModels.some((m) => {
      const caps = m.capabilities as Record<string, unknown> | null;
      return (
        caps?.toolUse === true ||
        caps?.imageInput === true ||
        caps?.pdfInput === true ||
        caps?.codeExecution === true
      );
    });

    if (!hasActiveCapability) {
      warning =
        "This provider's models have no active capabilities (toolUse, imageInput, pdfInput, codeExecution). " +
        "It will not be eligible for routing to any registered coworker. " +
        "It may still be used for passive chat workflows.";
    }
  }

  return { status: newStatus, warning };
}
