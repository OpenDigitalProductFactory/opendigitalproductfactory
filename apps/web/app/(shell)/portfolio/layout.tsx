// apps/web/app/(shell)/portfolio/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getPortfolioTree, getFullPortfolioTree } from "@/lib/portfolio-data";
import { PortfolioTree } from "@/components/portfolio/PortfolioTree";

export default async function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_portfolio"
    )
  ) {
    notFound();
  }

  const [prunedRoots, fullRoots] = await Promise.all([
    getPortfolioTree(true),
    getFullPortfolioTree(),
  ]);

  // Layout cannot access searchParams — PortfolioTree reads ?open= from window.location
  // client-side on mount (brief collapse flash is acceptable).
  return (
    <div className="flex gap-0 -m-2 h-[calc(100vh-57px)] overflow-hidden sm:-m-6">
      {/* Sidebar */}
      <div className="hidden w-56 flex-shrink-0 border-r border-[var(--dpf-border)] overflow-y-auto bg-[var(--dpf-bg)] sm:block">
        <PortfolioTree prunedRoots={prunedRoots} fullRoots={fullRoots} />
      </div>
      {/* Content panel */}
      <div className="min-w-0 flex-1 overflow-y-auto p-2 sm:p-6">{children}</div>
    </div>
  );
}
