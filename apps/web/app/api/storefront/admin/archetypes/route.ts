import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

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

  // Generate a unique archetypeId
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
    },
  });

  return NextResponse.json(archetype, { status: 201 });
}
