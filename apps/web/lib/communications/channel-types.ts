export const COMMUNICATION_CHANNELS = [
  "in-app",
  "push",
  "email",
  "teams",
  "slack",
  "whatsapp",
  "telegram",
  "webhook",
] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_URGENCIES = [
  "routine",
  "priority",
  "urgent",
  "emergency",
] as const;

export type CommunicationUrgency = (typeof COMMUNICATION_URGENCIES)[number];

export const COMMUNICATION_DELIVERY_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "expired",
] as const;

export type CommunicationDeliveryStatus = (typeof COMMUNICATION_DELIVERY_STATUSES)[number];

export type CommunicationDirection = "outbound" | "inbound" | "interactive";

export interface CommunicationTarget {
  targetType: "notification" | "work-item" | "agent-thread" | "direct-test";
  targetId: string;
  recipientUserId?: string;
  recipientPrincipalId?: string;
}

export interface SendCommunicationInput {
  channel: CommunicationChannel;
  target: CommunicationTarget;
  title: string;
  body: string;
  urgency: CommunicationUrgency;
  deepLink?: string;
  metadata?: Record<string, unknown>;
}

export interface CommunicationDeliveryResult {
  channel: CommunicationChannel;
  status: CommunicationDeliveryStatus;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface CommunicationAdapter {
  key: string;
  channel: CommunicationChannel;
  capabilities: {
    outbound: boolean;
    inbound: boolean;
    interactive: boolean;
    deliveryReceipts: boolean;
    readReceipts: boolean;
    templatesRequired: boolean;
  };
  send(input: SendCommunicationInput): Promise<CommunicationDeliveryResult>;
}

const CHANNEL_ALIASES: Record<string, CommunicationChannel> = {
  in_app: "in-app",
  inapp: "in-app",
  "in app": "in-app",
  mobile: "push",
  "mobile push": "push",
  "microsoft teams": "teams",
  ms_teams: "teams",
  whatsapp_business: "whatsapp",
  "whatsapp business": "whatsapp",
};

export function isCommunicationChannel(value: string): value is CommunicationChannel {
  return (COMMUNICATION_CHANNELS as readonly string[]).includes(value);
}

export function normalizeCommunicationChannel(value: string): CommunicationChannel | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  const aliased = CHANNEL_ALIASES[normalized] ?? CHANNEL_ALIASES[normalized.replace(/-/g, "_")];
  if (aliased) return aliased;
  return isCommunicationChannel(normalized) ? normalized : null;
}
