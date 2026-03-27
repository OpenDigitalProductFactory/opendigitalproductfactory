import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { BusinessModelBuilder } from "@/components/admin/BusinessModelBuilder";

export default async function AdminBusinessModelsPage() {
  const models = await prisma.businessModel.findMany({
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
  });

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
        <BusinessModelBuilder models={models} />
      </div>
    </div>
  );
}
