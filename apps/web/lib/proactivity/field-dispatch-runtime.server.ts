import "server-only";

import type { DispatcherAction } from "@dpf/validators";
import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { buildFieldDispatchNotificationProposal } from "./field-dispatch-runtime";
import { resolveUserAwareProactivityPlan } from "./proactivity-resolver.server";
import type { ProactivityPlan, ProactivityResolverInput } from "./proactivity-types";

const FIELD_DISPATCH_ATTENTION_CONTEXT_KEY = "field-dispatch:customer-notifications";
const FIELD_DISPATCH_ATTENTION_TASK_TYPE = "field-dispatch-customer-notification";
const DEFAULT_FIELD_DISPATCH_AGENT_ID = "field-dispatch-coworker";
const DEFAULT_FIELD_DISPATCH_ROUTE_CONTEXT = "/storefront";

export type BuildUserAwareFieldDispatchNotificationProposalsInput = {
  userId: string;
  actions: DispatcherAction[];
  archetype?: ProactivityResolverInput["archetype"];
  agentId?: string | null;
  routeContext?: string | null;
  now?: Date;
};

export async function buildUserAwareFieldDispatchNotificationProposals(
  input: BuildUserAwareFieldDispatchNotificationProposalsInput,
) {
  const proposals = await Promise.all(
    input.actions.map(async (action) => {
      if (action.kind !== "notify") return null;
      const proactivity = await resolveUserAwareProactivityPlan({
        userId: input.userId,
        now: input.now,
        input: {
          activityFamily: "field-dispatch-appointment",
          agentId: input.agentId,
          routeContext: input.routeContext,
          archetype: {
            ...input.archetype,
            fieldDispatchRunningLate: input.archetype?.fieldDispatchRunningLate ?? action.intent.event === "running-late",
          },
        },
      });

      return buildFieldDispatchNotificationProposal({
        jobId: action.jobId,
        intent: action.intent,
        proactivity: withDispatchEvidence(proactivity, action.intent.event, action.intent.urgency),
      });
    }),
  );

  return proposals.filter((proposal) => proposal !== null);
}

export type ProposeUserAwareFieldDispatchNotificationsResult = Array<{
  proposalId: string;
  status: string;
  existing?: true;
}>;

export async function proposeUserAwareFieldDispatchNotifications(
  input: BuildUserAwareFieldDispatchNotificationProposalsInput,
): Promise<ProposeUserAwareFieldDispatchNotificationsResult> {
  const drafts = await buildUserAwareFieldDispatchNotificationProposals(input);
  if (drafts.length === 0) return [];

  const agentId = input.agentId ?? DEFAULT_FIELD_DISPATCH_AGENT_ID;
  const routeContext = input.routeContext ?? DEFAULT_FIELD_DISPATCH_ROUTE_CONTEXT;
  const results: ProposeUserAwareFieldDispatchNotificationsResult = [];
  let threadId: string | null = null;

  for (const draft of drafts) {
    const proposalId = proposalIdForDraft(draft.parameters.jobId, draft.parameters.intent.event);
    const existing = await prisma.agentActionProposal.findUnique({
      where: { proposalId },
      select: { proposalId: true, status: true },
    });
    if (existing) {
      results.push({ proposalId: existing.proposalId, status: existing.status, existing: true });
      continue;
    }

    if (!threadId) {
      const thread = await prisma.agentThread.upsert({
        where: {
          userId_contextKey: {
            userId: input.userId,
            contextKey: FIELD_DISPATCH_ATTENTION_CONTEXT_KEY,
          },
        },
        create: {
          userId: input.userId,
          contextKey: FIELD_DISPATCH_ATTENTION_CONTEXT_KEY,
        },
        update: {},
        select: { id: true },
      });
      threadId = thread.id;
    }

    const message = await prisma.agentMessage.create({
      data: {
        threadId,
        role: "assistant",
        content: messageContentForDraft(draft.parameters.whyNow),
        agentId,
        routeContext,
        taskType: FIELD_DISPATCH_ATTENTION_TASK_TYPE,
      },
      select: { id: true },
    });
    const proposal = await prisma.agentActionProposal.create({
      data: {
        proposalId,
        threadId,
        messageId: message.id,
        agentId,
        actionType: draft.actionType,
        parameters: draft.parameters as unknown as Prisma.InputJsonValue,
        status: "proposed",
      },
      select: { proposalId: true, status: true },
    });
    results.push({ proposalId: proposal.proposalId, status: proposal.status });
  }

  revalidatePath("/workspace");
  revalidatePath("/workspace/inbox");
  revalidatePath(routeContext);
  return results;
}

function withDispatchEvidence(
  plan: ProactivityPlan,
  event: string,
  urgency: string,
): ProactivityPlan {
  return {
    ...plan,
    evidenceRefs: [
      ...plan.evidenceRefs,
      { kind: "dispatch-event", id: event },
      { kind: "dispatch-urgency", id: urgency },
    ],
  };
}

function proposalIdForDraft(jobId: string, event: string): string {
  return `field-dispatch-notification:${jobId}:${event}`;
}

function messageContentForDraft(whyNow: string): string {
  return `A customer update is ready to review. Why now: ${whyNow}`;
}
