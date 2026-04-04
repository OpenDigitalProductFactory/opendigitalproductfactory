import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

type ItemTemplate = { name: string; description?: string; priceType?: string; ctaType?: string };

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.storefrontConfig.findFirst({
    include: {
      archetype: true,
    },
  });

  if (!config) {
    return NextResponse.json({ error: "No storefront configured" }, { status: 404 });
  }

  const archetype = config.archetype;
  const originalItems = (archetype.itemTemplates as ItemTemplate[]) ?? [];

  // Load current live items
  const liveItems = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id },
    select: { name: true, category: true, ctaType: true, priceType: true, isActive: true, description: true },
    orderBy: { sortOrder: "asc" },
  });

  // Load current live sections
  const liveSections = await prisma.storefrontSection.findMany({
    where: { storefrontId: config.id },
    select: { type: true, title: true, isVisible: true },
    orderBy: { sortOrder: "asc" },
  });

  const originalSections = (archetype.sectionTemplates as Array<{ type: string; title: string }>) ?? [];

  // Compute diffs
  const originalItemNames = new Set(originalItems.map((i) => i.name));
  const liveItemNames = new Set(liveItems.map((i) => i.name));

  const itemsAdded = liveItems
    .filter((i) => !originalItemNames.has(i.name) && i.isActive)
    .map((i) => ({ name: i.name, ctaType: i.ctaType, priceType: i.priceType, category: i.category }));

  const itemsRemoved = originalItems
    .filter((i) => !liveItemNames.has(i.name))
    .map((i) => i.name);

  const itemsDeactivated = liveItems
    .filter((i) => originalItemNames.has(i.name) && !i.isActive)
    .map((i) => i.name);

  // Detect renamed items (same position, different name — heuristic)
  const itemsRenamed: Array<{ from: string; to: string }> = [];

  // Categories actually used
  const categoriesUsed = [...new Set(liveItems.map((i) => i.category).filter(Boolean))] as string[];

  const originalSectionTypes = new Set(originalSections.map((s) => s.type));
  const liveSectionTypes = new Set(liveSections.map((s) => s.type));

  const sectionsAdded = liveSections
    .filter((s) => !originalSectionTypes.has(s.type) && s.isVisible)
    .map((s) => ({ type: s.type, title: s.title }));

  const sectionsRemoved = originalSections
    .filter((s) => !liveSectionTypes.has(s.type))
    .map((s) => s.type);

  const sectionsHidden = liveSections
    .filter((s) => originalSectionTypes.has(s.type) && !s.isVisible)
    .map((s) => s.type);

  const hasChanges = itemsAdded.length > 0 || itemsRemoved.length > 0 || itemsDeactivated.length > 0 ||
    sectionsAdded.length > 0 || sectionsRemoved.length > 0 || sectionsHidden.length > 0 ||
    categoriesUsed.length > 0;

  // Build summary
  const summaryParts: string[] = [];
  if (itemsAdded.length > 0) summaryParts.push(`${itemsAdded.length} item(s) added`);
  if (itemsRemoved.length > 0) summaryParts.push(`${itemsRemoved.length} template item(s) removed`);
  if (itemsDeactivated.length > 0) summaryParts.push(`${itemsDeactivated.length} template item(s) deactivated`);
  if (sectionsAdded.length > 0) summaryParts.push(`${sectionsAdded.length} section(s) added`);
  if (sectionsRemoved.length > 0) summaryParts.push(`${sectionsRemoved.length} section(s) removed`);
  if (categoriesUsed.length > 0) summaryParts.push(`${categoriesUsed.length} categories in use`);

  return NextResponse.json({
    archetypeId: archetype.archetypeId,
    archetypeName: archetype.name,
    isBuiltIn: archetype.isBuiltIn,
    hasChanges,
    changes: {
      itemsAdded,
      itemsRemoved,
      itemsDeactivated,
      itemsRenamed,
      categoriesUsed,
      sectionsAdded,
      sectionsRemoved,
      sectionsHidden,
    },
    summary: hasChanges ? summaryParts.join(", ") : "No changes from original template",
  });
}
