import "server-only";

import { prisma } from "@dpf/db";
import { cache } from "react";
import { auth } from "@/lib/auth";
import {
  loadProductOperatingContext,
  type ProductOperatingContextQueryClient,
  type ProductOperatingContextQueryProfile,
} from "./product-operating-context-query";
import {
  ProductRouteAuthorityAmbiguousError,
  resolveProductRouteAuthority,
  type ProductRouteAuthorityDb,
  type ProductRouteAuthority,
} from "./product-route-authority";
import type {
  ProductOperatingContext,
  ProductOperatingScope,
} from "./product-operating-context";

export class ProductManagementAccessError extends Error {
  constructor() {
    super("The current principal cannot access product management.");
    this.name = "ProductManagementAccessError";
  }
}

export class ProductManagementOrganizationNotFoundError extends Error {
  constructor() {
    super("No organization is configured for product management.");
    this.name = "ProductManagementOrganizationNotFoundError";
  }
}

export const requireCurrentProductManagementOrganization = cache(
  async (): Promise<{ id: string; name: string }> => {
    const session = await auth();
    if (!session?.user || session.user.type === "customer") {
      throw new ProductManagementAccessError();
    }
    const organization = await prisma.organization.findFirst({
      select: { id: true, name: true },
    });
    if (!organization) {
      throw new ProductManagementOrganizationNotFoundError();
    }
    return organization;
  },
);

export const loadCurrentProductOperatingContextByKey = cache(
  async (
    kind: ProductOperatingScope["kind"],
    id: string,
    profile: ProductOperatingContextQueryProfile = "full",
  ): Promise<ProductOperatingContext> => {
    const organization = await requireCurrentProductManagementOrganization();
    return loadProductOperatingContext({
      db: prisma as unknown as ProductOperatingContextQueryClient,
      organizationId: organization.id,
      scope: { kind, id } as ProductOperatingScope,
      profile,
      authorize: async ({ organizationId }) => {
        if (organizationId !== organization.id) {
          throw new ProductManagementAccessError();
        }
      },
    });
  },
);

export function loadCurrentProductOperatingContext(
  scope: ProductOperatingScope,
  profile: ProductOperatingContextQueryProfile = "full",
): Promise<ProductOperatingContext> {
  return loadCurrentProductOperatingContextByKey(scope.kind, scope.id, profile);
}

export const resolveCurrentProductRouteAuthority = cache(
  async (id: string): Promise<ProductRouteAuthority | null> => {
    const organization = await requireCurrentProductManagementOrganization();
    try {
      return await resolveProductRouteAuthority({
        db: prisma as unknown as ProductRouteAuthorityDb,
        id,
        organizationId: organization.id,
      });
    } catch (error) {
      if (error instanceof ProductRouteAuthorityAmbiguousError) {
        return null;
      }
      throw error;
    }
  },
);
