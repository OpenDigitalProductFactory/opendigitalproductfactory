import type { DispatcherAction, DispatchNotificationIntent } from "@dpf/validators";

import { resolveFieldDispatchNotificationProactivity } from "./field-dispatch-proactivity";
import type { ProactivityPlan, ProactivityResolverInput } from "./proactivity-types";

export const FIELD_DISPATCH_CUSTOMER_NOTIFICATION_ACTION = "field_dispatch_customer_notification" as const;

export type FieldDispatchNotificationProposalParameters = {
  kind: "field-dispatch-customer-notification";
  jobId: string;
  intent: DispatchNotificationIntent;
  recommendedAction: string;
  whyNow: string;
  proactivity: ProactivityPlan;
};

export type FieldDispatchNotificationProposalDraft = {
  actionType: typeof FIELD_DISPATCH_CUSTOMER_NOTIFICATION_ACTION;
  parameters: FieldDispatchNotificationProposalParameters;
};

export type BuildFieldDispatchNotificationProposalsInput = {
  actions: DispatcherAction[];
  archetype?: ProactivityResolverInput["archetype"];
  agentId?: string | null;
  routeContext?: string | null;
};

export function buildFieldDispatchNotificationProposals(
  input: BuildFieldDispatchNotificationProposalsInput,
): FieldDispatchNotificationProposalDraft[] {
  return input.actions.flatMap((action) => {
    if (action.kind !== "notify") return [];
    const proactivity = resolveFieldDispatchNotificationProactivity({
      intent: action.intent,
      archetype: input.archetype,
      agentId: input.agentId,
      routeContext: input.routeContext,
    });

    return [
      {
        actionType: FIELD_DISPATCH_CUSTOMER_NOTIFICATION_ACTION,
        parameters: {
          kind: "field-dispatch-customer-notification",
          jobId: action.jobId,
          intent: action.intent,
          recommendedAction: recommendedNotificationAction(action.intent),
          whyNow: proactivity.explanation,
          proactivity,
        },
      },
    ];
  });
}

function recommendedNotificationAction(intent: DispatchNotificationIntent): string {
  if (intent.event === "running-late") return "Send running-late customer update";
  if (intent.event === "on-my-way") return "Send on-my-way customer update";
  if (intent.event === "confirm") return "Send appointment confirmation";
  return "Send completion update";
}
