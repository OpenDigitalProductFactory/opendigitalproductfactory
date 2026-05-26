// apps/web/app/(shell)/build/page.tsx
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { getExecutionEpicRollups, getFeatureBuildById, getFeatureBuilds } from "@/lib/feature-build-data";
import { getPortfoliosForSelect } from "@/lib/backlog-data";
import { businessBuildBriefFromRecord } from "@/lib/build/business-build-brief";
import { BuildStudio } from "@/components/build/BuildStudio";
import { BuildStudioV2 } from "@/components/build-studio/BuildStudioV2";
import { loadBuildStudioCapability } from "@/lib/build/build-studio-capability";
import { resolvePortalContextEnvelope } from "@/lib/portal-context";
import Link from "next/link";
import { execSync } from "child_process";

interface PageProps {
  searchParams: Promise<{ v?: string; buildId?: string }>;
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
  const { v, buildId } = await searchParams;
  if (v === "2") {
    const session = await auth();
    if (!session?.user?.id) return <BuildStudioV2 />;

    const businessBriefRow = await prisma.businessBuildBrief.findFirst({
      where: { submittedByUserId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        briefId: true,
        status: true,
        intakeSource: true,
        capabilityPackId: true,
        featureBuildId: true,
        businessOutcome: true,
        affectedPeople: true,
        affectedWorkflow: true,
        sourceEvidence: true,
        successSignals: true,
        constraints: true,
        businessInterpretation: true,
        technicalInterpretation: true,
        riskProfile: true,
        openQuestions: true,
        confidence: true,
      },
    });

    const featureBuild = businessBriefRow?.featureBuildId
      ? await prisma.featureBuild.findUnique({
        where: { id: businessBriefRow.featureBuildId },
        select: { title: true },
      })
      : null;

    const businessBrief = businessBriefRow
      ? businessBuildBriefFromRecord({
        title: featureBuild?.title ?? businessBriefRow.briefId,
        row: businessBriefRow,
      })
      : undefined;

    return <BuildStudioV2 businessBrief={businessBrief} />;
  }

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
    const heading = isOnlyLocal
      ? "Connect a code-capable AI runner to start building"
      : "Build Studio needs a code-capable AI runner";
    const body = isOnlyLocal
      ? "Build Studio writes code and orchestrates tools for you. The local AI on this install can chat, but it is not the right runner for production code work yet. Connect a subscription CLI path or an API-key provider below, then the build flow opens up."
      : "Build Studio needs an active runner that can write code and use tools at production quality. ChatGPT/OpenAI Codex can satisfy this through OAuth and Codex CLI; OpenAI and Anthropic API keys are separate pay-per-token licensing paths.";
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

          <ul className="space-y-3 border-t border-[var(--dpf-border)] pt-5">
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
              className="inline-block rounded px-5 py-2.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
            >
              Connect a provider &rarr;
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
  const portalContext = await resolvePortalContextEnvelope(
    {
      pathname: "/build",
      routeContext: "/build",
      buildId: buildId ?? null,
      searchParams: {
        ...(v ? { v } : {}),
        ...(buildId ? { buildId } : {}),
      },
    },
    session.user.id,
  );

  const projectBranch = getProjectBranch();
  const submissionBranchShortId = devConfig.clientId
    ? devConfig.clientId.replace(/-/g, "").slice(0, 8)
    : null;

  return (
    <section className="min-h-full">
      <BuildStudio
        builds={builds}
        epicRollups={epicRollups}
        portfolios={portfolios}
        governedBacklogEnabled={devConfig.governedBacklogEnabled}
        dpfEnvironment={process.env.DPF_ENVIRONMENT ?? "production"}
        projectBranch={projectBranch}
        submissionBranchShortId={submissionBranchShortId}
        initialBuildId={buildId}
        portalContext={portalContext}
        initialActiveBuild={initialActiveBuild}
      />
    </section>
  );
}
