// apps/web/app/(shell)/portfolio/product/[id]/team/page.tsx
//
// Team tab — business model assignment and role assignments for this product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import { listBusinessModels, getProductBusinessModels } from "@/lib/actions/business-model";
import { BusinessModelSelector } from "@/components/product/BusinessModelSelector";
import { BusinessModelRolePanel } from "@/components/product/BusinessModelRolePanel";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductTeamPage({ params }: Props) {
  const { id } = await params;

  const [product, availableModels, assignedRaw, users] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true } }),
    listBusinessModels(),
    getProductBusinessModels(id),
    prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        email: true,
        employeeProfile: { select: { displayName: true } },
      },
      orderBy: { email: "asc" },
    }),
  ]);

  if (!product) notFound();

  const assignedForPanel = assignedRaw.map((a) => ({
    id: a.id,
    assignedAt: a.assignedAt,
    businessModel: {
      ...a.businessModel,
      roles: a.businessModel.roles.map((r) => ({
        ...r,
        assignments: r.assignments.map((asn) => ({
          ...asn,
          revokedAt: asn.revokedAt ?? null,
        })),
      })),
    },
  }));

  const availableForSelector = availableModels.map((m) => ({
    ...m,
    _count: { roles: m._count.roles },
  }));

  const assignedForSelector = assignedRaw.map((a) => ({
    id: a.id,
    assignedAt: a.assignedAt,
    businessModel: {
      id: a.businessModel.id,
      modelId: a.businessModel.modelId,
      name: a.businessModel.name,
      isBuiltIn: a.businessModel.isBuiltIn,
    },
  }));

  return (
    <div>
      {/* Business Model section */}
      <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-5 mb-5">
        <div className="mb-3.5">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">Business Model</h2>
          <p className="text-[11px] text-[var(--dpf-muted)] m-0">
            Select the operating model that best describes this product. Each model provides a role
            template for assigning team members.
          </p>
        </div>
        <BusinessModelSelector
          productId={product.id}
          availableModels={availableForSelector}
          assignedModels={assignedForSelector}
        />
      </div>

      {/* Role Assignments section */}
      <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-5">
        <div className="mb-3.5">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">Role Assignments</h2>
          <p className="text-[11px] text-[var(--dpf-muted)] m-0">
            Assign team members to business model roles. Each role defines an authority domain and
            escalation path.
          </p>
        </div>
        <BusinessModelRolePanel
          productId={product.id}
          assignedModels={assignedForPanel}
          users={users.map((u) => ({
            id: u.id,
            email: u.email,
            displayName: u.employeeProfile?.displayName ?? null,
          }))}
        />
      </div>
    </div>
  );
}
