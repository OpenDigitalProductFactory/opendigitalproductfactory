import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { isIndustrySlug } from "@/lib/storefront/industries";
import { slugify } from "@/lib/shared/slugify";
import { toProductMixKey } from "@dpf/storefront-templates";

type CreateCustomArchetypeBody = {
  name: string;
  category: string;
  ctaType: string;
  itemTemplates: Array<{
    name: string;
    description: string;
    priceType: string;
    ctaType?: string;
    ctaLabel?: string;
    bookingDurationMinutes?: number;
  }>;
  sectionTemplates: Array<{
    type: string;
    title: string;
    sortOrder: number;
  }>;
  formSchema: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
    placeholder?: string;
  }>;
  tags: string[];
  customVocabulary?: {
    portalLabel?: string;
    stakeholderLabel?: string;
    teamLabel?: string;
    inboxLabel?: string;
    agentName?: string;
    itemsLabel?: string;
    singleItemLabel?: string;
    addButtonLabel?: string;
  };
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as CreateCustomArchetypeBody;
  if (!body.name || !body.category || !body.ctaType) {
    return NextResponse.json({ error: "name, category, and ctaType are required" }, { status: 400 });
  }
  if (!isIndustrySlug(body.category)) {
    return NextResponse.json(
      { error: `category must be one of the 11 canonical industries, got "${body.category}"` },
      { status: 400 },
    );
  }

  // Generate a unique archetypeId
  const slug = slugify(body.name);
  const archetypeId = `custom-${slug}`;

  // Check for duplicate
  const existing = await prisma.storefrontArchetype.findUnique({ where: { archetypeId } });
  if (existing) {
    return NextResponse.json({ error: `Archetype "${archetypeId}" already exists` }, { status: 409 });
  }

  const archetype = await prisma.storefrontArchetype.create({
    data: {
      archetypeId,
      name: body.name,
      category: body.category,
      ctaType: body.ctaType,
      itemTemplates: body.itemTemplates,
      sectionTemplates: body.sectionTemplates,
      formSchema: body.formSchema,
      tags: body.tags ?? [],
      isActive: true,
      isBuiltIn: false,
      ...(body.customVocabulary && { customVocabulary: body.customVocabulary }),
      productMix: {
        primary: {
          key: toProductMixKey(body.name) || "primary",
          label: body.name.trim(),
          archetypeId,
          products: body.itemTemplates.map((item, index) => ({
            key: toProductMixKey(item.name) || `product-${index + 1}`,
            label: item.name.trim(),
            description: item.description.trim(),
          })),
        },
        adjacent: [],
      },
    },
  });

  return NextResponse.json(archetype, { status: 201 });
}
