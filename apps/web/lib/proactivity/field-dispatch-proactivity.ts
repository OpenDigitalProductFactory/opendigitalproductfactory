import type { DispatchNotificationIntent } from "@dpf/validators";

import { resolveProactivityPlan } from "./proactivity-resolver";
import type { ProactivityPlan, ProactivityResolverInput } from "./proactivity-types";

export type FieldDispatchNotificationProactivityInput = {
  intent: DispatchNotificationIntent;
  archetype?: ProactivityResolverInput["archetype"];
  agentId?: string | null;
  routeContext?: string | null;
};

export function resolveFieldDispatchNotificationProactivity(
  input: FieldDispatchNotificationProactivityInput,
): ProactivityPlan {
  const isLate = input.intent.event === "running-late";
  const plan = resolveProactivityPlan({
    activityFamily: "field-dispatch-appointment",
    agentId: input.agentId,
    routeContext: input.routeContext,
    archetype: {
      ...input.archetype,
      fieldDispatchRunningLate: input.archetype?.fieldDispatchRunningLate ?? isLate,
    },
  });

  return {
    ...plan,
    evidenceRefs: [
      ...plan.evidenceRefs,
      { kind: "dispatch-event", id: input.intent.event },
      { kind: "dispatch-urgency", id: input.intent.urgency },
    ],
  };
}
