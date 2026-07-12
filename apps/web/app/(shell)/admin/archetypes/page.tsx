import { prisma } from "@dpf/db";
import {
  ALL_ARCHETYPES,
  deriveTwinProfile,
  type ArchetypeDefinition,
} from "@dpf/storefront-templates";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { industryLabel } from "@/lib/storefront/industries";
import {
  ArchetypeCatalogTable,
  type ArchetypeCatalogRow,
} from "@/components/admin/ArchetypeCatalogTable";

// Central, read-only catalog of every archetype configuration installed on the
// platform — including the ones that have NOT been enabled. The setup wizard
// (/storefront/setup) redirects away the moment an archetype is chosen, so once
// a business is live there is no in-product surface that lists the alternatives.
// This is an administrative view because the choice "affects the entire
// business": it sets the org's industry SSOT (StorefrontConfig.archetypeId) and,
// through it, the operational twin, vocabulary, and value stream.

// The seeded definitions carry the full leaf typing (schedulingDefaults,
// fieldDispatch, twinProfile overrides) that deriveTwinProfile reads; index them
// so each installed DB row derives its twin from the canonical definition.
const DEFS_BY_ID = new Map<string, ArchetypeDefinition>(
  ALL_ARCHETYPES.map((a) => [a.archetypeId, a]),
);

export default async function AdminArchetypesPage() {
  const [installed, config] = await Promise.all([
    prisma.storefrontArchetype.findMany({
      where: { isActive: true },
      select: {
        archetypeId: true,
        name: true,
        category: true,
        ctaType: true,
        tags: true,
        isBuiltIn: true,
        activationProfile: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    // StorefrontConfig.archetypeId is the FK (StorefrontArchetype.id, a cuid) —
    // the enabled *slug* lives on the relation, so read it there.
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { archetypeId: true } } },
    }),
  ]);

  const enabledId = config?.archetype?.archetypeId ?? null;

  const rows: ArchetypeCatalogRow[] = installed.map((a) => {
    // Prefer the canonical seeded definition (full leaf overrides); fall back to
    // a definition synthesized from the DB row for any custom/installed leaf
    // that has no compiled counterpart. deriveTwinProfile only reads
    // category/ctaType/tags/activationProfile + the optional leaf overrides.
    const def: ArchetypeDefinition =
      DEFS_BY_ID.get(a.archetypeId) ??
      ({
        archetypeId: a.archetypeId,
        name: a.name,
        category: a.category,
        ctaType: a.ctaType,
        tags: a.tags,
        itemTemplates: [],
        sectionTemplates: [],
        formSchema: [],
        // activationProfile is stored as JSON; deriveTwinProfile normalizes it
        // through readActivationProfile, so the raw shape is safe to pass.
        activationProfile:
          a.activationProfile as unknown as ArchetypeDefinition["activationProfile"],
      } as ArchetypeDefinition);

    const twin = deriveTwinProfile(def);

    return {
      archetypeId: a.archetypeId,
      name: a.name,
      category: a.category,
      categoryLabel: industryLabel(a.category) || a.category,
      ctaType: a.ctaType,
      isBuiltIn: a.isBuiltIn,
      twinTemplate: twin.template,
      twinVariant: twin.variant ?? null,
      twinPhysical: twin.physical,
      enabled: enabledId != null && a.archetypeId === enabledId,
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Archetype catalog — every business configuration installed on the platform,
          including the {rows.filter((r) => !r.enabled).length} not currently enabled.
        </p>
      </div>

      <AdminTabNav />

      <div className="mt-6">
        <ArchetypeCatalogTable rows={rows} />
      </div>
    </div>
  );
}
