import { prisma } from "@dpf/db";
import type { RecipeRow } from "./recipe-types";

export async function loadChampionRecipe(
  providerId: string,
  modelId: string,
  contractFamily: string,
): Promise<RecipeRow | null> {
  const recipe = await prisma.executionRecipe.findFirst({
    where: {
      providerId,
      modelId,
      contractFamily,
      status: "champion",
    },
    orderBy: { version: "desc" },
  });
  return recipe as RecipeRow | null;
}
