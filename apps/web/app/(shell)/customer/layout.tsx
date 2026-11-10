// apps/web/app/(shell)/customer/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can, getAccessibleSectionNavEntries } from "@/lib/permissions";
import { CustomerTabNav } from "@/components/customer/CustomerTabNav";
import { loadOwnerFirstContext } from "@/lib/owner-first/context";
import { resolveCustomerSurface } from "@/lib/owner-first/archetype-surface";

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

  const accessibleTabs = getAccessibleSectionNavEntries(access, "/customer").map((entry) => ({
    label: entry.label,
    href: entry.href,
  }));
  const { archetypeId } = await loadOwnerFirstContext();
  const { tabs } = resolveCustomerSurface(archetypeId, accessibleTabs);

  return (
    <div>
      <CustomerTabNav tabs={tabs} />
      {children}
    </div>
  );
}
