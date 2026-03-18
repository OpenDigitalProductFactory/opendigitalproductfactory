import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ComplianceTabNav } from "@/components/compliance/ComplianceTabNav";

export default async function ComplianceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (
    !session?.user ||
    !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_compliance")
  ) {
    notFound();
  }

  return (
    <>
      <ComplianceTabNav />
      {children}
    </>
  );
}
