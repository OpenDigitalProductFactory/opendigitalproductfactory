import type {
  CommunicationAdapter,
  CommunicationDeliveryResult,
  SendCommunicationInput,
} from "./channel-types";
import { recordDeliveryAttempt } from "./delivery-evidence";

export interface CommunicationDispatcher {
  send(input: SendCommunicationInput): Promise<CommunicationDeliveryResult>;
}

export function createCommunicationDispatcher(
  adapters: readonly CommunicationAdapter[],
): CommunicationDispatcher {
  const byChannel = new Map(adapters.map((adapter) => [adapter.channel, adapter]));

  return {
    async send(input) {
      const adapter = byChannel.get(input.channel);
      if (!adapter) {
        return recordDispatchResult(input, {
          channel: input.channel,
          status: "failed",
          errorCode: "adapter_not_registered",
          errorMessage: `No communication adapter is registered for ${input.channel}.`,
        });
      }

      try {
        return recordDispatchResult(input, await adapter.send(input));
      } catch (error) {
        return recordDispatchResult(input, {
          channel: input.channel,
          status: "failed",
          errorCode: "adapter_error",
          errorMessage: error instanceof Error ? error.message : "Unknown adapter error.",
        });
      }
    },
  };
}

async function recordDispatchResult(
  input: SendCommunicationInput,
  result: CommunicationDeliveryResult,
): Promise<CommunicationDeliveryResult> {
  await recordDeliveryAttempt({
    channel: input.channel,
    target: input.target,
    urgency: input.urgency,
    result,
  });

  return result;
}
