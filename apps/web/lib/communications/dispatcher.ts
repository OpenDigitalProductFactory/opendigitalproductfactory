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
  options: { recordDelivery?: typeof recordDeliveryAttempt } = {},
): CommunicationDispatcher {
  const byChannel = new Map(adapters.map((adapter) => [adapter.channel, adapter]));
  const record = options.recordDelivery ?? recordDeliveryAttempt;

  return {
    async send(input) {
      const adapter = byChannel.get(input.channel);
      if (!adapter) {
        return recordDispatchResult(input, {
          channel: input.channel,
          status: "failed",
          errorCode: "adapter_not_registered",
          errorMessage: `No communication adapter is registered for ${input.channel}.`,
        }, record);
      }

      try {
        return recordDispatchResult(input, await adapter.send(input), record);
      } catch (error) {
        return recordDispatchResult(input, {
          channel: input.channel,
          status: "failed",
          errorCode: "adapter_error",
          errorMessage: error instanceof Error ? error.message : "Unknown adapter error.",
        }, record);
      }
    },
  };
}

async function recordDispatchResult(
  input: SendCommunicationInput,
  result: CommunicationDeliveryResult,
  record: typeof recordDeliveryAttempt,
): Promise<CommunicationDeliveryResult> {
  await record({
    channel: input.channel,
    target: input.target,
    urgency: input.urgency,
    result,
  });

  return result;
}
