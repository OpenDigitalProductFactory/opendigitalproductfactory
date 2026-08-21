// apps/web/app/(shell)/build/page.tsx
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { getExecutionEpicRollups, getFeatureBuildById, getFeatureBuilds } from "@/lib/feature-build-data";
import { getPortfoliosForSelect } from "@/lib/backlog-data";
import { BuildStudio } from "@/components/build/BuildStudio";
import { loadBuildStudioCapability } from "@/lib/build/build-studio-capability";
import { loadBuildStudioCustomerStatuses, type CapsuleFindManyDelegate } from "@/lib/build/customer-status-loader";
import { resolvePortalContextEnvelope } from "@/lib/portal-context";
import { can } from "@/lib/govern/permissions";
import { EnableRunnerButton } from "@/components/build/EnableRunnerButton";
import Link from "next/link";
import { execSync } from "child_process";

interface PageProps {
  searchParams: Promise<{ buildId?: string }>;
}

function getProjectBranch(): string | null {
  try {
    // /workspace is the source volume (bootstrapped or user-managed)
    return execSync("git -C /workspace rev-parse --abbrev-ref HEAD", { encoding: "utf-8", timeout: 2000 }).trim() || null;
  } catch {
    try {
      // Shared workspace mode: CWD is the repo
      return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8", timeout: 2000 }).trim() || null;
    } catch {
      return null;
    }
  }
}

export default async function BuildPage({ searchParams }: PageProps) {
  const { buildId } = await searchParams;

  const session = await auth();
  if (!session?.user?.id) return null;

  // First-run gate: Build Studio requires platform development mode to be configured
  const devConfig = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
  if (!devConfig) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md space-y-4">
          <div className="text-4xl opacity-30">&#9881;</div>
          <h2 className="text-lg font-semibold text-[var(--dpf-text)]">
            Platform Development requires setup
          </h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Before using Build Studio, your administrator needs to configure how
            customisations are managed.
          </p>
          <Link
            href="/admin/platform-development"
            className="inline-block rounded px-4 py-2 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Go to Admin &rarr; Platform Development
          </Link>
        </div>
      </div>
    );
  }

  // Capability gate (G1): Build Studio's build-specialist agent needs a
  // strong-tier model with tool use and ≥32K context. On a typical first-
  // customer install only the local Docker Model Runner is active, which
  // cannot satisfy that floor. Rather than letting Dale type into a doomed
  // pipeline and hit opaque agent failures, surface "connect a provider" as
  // the obvious next step.
  const capability = await loadBuildStudioCapability();
  if (!capability.ok) {
    const isOnlyLocal = capability.reason === "only_local_provider_active";
    // Inline-enable only makes sense for operators who can flip provider
    // status; everyone else still gets the connect-a-provider link.
    const canManageProviders = can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    );
    const enableableRunners = canManageProviders ? capability.enableableRunners : [];
    // Prefer Claude as the headline runner when present (matches the
    // orchestrator's default subscription codegen path), else first available.
    const primaryRunner =
      enableableRunners.find((r) => r.shortLabel === "Claude") ?? enableableRunners[0];
    const heading = primaryRunner
      ? `${primaryRunner.shortLabel} is connected but turned off`
      : isOnlyLocal
        ? "Connect a code-capable AI runner to start building"
        : "Build Studio needs a code-capable AI runner";
    const body = primaryRunner
      ? `${primaryRunner.shortLabel} is already set up on this install — it's just disabled. Enable it right here to start building; no trip to provider settings needed.`
      : isOnlyLocal
        ? "Build Studio writes code and orchestrates tools for you. The local AI on this install can chat, but it is not the right runner for production code work yet. Connect a subscription CLI path or an API-key provider below, then the build flow opens up."
        : "Build Studio needs an active runner that can write code and use tools at production quality. ChatGPT/OpenAI Codex and Claude can both satisfy this through OAuth subscription CLI paths; OpenAI and Anthropic API keys are separate pay-per-token licensing paths.";
    return (
      <div className="flex items-start justify-center min-h-[60vh] px-6 py-10">
        <div className="max-w-2xl w-full space-y-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="text-4xl opacity-30" aria-hidden="true">&#128274;</div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-[var(--dpf-text)]">
                {heading}
              </h2>
              <p className="text-sm leading-relaxed text-[var(--dpf-muted)]">{body}</p>
            </div>
          </div>

          {enableableRunners.length > 0 ? (
            <div className="space-y-3 border-t border-[var(--dpf-border)] pt-5">
              {enableableRunners.map((runner) => (
                <div
                  key={runner.providerId}
                  className="flex items-center justify-between gap-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3"
                >
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-[var(--dpf-text)]">{runner.name}</div>
                    <div className="text-xs text-[var(--dpf-muted)]">
                      Connected but turned off — enable to start building.
                    </div>
                  </div>
                  <EnableRunnerButton providerId={runner.providerId} label={runner.shortLabel} />
                </div>
              ))}
            </div>
          ) : null}

          {enableableRunners.length > 0 ? (
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">
              Or connect a different runner
            </p>
          ) : null}

          <ul
            className={`space-y-3 ${enableableRunners.length > 0 ? "pt-1" : "border-t border-[var(--dpf-border)] pt-5"}`}
          >
            {capability.suggestedProviders.map((provider) => (
              <li key={provider.name} className="flex items-start gap-3">
                <span
                  className={`mt-1 inline-block h-2 w-2 rounded-full ${
                    provider.recommended ? "bg-[var(--dpf-accent)]" : "bg-[var(--dpf-muted)] opacity-50"
                  }`}
                  aria-hidden="true"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--dpf-text)]">
                    {provider.name}
                    {provider.recommended ? (
                      <span className="ml-2 text-xs font-normal uppercase tracking-wide text-[var(--dpf-accent)]">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-[var(--dpf-muted)]">{provider.description}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-3 border-t border-[var(--dpf-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/platform/ai/providers"
              className={`inline-block rounded px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 ${
                enableableRunners.length > 0
                  ? "border border-[var(--dpf-border)] text-[var(--dpf-text)]"
                  : "bg-[var(--dpf-accent)] text-white"
              }`}
            >
              {enableableRunners.length > 0 ? "Connect a different provider" : "Connect a provider"} &rarr;
            </Link>
            <span className="text-xs text-[var(--dpf-muted)]">
              {capability.activeProviderNames.length === 0
                ? "No AI providers are connected yet."
                : `Currently connected: ${capability.activeProviderNames.join(", ")}`}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const [builds, epicRollups, portfolios] = await Promise.all([
    getFeatureBuilds(session.user.id),
    getExecutionEpicRollups(session.user.id),
    getPortfoliosForSelect(),
  ]);
  const initialActiveBuild = buildId && !builds.some((build) => build.buildId === buildId)
    ? await getFeatureBuildById(buildId)
    : null;
  // BI-BB13B599: project each build (+ any out-of-list initial build) into its
  // plain, capsule-derived customer-mode status so BuildStudio can render the
  // first-viewport "wife-test" status band without pulling the projection into
  // the client bundle.
  const customerStatuses = await loadBuildStudioCustomerStatuses(
    // Prisma's real `groupBy` typing is a conditional generic that doesn't
    // structurally satisfy the narrow, test-mockable delegate interface;
    // this cast is the documented escape hatch (see CapsuleFindManyDelegate's
    // doc comment) rather than widening the interface and breaking test mocks.
    prisma as unknown as CapsuleFindManyDelegate,
    [...builds, ...(initialActiveBuild ? [initialActiveBuild] : [])].map((build) => ({
      id: build.id,
      buildId: build.buildId,
      title: build.title,
      phase: build.phase,
      updatedAt: build.updatedAt,
    })),
  );
  const portalContext = await resolvePortalContextEnvelope(
    {
      pathname: "/build",
      routeContext: "/build",
      buildId: buildId ?? null,
      searchParams: {
        ...(buildId ? { buildId } : {}),
      },
    },
    session.user.id,
  );

  const projectBranch = getProjectBranch();
  const submissionBranchShortId = devConfig.clientId
    ? devConfig.clientId.replace(/-/g, "").slice(0, 8)
    : null;

  // BI-E167A8A6: Build Studio has two work-intake doors. Door 2 — "Work Control /
  // Plan governed work" — creates a git-governed work capsule and needs
  // manage_backlog (createGovernedWorkAction enforces it server-side). Only
  // surface that door to operators who can actually use it; everyone else sees
  // the single plain-English "Start a new build" door, removing the "which one
  // is correct?" confusion.
  const canManageGovernedWork = can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_backlog",
  );

  return (
    <section className="min-h-full">
      <BuildStudio
        builds={builds}
        epicRollups={epicRollups}
        portfolios={portfolios}
        governedBacklogEnabled={devConfig.governedBacklogEnabled}
        canManageGovernedWork={canManageGovernedWork}
        dpfEnvironment={process.env.DPF_ENVIRONMENT ?? "production"}
        projectBranch={projectBranch}
        submissionBranchShortId={submissionBranchShortId}
        initialBuildId={buildId}
        portalContext={portalContext}
        initialActiveBuild={initialActiveBuild}
        customerStatuses={customerStatuses}
      />
    </section>
  );
}
