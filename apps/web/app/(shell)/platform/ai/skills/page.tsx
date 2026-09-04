import Link from "next/link";
import { ListShell } from "@/components/page-shells";
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
  getPendingSkillProposals,
} from "@/lib/actions/skills-observatory";
import { isSkillLifecycleState } from "@/lib/skills/lifecycle";

// Migrated to the L1 `list` shell (BI-36CE8BAB, EP-UX-SYSTEM §6 L1).
//
// This route was the portal's second-worst surface at 5,349 default-visible
// words against a 450-word budget, with ZERO lead-band words and an
// accessibility tree that was a flat run of ~150 sibling paragraphs. It stacked
// five unrelated panels vertically with no way to skip any of them.
//
// An interim fix capped the catalog at 12 rows, which brought the measurement to
// 1,352 but by HIDING skills — a masked list (BI-836923AD): a subset with no
// indication of what is missing, and a search that silently disagrees with the
// screen. This replaces the cap with structure and freezes at 205.
//
// The content did not shrink; it got a hierarchy. The catalog is what a reader
// comes here for and stays default-visible, grouped by category and collapsed;
// observability, the curator report and seed-drift detail are diagnostics and
// now sit behind one disclosure. Nothing was removed and every control and every
// skill remains reachable.

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
    pendingProposals,
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
    getPendingSkillProposals(),
  ]);

  const focusedLifecycleState =
    lifecycleRow && isSkillLifecycleState(lifecycleRow.lifecycleState)
      ? lifecycleRow.lifecycleState
      : null;

  return (
    <ListShell
      title="Skills"
      lead={`What your coworkers know how to do. ${catalogStats.total} skills in the catalog.`}
      // Granting a skill is the verb people come here for, and it lives on the
      // coworker's record rather than on this page. It used to be a sentence of
      // prose in the middle of a banner; making it the marked next action is
      // both the honest hierarchy and what makes "this screen says what to do
      // next" measurable instead of asserted.
      nextAction={{
        label: "Grant a skill to a coworker",
        href: "/platform/ai/overview",
        hint: "You grant skills one coworker at a time, on their record.",
      }}
      // Rendered only when something is genuinely wrong. A permanent "all clear"
      // banner trains people to skip the band that carries the real warnings.
      attention={
        // A pending proposal leads: it is the only item here that is waiting on
        // a person. Before BI-2F9EE2E9 the catalog gave no sign one existed and
        // the detail page was reachable only by hand-typing ?skill=, so a
        // decision could wait indefinitely with nobody told.
        pendingProposals.length > 0 || seedWarnings.length > 0 ? (
          <>
            {pendingProposals.length > 0 && (
              <>
                {pendingProposals.length} skill change
                {pendingProposals.length !== 1 ? "s are" : " is"} waiting for your review:{" "}
                {pendingProposals.map((item, index) => (
                  <span key={item.id}>
                    {index > 0 && ", "}
                    <a href={item.deepLink} className="underline">
                      {item.title.replace("Review a change to ", "")}
                    </a>
                  </span>
                ))}
                .{" "}
              </>
            )}
            {seedWarnings.length > 0 && (
              <>
                {seedWarnings.length} skill{seedWarnings.length !== 1 ? "s have" : " has"} drifted
                from the seed, so a fresh install would not match this one. Detail is under
                Technical details.
              </>
            )}
          </>
        ) : undefined
      }
      actions={[{ label: "Prompts", href: "/platform/ai/prompts" }]}
      technicalDetails={
        <div className="space-y-6">
          <section>
            <h2 className="mb-1 text-sm font-semibold text-[var(--dpf-text)]">Route skills</h2>
            <p className="text-xs text-[var(--dpf-muted)]">
              {stats.totalSkills} route-visible skills across {stats.routes} routes — what coworkers
              can surface in context.
            </p>
          </section>

          {seedWarnings.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Seed drift</h2>
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
                      {warning.legacyPath}
                      {" -> "}
                      {warning.pluginPath}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-[var(--dpf-text)]">Observability</h2>
            <SkillsObservatoryPanel
              skills={skills}
              finishingPasses={JSON.parse(JSON.stringify(finishingPasses))}
              specialistExecutions={JSON.parse(JSON.stringify(executions))}
              stats={stats}
              telemetry={telemetry}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-[var(--dpf-text)]">Curator</h2>
            <SkillCuratorReportPanel report={curatorReport} />
          </section>
        </div>
      }
    >
      <SkillsCatalogView
        skills={JSON.parse(JSON.stringify(catalogSkills))}
        stats={JSON.parse(JSON.stringify(catalogStats))}
      />

      {/* When ?skill= is set, that skill IS why the reader is here — so it stays
          default-visible rather than being demoted with the diagnostics. */}
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

          {focusedLifecycleState && (
            <div className="mb-4">
              <SkillLifecycleControls
                skillId={focusedSkillId}
                currentState={focusedLifecycleState}
              />
            </div>
          )}

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
              {review.seedDrift.seedStatus === "missing-in-repo" && (
                <div
                  className="mb-3 rounded border px-3 py-2 text-xs"
                  style={{
                    borderColor: "color-mix(in srgb, var(--dpf-warning) 35%, var(--dpf-border))",
                    background: "color-mix(in srgb, var(--dpf-warning) 8%, transparent)",
                    color: "var(--dpf-text)",
                  }}
                >
                  <strong>Drift can&rsquo;t be checked.</strong> The repo is present but this
                  skill has no seed file, so an approval can&rsquo;t be compared with what ships.
                  Looked in:{" "}
                  {review.seedDrift.candidatePaths.map((candidate, index) => (
                    <span key={candidate}>
                      {index > 0 && ", "}
                      <code>{candidate}</code>
                    </span>
                  ))}
                  .
                </div>
              )}
              {review.seedDrift.seedStatus === "repo-unavailable" && (
                <div
                  className="mb-3 rounded border px-3 py-2 text-xs"
                  style={{
                    borderColor: "var(--dpf-border)",
                    background: "var(--dpf-surface-2)",
                    color: "var(--dpf-muted)",
                  }}
                >
                  No repo checkout is reachable, so seed drift can&rsquo;t be checked (normal on
                  production).
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
    </ListShell>
  );
}
