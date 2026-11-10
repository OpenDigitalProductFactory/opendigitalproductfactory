/** Complete a serving inventory through one lifecycle, regardless of transport. */
export async function persistDiscoveredInventory(
  providerId: string,
  authMethod: string,
  models: Array<{ modelId: string; rawMetadata: Record<string, unknown> }>,
): Promise<{ discovered: number; newCount: number; modelIds?: string[]; error?: string }> {
  if (models.length === 0) return { discovered: 0, newCount: 0, error: "Provider returned no models; previous inventory retained" };
  const { upsertDiscoveredModels, reconcileDiscoveredModelPresence, readmitListedModels } = await import("./ai-provider-internals");
  const modelIds = [...new Set(models.map((model) => model.modelId))];
  const newCount = await upsertDiscoveredModels(providerId, models);
  await reconcileDiscoveredModelPresence(providerId, new Set(modelIds));
  await readmitListedModels(providerId, authMethod, modelIds);
  return { discovered: modelIds.length, newCount, modelIds };
}
