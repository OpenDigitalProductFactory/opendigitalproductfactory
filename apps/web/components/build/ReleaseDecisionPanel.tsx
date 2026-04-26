"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuildFlowState } from "@/lib/build-flow-state";
import type { PortfolioForSelect } from "@/lib/backlog-data";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { deriveReleaseDecisionCards, isMissingReleasableDiffError, type ReleaseDecisionTone } from "@/lib/build/release-decision";
import {
  executeBuildPromotion,
  prepareBuildRelease,
  registerBuildRelease,
  scheduleBuildPromotion,
  submitBuildContribution,
} from "@/lib/actions/build-release";
import { resumeBuildImplementation } from "@/lib/actions/build";

type Props = {
  build: FeatureBuildRow;
  flowState: BuildFlowState | null;
  portfolios: PortfolioForSelect[];
  onCompleted?: () => Promise<void> | void;
};

type PendingAction =
  | "prepare"
  | "register"
  | "contribute"
  | "deploy"
  | "schedule"
  | "resume"
  | null;

function toneStyles(tone: ReleaseDecisionTone): { borderColor: string; backgroundColor: string; badgeColor: string } {
  switch (tone) {
    case "success":
      return {
        borderColor: "color-mix(in srgb, var(--dpf-success) 45%, var(--dpf-border))",
        backgroundColor: "color-mix(in srgb, var(--dpf-success) 10%, var(--dpf-surface-1))",
        badgeColor: "var(--dpf-success)",
      };
    case "ready":
      return {
        borderColor: "color-mix(in srgb, var(--dpf-accent) 45%, var(--dpf-border))",
        backgroundColor: "color-mix(in srgb, var(--dpf-accent) 10%, var(--dpf-surface-1))",
        badgeColor: "var(--dpf-accent)",
      };
    case "warning":
      return {
        borderColor: "color-mix(in srgb, var(--dpf-warning) 45%, var(--dpf-border))",
        backgroundColor: "color-mix(in srgb, var(--dpf-warning) 9%, var(--dpf-surface-1))",
        badgeColor: "var(--dpf-warning)",
      };
    case "danger":
      return {
        borderColor: "color-mix(in srgb, var(--dpf-error) 45%, var(--dpf-border))",
        backgroundColor: "color-mix(in srgb, var(--dpf-error) 8%, var(--dpf-surface-1))",
        badgeColor: "var(--dpf-error)",
      };
    case "neutral":
    default:
      return {
        borderColor: "var(--dpf-border)",
        backgroundColor: "var(--dpf-surface-1)",
        badgeColor: "var(--dpf-muted)",
      };
  }
}

export function ReleaseDecisionPanel({
  build,
  flowState,
  portfolios,
  onCompleted,
}: Props) {
  const router = useRouter();
  const cards = useMemo(() => deriveReleaseDecisionCards(build, flowState), [build, flowState]);
  const [productName, setProductName] = useState(build.title);
  const [portfolioSlug, setPortfolioSlug] = useState(() => {
    const matching = portfolios.find((portfolio) => portfolio.id === build.portfolioId);
    return matching?.slug ?? portfolios[0]?.slug ?? "";
  });
  const [versionBump, setVersionBump] = useState<"major" | "minor" | "patch">("patch");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promotionId = flowState?.promote.promotionId ?? null;
  const releasePrepared = typeof build.diffPatch === "string" && build.diffPatch.trim().length > 0;
  const releaseRegistered = !!build.digitalProductId || !!promotionId;
  const upstreamDone = flowState?.upstream.state === "shipped";
  const promoteDone = flowState?.promote.state === "shipped";
  const missingDiffRecovery = isMissingReleasableDiffError(error);

  async function runAction(
    action: PendingAction,
    fn: () => Promise<{ message?: string | null; success?: boolean; error?: string | null }>,
  ) {
    if (!action) return;
    setPendingAction(action);
    setError(null);
    try {
      const result = await fn();
      if ("success" in result && result.success === false) {
        setMessage(null);
        setError(result.message ?? result.error ?? "The release action could not be completed.");
        return;
      }
      setMessage(result.message ?? null);
      router.refresh();
      await onCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The release action could not be completed.");
    } finally {
      setPendingAction(null);
    }
  }

  function openCoworker(prompt: string) {
    document.dispatchEvent(
      new CustomEvent("open-agent-panel", {
        detail: {
          autoMessage: prompt,
          targetBuildId: build.buildId,
        },
      }),
    );
  }

  const showRegistrationForm = releasePrepared && !releaseRegistered;
  const canRegister = showRegistrationForm && productName.trim().length > 0 && portfolioSlug.trim().length > 0;

  return (
    <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" data-testid="release-decision-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
            Release Decisions
          </p>
          <h4 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
            Govern community sharing, release registration, and production change timing from one place.
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
            This is the release-side control surface for the current Build Studio effort. Prepare the release evidence first, then register the promotion, decide whether to contribute upstream, and execute or schedule the operational change.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--dpf-text)]">
          {build.phase}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {cards.map((card) => {
          const styles = toneStyles(card.tone);
          return (
            <div
              key={card.title}
              className="rounded-xl border p-3"
              style={{ borderColor: styles.borderColor, backgroundColor: styles.backgroundColor }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--dpf-text)]">{card.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">{card.summary}</p>
                </div>
                <span
                  className="inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em]"
                  style={{ borderColor: styles.borderColor, color: styles.badgeColor }}
                >
                  {card.label}
                </span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--dpf-muted)]">{card.detail}</p>
            </div>
          );
        })}
      </div>

      {(message || error) && (
        <div
          className="mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed"
          style={{
            borderColor: error ? "var(--dpf-error)" : "var(--dpf-border)",
            backgroundColor: error
              ? "color-mix(in srgb, var(--dpf-error) 8%, var(--dpf-surface-1))"
              : "var(--dpf-surface-2)",
            color: error ? "var(--dpf-error)" : "var(--dpf-text)",
          }}
        >
          {error ?? message}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {!releasePrepared && (
          missingDiffRecovery ? (
            <ActionStrip
              title="1. Resume Implementation"
              description="Release preparation proved that this ship-phase build does not yet contain a real source diff. Reopen implementation from Build Studio so the coworker can produce the keeper change in the sandbox before release continues."
              primaryLabel={pendingAction === "resume" ? "Reopening implementation..." : "Resume Implementation"}
              onPrimary={() => runAction("resume", async () => {
                await resumeBuildImplementation(build.buildId);
                return {
                  message: "Implementation reopened. Build Studio is moving this effort back into a real sandbox pass so the coworker can produce a releasable source diff.",
                };
              })}
              disabled={pendingAction != null}
              secondaryLabel="Recover with coworker"
              onSecondary={() => openCoworker("Release preparation found no real source diff. Reopen implementation, make the actual Build Studio layout fix in the sandbox, and tell me when release evidence is ready again.")}
            />
          ) : (
            <ActionStrip
              title="1. Prepare Release Evidence"
              description="Extract the sandbox diff, capture the release summary, and make the promotion-ready artifacts visible to the rest of the workflow."
              primaryLabel={pendingAction === "prepare" ? "Preparing release..." : "Prepare Release"}
              onPrimary={() => runAction("prepare", () => prepareBuildRelease(build.buildId))}
              disabled={pendingAction != null}
              onSecondary={() => openCoworker("Summarize what still needs to be captured before this build is ready for governed release decisions.")}
            />
          )
        )}

        {showRegistrationForm && (
          <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-sm font-semibold text-[var(--dpf-text)]">2. Register the Governed Promotion</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
              Choose the product name, target portfolio, and version bump for the production-facing promotion record.
            </p>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-[var(--dpf-muted)]">
                Product name
                <input
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--dpf-muted)]">
                Portfolio
                <select
                  value={portfolioSlug}
                  onChange={(event) => setPortfolioSlug(event.target.value)}
                  className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none"
                >
                  {portfolios.map((portfolio) => (
                    <option
                      key={portfolio.id}
                      value={portfolio.slug}
                      className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                    >
                      {portfolio.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--dpf-muted)]">
                Version bump
                <select
                  value={versionBump}
                  onChange={(event) => setVersionBump(event.target.value as "major" | "minor" | "patch")}
                  className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none"
                >
                  <option value="patch" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Patch</option>
                  <option value="minor" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Minor</option>
                  <option value="major" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Major</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canRegister || pendingAction != null}
                onClick={() => runAction("register", () => registerBuildRelease({
                  buildId: build.buildId,
                  name: productName.trim(),
                  portfolioSlug,
                  versionBump,
                }))}
                className="inline-flex items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === "register" && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                {pendingAction === "register" ? "Registering promotion..." : "Create Promotion"}
              </button>
              <button
                type="button"
                onClick={() => openCoworker("Summarize the release registration decision, including the best portfolio and version bump for this build.")}
                className="inline-flex items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
              >
                Ask coworker
              </button>
            </div>
          </div>
        )}

        {releaseRegistered && (
          <ActionStrip
            title="3. Community Sharing"
            description={upstreamDone
              ? "A governed upstream pull request already exists for this build."
              : "Submit the shipped change upstream so the community-sharing lane reaches a governed terminal state."}
            primaryLabel={upstreamDone ? "Shared upstream" : pendingAction === "contribute" ? "Submitting PR..." : "Submit Upstream PR"}
            onPrimary={() => runAction("contribute", () => submitBuildContribution(build.buildId))}
            disabled={pendingAction != null || upstreamDone}
            secondaryLabel="Review with coworker"
            onSecondary={() => openCoworker("Summarize the upstream contribution readiness for this build and any risks before I open the PR.")}
          />
        )}

        {promotionId && (
          <ActionStrip
            title="4. Deployment Timing"
            description={promoteDone
              ? "The promotion has been deployed. If community sharing is also complete, the build should reconcile to done."
              : "Deploy now if the window is open, or schedule the approved promotion for the next governed release window."}
            primaryLabel={promoteDone ? "Promotion deployed" : pendingAction === "deploy" ? "Starting deployment..." : "Deploy Promotion"}
            onPrimary={() => runAction("deploy", () => executeBuildPromotion(promotionId))}
            disabled={pendingAction != null || promoteDone}
            secondaryLabel={promoteDone ? "Review with coworker" : pendingAction === "schedule" ? "Scheduling..." : "Schedule Next Window"}
            onSecondary={() => promoteDone
              ? openCoworker("Summarize the promotion outcome, rollout confidence, and whether anything remains before this build can close.")
              : runAction("schedule", () => scheduleBuildPromotion(promotionId))}
          />
        )}
      </div>
    </div>
  );
}

function ActionStrip({
  title,
  description,
  primaryLabel,
  onPrimary,
  disabled,
  secondaryLabel = "Ask coworker",
  onSecondary,
}: {
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  disabled: boolean;
  secondaryLabel?: string;
  onSecondary: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPrimary}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={onSecondary}
            className="inline-flex items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
