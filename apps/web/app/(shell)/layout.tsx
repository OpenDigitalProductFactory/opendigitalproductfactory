// apps/web/app/(shell)/layout.tsx
export const dynamic = "force-dynamic";

import { executeBootstrapDiscovery, prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolveBrandingLogoUrl, buildBrandingStyleTag } from "@/lib/branding";
import { redirect } from "next/navigation";
import { Header } from "@/components/shell/Header";
import { AgentCoworkerShell } from "@/components/agent/AgentCoworkerShell";
import { QueueFlusher } from "@/components/feedback/QueueFlusher";
import { StatusBanner } from "@/components/shell/StatusBanner";
import { UpdatePendingBanner } from "@/components/shell/UpdatePendingBanner";
import { ModelWarmup } from "@/components/shell/ModelWarmup";
import { SetupOverlay } from "@/components/setup/SetupOverlay";
import { getShellNavSections } from "@/lib/permissions";
import { AppRail } from "@/components/shell/AppRail";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // First-run check — redirect to setup if no org exists.
  // Skip in the sandbox: it's a preview container for Build Studio feature
  // output, not a user install, and the /setup redirect blocks users from
  // viewing the actual change they built.
  if (process.env.DPF_ENVIRONMENT !== "sandbox") {
    const { isFirstRun } = await import("@/lib/actions/setup-progress");
    if (await isFirstRun()) {
      redirect("/setup");
    }
  }

  const session = await auth();
  if (!session?.user) redirect("/welcome");
  if (session.user.type === "customer") redirect("/portal");

  const user = session.user;

  const [latestDiscoveryRun, activeBranding, organization] = await Promise.all([
    prisma.discoveryRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { id: true },
    }),
    prisma.brandingConfig.findUnique({
      where: { scope: "organization" },
      select: {
        logoUrlLight: true,
        tokens: true,
      },
    }),
    prisma.organization.findFirst({
      select: { name: true, logoUrl: true },
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
          ...(user.email ? { workEmail: user.email } : {}),
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

  // Check for active setup progress (onboarding tour in progress).
  // Skip entirely for the sandbox environment — the sandbox is a
  // dev-preview container for inspecting Build Studio feature output,
  // not a user-facing install. The setup tour has no meaning there and
  // blocks the preview view.
  const isSandbox = process.env.DPF_ENVIRONMENT === "sandbox";
  const activeSetup = isSandbox
    ? null
    : await prisma.platformSetupProgress.findFirst({
        where: { completedAt: null, userId: user.id },
        select: { id: true, currentStep: true, steps: true, context: true },
      });

  const brandingCss = buildBrandingStyleTag(activeBranding?.tokens ?? null);
  const shellNavSections = activeSetup
    ? []
    : getShellNavSections({
        userId: user.id,
        platformRole: user.platformRole,
        isSuperuser: user.isSuperuser,
      });

  return (
    <>
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      <div className="min-h-screen flex flex-col bg-[var(--dpf-bg)]">
        {activeSetup && (
          <SetupOverlay
            progressId={activeSetup.id}
            currentStep={activeSetup.currentStep}
            steps={activeSetup.steps as Record<string, "pending" | "completed" | "skipped">}
            setupContext={(activeSetup.context ?? {}) as Record<string, string>}
            triggeredSteps={
              ((activeSetup.context ?? {}) as { triggeredSteps?: string[] }).triggeredSteps ?? []
            }
          />
        )}
        <StatusBanner />
        <UpdatePendingBanner />
        <Header
          platformRole={user.platformRole}
          brandName={organization?.name ?? "Open Digital Product Factory"}
          brandLogoUrl={resolveBrandingLogoUrl(
            organization?.logoUrl ?? null,
            organization?.name ?? "Open Digital Product Factory",
          )}
          brandLogoUrlLight={resolveBrandingLogoUrl(
            activeBranding?.logoUrlLight ?? null,
            organization?.name ?? "Open Digital Product Factory",
          )}
          userId={user.id}
        />
        <div className="flex flex-1 flex-col lg:flex-row">
          {shellNavSections.length > 0 && (
            <aside className="shrink-0 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] lg:w-[248px] lg:border-b-0 lg:border-r">
              <div className="mx-auto w-full max-w-[1600px] lg:max-w-none">
                <AppRail sections={shellNavSections} />
              </div>
            </aside>
          )}
          <main className="min-w-0 flex-1">
            <div
              className="mx-auto w-full max-w-[1600px] transition-[padding-right] duration-200"
              style={{
                maxWidth: "var(--shell-page-frame-max-width, 1600px)",
                paddingRight: "var(--agent-panel-reserved-width, 0px)",
              }}
            >
              <div
                data-shell-content="true"
                style={{
                  padding: "var(--shell-page-padding, clamp(1rem, 1vw + 0.75rem, 1.5rem))",
                  minHeight:
                    "calc(100dvh - var(--shell-content-top, 16px) - var(--shell-page-bottom-gap, 16px))",
                }}
              >
                <div
                  className="mx-auto w-full"
                  style={{ maxWidth: "var(--shell-page-content-max-width, 80rem)" }}
                >
                  {children}
                </div>
              </div>
            </div>
          </main>
        </div>
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
