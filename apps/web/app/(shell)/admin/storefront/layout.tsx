import { StorefrontAdminTabNav } from "@/components/storefront-admin/StorefrontAdminTabNav";
import { prisma } from "@dpf/db";

export default async function StorefrontAdminLayout({ children }: { children: React.ReactNode }) {
  // Only show tab nav when storefront is already configured
  const configured = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Storefront</h1>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginTop: 4 }}>
          Create and manage your customer-facing storefront
        </p>
      </div>
      {configured && <StorefrontAdminTabNav />}
      {children}
    </div>
  );
}
