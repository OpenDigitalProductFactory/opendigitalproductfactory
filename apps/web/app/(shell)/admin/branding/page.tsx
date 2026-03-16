import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";

export default async function AdminBrandingPage() {
  const activeBranding = await prisma.brandingConfig.findUnique({
    where: { scope: "organization" },
    select: { id: true },
  });

  const hasExistingBrand = !!activeBranding;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Brand Configuration</p>
      </div>
      <AdminTabNav />
      <div className="p-6 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
        <p className="text-sm text-[var(--dpf-muted)]">
          {hasExistingBrand
            ? "Brand is configured. Quick edit and AI coworker coming soon."
            : "No brand configured yet. Setup wizard coming soon."}
        </p>
      </div>
    </div>
  );
}
