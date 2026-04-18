// apps/web/app/(shell)/build/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ShellPresentationMode } from "@/components/shell/ShellPresentationMode";

export default async function BuildLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_platform"
    )
  ) {
    notFound();
  }

  return (
    <>
      <ShellPresentationMode
        frameMaxWidth="1600px"
        contentMaxWidth="none"
        pagePadding="0px"
        bottomGap="16px"
      />
      {children}
    </>
  );
}
