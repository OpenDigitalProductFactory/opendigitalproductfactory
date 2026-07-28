import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function PerformanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;

  if (
    !user ||
    !can(
      {
        platformRole: user.platformRole,
        isSuperuser: user.isSuperuser,
      },
      "view_business_performance",
    )
  ) {
    notFound();
  }

  return children;
}
