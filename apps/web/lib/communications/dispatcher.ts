import type {
  CommunicationAdapter,
  CommunicationDeliveryResult,
  SendCommunicationInput,
} from "./channel-types";

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
        return {
          channel: input.channel,
          status: "failed",
          errorCode: "adapter_not_registered",
          errorMessage: `No communication adapter is registered for ${input.channel}.`,
        };
      }

      try {
        return await adapter.send(input);
      } catch (error) {
        return {
          channel: input.channel,
          status: "failed",
          errorCode: "adapter_error",
          errorMessage: error instanceof Error ? error.message : "Unknown adapter error.",
        };
      }
    },
  };
}
