// apps/web/app/(shell)/layout.tsx
export const dynamic = "force-dynamic";

import { executeBootstrapDiscovery, prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolveBrandingLogoUrl, buildBrandingStyleTag } from "@/lib/branding";
import { redirect } from "next/navigation";
import { Header } from "@/components/shell/Header";
import { loadInstallationBadge } from "@/lib/install/estate-identity";
import { AgentCoworkerShell } from "@/components/agent/AgentCoworkerShell";
import { QueueFlusher } from "@/components/feedback/QueueFlusher";
import { StatusBanner } from "@/components/shell/StatusBanner";
import { UpdatePendingBanner } from "@/components/shell/UpdatePendingBanner";
import { DeploymentSkewBanner } from "@/components/shell/DeploymentSkewBanner";
import { PlatformBanner } from "@/components/platform/PlatformBanner";
import { SystemEventProvider } from "@/components/platform/SystemEventProvider";
import { ShellBannerOverlay } from "@/components/shell/ShellBannerOverlay";
import { ModelWarmup } from "@/components/shell/ModelWarmup";
import { SetupOverlay } from "@/components/setup/SetupOverlay";
import { getGrantedCapabilities, getShellNavSections } from "@/lib/permissions";
import { cookies } from "next/headers";
import { getActiveOrgCapabilities } from "@/lib/storefront/org-capabilities.server";
import { AppRail } from "@/components/shell/AppRail";
import { ShellBreadcrumb } from "@/components/shell/ShellBreadcrumb";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { resolveHomePhoneCountry } from "@/lib/phone-country.server";
import { PhoneCountryProvider } from "@/components/ui/PhoneCountryContext";
import { NAV_MODE_COOKIE, resolveNavModeFromCookie } from "@/lib/navigation/nav-mode";
import { UxInitialLoadBoundary } from "@/components/shell/UxInitialLoadBoundary";

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

  const [
    latestDiscoveryRun,
    activeBranding,
    organization,
    useUnifiedCoworker,
    phoneCountry,
    activeOrgCapabilities,
  ] = await Promise.all([
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
      select: { name: true, logoUrl: true, cooConversationalName: true },
    }),
    isUnifiedCoworkerEnabled(),
    resolveHomePhoneCountry(),
    getActiveOrgCapabilities().catch((error: unknown) => {
      // Nav must render even if capability resolution fails — archetype-gated
      // entries just stay hidden.
      console.error("[shell-nav] active-capability resolution failed", error);
      return new Set<string>() as ReadonlySet<string>;
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
      const bootstrapProfile = await prisma.employeeProfile.create({
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
        select: { id: true },
      }).catch((err: unknown) => {
        // Unique constraint race — another request already created it
        console.warn("[bootstrap-employee]", err);
        return null;
      });

      // Identity spine: the auto-provisioned owner/admin must get a linked human
      // Principal, same as the governed People-screen path (BI-4150F4D6).
      // syncEmployeePrincipal is idempotent and converges onto any principal the
      // user already has via the shared 'user' alias.
      if (bootstrapProfile) {
        const { syncEmployeePrincipal } = await import(
          "@/lib/identity/principal-linking"
        );
        await syncEmployeePrincipal(bootstrapProfile.id).catch((err: unknown) => {
          console.error("[bootstrap-employee] principal sync failed", err);
        });
      }
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
  // Worker/operator rail mode (EP-NAV-COHERENCE P4 / BI-655418A7). Default
  // "operator" = the full rail; "Simple" writes worker via the rail toggle.
  // Operator is always one toggle away, so worker mode never strands a user.
  const navMode = resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value);
  const userContext = {
    userId: user.id,
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  };
  const shellNavSections = activeSetup
    ? []
    : getShellNavSections(userContext, { activeOrgCapabilities, mode: navMode });
  // The breadcrumb offers only what this principal can open. Same registry the
  // rail filters on and the destination route enforces (BI-2777B86B).
  const grantedCapabilities = getGrantedCapabilities(userContext);

  return (
    <PhoneCountryProvider country={phoneCountry}>
      <SystemEventProvider>
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      <div className="min-h-screen flex flex-col bg-[var(--dpf-bg)]">
        {/* Common Shell Action-Result Contract (BI-9C0954D0) C6: the first
            focusable element skips the global header/rail chrome straight to the
            route task, so keyboard and assistive-tech owners reach their work
            ahead of internal chrome. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:border focus:border-[var(--dpf-accent)] focus:bg-[var(--dpf-surface-1)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--dpf-text)]"
        >
          Skip to main content
        </a>
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
        <ShellBannerOverlay>
          <DeploymentSkewBanner />
          <PlatformBanner />
          <StatusBanner />
          <UpdatePendingBanner />
        </ShellBannerOverlay>
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
          navMode={navMode}
          installationBadge={await loadInstallationBadge({
            readConfig: async (key) =>
              (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null,
          })}
        />
        <div className="flex flex-1 flex-col lg:flex-row">
          {shellNavSections.length > 0 && (
            <aside className="min-w-0 shrink-0 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] lg:w-[248px] lg:border-b-0 lg:border-r">
              <div className="mx-auto w-full min-w-0 max-w-[1600px] lg:max-w-none">
                <AppRail sections={shellNavSections} mode={navMode} />
              </div>
            </aside>
          )}
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 scroll-mt-2 focus:outline-none">
            {/* Full-width by default (operator directive 2026-06-26): the page frame
                fills the viewport so wide surfaces — boards, grids, tables, canvases —
                use all the available room instead of a centered 1600px column. A
                surface that wants a narrower, centered measure (e.g. a reading view)
                opts in via <ShellPresentationMode frameMaxWidth=… contentMaxWidth=… />,
                which mx-auto then re-centers. */}
            <div
              className="mx-auto w-full"
              style={{
                // NOTE: no CSS transition on padding-right. The reserve comes from the
                // unregistered custom property --agent-panel-reserved-width; transitioning
                // a property whose value derives from an unregistered var leaves it stuck
                // at the fallback (0px) after the var updates, which intermittently let
                // content slide under the docked panel. Resolving the var directly (no
                // transition) makes the reserve reliable.
                maxWidth: "var(--shell-page-frame-max-width, none)",
                paddingRight: "var(--agent-panel-reserved-width, 0px)",
              }}
            >
              <div
                data-shell-content="true"
                style={{
                  padding: "var(--shell-page-padding, clamp(1rem, 1vw + 0.75rem, 1.5rem))",
                  // When the coworker panel is docked, the frame already reserves space
                  // for it on the right (--agent-panel-reserved-width). The page's own
                  // right gutter would otherwise STACK on top of that reserve and leave a
                  // dead black band between wide content (grids, boards) and the panel.
                  // Collapse the right padding once the reserve exceeds it, so content
                  // extends up to one clean gap from the panel. Undocked (reserve 0) it
                  // stays the normal page gutter — and the reserve itself remains the
                  // safety margin, so content never slides under the panel.
                  paddingRight:
                    "max(0px, calc(var(--shell-page-padding, clamp(1rem, 1vw + 0.75rem, 1.5rem)) - var(--agent-panel-reserved-width, 0px)))",
                  minHeight:
                    "calc(100dvh - var(--shell-content-top, 16px) - var(--shell-page-bottom-gap, 16px))",
                }}
              >
                <div
                  className="mx-auto w-full"
                  style={{ maxWidth: "var(--shell-page-content-max-width, none)" }}
                >
                  {shellNavSections.length > 0 && (
                    <ShellBreadcrumb capabilities={grantedCapabilities} />
                  )}
                  <UxInitialLoadBoundary>{children}</UxInitialLoadBoundary>
                </div>
              </div>
            </div>
          </main>
        </div>
        <AgentCoworkerShell
          userContext={{ userId: user.id, platformRole: user.platformRole, isSuperuser: user.isSuperuser }}
          useUnifiedCoworker={useUnifiedCoworker}
          cooConversationalName={organization?.cooConversationalName ?? null}
        />
        {/* FeedbackButton moved to Header — see HeaderFeedbackButton */}
        <QueueFlusher />
        <ModelWarmup />
      </div>
      </SystemEventProvider>
    </PhoneCountryProvider>
  );
}
