// apps/web/app/(shell)/customer/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CustomerTabNav } from "@/components/customer/CustomerTabNav";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_customer"
    )
  ) {
    notFound();
  }

  return (
    <div>
      <CustomerTabNav />
      {children}
    </div>
  );
}
