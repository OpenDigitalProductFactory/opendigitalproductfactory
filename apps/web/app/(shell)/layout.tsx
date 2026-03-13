// apps/web/app/(shell)/layout.tsx
import { executeBootstrapDiscovery, prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/shell/Header";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const latestDiscoveryRun = await prisma.discoveryRun.findFirst({
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });

  if (!latestDiscoveryRun) {
    await executeBootstrapDiscovery(prisma as never, {
      trigger: "bootstrap",
    }).catch((error: unknown) => {
      console.error("[bootstrap-discovery] automatic bootstrap failed", error);
    });
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--dpf-bg)]">
      <Header platformRole={session.user.platformRole} isSuperuser={session.user.isSuperuser} />
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">{children}</main>
    </div>
  );
}
