import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MarketingTabNav } from "@/components/customer-marketing/MarketingTabNav";

export default async function CustomerMarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_marketing",
    )
  ) {
    notFound();
  }

  return (
    <div>
      <MarketingTabNav />
      {children}
    </div>
  );
}
