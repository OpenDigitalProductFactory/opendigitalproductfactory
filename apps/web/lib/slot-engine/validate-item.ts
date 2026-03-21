import { prisma } from "@dpf/db";

/**
 * Validates that a storefrontItem with the given itemId belongs to the
 * organisation identified by `slug` and that the storefront is published.
 */
export async function validateItemOwnership(
  slug: string,
  itemId: string
): Promise<boolean> {
  const item = await prisma.storefrontItem.findFirst({
    where: {
      itemId,
      isActive: true,
      storefront: { organization: { slug }, isPublished: true },
    },
    select: { id: true },
  });
  return item !== null;
}
