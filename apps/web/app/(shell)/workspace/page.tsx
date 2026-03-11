// apps/web/app/(shell)/workspace/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWorkspaceTiles } from "@/lib/permissions";
import { WorkspaceTiles } from "@/components/shell/WorkspaceTiles";
import { AttentionStrip } from "@/components/shell/AttentionStrip";
import { prisma } from "@dpf/db";

type TileStatus = {
  count?: number;
  badge?: string;
  badgeColor?: string;
};

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const tiles = getWorkspaceTiles({
    platformRole: session.user.platformRole,
    isSuperuser: session.user.isSuperuser,
  });

  const [productCount, portfolioCount, agentCount] = await Promise.all([
    prisma.digitalProduct.count({ where: { lifecycleStatus: "active" } }),
    prisma.portfolio.count(),
    prisma.agent.count({ where: { status: "active" } }),
  ]);

  // Use a type-safe record where each value is fully defined — no undefined-valued
  // optional properties (exactOptionalPropertyTypes requires this).
  const tileStatus: Record<string, TileStatus> = {
    inventory: { count: productCount },
    portfolio: { count: portfolioCount },
    ea_modeler: { badge: `${agentCount} agents active`, badgeColor: "#7c8cf8" },
  };

  const attentionItems: Array<{ id: string; label: string; description: string; href: string }> =
    [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">
          Welcome, {session.user.platformRole ?? "Guest"}
        </h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {tiles.length} capabilities available
        </p>
      </div>

      <AttentionStrip items={attentionItems} />

      <p className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
        Your Workspace
      </p>
      <WorkspaceTiles tiles={tiles} tileStatus={tileStatus} />
    </div>
  );
}
