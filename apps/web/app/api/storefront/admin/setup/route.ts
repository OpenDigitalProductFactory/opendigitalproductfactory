import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { nanoid } from "nanoid";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { generateDesignSystem } from "@/lib/design-intelligence";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    archetypeId, tagline, heroImageUrl, orgName, orgSlug,
  } = (await req.json()) as {
    archetypeId: string;
    tagline?: string;
    heroImageUrl?: string;
    orgName?: string;
    orgSlug: string;
  };

  if (!orgSlug) {
    return NextResponse.json({ error: "orgSlug is required" }, { status: 400 });
  }

  const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found. Complete account setup first." },
      { status: 400 }
    );
  }

  // Update org name if the user edited it in the storefront wizard
  if (orgName && orgName !== org.name) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { name: orgName },
    });
  }

  const existing = await prisma.storefrontConfig.findUnique({ where: { organizationId: org.id } });
  if (existing) return NextResponse.json({ error: "Storefront already exists" }, { status: 409 });

  const archetype = await prisma.storefrontArchetype.findUnique({ where: { archetypeId } });
  if (!archetype) return NextResponse.json({ error: "Archetype not found" }, { status: 400 });

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
          }>
        ).map((t, i) => ({
          itemId: `itm-${nanoid(8)}`,
          name: t.name,
          description: t.description ?? null,
          priceType: t.priceType,
          ctaType: t.ctaType ?? archetype.ctaType,
          ctaLabel: t.ctaLabel ?? null,
          sortOrder: i,
          isActive: true,
          priceCurrency: "GBP",
        })),
      },
    },
    select: { id: true },
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
  const REVENUE_MODEL_MAP: Record<string, string> = {
    booking: "Appointment-based services",
    purchase: "Product/service sales",
    inquiry: "Quote-based services",
    donation: "Donor-funded",
  };

  await prisma.businessContext.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      industry: archetype.category,
      ctaType: archetype.ctaType,
      archetypeId: archetype.archetypeId,
      revenueModel: REVENUE_MODEL_MAP[archetype.ctaType] ?? null,
      customerSegments: [],
    },
    update: {
      industry: archetype.category,
      ctaType: archetype.ctaType,
      archetypeId: archetype.archetypeId,
      revenueModel: REVENUE_MODEL_MAP[archetype.ctaType] ?? null,
    },
  });

  // Seed default provider, availability, and booking config from template scheduling defaults
  const template = ALL_ARCHETYPES.find((a: { archetypeId: string }) => a.archetypeId === archetypeId);
  if (template?.schedulingDefaults) {
    const defaults = template.schedulingDefaults;

    // 1. Create default ServiceProvider named after the org
    const provider = await prisma.serviceProvider.create({
      data: {
        providerId: `SP-${nanoid(6).toUpperCase()}`,
        storefrontId: config.id,
        name: orgName ?? org.name,
        isActive: true,
      },
    });

    // 2. Create availability rows — use confirmed BusinessProfile hours if available
    const profile = await prisma.businessProfile.findFirst({
      where: { isActive: true, hoursConfirmedAt: { not: null } },
      select: { businessHours: true },
    });

    let operatingHours: { day: number; start: string; end: string }[];
    if (profile?.businessHours) {
      const bh = profile.businessHours as Record<string, { open: string; close: string } | null>;
      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6,
      };
      operatingHours = Object.entries(bh)
        .filter(([, hours]) => hours !== null)
        .map(([day, hours]) => ({
          day: dayMap[day] ?? 0,
          start: hours!.open,
          end: hours!.close,
        }));
    } else {
      operatingHours = defaults.defaultOperatingHours;
    }

    const grouped = new Map<string, number[]>();
    for (const h of operatingHours) {
      const key = `${h.start}-${h.end}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(h.day);
    }
    for (const [key, days] of grouped) {
      const keyParts = key.split("-");
      const startTime = keyParts[0] ?? "09:00";
      const endTime = keyParts[1] ?? "17:00";
      await prisma.providerAvailability.create({
        data: { providerId: provider.id, days, startTime, endTime },
      });
    }

    // 3. Link provider to all booking items
    const bookingItems = await prisma.storefrontItem.findMany({
      where: { storefrontId: config.id, ctaType: "booking" },
      select: { id: true, name: true },
    });

    for (const item of bookingItems) {
      await prisma.providerService.create({
        data: { providerId: provider.id, itemId: item.id },
      });
    }

    // 4. Set bookingConfig on each booking item from template + defaults
    const itemTemplates = template.itemTemplates;
    for (const tmpl of itemTemplates) {
      if ((tmpl.ctaType ?? template.ctaType) === "booking") {
        await prisma.storefrontItem.updateMany({
          where: { storefrontId: config.id, name: tmpl.name },
          data: {
            bookingConfig: {
              durationMinutes: tmpl.bookingDurationMinutes ?? 60,
              schedulingPattern: defaults.schedulingPattern,
              assignmentMode: defaults.assignmentMode,
              beforeBufferMinutes: defaults.defaultBeforeBuffer,
              afterBufferMinutes: defaults.defaultAfterBuffer,
              minimumNoticeHours: defaults.minimumNoticeHours,
              maxAdvanceDays: defaults.maxAdvanceDays,
            },
          },
        });
      }
    }

    // Update BusinessProfile to reflect storefront existence
    await prisma.businessProfile.updateMany({
      where: { isActive: true },
      data: { hasStorefront: true },
    });
  }

  return NextResponse.json({ success: true, storefrontId: config.id });
}
