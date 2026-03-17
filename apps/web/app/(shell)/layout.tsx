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

  // Bootstrap: ensure the logged-in user has an EmployeeProfile.
  // On first login after fresh install, this creates the initial admin employee.
  if (user.id) {
    const hasProfile = await prisma.employeeProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!hasProfile) {
      // Ensure reference data exists (fresh install)
      const empType = await prisma.employmentType.findFirst({ where: { status: "active" } });

      const emailName = user.email?.split("@")[0] ?? "Admin";
      const employeeId = `EMP-${Date.now().toString(36).toUpperCase()}`;
      await prisma.employeeProfile.create({
        data: {
          employeeId,
          userId: user.id,
          firstName: emailName.charAt(0).toUpperCase() + emailName.slice(1),
          lastName: "",
          displayName: emailName,
          workEmail: user.email ?? undefined,
          status: "active",
          startDate: new Date(),
          ...(empType ? { employmentTypeId: empType.id } : {}),
          employmentEvents: {
            create: {
              eventId: `EVT-${Date.now().toString(36).toUpperCase()}`,
              eventType: "hired",
              effectiveAt: new Date(),
              reason: "System bootstrap — first login",
            },
          },
        },
      }).catch((err: unknown) => {
        // Unique constraint race — another request already created it
        console.warn("[bootstrap-employee]", err);
      });
    }
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
