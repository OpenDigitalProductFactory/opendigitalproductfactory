import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { applyBusinessCapabilityPerspective } from "@dpf/db/business-capability-perspectives";
import { nanoid } from "nanoid";
import { generateDesignSystem } from "@/lib/design-intelligence";
import { seedBookingScheduleDefaults } from "@/lib/storefront/seed-booking-defaults";
import {
  deriveRevenueModelFromActivationProfile,
  readActivationProfile,
} from "@/lib/storefront/archetype-activation";
import { setCapabilityChoice } from "@/lib/storefront/capability-activation";
import { projectOperationalValueStreamForArchetype } from "@/lib/storefront/project-operational-value-stream";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    archetypeId, tagline, heroImageUrl, orgName, orgSlug, capabilityChoices,
  } = (await req.json()) as {
    archetypeId: string;
    tagline?: string;
    heroImageUrl?: string;
    orgName?: string;
    orgSlug: string;
    capabilityChoices?: Array<{ capabilityKey: string; choice: "enabled" | "disabled" }>;
  };

  if (!orgSlug) {
    return NextResponse.json({ error: "orgSlug is required" }, { status: 400 });
  }

  const org = await prisma.organization.findFirst({ select: { id: true, name: true, slug: true } });
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found. Complete account setup first." },
      { status: 400 }
    );
  }

  // Update org name and/or slug if the user edited them in the storefront wizard
  const orgUpdates: { name?: string; slug?: string } = {};
  if (orgName && orgName !== org.name) orgUpdates.name = orgName;
  if (orgSlug !== org.slug) orgUpdates.slug = orgSlug;
  if (Object.keys(orgUpdates).length > 0) {
    await prisma.organization.update({ where: { id: org.id }, data: orgUpdates });
  }

  const existing = await prisma.storefrontConfig.findUnique({ where: { organizationId: org.id } });
  if (existing) return NextResponse.json({ error: "Storefront already exists" }, { status: 409 });

  const archetype = await prisma.storefrontArchetype.findUnique({ where: { archetypeId } });
  if (!archetype) return NextResponse.json({ error: "Archetype not found" }, { status: 400 });

  const orgSettingsRow = await prisma.orgSettings.findFirst({ select: { baseCurrency: true } });
  const seedCurrency = orgSettingsRow?.baseCurrency ?? "USD";

  const config = await prisma.storefrontConfig.create({
    data: {
      organizationId: org.id,
      archetypeId: archetype.id,
      tagline: tagline ?? null,
      heroImageUrl: heroImageUrl ?? null,
      isPublished: false,
      sections: {
        create: (
          archetype.sectionTemplates as Array<{ type: string; title: string; sortOrder: number }>
        ).map((s) => ({
          type: s.type,
          title: s.title,
          sortOrder: s.sortOrder,
          content: {},
          isVisible: true,
        })),
      },
      items: {
        create: (
          archetype.itemTemplates as Array<{
            name: string;
            description?: string;
            priceType: string;
            ctaType?: string;
            ctaLabel?: string;
            priceAmount?: number | null;
          }>
        ).map((t, i) => ({
          itemId: `itm-${nanoid(8)}`,
          name: t.name,
          description: t.description ?? null,
          priceType: t.priceType,
          ctaType: t.ctaType ?? archetype.ctaType,
          ctaLabel: t.ctaLabel ?? null,
          // Seed the template's price so purchase items are chargeable out of the
          // box; null leaves the item price-less (CtaButton renders "Enquire").
          priceAmount: t.priceAmount ?? null,
          sortOrder: i,
          isActive: true,
          priceCurrency: seedCurrency,
        })),
      },
    },
    select: { id: true },
  });

  // Seed the primary composition slot so getCompositeActivationProfile can resolve this storefront.
  await prisma.storefrontArchetypeComposition.create({
    data: {
      storefrontId: config.id,
      archetypeId: archetype.id,
      role: "primary",
      sortOrder: 0,
    },
  });

  // Generate design system recommendation from archetype metadata (pure TypeScript, no LLM call)
  try {
    const tags = Array.isArray(archetype.tags) ? (archetype.tags as string[]).join(" ") : "";
    const query = `${archetype.category} ${archetype.name} ${tags}`.trim();
    const designSystemText = generateDesignSystem(query, orgName);
    await prisma.storefrontConfig.update({
      where: { id: config.id },
      data: { designSystem: designSystemText },
    });
  } catch (e) {
    // Non-fatal — storefront works without design system
    console.warn("[storefront-setup] design system generation failed:", (e as Error).message?.slice(0, 200));
  }

  // Populate Organization.industry from archetype category
  await prisma.organization.update({
    where: { id: org.id },
    data: { industry: archetype.category },
  });

  // Update BusinessContext with archetype-derived fields (ctaType, archetypeId).
  // BusinessContext should already exist from the "Your Business" setup step.
  // If it doesn't (backward compat / direct portal setup), create a minimal one.
  const activationProfile = readActivationProfile(archetype.activationProfile);
  const revenueModel = deriveRevenueModelFromActivationProfile(activationProfile, archetype.ctaType);

  // BusinessContext.archetypeId is deprecated — read StorefrontConfig.archetypeId.
  await prisma.businessContext.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      industry: archetype.category,
      ctaType: archetype.ctaType,
      revenueModel,
      customerSegments: [],
    },
    update: {
      industry: archetype.category,
      ctaType: archetype.ctaType,
      revenueModel,
    },
  });

  // EP-PARTNER-CHANNEL Phase 1b: persist the operator's answers to the setup
  // capability questions (e.g. "Do you sell through partners or resellers?").
  // setCapabilityChoice validates the key; a bad/unknown key is skipped rather
  // than failing the whole setup.
  if (Array.isArray(capabilityChoices)) {
    for (const entry of capabilityChoices) {
      if (entry?.choice !== "enabled" && entry?.choice !== "disabled") continue;
      try {
        await setCapabilityChoice({
          organizationId: org.id,
          capabilityKey: entry.capabilityKey,
          choice: entry.choice,
          decidedVia: "setup-wizard",
        });
      } catch {
        // Unknown capability key — skip without failing setup.
      }
    }
  }

  await applyBusinessCapabilityPerspective(prisma, {
    archetypeId,
    category: archetype.category,
  });

  // P0 "Capture": derive and persist the org's operational value-stream
  // architecture so it renders on /ea and seeds the WWWD business-context
  // perspective. Fatal: setup has not met the architecture contract without it.
  await projectOperationalValueStreamForArchetype({
    organizationId: org.id,
    archetypeId,
  });

  // Seed a default provider, availability, provider→item links, and per-item
  // bookingConfig for booking archetypes so the storefront ships with a working
  // calendar instead of an empty one (AUDIT-R3/R4, R9-RES-001). Shared with the
  // archetype-reset path so the two seed paths can never drift.
  const seededBooking = await seedBookingScheduleDefaults(prisma, {
    storefrontId: config.id,
    archetypeId,
    providerName: orgName ?? org.name,
  });

  if (seededBooking) {
    // Mark the business as having a storefront (booking archetypes only,
    // preserving prior behaviour).
    await prisma.businessProfile.updateMany({
      where: { isActive: true },
      data: { hasStorefront: true },
    });
  }

  return NextResponse.json({ success: true, storefrontId: config.id });
}
