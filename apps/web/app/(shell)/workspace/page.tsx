// apps/web/app/(shell)/workspace/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@dpf/db";
import { PlatformWorkspaceHome } from "@/components/workspace-home/PlatformWorkspaceHome";
import { VerticalWorkspaceHome } from "@/components/workspace-home/VerticalWorkspaceHome";
import { OperatorCockpit } from "@/components/workspace-home/OperatorCockpit";
import { WorkspaceStorefrontAttention } from "@/components/owner-first/WorkspaceStorefrontAttention";
import { WorkspaceTwinHero } from "@/components/workspace-home/WorkspaceTwinHero";
import { resolveCloudProviderReadiness } from "@/lib/inference/cloud-provider-readiness";
import { CloudProviderUnclearedNotice } from "@/components/workspace-home/CloudProviderUnclearedNotice";
import { LocalOnlyProviderNotice } from "@/components/workspace-home/LocalOnlyProviderNotice";
import { UnconfiguredWorkspaceHomeNotice } from "@/components/workspace-home/UnconfiguredWorkspaceHomeNotice";
import { loadPlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";
import { resolveWorkspaceHomeContribution } from "@/lib/workspace-home/registry";
import { loadWorkspaceTwinPresentation } from "@/lib/workspace-home/twin-panel-data";
import { recordWorkspaceHomeResolution } from "@/lib/workspace-home/telemetry";
import {
  isSimpleNavMode,
  NAV_MODE_COOKIE,
  resolveNavModeFromCookie,
} from "@/lib/navigation/nav-mode";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // BI-655418A7: Simple mode must condense the home body, not only the rail.
  const navMode = resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value);
  const simpleHome = isSimpleNavMode(navMode);
  const platformHomeData = await loadPlatformWorkspaceHomeData({
    prismaClient: prisma,
    user: session.user,
  });
  const workspaceHomeResolution = resolveWorkspaceHomeContribution({
    storefrontConfig: platformHomeData.storefrontConfig,
  });

  // The operational twin becomes the main workspace view (EP-LIVING-BUSINESS-VIZ
  // P3). It derives for every archetype with a definition, independent of whether
  // a workspace-home registry contribution is seeded; a resolution miss falls back
  // to the existing home. Now wired to the LIVE `LivingBusinessSnapshot` projection
  // (increment 2a) — real business data where the org has it, deterministic demo
  // otherwise.
  const archetypeRef = platformHomeData.storefrontConfig?.archetype ?? null;
  const twinPresentation = await loadWorkspaceTwinPresentation(
    archetypeRef?.archetypeId ?? null,
    archetypeRef?.name ?? null,
  );
  const restaurantShift = Boolean(twinPresentation?.restaurantFloor);

  // BI-575F0046: counting active non-local providers reported a fresh install as
  // HAVING cloud AI the moment one was connected — while its clearance was
  // `["public"]` and no turn is ever public, so nothing could use it and the
  // local-only notice disappeared. Ask whether a provider can take work, not
  // whether one exists.
  const cloudReadiness = resolveCloudProviderReadiness(
    await prisma.modelProvider.findMany({
      where: { status: "active" },
      select: { providerId: true, name: true, status: true, sensitivityClearance: true },
    }),
  );
  // Fire-and-forget — the metric increment is observability, not load-bearing,
  // and we don't want a Prometheus registry mishap to break the page render.
  void recordWorkspaceHomeResolution(
    workspaceHomeResolution,
    platformHomeData.storefrontConfig?.archetype ?? null,
  ).catch(() => {
    // Swallow — counter recording must not affect the response.
  });

  // The operator cockpit — the ONE consolidated "what needs you now" surface,
  // organized OUTSIDE-IN from the customer inward, with a single attention count
  // and honest customer-impact ranking (BI-8C3EB52C, BI-2651043B, BI-D35DE119).
  // Supersedes the old "Needs you" band; it always states its state, so no other
  // panel can contradict its count. On the twin hero it folds in as the HUD rail so
  // there is still exactly ONE attention surface.
  // Storefront/Funnel signals are reconciled into the attention surface FIRST,
  // then the cockpit renders the generic coworker-decision residue below it
  // (BI-3BCAF95F). The storefront band self-hides when there is no guest work, so
  // it never adds an empty panel to the surface we are decluttering.
  const cockpit = (
    <>
      <WorkspaceStorefrontAttention density={simpleHome || restaurantShift ? "simple" : "full"} />
      <OperatorCockpit
        userId={session.user.id}
        audience={simpleHome || restaurantShift ? "worker" : "operator"}
      />
    </>
  );

  return (
    <div data-nav-mode={navMode}>
      {/* The installation identity panel used to open this page and cost roughly
          the top third of the first viewport (BI-7626A660). It now lives at
          /ops/installation, and the header badge — non-production only — is the
          arrival-time signal. The operator's actual work starts here. */}
      {workspaceHomeResolution.mode === "unconfigured" && <UnconfiguredWorkspaceHomeNotice />}
      {workspaceHomeResolution.mode !== "unconfigured" && cloudReadiness.state === "none" && (
        <LocalOnlyProviderNotice />
      )}
      {workspaceHomeResolution.mode !== "unconfigured" && cloudReadiness.state === "public-only" && (
        <CloudProviderUnclearedNotice providerNames={cloudReadiness.providerNames} />
      )}
      {twinPresentation ? (
        // Operator-confirmed placement (parent spec §9 option c): the operational
        // twin is the main workspace view, a dedicated hero with the cockpit folded
        // in as its HUD and the platform launcher demoted below.
        <WorkspaceTwinHero
          cockpit={cockpit}
          presentation={twinPresentation}
          contribution={
            workspaceHomeResolution.mode === "vertical"
              ? workspaceHomeResolution.contribution
              : null
          }
          density={simpleHome ? "simple" : "full"}
          platformBody={
            <PlatformWorkspaceHome
              data={platformHomeData}
              heading="All workspace areas"
              density="simple"
            />
          }
        />
      ) : (
        <>
          {cockpit}
          {workspaceHomeResolution.mode === "vertical" ? (
            <VerticalWorkspaceHome
              contribution={workspaceHomeResolution.contribution}
              data={platformHomeData}
            />
          ) : (
            <PlatformWorkspaceHome
              data={platformHomeData}
              density={simpleHome ? "simple" : "full"}
            />
          )}
        </>
      )}
    </div>
  );
}
