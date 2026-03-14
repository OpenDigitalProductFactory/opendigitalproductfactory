// apps/web/app/(shell)/layout.tsx
import { executeBootstrapDiscovery, prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolveBrandingLogoUrl } from "@/lib/branding";
import { redirect } from "next/navigation";
import { Header } from "@/components/shell/Header";
import { AgentCoworkerShell } from "@/components/agent/AgentCoworkerShell";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { QueueFlusher } from "@/components/feedback/QueueFlusher";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;

  const [latestDiscoveryRun, activeBranding] = await Promise.all([
    prisma.discoveryRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { id: true },
    }),
    prisma.brandingConfig.findUnique({
      where: { scope: "organization" },
      select: {
        companyName: true,
        logoUrl: true,
      },
    }),
  ]);

  if (!latestDiscoveryRun) {
    await executeBootstrapDiscovery(prisma as never, {
      trigger: "bootstrap",
    }).catch((error: unknown) => {
      console.error("[bootstrap-discovery] automatic bootstrap failed", error);
    });
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--dpf-bg)]">
      <Header
        platformRole={user.platformRole}
        isSuperuser={user.isSuperuser}
        brandName={activeBranding?.companyName ?? "Open Digital Product Factory"}
        brandLogoUrl={resolveBrandingLogoUrl(
          activeBranding?.logoUrl ?? null,
          activeBranding?.companyName ?? "Open Digital Product Factory",
        )}
      />
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">{children}</main>
      <AgentCoworkerShell
        userContext={{ userId: user.id, platformRole: user.platformRole, isSuperuser: user.isSuperuser }}
      />
      <FeedbackButton userId={user.id} />
      <QueueFlusher />
    </div>
  );
}
