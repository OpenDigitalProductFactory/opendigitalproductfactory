import { prisma, type Prisma } from "@dpf/db";

import type {
  CommunicationChannel,
  CommunicationDeliveryResult,
  CommunicationTarget,
  CommunicationUrgency,
} from "./channel-types";

export interface RecordDeliveryAttemptInput {
  channel: CommunicationChannel;
  target: CommunicationTarget;
  urgency: CommunicationUrgency;
  result: CommunicationDeliveryResult;
}

export async function recordDeliveryAttempt(
  input: RecordDeliveryAttemptInput,
  db: { communicationDeliveryAttempt: Pick<Prisma.TransactionClient["communicationDeliveryAttempt"], "create"> } = prisma,
): Promise<{ attemptId: string }> {
  return db.communicationDeliveryAttempt.create({
    data: {
      channelType: input.channel,
      targetType: input.target.targetType,
      targetId: input.target.targetId,
      providerMessageId: input.result.providerMessageId ?? null,
      status: input.result.status,
      urgency: input.urgency,
      errorCode: input.result.errorCode ?? null,
      errorMessage: input.result.errorMessage ?? null,
      sentAt: input.result.status === "sent" ? new Date() : null,
    },
    select: { attemptId: true },
  });
}
