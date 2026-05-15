import {
  COMMUNICATION_URGENCIES,
  normalizeCommunicationChannel,
  type CommunicationChannel,
  type CommunicationUrgency,
} from "./channel-types";

export interface ChannelBindingInput {
  principalId: string;
  employeeProfileId?: string;
  channelType: string;
  providerKey: string;
  providerAccountId?: string;
  externalSubject: string;
  displayLabel?: string;
  allowedUrgencies: string[];
}

export interface ParsedChannelBinding {
  principalId: string;
  employeeProfileId?: string;
  channelType: CommunicationChannel;
  providerKey: string;
  providerAccountId?: string;
  externalSubject: string;
  displayLabel?: string;
  allowedUrgencies: CommunicationUrgency[];
}

export function parseChannelBindingInput(
  input: ChannelBindingInput,
): { ok: true; value: ParsedChannelBinding } | { ok: false; error: string } {
  const principalId = input.principalId.trim();
  if (!principalId) {
    return { ok: false, error: "Principal is required." };
  }

  const channelType = normalizeCommunicationChannel(input.channelType);
  if (!channelType) {
    return { ok: false, error: `Unsupported channel: ${input.channelType}` };
  }

  const providerKey = input.providerKey.trim();
  if (!providerKey) {
    return { ok: false, error: "Provider key is required." };
  }

  const externalSubject = input.externalSubject.trim();
  if (!externalSubject) {
    return { ok: false, error: "External subject is required." };
  }

  const allowedUrgencies = input.allowedUrgencies.filter(
    (urgency): urgency is CommunicationUrgency =>
      (COMMUNICATION_URGENCIES as readonly string[]).includes(urgency),
  );

  if (allowedUrgencies.length === 0) {
    return { ok: false, error: "At least one valid urgency is required." };
  }

  return {
    ok: true,
    value: {
      principalId,
      employeeProfileId: input.employeeProfileId?.trim() || undefined,
      channelType,
      providerKey,
      providerAccountId: input.providerAccountId?.trim() || undefined,
      externalSubject,
      displayLabel: input.displayLabel?.trim() || undefined,
      allowedUrgencies,
    },
  };
}
