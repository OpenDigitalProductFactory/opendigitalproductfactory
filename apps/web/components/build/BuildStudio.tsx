// apps/web/components/build/BuildStudio.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitBranch } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { FeatureBriefPanel } from "./FeatureBriefPanel";
import { ReviewPanel } from "./ReviewPanel";
import { NodeInspector } from "./NodeInspector";
import type { ProcessGraphNodeClickInfo } from "./ProcessGraphClickInfo";
import { OpenSandboxButton } from "./OpenSandboxButton";
import { DetailsDrawer, DetailsDrawerPill, type DetailsDrawerSection } from "./DetailsDrawer";
import { computeDrivingBuild, isValidSandboxPort, type SandboxDriverCandidate } from "@/lib/build/sandbox-driver";
import { ClaimBadge } from "./ClaimBadge";
import { ProcessGraph } from "./ProcessGraph";
import { BuildProgressOperationalPanel } from "./BuildProgressOperationalPanel";
import { ReleaseDecisionPanel } from "./ReleaseDecisionPanel";
import { BuildStudioWorkflowActionCard } from "./BuildStudioWorkflowActionCard";
import { DecompositionCoordinator } from "./DecompositionCoordinator";
import { CodeIntelligenceStatusCard } from "./CodeIntelligenceStatusCard";
import { BuildAssuranceGateCard } from "./BuildAssuranceGateCard";
import { BuildListItem } from "./BuildListItem";
import { EpicRollupListItem } from "./EpicRollupListItem";
import { deriveFleetCounts, deriveNeedsAttention, deriveQueueState } from "./fleet-derivation";
import { PortalContextStrip } from "@/components/portal-context/PortalContextStrip";
import { deriveBuildStudioWorkflowAction } from "./build-studio-workflow-actions";
import { resolveBuildStudioBranchBadge } from "./build-studio-branch-badge";
import { createFeatureBuild, deleteFeatureBuild } from "@/lib/actions/build";
import { getFeatureBuild } from "@/lib/actions/build-read";
import { getBuildFlowStateAction } from "@/lib/actions/build-flow";
import { getBuildProgressVisibilityAction } from "@/lib/actions/build-progress-visibility";
import { getCodeGraphFreshnessAction } from "@/lib/actions/code-intelligence";
import { getBuildAssuranceFindings, getBuildBomSummary } from "@/lib/actions/assurance";
import type { ActiveAssuranceFindingRow } from "@/lib/assurance/finding-read";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import type { BuildFlowState } from "@/lib/build-flow-state";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { EpicRollupView } from "@/lib/build/epic-rollup";
import type { BomSummary } from "@/lib/assurance/bom-read";
import type { CodeGraphFreshness } from "@/lib/integrate/code-graph-access";
import type { BuildExecutionState } from "@/lib/integrate/build-exec-types";
import { STEP_LABELS } from "@/lib/integrate/build-exec-types";
import type { PortfolioForSelect } from "@/lib/backlog-data";
import { deriveLifecycleLabel } from "@/lib/governed-backlog-workflow";
import type { PortalContextEnvelope } from "@/lib/portal-context";
import {
  BUILD_STUDIO_TEST_IDS,
  getBuildStudioGraphPanelClassName,
  getBuildStudioShellClassName,
  getBuildStudioSidebarClassName,
  shouldOpenBuildStudioSidebarByDefault,
} from "./build-studio-layout";

type Props = {
  builds: FeatureBuildRow[];
  epicRollups?: EpicRollupView[];
  portfolios: PortfolioForSelect[];
  governedBacklogEnabled: boolean;
  dpfEnvironment?: string;
  projectBranch?: string | null;
  submissionBranchShortId?: string | null;
  initialBuildId?: string | null;
  portalContext?: PortalContextEnvelope | null;
  initialActiveBuild?: FeatureBuildRow | null;
};

const MISSING_BOM_SUMMARY: BomSummary = {
  state: "missing",
  document: null,
  counts: { components: 0, models: 0 },
  findings: {
    total: 0,
    blocking: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    byKind: {},
  },
  scanner: {
    state: "needs-evaluation",
    approvedScannerCount: 0,
    scannerNames: [],
    reason: "no-approved-scanner",
  },
};

export function BuildStudio({
  builds,
  epicRollups = [],
  portfolios,
  governedBacklogEnabled,
  dpfEnvironment,
  projectBranch,
  submissionBranchShortId,
  initialBuildId,
  portalContext,
  initialActiveBuild,
}: Props) {
  const router = useRouter();
  const buildRows = Array.isArray(builds) ? builds : [];
  const rollupRows = Array.isArray(epicRollups) ? epicRollups : [];
  const portfolioRows = Array.isArray(portfolios) ? portfolios : [];
  const [activeBuild, setActiveBuild] = useState<FeatureBuildRow | null>(
    () => initialActiveBuild ?? resolveInitialActiveBuild(buildRows, initialBuildId),
  );
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  // Tab selector removed per spec §1 + §9 #11 — the workflow graph is the
  // always-visible primary surface of the active-build pane. Progress /
  // Brief / Review / Sandbox / BS-Queue evidence migrates into the
  // DetailsDrawer accordion (PR #912's DetailsDrawer + this slice).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInitialSectionId, setDrawerInitialSectionId] = useState<string | null>(null);
  // Assurance + code-intel cards collapse so the workflow graph stays the
  // primary surface (spec §1 + §9 #11). Operators can re-expand on demand.
  const [assuranceRowExpanded, setAssuranceRowExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    shouldOpenBuildStudioSidebarByDefault(
      typeof window === "undefined" ? undefined : window.innerWidth,
    ),
  );
  // Anchored NodeInspector lifecycle. When ProcessGraph is rendered with an
  // onNodeClick prop, it delegates click handling here instead of opening
  // its own internal TaskInspector / WorkflowStageInspector overlays. The
  // anchored inspector lives INSIDE the workflow canvas so it never
  // displaces the AI Coworker rail. Per spec §2 and Mark's explicit ask.
  const [selectedNodeClick, setSelectedNodeClick] = useState<ProcessGraphNodeClickInfo | null>(null);
  // Clear inspector state when the active build changes — a stale anchor
  // from another build would point at a node that's no longer in the DOM.
  useEffect(() => {
    setSelectedNodeClick(null);
  }, [activeBuild?.buildId]);
  const isDevEnvironment = dpfEnvironment === "dev";
  const supervisedBuildRows =
    activeBuild && !buildRows.some((build) => build.buildId === activeBuild.buildId)
      ? [activeBuild, ...buildRows]
      : buildRows;
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
  // ─── Refetch deduplication: prevent triple-fetch from overlapping channels ─
  const lastFetchRef = useRef<number>(0);
  const fetchInFlightRef = useRef<boolean>(false);
  const [flowState, setFlowState] = useState<BuildFlowState | null>(null);
  const [progressVisibility, setProgressVisibility] = useState<BuildProgressVisibility | null>(null);
  const [codeGraphFreshness, setCodeGraphFreshness] = useState<CodeGraphFreshness | null>(null);
  const [bomSummary, setBomSummary] = useState<BomSummary>(MISSING_BOM_SUMMARY);
  const [assuranceFindings, setAssuranceFindings] = useState<ActiveAssuranceFindingRow[]>([]);
  const workflowAction = activeBuild
    ? deriveBuildStudioWorkflowAction({
      build: activeBuild,
      governedBacklogEnabled,
      progressVisibility,
    })
    : null;

  useEffect(() => {
    if (!activeBuild?.buildId) return;
    if (initialBuildId === activeBuild.buildId) return;
    router.replace(buildStudioBuildHref(activeBuild.buildId), { scroll: false });
  }, [activeBuild?.buildId, initialBuildId, router]);

  const refreshActiveBuildState = useCallback(async (buildId: string) => {
    const [freshResult, flowResult, progressResult, bomResult, findingsResult] = await Promise.allSettled([
      getFeatureBuild(buildId),
      getBuildFlowStateAction(buildId),
      getBuildProgressVisibilityAction(buildId),
      getBuildBomSummary(buildId),
      getBuildAssuranceFindings(buildId, 25),
    ]);
    const fresh = freshResult.status === "fulfilled" ? freshResult.value : null;
    const nextFlow = flowResult.status === "fulfilled" ? flowResult.value : null;
    const nextProgress = progressResult.status === "fulfilled" ? progressResult.value : null;
    const nextBomSummary = bomResult.status === "fulfilled" ? bomResult.value : MISSING_BOM_SUMMARY;
    const nextFindings = findingsResult.status === "fulfilled" ? findingsResult.value : [];

    if (fresh) setActiveBuild(fresh);
    setFlowState(nextFlow);
    setProgressVisibility(nextProgress);
    setBomSummary(nextBomSummary);
    setAssuranceFindings(nextFindings);
  }, []);
  const selectBuildById = useCallback(async (buildId: string) => {
    const existing = buildRows.find((build) => build.buildId === buildId);
    if (existing) {
      setActiveBuild(existing);
      setSidebarOpen(true);
      return;
    }

    const fresh = await getFeatureBuild(buildId);
    if (fresh) {
      setActiveBuild(fresh);
      setSidebarOpen(true);
    }
  }, [buildRows]);
  const debouncedRefetch = useCallback(async () => {
    if (!activeBuild) return;
    const now = Date.now();
    if (now - lastFetchRef.current < 500) return;
    if (fetchInFlightRef.current) return;
    lastFetchRef.current = now;
    fetchInFlightRef.current = true;
    try {
      await refreshActiveBuildState(activeBuild.buildId);
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [activeBuild?.buildId, refreshActiveBuildState]);

  // Fetch initial flow state when the active build changes so the first
  // paint shows substep counts and fork nodes without waiting for an SSE
  // event. Progress visibility rides the same refresh channels rather than
  // starting a separate polling loop. debouncedRefetch handles subsequent
  // updates.
  useEffect(() => {
    if (!activeBuild) {
      setFlowState(null);
      setProgressVisibility(null);
      setBomSummary(MISSING_BOM_SUMMARY);
      setAssuranceFindings([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      getBuildFlowStateAction(activeBuild.buildId),
      getBuildProgressVisibilityAction(activeBuild.buildId),
      getBuildBomSummary(activeBuild.buildId),
      getBuildAssuranceFindings(activeBuild.buildId, 25),
    ]).then(([flowResult, progressResult, bomResult, findingsResult]) => {
      if (!cancelled) {
        setFlowState(flowResult.status === "fulfilled" ? flowResult.value : null);
        setProgressVisibility(progressResult.status === "fulfilled" ? progressResult.value : null);
        setBomSummary(bomResult.status === "fulfilled" ? bomResult.value : MISSING_BOM_SUMMARY);
        setAssuranceFindings(findingsResult.status === "fulfilled" ? findingsResult.value : []);
      }
    }).catch(() => {
      if (!cancelled) {
        setFlowState(null);
        setProgressVisibility(null);
        setBomSummary(MISSING_BOM_SUMMARY);
        setAssuranceFindings([]);
      }
    });
    return () => { cancelled = true; };
  }, [activeBuild?.buildId]);

  useEffect(() => {
    let cancelled = false;
    getCodeGraphFreshnessAction()
      .then((freshness) => {
        if (!cancelled) setCodeGraphFreshness(freshness);
      })
      .catch(() => {
        if (!cancelled) setCodeGraphFreshness(null);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const syncSidebarToViewport = () => {
      setSidebarOpen(shouldOpenBuildStudioSidebarByDefault(window.innerWidth));
    };
    syncSidebarToViewport();
    window.addEventListener("resize", syncSidebarToViewport);
    return () => window.removeEventListener("resize", syncSidebarToViewport);
  }, []);

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
          <div className="border-b border-[var(--dpf-border)] p-3">
            <Link
              href="/build/work"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
            >
              <GitBranch className="h-4 w-4" aria-hidden="true" />
              <span>Work Control</span>
            </Link>
          </div>
          {isDevEnvironment ? (
            <div className="p-3 border-b border-[var(--dpf-border)]">
              <div className="px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md text-[var(--dpf-muted)]">
                Development environment -- builds are managed from the production instance
              </div>
            </div>
          ) : (
            // D12 (2026-05-23): multiline textarea instead of single-line input.
            // The prior <input> truncated longer descriptions to a tail-only
            // view (e.g. "...driving back to the warehouse" with no way to see
            // the start) — looked like the platform had eaten half the text.
            // Now: auto-resizing textarea with visible char count; Enter inserts
            // a newline (multiline field), Cmd/Ctrl+Enter submits to preserve
            // keyboard flow without losing the multiline capability.
            <div className="p-3 border-b border-[var(--dpf-border)]">
              <textarea
                placeholder="Describe a new feature in plain English — say what you want to do, who it's for, and any details that matter."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                rows={3}
                className="w-full px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)] resize-y min-h-[72px] max-h-[200px] leading-snug"
              />
              <div className="flex items-center justify-between mt-2 gap-2">
                <div className="text-[10px] text-[var(--dpf-muted)] leading-tight">
                  Press Cmd/Ctrl+Enter to start.
                  {newTitle.length > 0 ? ` ${newTitle.length} characters.` : ""}
                </div>
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

          {/* Fleet rail (compact density) — replaces the legacy comfortable
              build cards. Per spec §1: one row per in-flight build, ≤32px
              tall, phase mini-rail + queue badge + needs-attention dot.
              Order: running → blocked → queued → idle. Falls back to FB
              ascending for same-kind tie-break. */}
          <FleetRailZone
            buildRows={buildRows}
            epicRollups={rollupRows}
            activeBuildId={activeBuild?.buildId ?? null}
            governedBacklogEnabled={governedBacklogEnabled}
            isDevEnvironment={isDevEnvironment}
            onSelectBuild={(build) => {
              setActiveBuild(build);
              setSidebarOpen(true);
            }}
            onSelectBuildById={selectBuildById}
            onDeleteBuild={(build) => {
              if (isDevEnvironment) return;
              if (!confirm(`Delete "${build.title}"?`)) return;
              deleteFeatureBuild(build.buildId).then(() => {
                if (activeBuild?.buildId === build.buildId) setActiveBuild(null);
                router.refresh();
              });
            }}
            onOpenQueueDrawer={() => {
              setDrawerInitialSectionId("bs-queue");
              setDrawerOpen(true);
            }}
          />
        </div>

        {/* Right: Preview or Brief */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--dpf-surface-1)]">
          <PortalContextStrip envelope={portalContext ?? null} />
          {activeBuild ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--dpf-border)] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2
                      title={activeBuild.title}
                      className="m-0 max-h-[3rem] min-w-0 overflow-hidden break-words text-base font-bold leading-6 text-[var(--dpf-text)] line-clamp-2"
                    >
                      {activeBuild.title}
                    </h2>
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
                    {/* "Workflow: <label>" header pill removed per spec — the
                        workflow rail / mini-rail already conveys the same
                        information without duplicating it in the header.
                        See docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md */}
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
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerInitialSectionId("canonical-doc");
                          setDrawerOpen(true);
                        }}
                        title="Open the full description and Scout findings"
                        className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                        data-testid="build-studio-canonical-doc-trigger"
                      >
                        {activeBuild.originator.itemId}
                      </button>
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
                {activeBuild && activeBuild.phase === "ship" && (
                  <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
                    <ReleaseDecisionPanel
                      build={activeBuild}
                      flowState={flowState}
                      portfolios={portfolioRows}
                      onCompleted={() => refreshActiveBuildState(activeBuild.buildId)}
                    />
                  </div>
                )}
                {activeBuild && workflowAction && activeBuild.phase !== "ship" && (
                  <div className="border-b border-[var(--dpf-border)]">
                    {/* compact=true renders the 40px ActionBanner via the
                        delegation in BuildStudioWorkflowActionCard (T9). The
                        ~200px card is the legacy presentation; the compact
                        path is now the default per spec §1 (center zone). */}
                    <BuildStudioWorkflowActionCard
                      build={activeBuild}
                      action={workflowAction}
                      compact
                      onCompleted={() => refreshActiveBuildState(activeBuild.buildId)}
                    />
                    {workflowAction.kind === "decompose-now" && activeBuild.designDoc && (
                      <DecompositionCoordinator
                        buildId={activeBuild.buildId}
                        buildTitle={activeBuild.title}
                        parentAcceptanceCriteria={
                          Array.isArray(activeBuild.designDoc.acceptanceCriteria)
                            ? activeBuild.designDoc.acceptanceCriteria.filter(
                                (ac): ac is string => typeof ac === "string",
                              )
                            : []
                        }
                        assessment={activeBuild.designReview?.sizeAssessment ?? null}
                        initialCandidates={activeBuild.designReview?.decompositionCandidates?.latest ?? []}
                        existingOverride={activeBuild.designReview?.decompositionOverride ?? null}
                        planOscillationEntry
                      />
                    )}
                  </div>
                )}
                {/* Workflow graph — always-visible primary surface of the
                    active-build pane. The tab selector (Progress/Workflow/
                    Details/Preview) is gone; evidence migrates into the
                    DetailsDrawer below. See spec §1 + §9 #11. */}
                <div
                  className={`${getBuildStudioGraphPanelClassName()} relative`}
                  data-testid={BUILD_STUDIO_TEST_IDS.graphPanel}
                >
                  <AssuranceRow
                    expanded={assuranceRowExpanded}
                    onToggle={() => setAssuranceRowExpanded((p) => !p)}
                    freshness={codeGraphFreshness}
                    buildId={activeBuild.buildId}
                    bomSummary={bomSummary}
                    findings={assuranceFindings}
                  />
                  <div className="border-b border-[var(--dpf-border)] px-4 py-2 text-xs text-[var(--dpf-muted)]">
                    Select any stage or task to inspect — or open Details on the right for progress, brief, review, sandbox, and BS Queue evidence.
                  </div>
                  <ProcessGraph
                    build={activeBuild}
                    workflowLabel={activeLifecycleLabel}
                    governedBacklogEnabled={governedBacklogEnabled}
                    progressVisibility={progressVisibility}
                    onNodeClick={(info) => {
                      setSelectedNodeClick((prev) =>
                        prev?.nodeId === info.nodeId ? null : info,
                      );
                    }}
                  />
                  {selectedNodeClick && (
                    <NodeInspector
                      nodeId={selectedNodeClick.nodeId}
                      title={resolveInspectorTitle(selectedNodeClick)}
                      anchorRect={selectedNodeClick.anchorRect}
                      containerRect={selectedNodeClick.containerRect}
                      containerScrollTop={selectedNodeClick.containerScrollTop}
                      onClose={() => setSelectedNodeClick(null)}
                      onAskCoworker={() => {
                        const prefill = buildCoworkerPrefill(selectedNodeClick, activeBuild.buildId);
                        document.dispatchEvent(
                          new CustomEvent("open-agent-panel", {
                            detail: { autoMessage: prefill, targetBuildId: activeBuild.buildId },
                          }),
                        );
                      }}
                    >
                      <NodeInspectorBody info={selectedNodeClick} />
                    </NodeInspector>
                  )}
                  <DetailsDrawerPill
                    isOpen={drawerOpen}
                    onClick={() => {
                      setDrawerOpen((p) => !p);
                      setDrawerInitialSectionId(null);
                    }}
                  />
                  <DetailsDrawer
                    isOpen={drawerOpen}
                    onClose={() => setDrawerOpen(false)}
                    sections={buildDetailsDrawerSections(
                      activeBuild,
                      progressVisibility,
                      drawerInitialSectionId,
                      supervisedBuildRows,
                    )}
                  />
                </div>
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

      {/* PhaseIndicator bottom strip removed per spec — phase progression
          is now visible exactly once per surface: the ProcessGraph nodes
          carry it for the active build, and the (still-pending) compact
          fleet mini-rail carries it for the aggregate.
          See docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md §1, §9 #2 */}

      {/* Footer — single shared OpenSandboxButton (sandbox is shared across
          all in-flight builds; surfacing one link labeled with the current
          driver replaces the dishonest per-build Preview tab). */}
      <BuildStudioFooter builds={supervisedBuildRows} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* DetailsDrawer — derive accordion sections from active build + drawer state.*/
/* ────────────────────────────────────────────────────────────────────────── */

function buildDetailsDrawerSections(
  activeBuild: FeatureBuildRow,
  progressVisibility: BuildProgressVisibility | null,
  initialSectionId: string | null,
  allBuilds: readonly FeatureBuildRow[],
): DetailsDrawerSection[] {
  // Default-open section depends on phase + explicit operator intent.
  // - When the queue header opened the drawer, BS-Queue is the explicit pick.
  // - When the canonical-doc trigger opened the drawer, that's the explicit pick.
  // - Otherwise: ideate/plan → Brief; build → Progress; review/ship/complete → Review.
  const defaultId =
    initialSectionId ??
    (activeBuild.phase === "ideate" || activeBuild.phase === "plan"
      ? "brief"
      : activeBuild.phase === "build"
        ? "progress"
        : "review");

  return [
    {
      id: "canonical-doc",
      title: "Canonical doc",
      defaultOpen: defaultId === "canonical-doc",
      content: <CanonicalDocSection build={activeBuild} />,
    },
    {
      id: "progress",
      title: "Progress",
      defaultOpen: defaultId === "progress",
      content: <BuildProgressOperationalPanel projection={progressVisibility} />,
    },
    {
      id: "brief",
      title: activeBuild.phase === "complete" ? "Shipped — original brief" : "Brief / Design Doc",
      defaultOpen: defaultId === "brief",
      content: (
        <FeatureBriefPanel
          brief={activeBuild.brief}
          phase={activeBuild.phase}
          diffSummary={activeBuild.diffSummary}
          build={activeBuild}
        />
      ),
    },
    {
      id: "review",
      title: activeBuild.phase === "ship" ? "Release" : "Review",
      defaultOpen: defaultId === "review",
      content: <ReviewPanel build={activeBuild} />,
    },
    {
      id: "bs-queue",
      title: "BS Queue",
      defaultOpen: defaultId === "bs-queue",
      content: <BsQueueSection builds={allBuilds} />,
    },
  ];
}

function CanonicalDocSection({ build }: { build: FeatureBuildRow }) {
  const description = build.description?.trim() ?? "";
  const originator = build.originator;
  const scout = build.scoutFindings;

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      {originator && (
        <div className="flex flex-col gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-[var(--dpf-muted)]">
            <span className="font-mono font-semibold text-[var(--dpf-text)]">{originator.itemId}</span>
            <span>·</span>
            <span>{originator.title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--dpf-muted)]">
            <span>Status: <span className="text-[var(--dpf-text)]">{originator.status}</span></span>
            {originator.triageOutcome && (
              <span>Triage: <span className="text-[var(--dpf-text)]">{originator.triageOutcome}</span></span>
            )}
            {originator.effortSize && (
              <span>Size: <span className="text-[var(--dpf-text)]">{originator.effortSize}</span></span>
            )}
          </div>
          {originator.resolution && (
            <p className="mt-1 text-[var(--dpf-text-secondary)] leading-snug">{originator.resolution}</p>
          )}
        </div>
      )}
      {description ? (
        <div className="prose prose-sm prose-invert max-w-none text-[var(--dpf-text)] leading-relaxed [&_h1]:text-base [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_code]:text-xs">
          <ReactMarkdown>{description}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs text-[var(--dpf-muted)]">
          No description was captured for this build. The originating backlog item may have only had a title.
        </p>
      )}
      {scout && (
        <details className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-xs">
          <summary className="cursor-pointer font-semibold text-[var(--dpf-text)]">Scout findings</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-[var(--dpf-text-secondary)]">
            {JSON.stringify(scout, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

type AssuranceRowProps = {
  expanded: boolean;
  onToggle: () => void;
  freshness: CodeGraphFreshness | null;
  buildId: string;
  bomSummary: BomSummary;
  findings: ActiveAssuranceFindingRow[];
};

function AssuranceRow({ expanded, onToggle, freshness, buildId, bomSummary, findings }: AssuranceRowProps) {
  const codeIntelLabel = freshness
    ? freshness.available && freshness.indexStatus === "ready"
      ? "ready"
      : freshness.indexStatus
    : "unknown";
  const bomLabel = bomSummary.state === "missing" ? "no BOM" : bomSummary.state;
  const activeFindings = findings.length;

  return (
    <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs text-[var(--dpf-muted)] transition-colors hover:bg-[var(--dpf-surface-1)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-[var(--dpf-text)]">Code intel &amp; assurance</span>
          <span>Code intel: <span className="text-[var(--dpf-text)]">{codeIntelLabel}</span></span>
          <span>BOM: <span className="text-[var(--dpf-text)]">{bomLabel}</span></span>
          <span>Findings: <span className="text-[var(--dpf-text)]">{activeFindings} active</span></span>
        </span>
        <span aria-hidden="true" className="text-[var(--dpf-muted)]">{expanded ? "▾" : "▸"}</span>
      </button>
      {/* Cards always mounted so eager-render assertions + SR users still find
       *  them (spec §9 #11). When collapsed we hide via `hidden` rather than
       *  unmount — keeps the surface eager and avoids re-fetching on toggle. */}
      <div
        className={`border-t border-[var(--dpf-border)] px-4 py-3 ${expanded ? "" : "hidden"}`}
      >
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
          <CodeIntelligenceStatusCard freshness={freshness} />
          <BuildAssuranceGateCard
            buildId={buildId}
            summary={bomSummary}
            findings={findings}
          />
        </div>
      </div>
    </div>
  );
}

function BsQueueSection({ builds }: { builds: readonly FeatureBuildRow[] }) {
  const entries = builds.map((b) => ({
    build: b,
    queueState: deriveQueueState(b),
    needsAttention: deriveNeedsAttention(b),
  }));
  const kindRank = { running: 0, blocked: 1, queued: 2, idle: 3 } as const;
  const sorted = [...entries].sort((a, b) => {
    const ra = kindRank[a.queueState.kind];
    const rb = kindRank[b.queueState.kind];
    if (ra !== rb) return ra - rb;
    if (a.queueState.kind === "queued" && b.queueState.kind === "queued") {
      return a.queueState.position - b.queueState.position;
    }
    return a.build.buildId.localeCompare(b.build.buildId);
  });
  const counts = deriveFleetCounts(entries.map((e) => e.queueState));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[var(--dpf-muted)]">
        Shared sandbox runtime — read-only view. Per spec §10, queue mutation
        (start/cancel/reorder) belongs to the concurrency thread, not this layout.
      </p>
      <div className="flex flex-wrap gap-3 text-[11px] text-[var(--dpf-text)]">
        <span>Running: <span className="font-semibold">{counts.runningCount}</span></span>
        <span>Blocked: <span className="font-semibold text-[var(--dpf-warning)]">{counts.blockedCount}</span></span>
        <span>Queued: <span className="font-semibold">{counts.queuedCount}</span></span>
      </div>
      <ul className="flex flex-col gap-1">
        {sorted.map((entry) => (
          <li
            key={entry.build.buildId}
            className="flex items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px]"
            data-build-id={entry.build.buildId}
            data-queue-kind={entry.queueState.kind}
          >
            <span className="font-mono text-[var(--dpf-text)]">{entry.build.buildId}</span>
            <span className="truncate text-[var(--dpf-muted)]">{entry.build.title}</span>
            <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
              {entry.queueState.kind}
              {entry.queueState.kind === "queued" && ` @${entry.queueState.position}`}
            </span>
          </li>
        ))}
        {sorted.length === 0 && (
          <li className="text-[var(--dpf-muted)]">No builds.</li>
        )}
      </ul>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* NodeInspector helpers — derive title + body + coworker-prefill from click. */
/* ────────────────────────────────────────────────────────────────────────── */

function resolveInspectorTitle(info: ProcessGraphNodeClickInfo): string {
  if (info.kind === "task") {
    return info.task?.title ?? "Task";
  }
  if (info.kind === "phase" || info.kind === "forkJoin") {
    const phase = info.phase;
    if (phase === "ideate") return "Ideate phase";
    if (phase === "plan") return "Plan phase";
    if (phase === "build") return "Build phase";
    if (phase === "review") return "Review phase";
    if (phase === "ship") return "Ship phase";
    if (phase === "complete") return "Complete";
    if (phase === "failed") return "Failed";
    return "Workflow node";
  }
  return "Workflow node";
}

/**
 * Build a prefill string for the AI Coworker panel when the operator
 * clicks "Ask coworker about this step" inside the inspector.
 */
function buildCoworkerPrefill(info: ProcessGraphNodeClickInfo, buildId: string): string {
  if (info.kind === "task" && info.task) {
    return `In build ${buildId}, looking at task "${info.task.title}". What's happening with this step?`;
  }
  if (info.phase) {
    return `In build ${buildId}, looking at the ${info.phase} phase. What's the current state and what does the operator need to do next?`;
  }
  return `In build ${buildId}, looking at a workflow node. What's its current state?`;
}

function NodeInspectorBody({ info }: { info: ProcessGraphNodeClickInfo }) {
  if (info.kind === "task") {
    const assigned = info.task;
    if (!assigned) {
      return (
        <p className="text-[var(--dpf-muted)]">
          This task is referenced by the workflow but isn't in the saved build plan.
        </p>
      );
    }
    const plan = assigned.task;
    return (
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">Specialist</p>
          <p className="mt-0.5 text-[var(--dpf-text)]">{assigned.specialist}</p>
        </div>
        {plan?.implement && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">Implement</p>
            <p className="mt-0.5 text-[var(--dpf-text)]">{plan.implement}</p>
          </div>
        )}
        {plan?.testFirst && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">Test first</p>
            <p className="mt-0.5 text-[var(--dpf-text)]">{plan.testFirst}</p>
          </div>
        )}
        {plan?.verify && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">Verify</p>
            <p className="mt-0.5 text-[var(--dpf-text)]">{plan.verify}</p>
          </div>
        )}
      </div>
    );
  }
  if (info.kind === "phase" || info.kind === "forkJoin") {
    return (
      <div className="flex flex-col gap-2">
        <p>
          Click this node again to close the inspector, or open the Details
          drawer for full evidence (Progress, Brief, Review, Sandbox).
        </p>
        <p className="text-[var(--dpf-muted)]">
          The full per-phase inspector content migrates into the inspector in
          a follow-up slice — for now the body shows a minimal placeholder so
          the anchored-positioning + a11y contract is in place.
        </p>
      </div>
    );
  }
  return <p className="text-[var(--dpf-muted)]">Workflow node selected.</p>;
}

function BuildStudioFooter({ builds }: { builds: FeatureBuildRow[] }) {
  const candidates: SandboxDriverCandidate[] = builds.map((b) => ({
    buildCode: b.buildId,
    sandboxPort: b.sandboxPort,
    lastActivityAt: b.updatedAt,
  }));
  const driving = computeDrivingBuild(candidates);
  const sandboxUrl =
    driving && isValidSandboxPort(driving.sandboxPort)
      ? `http://localhost:${driving.sandboxPort}`
      : "";
  return (
    <div
      data-testid={BUILD_STUDIO_TEST_IDS.footer}
      className="flex h-12 shrink-0 items-center justify-between border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-2"
    >
      <span
        className="text-[11px] text-[var(--dpf-muted)]"
        title="The sandbox container reuses your portal-configured provider credentials (Codex / Claude OAuth). You don't sign in again."
      >
        {driving
          ? "Sandbox is shared across all in-flight builds — uses your portal credentials, no extra sign-in."
          : "No build is currently driving the sandbox."}
      </span>
      <OpenSandboxButton
        drivingBuildCode={driving?.buildCode ?? null}
        sandboxUrl={sandboxUrl}
      />
    </div>
  );
}

function resolveInitialActiveBuild(
  buildRows: FeatureBuildRow[],
  initialBuildId?: string | null,
): FeatureBuildRow | null {
  if (initialBuildId) {
    const linkedBuild = buildRows.find((build) => build.buildId === initialBuildId);
    if (linkedBuild) return linkedBuild;
  }

  return buildRows.find((build) => build.phase !== "complete" && build.phase !== "failed") ?? null;
}

function buildStudioBuildHref(buildId: string): string {
  return `/build?buildId=${encodeURIComponent(buildId)}`;
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

function FleetRailZone({
  buildRows,
  epicRollups,
  activeBuildId,
  governedBacklogEnabled,
  isDevEnvironment,
  onSelectBuild,
  onSelectBuildById,
  onDeleteBuild,
  onOpenQueueDrawer,
}: {
  buildRows: FeatureBuildRow[];
  epicRollups: EpicRollupView[];
  activeBuildId: string | null;
  governedBacklogEnabled: boolean;
  isDevEnvironment: boolean;
  onSelectBuild: (build: FeatureBuildRow) => void;
  onSelectBuildById: (buildId: string) => void | Promise<void>;
  onDeleteBuild: (build: FeatureBuildRow) => void;
  onOpenQueueDrawer: () => void;
}) {
  const [expandedEpicIds, setExpandedEpicIds] = useState<Set<string>>(() => new Set());

  // Derive per-row fleet entries: queueState + needsAttention + lifecycle.
  // queueState falls back to phase-based heuristics until the concurrency
  // dispatcher exposes real values (its thread owns that surface).
  const entries = buildRows.map((build) => ({
    build,
    queueState: deriveQueueState(build),
    needsAttention: deriveNeedsAttention(build),
    lifecycleLabel: deriveLifecycleLabel({
      backlogItem: build.originator
        ? {
          status: build.originator.status,
          triageOutcome: build.originator.triageOutcome,
          activeBuildId: build.originator.activeBuildId,
        }
        : null,
      featureBuild: build,
      governedBacklogEnabled,
    }),
  }));

  // Sort: running → blocked → queued (by position) → idle. Stable tie-break
  // by buildId so render order doesn't flicker across re-renders.
  const kindRank = { running: 0, blocked: 1, queued: 2, idle: 3 } as const;
  const sorted = [...entries].sort((a, b) => {
    const ra = kindRank[a.queueState.kind];
    const rb = kindRank[b.queueState.kind];
    if (ra !== rb) return ra - rb;
    if (a.queueState.kind === "queued" && b.queueState.kind === "queued") {
      return a.queueState.position - b.queueState.position;
    }
    return a.build.buildId.localeCompare(b.build.buildId);
  });

  // Split entries into active (needs attention) vs completed (historical). The
  // fleet rail surfaces what needs attention; completed work is one click away
  // via the "{N} completed" toggle below. Matches the "Builds: {N} running"
  // header semantic — the list should only show inflight work by default.
  const activeEntries = sorted.filter((e) => e.build.phase !== "complete");
  const completedEntries = sorted.filter((e) => e.build.phase === "complete");
  const activeEpicRollups = epicRollups.filter((rollup) => rollup.status !== "complete");
  const completedEpicRollups = epicRollups.filter((rollup) => rollup.status === "complete");
  const completedItemCount = completedEntries.length + completedEpicRollups.length;
  const [showCompleted, setShowCompleted] = useState(false);

  const counts = deriveFleetCounts(entries.map((e) => e.queueState));

  useEffect(() => {
    if (!activeBuildId) return;
    const activeEpic = epicRollups.find((rollup) =>
      rollup.children.some((child) => child.buildId === activeBuildId),
    );
    if (!activeEpic) return;
    setExpandedEpicIds((previous) => {
      if (previous.has(activeEpic.epicId)) return previous;
      const next = new Set(previous);
      next.add(activeEpic.epicId);
      return next;
    });
  }, [activeBuildId, epicRollups]);

  const toggleEpic = useCallback((epicId: string) => {
    setExpandedEpicIds((previous) => {
      const next = new Set(previous);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  }, []);

  if (buildRows.length === 0 && epicRollups.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-2">
        <div className="p-6 text-center">
          <div className="text-3xl mb-3 opacity-20">&#128161;</div>
          <p className="text-sm text-[var(--dpf-muted)] mb-2">No builds yet</p>
          <p className="text-xs text-[var(--dpf-muted)] opacity-70">
            Type a feature name above and press <strong className="text-[var(--dpf-text)]">New</strong> to start.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Compact fleet header — surfaces in-flight aggregate so the
          operator can see queue pressure without opening every build.
          Click opens the DetailsDrawer's BS-Queue section. */}
      <button
        type="button"
        onClick={onOpenQueueDrawer}
        role="status"
        aria-live="polite"
        aria-label="Open build details drawer — BS queue section"
        data-testid="build-studio-fleet-header"
        className="flex w-full shrink-0 cursor-pointer items-center justify-between border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-surface-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
      >
        <span data-testid="fleet-header-label">
          Builds: {counts.runningCount} running
          {counts.blockedCount > 0 && (
            <> · <span className="text-[var(--dpf-warning)]">{counts.blockedCount} blocked</span></>
          )}
          {counts.queuedCount > 0 && (
            <> · {counts.queuedCount} queued</>
          )}
        </span>
        <span aria-hidden="true" className="text-[var(--dpf-muted)]">›</span>
      </button>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1" data-testid="fleet-rail-body">
        {activeEpicRollups.map((rollup, idx) => (
          <li key={rollup.epicId}>
            <EpicRollupListItem
              rollup={rollup}
              activeBuildId={activeBuildId}
              expanded={expandedEpicIds.has(rollup.epicId)}
              index={idx}
              onToggle={() => toggleEpic(rollup.epicId)}
              onSelectBuild={onSelectBuildById}
            />
          </li>
        ))}
        {activeEntries.map((entry, idx) => (
          <li key={entry.build.buildId}>
            <BuildListItem
              build={entry.build}
              active={activeBuildId === entry.build.buildId}
              index={activeEpicRollups.length + idx}
              lifecycleLabel={entry.lifecycleLabel}
              isDevEnvironment={isDevEnvironment}
              density="fleet"
              queueState={entry.queueState}
              needsAttention={entry.needsAttention}
              onSelect={() => onSelectBuild(entry.build)}
              onDelete={() => onDeleteBuild(entry.build)}
            />
          </li>
        ))}
        {activeEpicRollups.length === 0 && activeEntries.length === 0 && (
          <li className="px-3 py-6 text-center text-[11px] text-[var(--dpf-muted)]">
            No active builds. Type a feature name above and press <strong className="text-[var(--dpf-text)]">New</strong> to start.
          </li>
        )}
        {completedItemCount > 0 && (
          <>
            <li>
              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                aria-expanded={showCompleted}
                aria-controls="fleet-rail-completed-list"
                data-testid="fleet-rail-completed-toggle"
                className="mt-2 flex w-full items-center justify-between rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--dpf-muted)] transition-colors hover:bg-[var(--dpf-surface-3)] hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
              >
                <span>
                  {completedItemCount} completed build{completedItemCount === 1 ? "" : "s"}
                </span>
                <span aria-hidden="true" className="text-[var(--dpf-muted)]">
                  {showCompleted ? "▾" : "▸"}
                </span>
              </button>
            </li>
            {showCompleted && (
              <li id="fleet-rail-completed-list" className="contents">
                <ul className="flex flex-col gap-0.5">
                  {completedEpicRollups.map((rollup, idx) => (
                    <li key={rollup.epicId}>
                      <EpicRollupListItem
                        rollup={rollup}
                        activeBuildId={activeBuildId}
                        expanded={expandedEpicIds.has(rollup.epicId)}
                        index={activeEpicRollups.length + activeEntries.length + idx}
                        onToggle={() => toggleEpic(rollup.epicId)}
                        onSelectBuild={onSelectBuildById}
                      />
                    </li>
                  ))}
                  {completedEntries.map((entry, idx) => (
                    <li key={entry.build.buildId}>
                      <BuildListItem
                        build={entry.build}
                        active={activeBuildId === entry.build.buildId}
                        index={activeEpicRollups.length + activeEntries.length + completedEpicRollups.length + idx}
                        lifecycleLabel={entry.lifecycleLabel}
                        isDevEnvironment={isDevEnvironment}
                        density="fleet"
                        queueState={entry.queueState}
                        needsAttention={entry.needsAttention}
                        onSelect={() => onSelectBuild(entry.build)}
                        onDelete={() => onDeleteBuild(entry.build)}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </>
        )}
      </ul>
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
