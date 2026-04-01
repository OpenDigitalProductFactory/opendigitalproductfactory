// apps/web/components/build/BuildStudio.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhaseIndicator } from "./PhaseIndicator";
import { FeatureBriefPanel } from "./FeatureBriefPanel";
import { SandboxPreview } from "./SandboxPreview";
import { ClaimBadge } from "./ClaimBadge";
import { createFeatureBuild, deleteFeatureBuild } from "@/lib/actions/build";
import { getFeatureBuild } from "@/lib/actions/build-read";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { PortfolioForSelect } from "@/lib/backlog-data";

type Props = {
  builds: FeatureBuildRow[];
  portfolios: PortfolioForSelect[];
  dpfEnvironment?: string;
};

export function BuildStudio({ builds, portfolios, dpfEnvironment }: Props) {
  const router = useRouter();
  const [activeBuild, setActiveBuild] = useState<FeatureBuildRow | null>(
    builds.find((b) => b.phase !== "complete" && b.phase !== "failed") ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [buildView, setBuildView] = useState<"preview" | "docs">("preview");
  const isDevEnvironment = dpfEnvironment === "dev";

  useEffect(() => {
    const detail = activeBuild?.buildId ?? null;
    window.dispatchEvent(new CustomEvent("build-studio-active-build", { detail }));
    return () => {
      window.dispatchEvent(new CustomEvent("build-studio-active-build", { detail: null }));
    };
  }, [activeBuild?.buildId]);

  // SSE subscription for live refresh when agent updates the build.
  // Debounced: refetches on any event type (not just phase changes) so that
  // sandbox port allocation and file generation are picked up promptly.
  useEffect(() => {
    if (!activeBuild?.threadId) return;
    const es = new EventSource(`/api/agent/stream?threadId=${activeBuild.threadId}`);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const fresh = await getFeatureBuild(activeBuild.buildId);
        if (fresh) setActiveBuild(fresh);
      }, 2_000);
    };
    return () => {
      es.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [activeBuild?.threadId, activeBuild?.buildId]);

  // Poll for sandbox port when phase is "build" or "review" but port is unknown.
  // This covers the gap between phase transition and sandbox allocation.
  useEffect(() => {
    if (!activeBuild) return;
    if (activeBuild.phase !== "build" && activeBuild.phase !== "review") return;
    if (activeBuild.sandboxPort !== null) return;
    const interval = setInterval(async () => {
      const fresh = await getFeatureBuild(activeBuild.buildId);
      if (fresh) setActiveBuild(fresh);
    }, 3_000);
    return () => clearInterval(interval);
  }, [activeBuild?.buildId, activeBuild?.phase, activeBuild?.sandboxPort]);

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
        designDoc: null,
        designReview: null,
        buildPlan: null,
        planReview: null,
        taskResults: null,
        verificationOut: null,
        acceptanceMet: null,
        accountableEmployeeId: null,
        claimedByAgentId: null,
        claimedAt: null,
        claimStatus: null,
        uxTestResults: null,
        buildExecState: null,
        phaseHandoffs: null,
      });
      setNewTitle("");
      router.refresh();
      // Open the co-worker panel and auto-prompt about the new feature
      document.dispatchEvent(new CustomEvent("open-agent-panel", {
        detail: { autoMessage: `I just created a new feature called "${title}". Help me define it.` },
      }));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Build List */}
        <div className="w-[360px] border-r border-[var(--dpf-border)] flex flex-col bg-[var(--dpf-surface-1)]">
          {isDevEnvironment ? (
            <div className="p-3 border-b border-[var(--dpf-border)]">
              <div className="px-3 py-2 text-[13px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md text-[var(--dpf-muted)]">
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
                  className="flex-1 px-3 py-2 text-[13px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                />
                <button
                  onClick={handleCreate}
                  disabled={creating || !newTitle.trim()}
                  className="px-4 py-2 text-[13px] font-semibold bg-[var(--dpf-accent)] text-white border-none rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  New
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto p-2">
            {builds.length === 0 ? (
              <div className="p-6 text-center">
                <div className="text-3xl mb-3 opacity-20">&#128161;</div>
                <p className="text-[13px] text-[var(--dpf-muted)] mb-2">No builds yet</p>
                <p className="text-xs text-[var(--dpf-muted)] opacity-70">
                  Type a feature name above and press <strong className="text-[var(--dpf-text)]">New</strong> to start.
                </p>
              </div>
            ) : (
              builds.map((build) => (
                <button
                  key={build.buildId}
                  onClick={() => setActiveBuild(build)}
                  className="block w-full text-left px-3 py-2.5 mb-1 rounded-md cursor-pointer transition-colors"
                  style={{
                    border: activeBuild?.buildId === build.buildId
                      ? "1px solid var(--dpf-accent)"
                      : "1px solid transparent",
                    background: activeBuild?.buildId === build.buildId
                      ? "var(--dpf-surface-2)"
                      : "transparent",
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="text-[13px] font-semibold text-[var(--dpf-text)] mb-0.5">{build.title}</div>
                    <span
                      role="button"
                      tabIndex={0}
                      title="Delete build"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isDevEnvironment) return;
                        if (!confirm(`Delete "${build.title}"?`)) return;
                        deleteFeatureBuild(build.buildId).then(() => {
                          if (activeBuild?.buildId === build.buildId) setActiveBuild(null);
                          router.refresh();
                        });
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.click(); }}
                      className="text-[var(--dpf-muted)] hover:text-[#f87171] text-xs ml-2 shrink-0 cursor-pointer"
                    >
                      &times;
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--dpf-muted)]">
                    {build.buildId} &middot; {build.phase}
                    {build.product && (
                      <span> &middot; v{build.product.version} &middot; {build.product.backlogCount} item{build.product.backlogCount !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Preview or Brief */}
        <div className="flex-1 flex flex-col overflow-auto">
          {activeBuild ? (
            <>
              <div className="px-4 py-3 border-b border-[var(--dpf-border)] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[var(--dpf-text)] m-0">{activeBuild.title}</h2>
                    <ClaimBadge agentId={activeBuild.claimedByAgentId ?? null} claimStatus={activeBuild.claimStatus ?? null} claimedAt={activeBuild.claimedAt ?? null} />
                  </div>
                  <span className="text-xs text-[var(--dpf-muted)]">{activeBuild.buildId}</span>
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                {/* Tab selector — only show when sandbox is available */}
                {activeBuild.sandboxPort && (activeBuild.phase === "build" || activeBuild.phase === "review" || activeBuild.phase === "ship") && (
                  <div className="flex gap-1 px-4 pt-3 pb-0">
                    <button
                      onClick={() => setBuildView("preview")}
                      className="px-3 py-1 rounded-t text-xs font-medium transition-colors"
                      style={{
                        background: buildView === "preview" ? "var(--dpf-surface-2)" : "transparent",
                        color: buildView === "preview" ? "var(--dpf-text)" : "var(--dpf-muted)",
                        borderBottom: buildView === "preview" ? "2px solid var(--dpf-accent)" : "2px solid transparent",
                      }}
                    >
                      Live Preview
                    </button>
                    <button
                      onClick={() => setBuildView("docs")}
                      className="px-3 py-1 rounded-t text-xs font-medium transition-colors"
                      style={{
                        background: buildView === "docs" ? "var(--dpf-surface-2)" : "transparent",
                        color: buildView === "docs" ? "var(--dpf-text)" : "var(--dpf-muted)",
                        borderBottom: buildView === "docs" ? "2px solid var(--dpf-accent)" : "2px solid transparent",
                      }}
                    >
                      Build Details
                    </button>
                  </div>
                )}
                <div className="flex-1 flex p-4 gap-4">
                  {buildView === "preview" && activeBuild.sandboxPort && (activeBuild.phase === "build" || activeBuild.phase === "review" || activeBuild.phase === "ship") ? (
                    <SandboxPreview
                      buildId={activeBuild.buildId}
                      phase={activeBuild.phase}
                      sandboxPort={activeBuild.sandboxPort}
                    />
                  ) : (
                    <div className="flex-1">
                      <FeatureBriefPanel
                        brief={activeBuild.brief}
                        phase={activeBuild.phase}
                        diffSummary={activeBuild.diffSummary}
                        build={activeBuild}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center">
              <div className="text-center max-w-md px-8">
                <div className="text-5xl mb-4 opacity-20">&#128736;</div>
                <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-3">Product Development Studio</h2>
                <p className="text-sm text-[var(--dpf-muted)] leading-relaxed mb-6">
                  Build features without writing code. Describe what you want, and your AI Coworker will design, build, and deploy it.
                </p>
                <div className="text-left bg-[var(--dpf-surface-2)] rounded-lg border border-[var(--dpf-border)] p-4">
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

      {activeBuild && <PhaseIndicator currentPhase={activeBuild.phase} />}
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-5 h-5 rounded-full bg-[var(--dpf-accent)] text-[10px] font-bold text-white grid place-items-center shrink-0 mt-0.5">
        {n}
      </span>
      <span className="text-[13px] text-[#ccc] leading-snug">{text}</span>
    </div>
  );
}
