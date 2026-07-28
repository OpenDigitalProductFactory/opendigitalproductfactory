import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: vi.fn() },
    catalogItem: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/products/catalog-builder-commands", () => ({
  executeCatalogBuilderCommand: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { executeCatalogBuilderCommand } from "@/lib/products/catalog-builder-commands";
import { PATCH } from "./route";

function request(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe("Catalog Builder route adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an authenticated admin before reading catalog state", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await PATCH(request({ operation: "replace-bundle" }), {
      params: Promise.resolve({ catalogItemId: "catalog-row" }),
    });

    expect(response.status).toBe(401);
    expect(prisma.storefrontConfig.findFirst).not.toHaveBeenCalled();
  });

  it("scopes the item to the configured organization and delegates one command", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin", type: "admin" },
    } as never);
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      organizationId: "org-one",
    } as never);
    const catalogItem = {
      id: "catalog-row",
      organizationId: "org-one",
      priceCurrency: "USD",
    };
    vi.mocked(prisma.catalogItem.findFirst).mockResolvedValue(
      catalogItem as never,
    );
    vi.mocked(executeCatalogBuilderCommand).mockResolvedValue(
      "Purchase route saved",
    );
    const command = {
      operation: "set-fulfillment-route",
      fulfillmentRoute: "direct-purchase",
    };

    const response = await PATCH(request(command), {
      params: Promise.resolve({ catalogItemId: "catalog-row" }),
    });

    expect(prisma.catalogItem.findFirst).toHaveBeenCalledWith({
      where: { id: "catalog-row", organizationId: "org-one" },
      select: { id: true, organizationId: true, priceCurrency: true },
    });
    expect(executeCatalogBuilderCommand).toHaveBeenCalledWith({
      db: prisma,
      catalogItem,
      command,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Purchase route saved",
    });
  });
});
