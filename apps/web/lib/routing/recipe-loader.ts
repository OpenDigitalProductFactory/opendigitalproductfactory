import { prisma } from "@dpf/db";
import type { RecipeRow, RoleRoutingRecipe } from "./recipe-types";
import {
  getPattern,
  extractRoleRecipes,
} from "../deliberation/registry";

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

/**
 * Load a per-role routing preference for a deliberation branch. Reads from
 * the pattern's providerStrategyHints.rolesRecipes JSON — no new DB tables.
 * Returns null when the pattern or the role has no explicit recipe; callers
 * should then fall back to the normal task-router defaults.
 */
export async function loadRoleRecipe(
  patternSlug: string,
  roleId: string,
): Promise<RoleRoutingRecipe | null> {
  const pattern = await getPattern(patternSlug);
  if (!pattern) return null;
  const recipes = extractRoleRecipes(pattern);
  return recipes.get(roleId) ?? null;
}
