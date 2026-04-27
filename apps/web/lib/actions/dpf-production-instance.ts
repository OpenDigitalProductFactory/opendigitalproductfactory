"use server";

import { prisma } from "@dpf/db";

const DPF_PRESET = {
  organization: {
    name: "Open Digital Product Factory",
    slug: "open-digital-product-factory",
    website: "https://opendigitalproductfactory.com",
    email: "hello@opendigitalproductfactory.com",
    industry: "software-platform",
  },
  businessContext: {
    description:
      "Open Digital Product Factory uses DPF to market, sell, govern, and improve DPF as a real customer-zero production instance.",
    targetMarket:
      "Organizations that need an AI-native platform for governed digital product operations, delivery, and improvement.",
    companySize: "small",
    geographicScope: "international",
    revenueModel: "Platform subscriptions and services",
  },
  storefront: {
    tagline: "Run your digital product operation on the platform that runs itself.",
    description:
      "DPF is the AI-native operating platform for digital products, and this instance is the real production system Open Digital Product Factory uses to run and improve DPF itself.",
    contactEmail: "hello@opendigitalproductfactory.com",
  },
} as const;

export async function applyDpfProductionInstancePreset() {
  const organization = await prisma.organization.findFirst({
    select: { id: true, slug: true },
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  const storefrontConfig = await prisma.storefrontConfig.findFirst({
    where: { organizationId: organization.id },
    select: { id: true, organizationId: true },
  });

  if (!storefrontConfig) {
    throw new Error("Storefront configuration not found");
  }

  const updatedOrganization = await prisma.organization.update({
    where: { id: organization.id },
    data: DPF_PRESET.organization,
  });

  const updatedBusinessContext = await prisma.businessContext.upsert({
    where: { organizationId: organization.id },
    create: {
      organizationId: organization.id,
      customerSegments: [],
      ...DPF_PRESET.businessContext,
    },
    update: DPF_PRESET.businessContext,
  });

  const updatedStorefront = await prisma.storefrontConfig.update({
    where: { id: storefrontConfig.id },
    data: DPF_PRESET.storefront,
  });

  return {
    organization: updatedOrganization,
    businessContext: updatedBusinessContext,
    storefront: updatedStorefront,
  };
}
