import "server-only";

import type { DispatcherAction } from "@dpf/validators";

import { buildFieldDispatchNotificationProposal } from "./field-dispatch-runtime";
import { resolveUserAwareProactivityPlan } from "./proactivity-resolver.server";
import type { ProactivityPlan, ProactivityResolverInput } from "./proactivity-types";

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
