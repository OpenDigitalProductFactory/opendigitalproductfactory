import type { CommunicationChannel, CommunicationUrgency } from "./channel-types";

export interface CommunicationBindingSummary {
  channel: CommunicationChannel;
  verified: boolean;
  active: boolean;
  allowedUrgencies: readonly CommunicationUrgency[];
}

export interface SelectCommunicationPlanInput {
  urgency: CommunicationUrgency;
  bindings: readonly CommunicationBindingSummary[];
  now: Date;
}

export interface CommunicationPlan {
  channels: CommunicationChannel[];
  fanOut: boolean;
}

const ROUTINE_ORDER: CommunicationChannel[] = ["in-app", "push", "email"];
const PRIORITY_ORDER: CommunicationChannel[] = [
  "in-app",
  "push",
  "teams",
  "slack",
  "whatsapp",
  "email",
];
const URGENT_ORDER: CommunicationChannel[] = [
  "in-app",
  "push",
  "teams",
  "slack",
  "whatsapp",
  "email",
];
const EMERGENCY_ORDER: CommunicationChannel[] = [
  "in-app",
  "push",
  "teams",
  "slack",
  "whatsapp",
  "email",
  "telegram",
  "webhook",
];

export function selectCommunicationPlan(input: SelectCommunicationPlanInput): CommunicationPlan {
  const order = input.urgency === "routine"
    ? ROUTINE_ORDER
    : input.urgency === "priority"
      ? PRIORITY_ORDER
      : input.urgency === "urgent"
        ? URGENT_ORDER
        : EMERGENCY_ORDER;

  const eligible = input.bindings.filter(
    (binding) =>
      binding.active &&
      binding.verified &&
      binding.allowedUrgencies.includes(input.urgency),
  );

  const channels = order.filter((channel) =>
    eligible.some((binding) => binding.channel === channel),
  );

  return {
    channels,
    fanOut: input.urgency === "emergency",
  };
}
