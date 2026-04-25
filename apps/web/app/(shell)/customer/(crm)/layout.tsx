import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function CustomerCrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_customer",
    )
  ) {
    notFound();
  }

  return children;
}
