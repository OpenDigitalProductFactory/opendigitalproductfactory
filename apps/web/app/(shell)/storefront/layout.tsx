import { StorefrontAdminTabNav } from "@/components/storefront-admin/StorefrontAdminTabNav";

export default function StorefrontAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Storefront</h1>
      </div>
      <StorefrontAdminTabNav />
      {children}
    </div>
  );
}
