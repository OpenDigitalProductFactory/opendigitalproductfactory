import Link from "next/link";
import { SkillsCatalogView } from "@/components/admin/SkillsCatalogView";
import { SkillsObservatoryPanel } from "@/components/platform/SkillsObservatoryPanel";
import { SkillProposalsPanel } from "@/components/platform/SkillProposalsPanel";
import { SkillRevisionHistoryPanel } from "@/components/platform/SkillRevisionHistoryPanel";
import { SkillCuratorReportPanel } from "@/components/platform/SkillCuratorReportPanel";
import { SkillLifecycleControls } from "@/components/platform/SkillLifecycleControls";
import { SkillEvidencePanel } from "@/components/platform/SkillEvidencePanel";
import {
  getSkillCatalog,
  getSkillCatalogStats,
} from "@/lib/actions/skill-marketplace";
import {
  getSkillsCatalog,
  getFinishingPassActivity,
  getSpecialistExecutions,
  getSkillsObservatoryStats,
  getSkillTelemetrySummary,
  getSkillReviewDetail,
  getLatestSkillCuratorReport,
  getSkillLifecycleState,
  getSkillSeedWarnings,
} from "@/lib/actions/skills-observatory";
import { isSkillLifecycleState } from "@/lib/skills/lifecycle";

export default async function SkillsObservatoryPage({
  searchParams,
}: {
  searchParams?: Promise<{
    skill?: string;
    evidenceThread?: string;
    evidenceTaskRun?: string;
    evidenceRoute?: string;
    evidenceQuery?: string;
  }>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const focusedSkillId =
    typeof resolvedParams.skill === "string" ? resolvedParams.skill : null;
  const evidenceScope = {
    threadId:
      typeof resolvedParams.evidenceThread === "string"
        ? resolvedParams.evidenceThread
        : null,
    taskRunId:
      typeof resolvedParams.evidenceTaskRun === "string"
        ? resolvedParams.evidenceTaskRun
        : null,
    routeContext:
      typeof resolvedParams.evidenceRoute === "string"
        ? resolvedParams.evidenceRoute
        : null,
    query:
      typeof resolvedParams.evidenceQuery === "string"
        ? resolvedParams.evidenceQuery
        : null,
  };

  const [
    catalogSkills,
    catalogStats,
    skills,
    finishingPasses,
    executions,
    stats,
    telemetry,
    review,
    curatorReport,
    lifecycleRow,
    seedWarnings,
  ] = await Promise.all([
    getSkillCatalog(),
    getSkillCatalogStats(),
    getSkillsCatalog(),
    getFinishingPassActivity(),
    getSpecialistExecutions(),
    getSkillsObservatoryStats(),
    getSkillTelemetrySummary(),
    focusedSkillId ? getSkillReviewDetail(focusedSkillId, evidenceScope) : Promise.resolve(null),
    getLatestSkillCuratorReport(),
    focusedSkillId ? getSkillLifecycleState(focusedSkillId) : Promise.resolve(null),
    getSkillSeedWarnings(),
  ]);

  const focusedLifecycleState =
    lifecycleRow && isSkillLifecycleState(lifecycleRow.lifecycleState)
      ? lifecycleRow.lifecycleState
      : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Skills — {catalogStats.total} catalog entries and {stats.totalSkills} route-visible skills across {stats.routes} routes
        </p>
      </div>

      {/* Catalog framing (coworker-management-consolidation WS3): this is the
          GLOBAL skills catalog / observatory. Granting or revoking skills for a
          single coworker lives on that coworker's record, reached from the
          directory. */}
      <div className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 text-xs text-[var(--dpf-muted)]">
        This is the <strong className="text-[var(--dpf-text)]">global skills catalog and observatory</strong>. To grant
        or revoke skills for a single coworker, open that coworker&rsquo;s record from the{" "}
        <Link href="/platform/ai/overview" className="underline text-[var(--dpf-accent)]">
          AI Workforce directory
        </Link>{" "}
        and use its Capabilities tab.
      </div>

      {seedWarnings.length > 0 && (
        <div
          className="mb-6 rounded border p-4"
          style={{
            borderColor: "color-mix(in srgb, var(--dpf-warning) 40%, var(--dpf-border))",
            background: "color-mix(in srgb, var(--dpf-warning) 8%, var(--dpf-surface-1))",
          }}
        >
          <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Seed Warnings</h2>
          <div className="space-y-2">
            {seedWarnings.map((warning) => (
              <div
                key={warning.warningId}
                className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--dpf-text)]">{warning.skillId}</span>
                  <span className="font-mono text-[10px] text-[var(--dpf-muted)]">
                    {warning.warningType}
                  </span>
                </div>
                <p className="mt-1 text-[var(--dpf-muted)]">{warning.message}</p>
                <p className="mt-1 font-mono text-[10px] text-[var(--dpf-muted)]">
                  {warning.legacyPath}{" -> "}{warning.pluginPath}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Catalog</h2>
        <p className="mb-3 text-xs text-[var(--dpf-muted)]">
          Skills are user-triggerable or agent-triggerable actions with capability gates and tool access.
          Prompts remain the system instructions that shape coworker behavior and now live under{" "}
          <Link href="/platform/ai/prompts" className="underline text-[var(--dpf-accent)]">
            Prompts
          </Link>.
        </p>
        <SkillsCatalogView
          skills={JSON.parse(JSON.stringify(catalogSkills))}
          stats={JSON.parse(JSON.stringify(catalogStats))}
        />
      </div>

      <div className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Route Skills</h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          Route-level and universal skills describe what coworkers can surface in-context across the platform.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--dpf-text)]">Observability</h2>
        <SkillsObservatoryPanel
          skills={skills}
          finishingPasses={JSON.parse(JSON.stringify(finishingPasses))}
          specialistExecutions={JSON.parse(JSON.stringify(executions))}
          stats={stats}
          telemetry={telemetry}
        />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-[var(--dpf-text)]">Curator</h2>
        <SkillCuratorReportPanel report={curatorReport} />
      </div>

      {focusedSkillId && (
        <div className="mt-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
              Skill detail — <code>{focusedSkillId}</code>
            </h2>
            <Link
              href="/platform/ai/skills"
              className="text-xs underline text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              Clear focus
            </Link>
          </div>

          {/* Slice 4: lifecycle controls */}
          {focusedLifecycleState && (
            <div className="mb-4">
              <SkillLifecycleControls
                skillId={focusedSkillId}
                currentState={focusedLifecycleState}
              />
            </div>
          )}

          {/* Slice 3: seed drift, proposals, revisions */}
          {review ? (
            <>
              {!review.seedDrift.inSync && review.seedDrift.seedBody !== null && (
                <div
                  className="mb-3 rounded border px-3 py-2 text-xs"
                  style={{
                    borderColor: "color-mix(in srgb, var(--dpf-warning) 35%, var(--dpf-border))",
                    background: "color-mix(in srgb, var(--dpf-warning) 8%, transparent)",
                    color: "var(--dpf-text)",
                  }}
                >
                  <strong>Seed drift:</strong> DB body differs from <code>{review.seedDrift.seedPath}</code>.
                  Patch the seed file in the same PR so a fresh install keeps this change.
                </div>
              )}
              {!review.seedDrift.inSync && review.seedDrift.seedBody === null && (
                <div
                  className="mb-3 rounded border px-3 py-2 text-xs"
                  style={{
                    borderColor: "var(--dpf-border)",
                    background: "var(--dpf-surface-2)",
                    color: "var(--dpf-muted)",
                  }}
                >
                  Seed file not found at <code>{review.seedDrift.seedPath}</code> (normal for production
                  installs where the repo isn&rsquo;t checked out next to the app).
                </div>
              )}
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                  Evidence
                </h3>
                <SkillEvidencePanel evidence={review.evidence} activeScope={evidenceScope} />
              </div>
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                  Proposals
                </h3>
                <SkillProposalsPanel
                  skillId={review.skillId}
                  currentContent={review.skillMdContent}
                  proposals={review.proposals}
                />
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                  Revision history
                </h3>
                <SkillRevisionHistoryPanel skillId={review.skillId} revisions={review.revisions} />
              </div>
            </>
          ) : (
            !focusedLifecycleState && (
              <p className="text-xs text-[var(--dpf-muted)]">
                No skill found with id <code>{focusedSkillId}</code>.
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
