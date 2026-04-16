import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { BusinessContextForm } from "@/components/admin/BusinessContextForm";
import { getSetupContext } from "@/lib/actions/setup-progress";

export default async function AdminBusinessContextPage() {
  const [org, setupContext] = await Promise.all([
    prisma.organization.findFirst({
      select: { id: true, email: true, phone: true },
    }),
    getSetupContext(),
  ]);

  const bc = org
    ? await prisma.businessContext.findUnique({
        where: { organizationId: org.id },
      })
    : null;

  // Only apply suggestions during initial setup (no existing business context record)
  const suggestions = !bc && setupContext ? {
    industry: setupContext.suggestedIndustry ?? "",
    description: setupContext.suggestedDescription ?? "",
    contactEmail: setupContext.suggestedContactEmail ?? "",
    contactPhone: setupContext.suggestedContactPhone ?? "",
    geographicScope: setupContext.suggestedGeographicScope ?? null,
  } : null;

  const initial = {
    description: bc?.description ?? suggestions?.description ?? "",
    targetMarket: bc?.targetMarket ?? "",
    industry: bc?.industry ?? suggestions?.industry ?? "",
    companySize: bc?.companySize ?? null,
    geographicScope: bc?.geographicScope ?? suggestions?.geographicScope ?? null,
    revenueModel: bc?.revenueModel ?? "",
    contactEmail: org?.email ?? suggestions?.contactEmail ?? "",
    contactPhone: org?.phone ?? suggestions?.contactPhone ?? "",
  };

  // Track which fields were auto-filled from URL import
  const autoFilledFields = suggestions
    ? Object.entries(suggestions)
        .filter(([, v]) => v != null && v !== "")
        .map(([k]) => k)
    : [];

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
        <BusinessContextForm initial={initial} isEdit={!!bc} autoFilledFields={autoFilledFields} />
      </div>
    </div>
  );
}
