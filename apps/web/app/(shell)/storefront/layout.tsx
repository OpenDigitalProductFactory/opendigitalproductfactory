import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { StorefrontAdminTabNav } from "@/components/storefront-admin/StorefrontAdminTabNav";

export default async function StorefrontAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (
    !session?.user ||
    !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_storefront")
  ) {
    notFound();
  }

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
