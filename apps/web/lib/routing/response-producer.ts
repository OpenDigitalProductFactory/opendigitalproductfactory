import { createHash } from "node:crypto";

export type ResponseProducer = Readonly<{
  attemptId: string;
  providerId: string;
  modelId: string;
  contentDigest: string;
}>;

/** Later validation hashes exact stored bytes, without normalization. */
export const responseContentDigest = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

export function createResponseProducer(input: {
  attemptId: string;
  providerId: string;
  modelId: string;
  content: string;
}): ResponseProducer | undefined {
  if (!input.content.trim()) return undefined;
  return {
    attemptId: input.attemptId,
    providerId: input.providerId,
    modelId: input.modelId,
    contentDigest: responseContentDigest(input.content.trim()),
  };
}

/** Only deterministic edge trimming may preserve the initial producer. */
export function preserveResponseProducer(
  producer: ResponseProducer | undefined,
  content: string,
  identity: { providerId: string; modelId: string },
): ResponseProducer | undefined {
  return producer
    && producer.providerId === identity.providerId
    && producer.modelId === identity.modelId
    && producer.contentDigest === responseContentDigest(content.trim())
    ? producer
    : undefined;
}

export const RESPONSE_FEEDBACK_BINDING_SELECT = {
  responseAttemptId: true,
  responseContentDigest: true,
  responseScope: true,
  responseWorkroomId: true,
} as const;
