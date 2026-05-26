import "server-only";

import { prisma } from "@dpf/db";
import {
  buildPipelineInspectorView,
  type PipelineInspectorView,
} from "./pipeline-inspector";

export async function getPipelineInspectorView(
  opportunityId: string | null | undefined,
): Promise<PipelineInspectorView | null> {
  if (!opportunityId) return null;

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      account: { select: { id: true, name: true } },
      contact: { select: { email: true, firstName: true, lastName: true } },
      activities: {
        orderBy: { createdAt: "desc" },
        select: { id: true, type: true, subject: true, body: true, createdAt: true },
      },
      quotes: {
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          quoteNumber: true,
          status: true,
          totalAmount: true,
          currency: true,
          sentAt: true,
          acceptedAt: true,
        },
      },
    },
  });

  if (!opportunity) return null;

  const engagement = opportunity.engagementId
    ? await prisma.engagement.findUnique({
        where: { id: opportunity.engagementId },
        select: {
          id: true,
          title: true,
          status: true,
          source: true,
          sourceRefId: true,
        },
      })
    : null;

  return buildPipelineInspectorView({
    opportunity: {
      id: opportunity.id,
      opportunityId: opportunity.opportunityId,
      title: opportunity.title,
      stage: opportunity.stage,
      isDormant: opportunity.isDormant,
      probability: opportunity.probability,
      expectedValue: opportunity.expectedValue,
      currency: opportunity.currency,
      expectedClose: opportunity.expectedClose,
      stageChangedAt: opportunity.stageChangedAt,
      notes: opportunity.notes,
      account: opportunity.account,
      contact: opportunity.contact,
      engagement,
      quotes: opportunity.quotes,
      activities: opportunity.activities,
    },
  });
}
