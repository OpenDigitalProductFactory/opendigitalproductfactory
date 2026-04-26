// apps/web/app/(shell)/build/page.tsx
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { getFeatureBuilds } from "@/lib/feature-build-data";
import { getPortfoliosForSelect } from "@/lib/backlog-data";
import { BuildStudio } from "@/components/build/BuildStudio";
import { BuildStudioV2 } from "@/components/build-studio/BuildStudioV2";
import Link from "next/link";
import { execSync } from "child_process";

interface PageProps {
  searchParams: Promise<{ v?: string }>;
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
  const { v } = await searchParams;
  if (v === "2") {
    return <BuildStudioV2 />;
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

  const [builds, portfolios] = await Promise.all([
    getFeatureBuilds(session.user.id),
    getPortfoliosForSelect(),
  ]);

  const projectBranch = getProjectBranch();
  const submissionBranchShortId = devConfig.clientId
    ? devConfig.clientId.replace(/-/g, "").slice(0, 8)
    : null;

  return (
    <section className="min-h-full">
      <BuildStudio
        builds={builds}
        portfolios={portfolios}
        governedBacklogEnabled={devConfig.governedBacklogEnabled}
        dpfEnvironment={process.env.DPF_ENVIRONMENT ?? "production"}
        projectBranch={projectBranch}
        submissionBranchShortId={submissionBranchShortId}
      />
    </section>
  );
}
