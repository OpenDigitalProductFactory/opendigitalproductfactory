export const MODEL_PROFILE_SEED_GENERATED_BY = "system:seed";

export type ModelProfileSeedRecord = Record<string, unknown> & {
  providerId?: unknown;
  modelId?: unknown;
  generatedBy?: unknown;
};

export function toModelProfileSeedCreateData(profile: ModelProfileSeedRecord): Record<string, unknown> {
  const { providerId, modelId, generatedBy, ...rest } = profile;
  if (typeof providerId !== "string" || providerId.length === 0) {
    throw new Error("model profile seed is missing providerId");
  }
  if (typeof modelId !== "string" || modelId.length === 0) {
    throw new Error("model profile seed is missing modelId");
  }
  return {
    providerId,
    modelId,
    ...rest,
    generatedBy: typeof generatedBy === "string" && generatedBy.length > 0
      ? generatedBy
      : MODEL_PROFILE_SEED_GENERATED_BY,
  };
}
