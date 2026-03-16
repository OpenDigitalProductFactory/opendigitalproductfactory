// apps/web/app/(shell)/layout.tsx
import { executeBootstrapDiscovery, prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolveBrandingLogoUrl, buildBrandingStyleTag } from "@/lib/branding";
import { redirect } from "next/navigation";
import { Header } from "@/components/shell/Header";
import { AgentCoworkerShell } from "@/components/agent/AgentCoworkerShell";
import { QueueFlusher } from "@/components/feedback/QueueFlusher";
import { StatusBanner } from "@/components/shell/StatusBanner";
import { ModelWarmup } from "@/components/shell/ModelWarmup";

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
        tokens: true,
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

  const brandingCss = buildBrandingStyleTag(activeBranding?.tokens ?? null);

  return (
    <>
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      <div className="min-h-screen flex flex-col bg-[var(--dpf-bg)]">
        <StatusBanner />
        <Header
          platformRole={user.platformRole}
          isSuperuser={user.isSuperuser}
          brandName={activeBranding?.companyName ?? "Open Digital Product Factory"}
          brandLogoUrl={resolveBrandingLogoUrl(
            activeBranding?.logoUrl ?? null,
            activeBranding?.companyName ?? "Open Digital Product Factory",
          )}
          userId={user.id}
        />
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">{children}</main>
        <AgentCoworkerShell
          userContext={{ userId: user.id, platformRole: user.platformRole, isSuperuser: user.isSuperuser }}
        />
        {/* FeedbackButton moved to Header — see HeaderFeedbackButton */}
        <QueueFlusher />
        <ModelWarmup />
      </div>
    </>
  );
}
