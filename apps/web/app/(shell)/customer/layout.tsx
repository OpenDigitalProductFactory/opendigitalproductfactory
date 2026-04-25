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
  if (!session?.user) {
    notFound();
  }

  const access = {
    platformRole: session.user.platformRole,
    isSuperuser: session.user.isSuperuser,
  };
  const canViewCustomer = can(access, "view_customer");
  const canViewMarketing = can(access, "view_marketing");

  if (!canViewCustomer && !canViewMarketing) {
    notFound();
  }

  const tabs = [
    ...(canViewCustomer
      ? [
          { label: "Accounts", href: "/customer" },
          { label: "Engagements", href: "/customer/engagements" },
          { label: "Pipeline", href: "/customer/opportunities" },
          { label: "Quotes", href: "/customer/quotes" },
          { label: "Orders", href: "/customer/sales-orders" },
          { label: "Funnel", href: "/customer/funnel" },
        ]
      : []),
    ...(canViewMarketing ? [{ label: "Marketing", href: "/customer/marketing" }] : []),
  ];

  return (
    <div>
      <CustomerTabNav tabs={tabs} />
      {children}
    </div>
  );
}
