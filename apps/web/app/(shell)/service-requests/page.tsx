import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { hasActiveOrgCapability } from "@/lib/storefront/org-capabilities.server";
import {
  ServiceRequestsPanel,
  type ServiceRequestRow,
} from "@/components/civic/ServiceRequestsPanel";

// 311 service-request queue (BI-8D477188 Phase 3) — a civic re-skin over the
// existing StorefrontInquiry intake pipeline (substrate verdict: reuse, no new
// model). Department comes from the public form's formData.
export default async function ServiceRequestsPage() {
  if (!(await hasActiveOrgCapability("service-request-311"))) notFound();

  const inquiries = await prisma.storefrontInquiry.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const rows: ServiceRequestRow[] = inquiries.map((i) => {
    const formData = (i.formData ?? {}) as Record<string, unknown>;
    const department = typeof formData.department === "string" ? formData.department : null;
    return {
      id: i.id,
      ref: i.inquiryRef,
      requesterName: i.customerName,
      requesterEmail: i.customerEmail,
      message: i.message,
      department,
      status: i.status,
      createdAt: i.createdAt.toISOString(),
    };
  });

  const open = rows.filter((r) => r.status !== "closed").length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Service Requests</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          {open} open · {rows.length} total · resident submissions routed by department
        </p>
      </div>
      <ServiceRequestsPanel requests={rows} />
    </div>
  );
}
