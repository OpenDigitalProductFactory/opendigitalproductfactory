"use server";

import { prisma } from "@dpf/db";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { resolveAgentForRouteWithPrompts } from "@/lib/tak/agent-routing-server";
import { requestCoworker } from "@/lib/tak/coworker-collaboration";
import {
  formatProviderReviewObjective,
  validateProviderReviewPacket,
  type ProviderReviewPacket,
} from "@/lib/routing/provider-suitability/provider-review-packet";
import { PROVIDER_COMPLIANCE_COLLABORATION_SUMMARY } from "@/lib/routing/provider-suitability/provider-compliance-advisory";
import { requireUser } from "./shared/guards";

const ALLOWED_ROUTES = new Set(["/setup", "/workspace"]);
const ALLOWED_CALLERS = new Set([
  "coo",
  "AGT-ORCH-000",
  "onboarding-coo",
  "AGT-WS-ONBOARD",
]);

export type ProviderComplianceConsultationResult =
  | { success: true; childThreadId: string; taskRunId: string }
  | { success: false; error: string };

/**
 * Deterministically start the bounded provider-compliance consultation after
 * the owner uses the explicit COO action. The browser cannot select the target,
 * caller, objective, or evidence scope: all four are derived and revalidated
 * here before the existing governed requestCoworker path is invoked.
 */
export async function startProviderComplianceConsultation(input: {
  parentThreadId: string;
  routeContext: string;
  packet: ProviderReviewPacket;
}): Promise<ProviderComplianceConsultationResult> {
  const validation = validateProviderReviewPacket(input.packet);
  if (!validation.success) return validation;
  if (!ALLOWED_ROUTES.has(input.routeContext)) {
    return { success: false, error: "provider_consultation_route_not_allowed" };
  }

  const user = await requireUser();
  const parent = await prisma.agentThread.findFirst({
    where: { id: input.parentThreadId, userId: user.id },
    select: { id: true },
  });
  if (!parent) return { success: false, error: "provider_consultation_thread_not_found" };

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  const expectedOrganizationRef = organization?.id ?? "unconfigured-organization";
  if (validation.value.organizationRef !== expectedOrganizationRef) {
    return { success: false, error: "organization_reference_mismatch" };
  }

  const connectionRefs = validation.value.providerConnections;
  if (connectionRefs.length > 0) {
    const rows = await prisma.aiProviderConnection.findMany({
      where: {
        connectionId: { in: connectionRefs.map((connection) => connection.providerConnectionId) },
        OR: organization
          ? [{ organizationId: organization.id }, { organizationId: null }]
          : [{ organizationId: null }],
      },
      select: { connectionId: true, providerId: true },
    });
    const actual = new Set(rows.map((row) => `${row.connectionId}\u0000${row.providerId}`));
    const allReferencesMatch = connectionRefs.every((connection) =>
      actual.has(`${connection.providerConnectionId}\u0000${connection.providerId}`),
    );
    if (!allReferencesMatch) {
      return { success: false, error: "provider_connection_reference_mismatch" };
    }
  }

  const unified = await isUnifiedCoworkerEnabled();
  const caller = await resolveAgentForRouteWithPrompts(
    input.routeContext,
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    unified,
  );
  if (!ALLOWED_CALLERS.has(caller.agentId)) {
    return { success: false, error: "provider_consultation_requires_coo" };
  }

  const ownerRequest = `Please have my COO review our AI provider suitability for ${validation.value.recommendation.workloadClasses.join(", ") || "the configured workloads"}. Use only the minimized compliance packet and keep provider policy unchanged.`;
  await prisma.agentMessage.create({
    data: {
      threadId: parent.id,
      role: "user",
      content: ownerRequest,
      agentId: caller.agentId,
      routeContext: input.routeContext,
    },
  });

  try {
    const result = await requestCoworker(
      {
        parentThreadId: parent.id,
        targetAgent: "AGT-902",
        objective: formatProviderReviewObjective(validation.value),
        tier: 2,
        enteredVia: "handoff",
        callerAgentId: caller.agentId,
        questionPacketSummary: PROVIDER_COMPLIANCE_COLLABORATION_SUMMARY,
        routeContext: input.routeContext,
      },
      user.id,
    );
    return {
      success: true,
      childThreadId: result.childThreadId,
      taskRunId: result.taskRunId,
    };
  } catch {
    await prisma.agentMessage.create({
      data: {
        threadId: parent.id,
        role: "system",
        content: "DPF could not start the compliance consultation. Provider posture was not changed; try again or request qualified review.",
        agentId: caller.agentId,
        routeContext: input.routeContext,
      },
    }).catch(() => undefined);
    return { success: false, error: "provider_consultation_unavailable" };
  }
}
