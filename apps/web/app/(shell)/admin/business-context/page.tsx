import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { BusinessContextForm } from "@/components/admin/BusinessContextForm";

export default async function AdminBusinessContextPage() {
  const org = await prisma.organization.findFirst({
    select: { id: true, email: true, phone: true },
  });

  const bc = org
    ? await prisma.businessContext.findUnique({
        where: { organizationId: org.id },
      })
    : null;

  const initial = {
    description: bc?.description ?? "",
    targetMarket: bc?.targetMarket ?? "",
    industry: bc?.industry ?? "",
    companySize: bc?.companySize ?? null,
    geographicScope: bc?.geographicScope ?? null,
    revenueModel: bc?.revenueModel ?? "",
    contactEmail: org?.email ?? "",
    contactPhone: org?.phone ?? "",
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {bc ? "Your business context — edit anytime" : "Tell the platform about your business"}
        </p>
      </div>

      <AdminTabNav />

      <div className="mt-6">
        <BusinessContextForm initial={initial} isEdit={!!bc} />
      </div>
    </div>
  );
}
