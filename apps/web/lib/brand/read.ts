import { prisma } from "@dpf/db";
import { isBrandDesignSystem, type BrandDesignSystem } from "./types";

export type BrandContext = {
  structured: BrandDesignSystem | null;
  legacyMarkdown: string | null;
  source: "organization" | "storefront" | "none";
};

export async function readBrandContext(args: {
  organizationId?: string | null;
  storefrontId?: string | null;
}): Promise<BrandContext> {
  if (args.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: args.organizationId },
      select: {
        designSystem: true,
        storefrontConfig: { select: { id: true, designSystem: true } },
      },
    });
    if (org?.designSystem && isBrandDesignSystem(org.designSystem)) {
      return { structured: org.designSystem, legacyMarkdown: null, source: "organization" };
    }
    if (org?.storefrontConfig?.designSystem) {
      const raw = org.storefrontConfig.designSystem;
      const legacy = typeof raw === "string" ? raw : JSON.stringify(raw);
      return { structured: null, legacyMarkdown: legacy, source: "storefront" };
    }
    return { structured: null, legacyMarkdown: null, source: "none" };
  }

  if (args.storefrontId) {
    const storefront = await prisma.storefrontConfig.findUnique({
      where: { id: args.storefrontId },
      select: { designSystem: true, organizationId: true },
    });
    if (storefront?.organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: storefront.organizationId },
        select: { designSystem: true },
      });
      if (org?.designSystem && isBrandDesignSystem(org.designSystem)) {
        return { structured: org.designSystem, legacyMarkdown: null, source: "organization" };
      }
    }
    if (storefront?.designSystem) {
      const raw = storefront.designSystem;
      const legacy = typeof raw === "string" ? raw : JSON.stringify(raw);
      return { structured: null, legacyMarkdown: legacy, source: "storefront" };
    }
    return { structured: null, legacyMarkdown: null, source: "none" };
  }

  const anyOrg = await prisma.organization.findFirst({
    select: { designSystem: true },
  });
  if (anyOrg?.designSystem && isBrandDesignSystem(anyOrg.designSystem)) {
    return { structured: anyOrg.designSystem, legacyMarkdown: null, source: "organization" };
  }

  const anyStorefront = await prisma.storefrontConfig.findFirst({
    select: { designSystem: true },
  });
  if (anyStorefront?.designSystem) {
    const raw = anyStorefront.designSystem;
    const legacy = typeof raw === "string" ? raw : JSON.stringify(raw);
    return { structured: null, legacyMarkdown: legacy, source: "storefront" };
  }

  return { structured: null, legacyMarkdown: null, source: "none" };
}
