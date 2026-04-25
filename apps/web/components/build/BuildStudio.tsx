// apps/web/components/build/BuildStudio.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhaseIndicator } from "./PhaseIndicator";
import { FeatureBriefPanel } from "./FeatureBriefPanel";
import { ReviewPanel } from "./ReviewPanel";
import { PreviewUrlCard } from "./PreviewUrlCard";
import { ClaimBadge } from "./ClaimBadge";
import { ProcessGraph } from "./ProcessGraph";
import { BuildStudioWorkflowActionCard } from "./BuildStudioWorkflowActionCard";
import { deriveBuildStudioWorkflowAction } from "./build-studio-workflow-actions";
import { resolveBuildStudioBranchBadge } from "./build-studio-branch-badge";
import { createFeatureBuild, deleteFeatureBuild } from "@/lib/actions/build";
import { getFeatureBuild } from "@/lib/actions/build-read";
import { getBuildFlowStateAction } from "@/lib/actions/build-flow";
import type { BuildFlowState } from "@/lib/build-flow-state";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { BuildExecutionState } from "@/lib/integrate/build-exec-types";
import { STEP_LABELS } from "@/lib/integrate/build-exec-types";
import type { PortfolioForSelect } from "@/lib/backlog-data";
import { deriveLifecycleLabel } from "@/lib/governed-backlog-workflow";
import {
  BUILD_STUDIO_TEST_IDS,
  getBuildStudioGraphPanelClassName,
  getBuildStudioShellClassName,
  getBuildStudioSidebarClassName,
} from "./build-studio-layout";

type Props = {
  builds: FeatureBuildRow[];
  portfolios: PortfolioForSelect[];
  governedBacklogEnabled: boolean;
  dpfEnvironment?: string;
  projectBranch?: string | null;
  submissionBranchShortId?: string | null;
};

export function BuildStudio({
  builds,
  portfolios,
  governedBacklogEnabled,
  dpfEnvironment,
  projectBranch,
  submissionBranchShortId,
}: Props) {
  const router = useRouter();
  const [activeBuild, setActiveBuild] = useState<FeatureBuildRow | null>(
    builds.find((b) => b.phase !== "complete" && b.phase !== "failed") ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [buildView, setBuildView] = useState<"preview" | "docs" | "graph">("graph");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isDevEnvironment = dpfEnvironment === "dev";
  const branchBadge = resolveBuildStudioBranchBadge({
    submissionBranchShortId,
    buildTitle: activeBuild?.title ?? null,
    workspaceBranch: projectBranch,
  });
  const activeLifecycleLabel = activeBuild
    ? deriveLifecycleLabel({
      backlogItem: activeBuild.originator
        ? {
          status: activeBuild.originator.status,
          triageOutcome: activeBuild.originator.triageOutcome,
          activeBuildId: activeBuild.originator.activeBuildId,
        }
        : null,
      featureBuild: activeBuild,
      governedBacklogEnabled,
    })
    : null;
  const workflowAction = activeBuild
    ? deriveBuildStudioWorkflowAction({
      build: activeBuild,
      governedBacklogEnabled,
    })
    : null;

  // ─── Refetch deduplication: prevent triple-fetch from overlapping channels ─
  const lastFetchRef = useRef<number>(0);
  const fetchInFlightRef = useRef<boolean>(false);
  const [flowState, setFlowState] = useState<BuildFlowState | null>(null);
  const debouncedRefetch = useCallback(async () => {
    if (!activeBuild) return;
    const now = Date.now();
    if (now - lastFetchRef.current < 500) return;
    if (fetchInFlightRef.current) return;
    lastFetchRef.current = now;
    fetchInFlightRef.current = true;
    try {
      // Fetch build row + flow state in parallel. Flow state is derived
      // from existing columns (see lib/build-flow-state.ts) so the cost
      // is one extra Prisma round-trip, not a new source of truth.
      const [fresh, nextFlow] = await Promise.all([
        getFeatureBuild(activeBuild.buildId),
        getBuildFlowStateAction(activeBuild.buildId),
      ]);
      if (fresh) setActiveBuild(fresh);
      setFlowState(nextFlow);
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [activeBuild?.buildId]);

  // Fetch initial flow state when the active build changes so the first
  // paint shows substep counts and fork nodes without waiting for an SSE
  // event. debouncedRefetch handles subsequent updates.
  useEffect(() => {
    if (!activeBuild) { setFlowState(null); return; }
    let cancelled = false;
    getBuildFlowStateAction(activeBuild.buildId).then((s) => {
      if (!cancelled) setFlowState(s);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeBuild?.buildId]);

  useEffect(() => {
    const detail = activeBuild?.buildId ?? null;
    // Defer the dispatch: React fires child effects before parent effects on
    // initial mount, so AgentCoworkerShell (in the layout) hasn't attached
    // its "build-studio-active-build" listener yet when this effect runs on
    // first render. Dispatching synchronously loses the event and the Shell
    // fetches the wrong thread (/build instead of /build#<buildId>).
    // A microtask is enough — Shell's useEffect runs after BuildStudio's.
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent("build-studio-active-build", { detail }));
    }, 0);
    return () => {
      clearTimeout(timer);
      window.dispatchEvent(new CustomEvent("build-studio-active-build", { detail: null }));
    };
  }, [activeBuild?.buildId]);

  // ─── Primary update channel: DOM relay from CoworkerPanel ───────────────
  // The panel is always SSE-connected when the agent is busy. It relays
  // build-relevant events (phase:change, evidence:update, sandbox:ready,
  // orchestrator:task_complete, done) as DOM CustomEvents. This is instant
  // and doesn't require a threadId on the build.
  useEffect(() => {
    if (!activeBuild) return;
    const handleProgressUpdate = () => { debouncedRefetch(); };
    window.addEventListener("build-progress-update", handleProgressUpdate);
    return () => window.removeEventListener("build-progress-update", handleProgressUpdate);
  }, [activeBuild?.buildId, debouncedRefetch]);

  // ─── Thread linking: panel tells us the threadId ───────────────────────
  // When the coworker sends its first message for a build, it dispatches
  // this event so we can connect fallback SSE without polling.
  useEffect(() => {
    if (!activeBuild || activeBuild.threadId) return;
    const handleThreadLinked = (e: Event) => {
      const { buildId, threadId } = (e as CustomEvent<{ buildId: string; threadId: string }>).detail;
      if (buildId === activeBuild.buildId && threadId) {
        setActiveBuild((prev) => prev ? { ...prev, threadId } : prev);
      }
    };
    window.addEventListener("build-thread-linked", handleThreadLinked);
    return () => window.removeEventListener("build-thread-linked", handleThreadLinked);
  }, [activeBuild?.buildId, activeBuild?.threadId]);

  // ─── Fallback SSE: direct connection when panel is closed ──────────────
  // Only activates once threadId is known (via relay or DB poll).
  // The panel relay is the primary channel; this catches updates when
  // the panel is closed or the build was started by an external agent.
  useEffect(() => {
    if (!activeBuild?.threadId) return;
    const es = new EventSource(`/api/agent/stream?threadId=${activeBuild.threadId}`);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = async (e) => {
      let isUrgent = false;
      try {
        const data = JSON.parse(e.data);
        isUrgent = data.type === "phase:change" || data.type === "evidence:update"
          || data.type === "orchestrator:task_complete" || data.type === "sandbox:ready"
          || data.type === "orchestrator:warning";
      } catch { /* non-JSON — debounce */ }

      if (isUrgent) {
        if (debounceTimer) clearTimeout(debounceTimer);
        await debouncedRefetch();
      } else {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(debouncedRefetch, 800);
      }
    };
    return () => {
      es.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [activeBuild?.threadId, activeBuild?.buildId, debouncedRefetch]);

  // ─── Ultimate fallback: DB poll when panel is closed AND no threadId ───
  // Only runs when we have no other update channel. 10-second interval
  // to avoid hammering the DB. Covers: external agent builds, panel closed
  // before first message.
  useEffect(() => {
    if (!activeBuild) return;
    if (activeBuild.threadId) return; // SSE fallback will handle it
    const interval = setInterval(debouncedRefetch, 10_000);
    return () => clearInterval(interval);
  }, [activeBuild?.buildId, activeBuild?.threadId, debouncedRefetch]);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    const title = newTitle.trim();
    setCreating(true);
    try {
      const { buildId } = await createFeatureBuild({ title });
      setActiveBuild({
        id: "",
        buildId,
        title,
        description: null,
        portfolioId: null,
        brief: null,
        plan: null,
        phase: "ideate",
        sandboxId: null,
        sandboxPort: null,
        diffSummary: null,
        diffPatch: null,
        codingProvider: null,
        threadId: null,
        digitalProductId: null,
        product: null,
        createdById: "",
        createdAt: new Date(),
        updatedAt: new Date(),
        originatingBacklogItemId: null,
        draftApprovedAt: null,
        designDoc: null,
        designReview: null,
        buildPlan: null,
        planReview: null,
        taskResults: null,
        verificationOut: null,
        acceptanceMet: null,
        scoutFindings: null,
        happyPathState: {
          intake: {
            status: "pending",
            taxonomyNodeId: null,
            backlogItemId: null,
            epicId: null,
            constrainedGoal: null,
            failureReason: null,
          },
          execution: {
            engine: null,
            source: null,
            status: "pending",
            failureStage: null,
          },
          verification: {
            status: "pending",
            checks: [],
          },
        },
        accountableEmployeeId: null,
        claimedByAgentId: null,
        claimedAt: null,
        claimStatus: null,
        uxTestResults: null,
        uxVerificationStatus: null,
        buildExecState: null,
        deliberationSummary: null,
        originator: null,
        phaseHandoffs: null,
      });
      setNewTitle("");
      router.refresh();
      // Open the co-worker panel and auto-prompt about the new feature.
      // Include targetBuildId so Shell can queue the message until its
      // thread context matches the new build — without the guard, the
      // auto-message can fire against the previously-active thread
      // because Shell's thread switch lags the panel's receipt of the
      // event by one React render cycle.
      document.dispatchEvent(new CustomEvent("open-agent-panel", {
        detail: {
          autoMessage: `I just created a new feature called "${title}". Help me define it.`,
          targetBuildId: buildId,
        },
      }));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={getBuildStudioShellClassName()} data-testid={BUILD_STUDIO_TEST_IDS.shell}>
      <div className="relative flex flex-1 overflow-hidden">
        {/* Sidebar toggle (visible on small screens) */}
        <button
          type="button"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute top-2 left-2 z-10 lg:hidden w-8 h-8 rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] grid place-items-center text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          {sidebarOpen ? "\u2190" : "\u2192"}
        </button>

        {/* Left: Build List */}
        <div className={getBuildStudioSidebarClassName(sidebarOpen)}>
          {isDevEnvironment ? (
            <div className="p-3 border-b border-[var(--dpf-border)]">
              <div className="px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md text-[var(--dpf-muted)]">
                Development environment -- builds are managed from the production instance
              </div>
            </div>
          ) : (
            <div className="p-3 border-b border-[var(--dpf-border)]">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Describe a new feature..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  className="flex-1 px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                />
                <button
                  onClick={handleCreate}
                  disabled={creating || !newTitle.trim()}
                  className="px-4 py-2 text-sm font-semibold bg-[var(--dpf-accent)] text-white border-none rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  {creating && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {creating ? "Creating..." : "New"}
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto p-2">
            {builds.length === 0 ? (
              <div className="p-6 text-center">
                <div className="text-3xl mb-3 opacity-20">&#128161;</div>
                <p className="text-sm text-[var(--dpf-muted)] mb-2">No builds yet</p>
                <p className="text-xs text-[var(--dpf-muted)] opacity-70">
                  Type a feature name above and press <strong className="text-[var(--dpf-text)]">New</strong> to start.
                </p>
              </div>
            ) : (
              builds.map((build, idx) => {
                const lifecycleLabel = deriveLifecycleLabel({
                  backlogItem: build.originator
                    ? {
                      status: build.originator.status,
                      triageOutcome: build.originator.triageOutcome,
                      activeBuildId: build.originator.activeBuildId,
                    }
                    : null,
                  featureBuild: build,
                  governedBacklogEnabled,
                });

                return (
                <button
                  key={build.buildId}
                  onClick={() => { setActiveBuild(build); setSidebarOpen(true); }}
                  className="block w-full text-left px-3 py-2.5 mb-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-[var(--dpf-surface-2)] hover:shadow-dpf-xs animate-slide-up focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
                  style={{
                    animationDelay: `${idx * 30}ms`,
                    animationFillMode: "backwards",
                    border: activeBuild?.buildId === build.buildId
                      ? "1px solid var(--dpf-accent)"
                      : "1px solid transparent",
                    background: activeBuild?.buildId === build.buildId
                      ? "var(--dpf-surface-2)"
                      : "transparent",
                  }}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="mb-0.5 min-w-0 flex-1 break-words text-sm font-semibold text-[var(--dpf-text)]">{build.title}</div>
                    <button
                      type="button"
                      aria-label={`Delete ${build.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isDevEnvironment) return;
                        if (!confirm(`Delete "${build.title}"?`)) return;
                        deleteFeatureBuild(build.buildId).then(() => {
                          if (activeBuild?.buildId === build.buildId) setActiveBuild(null);
                          router.refresh();
                        });
                      }}
                      className="text-[var(--dpf-muted)] hover:text-[var(--dpf-error)] text-xs ml-2 shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2 rounded"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="text-xs text-[var(--dpf-muted)]">
                    {build.buildId}
                    {build.originator && (
                      <span> &middot; {build.originator.itemId}</span>
                    )}
                    <span> &middot; {build.phase}</span>
                    {build.product && (
                      <span> &middot; v{build.product.version} &middot; {build.product.backlogCount} item{build.product.backlogCount !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                  {lifecycleLabel && (
                    <div className="mt-2">
                      <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--dpf-text)]">
                        {lifecycleLabel}
                      </span>
                    </div>
                  )}
                </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Preview or Brief */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--dpf-surface-1)]">
          {activeBuild ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--dpf-border)] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 min-w-0 break-words text-base font-bold text-[var(--dpf-text)]">{activeBuild.title}</h2>
                    <ClaimBadge agentId={activeBuild.claimedByAgentId ?? null} claimStatus={activeBuild.claimStatus ?? null} claimedAt={activeBuild.claimedAt ?? null} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)]">
                    <span>{activeBuild.buildId}</span>
                    {activeBuild.originator && (
                      <>
                        <span>&middot;</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 font-medium text-[var(--dpf-text)]">
                          {activeBuild.originator.itemId}
                        </span>
                      </>
                    )}
                    {activeLifecycleLabel && (
                      <>
                        <span>&middot;</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 font-medium text-[var(--dpf-text)]">
                          Workflow: {activeLifecycleLabel}
                        </span>
                      </>
                    )}
                    {branchBadge && (
                      <>
                        <span>&middot;</span>
                        <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 font-mono" title={branchBadge.title}>
                          <svg className="shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" /></svg>
                          <span className="truncate">{branchBadge.value}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Error banner for failed builds */}
              {activeBuild.phase === "failed" && (
                <BuildFailedBanner execState={activeBuild.buildExecState} />
              )}

              <div className="flex min-h-0 flex-1 flex-col">
                {activeBuild.originator && (
                  <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)]">
                      <span className="font-semibold text-[var(--dpf-text)]">Canonical backlog item</span>
                      <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 font-medium text-[var(--dpf-text)]">
                        {activeBuild.originator.itemId}
                      </span>
                      <span>{activeBuild.originator.title}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)]">
                      <span>Status: {activeBuild.originator.status}</span>
                      {activeBuild.originator.triageOutcome && (
                        <span>Triage: {activeBuild.originator.triageOutcome}</span>
                      )}
                      {activeBuild.originator.effortSize && (
                        <span>Size: {activeBuild.originator.effortSize}</span>
                      )}
                      {activeBuild.originator.resolution && (
                        <span>Decision: {activeBuild.originator.resolution}</span>
                      )}
                    </div>
                  </div>
                )}
                {activeBuild && workflowAction && (
                  <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
                    <BuildStudioWorkflowActionCard
                      build={activeBuild}
                      action={workflowAction}
                      onCompleted={async () => {
                        const refreshed = await getFeatureBuild(activeBuild.buildId);
                        if (refreshed) {
                          setActiveBuild(refreshed);
                        }
                      }}
                    />
                  </div>
                )}
                {/* Tab selector */}
                <div role="tablist" aria-label="Workflow view tabs" className="flex gap-1 px-4 pt-3 pb-0">
                  <button
                    role="tab"
                    aria-selected={buildView === "graph"}
                    aria-controls="panel-graph"
                    onClick={() => setBuildView("graph")}
                    className="px-3 py-1 rounded-t text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
                    style={{
                      background: buildView === "graph" ? "var(--dpf-surface-2)" : "transparent",
                      color: buildView === "graph" ? "var(--dpf-text)" : "var(--dpf-muted)",
                      borderBottom: buildView === "graph" ? "2px solid var(--dpf-accent)" : "2px solid transparent",
                    }}
                  >
                    Workflow
                  </button>
                  {/* Details tab — always available so design doc / brief is visible during ideate/plan */}
                  <button
                    role="tab"
                    aria-selected={buildView === "docs"}
                    aria-controls="panel-docs"
                    onClick={() => setBuildView("docs")}
                    className="px-3 py-1 rounded-t text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
                    style={{
                      background: buildView === "docs" ? "var(--dpf-surface-2)" : "transparent",
                      color: buildView === "docs" ? "var(--dpf-text)" : "var(--dpf-muted)",
                      borderBottom: buildView === "docs" ? "2px solid var(--dpf-accent)" : "2px solid transparent",
                    }}
                  >
                    {(activeBuild.phase === "review" || activeBuild.phase === "ship" || activeBuild.phase === "complete") ? "Review" : "Details"}
                  </button>
                  {activeBuild.sandboxPort && (activeBuild.phase === "build" || activeBuild.phase === "review" || activeBuild.phase === "ship") && (
                    <button
                      role="tab"
                      aria-selected={buildView === "preview"}
                      aria-controls="panel-preview"
                      onClick={() => setBuildView("preview")}
                      className="px-3 py-1 rounded-t text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
                      style={{
                        background: buildView === "preview" ? "var(--dpf-surface-2)" : "transparent",
                        color: buildView === "preview" ? "var(--dpf-text)" : "var(--dpf-muted)",
                        borderBottom: buildView === "preview" ? "2px solid var(--dpf-accent)" : "2px solid transparent",
                      }}
                    >
                      Preview
                    </button>
                  )}
                </div>
                {buildView === "graph" && (
                  <div
                    className={getBuildStudioGraphPanelClassName()}
                    data-testid={BUILD_STUDIO_TEST_IDS.graphPanel}
                  >
                    <div className="border-b border-[var(--dpf-border)] px-4 py-2 text-xs text-[var(--dpf-muted)]">
                      Select any stage or task to inspect what happened, related artifacts, and the next approval gate.
                    </div>
                    <ProcessGraph
                      build={activeBuild}
                      workflowLabel={activeLifecycleLabel}
                      governedBacklogEnabled={governedBacklogEnabled}
                    />
                  </div>
                )}
                {buildView !== "graph" && (
                  <div className="flex min-h-0 flex-1 gap-4 p-4">
                    {buildView === "preview" && activeBuild.sandboxPort && (activeBuild.phase === "build" || activeBuild.phase === "review" || activeBuild.phase === "ship") ? (
                      <PreviewUrlCard
                        buildId={activeBuild.buildId}
                        phase={activeBuild.phase}
                        sandboxPort={activeBuild.sandboxPort}
                      />
                    ) : (
                      <div className="flex-1 overflow-auto">
                        {activeBuild.phase === "review" || activeBuild.phase === "ship" || activeBuild.phase === "complete" ? (
                          <ReviewPanel build={activeBuild} />
                        ) : (
                          <FeatureBriefPanel
                            brief={activeBuild.brief}
                            phase={activeBuild.phase}
                            diffSummary={activeBuild.diffSummary}
                            build={activeBuild}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center">
              <div className="text-center max-w-md px-8">
                <div className="text-5xl mb-4 opacity-20">&#128736;</div>
                <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-3">Product Development Studio</h2>
                {branchBadge && (
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-xs font-mono text-[var(--dpf-muted)] mb-4" title={branchBadge.title}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" /></svg>
                    {branchBadge.value}
                  </div>
                )}
                <p className="text-sm text-[var(--dpf-muted)] leading-relaxed mb-6">
                  Build features without writing code. Describe what you want, and your AI Coworker will design, build, and deploy it.
                </p>
                <div className="text-left bg-[var(--dpf-surface-2)] rounded-lg border border-[var(--dpf-border)] p-4 shadow-dpf-md">
                  <p className="text-xs font-semibold text-[var(--dpf-text)] mb-3 uppercase tracking-wider">How it works</p>
                  <div className="flex flex-col gap-2.5">
                    <Step n={1} text="Type a feature name in the sidebar and click New" />
                    <Step n={2} text="Your AI Coworker will open and guide you through the process" />
                    <Step n={3} text="Review the live preview as it builds" />
                    <Step n={4} text="Approve and deploy when you're happy" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {activeBuild && buildView !== "graph" && (
        <PhaseIndicator currentPhase={activeBuild.phase} flowState={flowState} />
      )}
    </div>
  );
}

function BuildFailedBanner({ execState }: { execState: BuildExecutionState | null }) {
  const failedStep = execState?.failedAt ?? execState?.step ?? "unknown";
  const stepLabel = STEP_LABELS[failedStep as keyof typeof STEP_LABELS] ?? failedStep;
  const errorMsg = execState?.error;

  const RECOVERY_HINTS: Record<string, string> = {
    sandbox_created: "The sandbox container failed to start. Try again -- Docker may have been busy.",
    workspace_initialized: "Project files could not be copied into the sandbox. Check disk space.",
    db_ready: "The sandbox database failed to initialize. This is usually transient -- retry.",
    deps_installed: "Dependency installation failed. Check package.json for invalid packages.",
    code_generated: "Code generation encountered errors. Review the brief and ask your coworker to retry.",
    tests_run: "Tests failed after code generation. Ask your coworker to review the test output.",
  };

  const hint = RECOVERY_HINTS[failedStep] ?? "Ask your AI Coworker for help diagnosing this failure.";

  return (
    <div className="mx-4 mt-3 p-3 rounded-lg border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_8%,var(--dpf-surface-1))] animate-fade-in" role="alert">
      <div className="flex items-start gap-2">
        <span className="w-5 h-5 rounded-full bg-[var(--dpf-error)] text-white text-xs font-bold grid place-items-center shrink-0 mt-0.5">!</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--dpf-error)]">Build failed at: {stepLabel}</p>
          {errorMsg && (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--dpf-text)]">{errorMsg}</pre>
          )}
          <p className="text-xs text-[var(--dpf-muted)] mt-2">{hint}</p>
        </div>
      </div>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-5 h-5 rounded-full bg-[var(--dpf-accent)] text-[10px] font-bold text-white grid place-items-center shrink-0 mt-0.5">
        {n}
      </span>
      <span className="text-sm leading-snug text-[var(--dpf-text)]">{text}</span>
    </div>
  );
}
