// apps/web/app/(shell)/portfolio/product/[id]/page.tsx
//
// Admin product detail page — shows product metadata, business model assignment,
// and business model role assignment panel.

import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@dpf/db";
import { listBusinessModels, getProductBusinessModels } from "@/lib/actions/business-model";
import { BusinessModelSelector } from "@/components/product/BusinessModelSelector";
import { BusinessModelRolePanel } from "@/components/product/BusinessModelRolePanel";

type Props = {
  params: Promise<{ id: string }>;
};

const STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  draft: "#fbbf24",
  inactive: "#8888a0",
};

export default async function ProductDetailPage({ params }: Props) {
  const { id } = await params;

  const [product, availableModels, assignedRaw, users] = await Promise.all([
    prisma.digitalProduct.findUnique({
      where: { id },
      select: {
        id: true,
        productId: true,
        name: true,
        description: true,
        lifecycleStage: true,
        lifecycleStatus: true,
        version: true,
        portfolio: { select: { name: true, slug: true } },
        taxonomyNode: { select: { name: true, nodeId: true } },
        createdAt: true,
        updatedAt: true,
      },
    }),
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

  const statusColour = STATUS_COLOURS[product.lifecycleStatus] ?? "#8888a0";

  // Shape assigned models into the structure BusinessModelRolePanel expects
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

  // Shape for selector (needs _count.roles)
  const availableForSelector = availableModels.map((m) => ({
    ...m,
    _count: { roles: m._count.roles },
  }));

  // Shape assigned for selector
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
      {/* Breadcrumb */}
      <nav style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 16, display: "flex", gap: 6, alignItems: "center" }}>
        <Link href="/portfolio" style={{ color: "var(--dpf-muted)", textDecoration: "none" }}>Portfolio</Link>
        {product.portfolio && (
          <>
            <span>›</span>
            <Link
              href={`/portfolio/${product.portfolio.slug}`}
              style={{ color: "var(--dpf-muted)", textDecoration: "none" }}
            >
              {product.portfolio.name}
            </Link>
          </>
        )}
        <span>›</span>
        <span style={{ color: "var(--dpf-text)" }}>{product.name}</span>
      </nav>

      {/* Product header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>{product.name}</h1>
          <span
            style={{
              fontSize: 10,
              borderRadius: 4,
              padding: "2px 8px",
              background: `${statusColour}20`,
              color: statusColour,
            }}
          >
            {product.lifecycleStatus}
          </span>
        </div>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0 }}>
          {product.productId} · {product.lifecycleStage} · v{product.version}
          {product.taxonomyNode && ` · ${product.taxonomyNode.name}`}
        </p>
        {product.description && (
          <p style={{ fontSize: 12, color: "var(--dpf-text)", marginTop: 8, maxWidth: 640 }}>{product.description}</p>
        )}
      </div>

      {/* Business Model section */}
      <div
        style={{
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 4px" }}>
            Business Model
          </h2>
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0 }}>
            Select the operating model that best describes this product. Each model provides a role template for assigning team members.
          </p>
        </div>

        <BusinessModelSelector
          productId={product.id}
          availableModels={availableForSelector}
          assignedModels={assignedForSelector}
        />
      </div>

      {/* Role Assignments section */}
      <div
        style={{
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 4px" }}>
            Role Assignments
          </h2>
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0 }}>
            Assign team members to business model roles. Each role defines an authority domain and escalation path.
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
