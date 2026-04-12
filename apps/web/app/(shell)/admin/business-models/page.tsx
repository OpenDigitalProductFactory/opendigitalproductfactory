import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { BusinessModelBuilder } from "@/components/admin/BusinessModelBuilder";

// Map BusinessContext.industry to recommended business model IDs
const INDUSTRY_TO_MODELS: Record<string, string[]> = {
  "professional-services": ["bm-services"],
  "healthcare-wellness": ["bm-services"],
  "beauty-personal-care": ["bm-services"],
  "trades-maintenance": ["bm-services"],
  "education-training": ["bm-services", "bm-saas"],
  "pet-services": ["bm-services"],
  "food-hospitality": ["bm-ecommerce"],
  "retail-goods": ["bm-ecommerce"],
  "fitness-recreation": ["bm-saas", "bm-services"],
  "nonprofit-community": ["bm-services"],
  "hoa-property-management": ["bm-services"],
};

export default async function AdminBusinessModelsPage() {
  const [models, bc] = await Promise.all([
    prisma.businessModel.findMany({
      select: {
        id: true,
        modelId: true,
        name: true,
        description: true,
        isBuiltIn: true,
        status: true,
        _count: {
          select: {
            roles: { where: { status: "active" } },
            products: true,
          },
        },
      },
      orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
    }),
    prisma.businessContext.findFirst({ select: { industry: true } }),
  ]);

  const recommendedModelIds = bc?.industry
    ? INDUSTRY_TO_MODELS[bc.industry] ?? []
    : [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Business model templates — {models.filter((m) => m.isBuiltIn).length} built-in,{" "}
          {models.filter((m) => !m.isBuiltIn).length} custom
        </p>
      </div>

      <AdminTabNav />

      <div className="mt-6">
        <BusinessModelBuilder models={models} recommendedModelIds={recommendedModelIds} />
      </div>
    </div>
  );
}
