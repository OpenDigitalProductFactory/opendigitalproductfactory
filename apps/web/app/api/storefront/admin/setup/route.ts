import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { nanoid } from "nanoid";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { archetypeId, tagline, heroImageUrl, orgName, orgSlug } = (await req.json()) as {
    archetypeId: string;
    tagline?: string;
    heroImageUrl?: string;
    orgName: string;
    orgSlug: string;
  };

  if (!orgName || !orgSlug) {
    return NextResponse.json({ error: "orgName and orgSlug are required" }, { status: 400 });
  }

  let org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        orgId: `ORG-${nanoid(6).toUpperCase()}`,
        name: orgName,
        slug: orgSlug,
      },
      select: { id: true },
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

  // Seed default provider, availability, and booking config from template scheduling defaults
  const template = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (template?.schedulingDefaults) {
    const defaults = template.schedulingDefaults;

    // 1. Create default ServiceProvider named after the org
    const provider = await prisma.serviceProvider.create({
      data: {
        providerId: `SP-${nanoid(6).toUpperCase()}`,
        storefrontId: config.id,
        name: orgName,
        isActive: true,
      },
    });

    // 2. Create availability rows — group days by identical hours
    const grouped = new Map<string, number[]>();
    for (const h of defaults.defaultOperatingHours) {
      const key = `${h.start}-${h.end}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(h.day);
    }
    for (const [key, days] of grouped) {
      const [startTime, endTime] = key.split("-");
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
  }

  return NextResponse.json({ success: true, storefrontId: config.id });
}
