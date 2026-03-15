// apps/web/components/build/BuildStudio.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhaseIndicator } from "./PhaseIndicator";
import { FeatureBriefPanel } from "./FeatureBriefPanel";
import { SandboxPreview } from "./SandboxPreview";
import { createFeatureBuild } from "@/lib/actions/build";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { PortfolioForSelect } from "@/lib/backlog-data";

type Props = {
  builds: FeatureBuildRow[];
  portfolios: PortfolioForSelect[];
};

export function BuildStudio({ builds, portfolios }: Props) {
  const router = useRouter();
  const [activeBuild, setActiveBuild] = useState<FeatureBuildRow | null>(
    builds.find((b) => b.phase !== "complete" && b.phase !== "failed") ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const { buildId } = await createFeatureBuild({ title: newTitle.trim() });
      setActiveBuild({
        id: "",
        buildId,
        title: newTitle.trim(),
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
        createdById: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setNewTitle("");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Build List */}
        <div className="w-[360px] border-r border-[var(--dpf-border)] flex flex-col bg-[var(--dpf-surface-1)]">
          <div className="p-3 border-b border-[var(--dpf-border)]">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Describe a new feature..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="flex-1 px-3 py-2 text-[13px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md text-white outline-none focus:border-[var(--dpf-accent)]"
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

          <div className="flex-1 overflow-auto p-2">
            {builds.length === 0 ? (
              <p className="text-[13px] text-[var(--dpf-muted)] p-4 text-center">
                No feature builds yet. Describe what you want to build above.
              </p>
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
                  <div className="text-[13px] font-semibold text-white mb-0.5">{build.title}</div>
                  <div className="text-[11px] text-[var(--dpf-muted)]">
                    {build.buildId} &middot; {build.phase}
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
                  <h2 className="text-base font-bold text-white m-0">{activeBuild.title}</h2>
                  <span className="text-xs text-[var(--dpf-muted)]">{activeBuild.buildId}</span>
                </div>
              </div>

              <div className="flex-1 flex p-4 gap-4">
                {activeBuild.phase === "build" || activeBuild.phase === "review" ? (
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
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center">
              <div className="text-center">
                <div className="text-5xl mb-4 opacity-20">&#128736;</div>
                <h2 className="text-lg font-bold text-white mb-2">Product Development Studio</h2>
                <p className="text-sm text-[var(--dpf-muted)] max-w-[400px] leading-relaxed">
                  Describe what you want to build in plain language. The AI will design it, build it in a sandbox, and deploy it when you approve.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {activeBuild && <PhaseIndicator currentPhase={activeBuild.phase} />}
    </div>
  );
}
