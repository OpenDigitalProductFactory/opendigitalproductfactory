"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerEndpointTests } from "@/lib/actions/endpoint-performance";

type TaskPerformance = {
  taskType: string;
  evaluationCount: number;
  successCount: number;
  avgOrchestratorScore: number;
  avgHumanScore: number | null;
  instructionPhase: string;
  pinned: boolean;
  blocked: boolean;
  avgLatencyMs: number;
  lastEvaluatedAt: string | null;
};

type Evaluation = {
  id: string;
  taskType: string;
  qualityScore: number | null;
  humanScore: number | null;
  taskContext: string;
  evaluationNotes: string | null;
  routeContext: string;
  source: string | null;
  createdAt: string;
};

type TestRun = {
  runId: string;
  modelId: string | null;
  probesPassed: number;
  probesFailed: number;
  scenariosPassed: number;
  scenariosFailed: number;
  avgScore: number | null;
  results: {
    modelId?: string;
    friendlyName?: string;
    probes?: Array<{ id: string; category: string; name: string; pass: boolean; reason: string }>;
    scenarios?: Array<{ id: string; taskType: string; name: string; passed: boolean; assertions: Array<{ description: string; passed: boolean; detail: string }>; orchestratorScore: number | null }>;
  } | null;
  startedAt: string;
  status: string;
};

type Profile = {
  friendlyName: string;
  capabilityTier: string;
  codingCapability: string | null;
  instructionFollowing: string | null;
  bestFor: unknown;
  avoidFor: unknown;
} | null;

const PHASE_COLORS: Record<string, string> = {
  learning: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  practicing: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  innate: "bg-green-500/20 text-green-300 border-green-500/30",
};

const CAPABILITY_COLORS: Record<string, string> = {
  excellent: "text-green-400",
  adequate: "text-yellow-400",
  insufficient: "text-red-400",
};

function ScoreBar({ score, max = 5 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100);
  const color = score >= 4 ? "#4ade80" : score >= 3 ? "#fbbf24" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{score.toFixed(1)}</span>
    </div>
  );
}

export default function EndpointPerformancePanel({
  endpointId,
  performances,
  recentEvals,
  testRuns,
  profile,
}: {
  endpointId: string;
  performances: TaskPerformance[];
  recentEvals: Evaluation[];
  testRuns: TestRun[];
  profile: Profile;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<"performance" | "evaluations" | "tests">("performance");

  function handleRunTests(probesOnly: boolean) {
    startTransition(async () => {
      await triggerEndpointTests(endpointId, probesOnly);
      router.refresh();
    });
  }

  return (
    <div className="mt-6 bg-[#1a1a2e] border border-[#2a2a40] rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Endpoint Performance</h2>
          {profile && (
            <div className="flex items-center gap-3 mt-1 text-xs text-[#b0b0c8]">
              <span>Tier: {profile.capabilityTier}</span>
              {profile.instructionFollowing && (
                <span>Instructions: <span className={CAPABILITY_COLORS[profile.instructionFollowing] ?? ""}>{profile.instructionFollowing}</span></span>
              )}
              {profile.codingCapability && (
                <span>Coding: <span className={CAPABILITY_COLORS[profile.codingCapability] ?? ""}>{profile.codingCapability}</span></span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleRunTests(true)}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded-lg bg-[#7c8cf8]/20 text-[#7c8cf8] border border-[#7c8cf8]/30 hover:bg-[#7c8cf8]/30 transition-colors disabled:opacity-50"
          >
            {isPending ? "Running..." : "Run Probes"}
          </button>
          <button
            onClick={() => handleRunTests(false)}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded-lg bg-[#7c8cf8]/20 text-[#7c8cf8] border border-[#7c8cf8]/30 hover:bg-[#7c8cf8]/30 transition-colors disabled:opacity-50"
          >
            {isPending ? "Running..." : "Run Full Tests"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[#2a2a40]">
        {(["performance", "evaluations", "tests"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-[#7c8cf8] text-white"
                : "border-transparent text-[#8888a0] hover:text-white"
            }`}
          >
            {tab === "performance" ? "By Task Type" : tab === "evaluations" ? "Recent Evaluations" : "Test Runs"}
            {tab === "tests" && testRuns.length > 0 && (
              <span className="ml-1 text-[#8888a0]">({testRuns.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Performance by Task Type */}
      {activeTab === "performance" && (
        <div className="space-y-2">
          {performances.length === 0 ? (
            <div className="text-center py-8 text-[#8888a0] text-xs">
              No performance data yet. Run tests or wait for conversation evaluations.
            </div>
          ) : (
            <div className="grid gap-2">
              {performances.map((p) => (
                <div key={p.taskType} className="flex items-center gap-4 p-3 rounded-lg bg-[#161625]">
                  <div className="w-28 shrink-0">
                    <span className="text-xs font-medium text-white">{p.taskType}</span>
                  </div>
                  <div className="flex-1">
                    <ScoreBar score={p.avgOrchestratorScore} />
                  </div>
                  {p.avgHumanScore !== null && (
                    <div className="w-24">
                      <div className="text-[10px] text-[#8888a0] mb-0.5">Human</div>
                      <ScoreBar score={p.avgHumanScore} />
                    </div>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] border ${PHASE_COLORS[p.instructionPhase] ?? ""}`}>
                    {p.instructionPhase}
                  </span>
                  <div className="text-[10px] text-[#8888a0] w-16 text-right">
                    {p.evaluationCount} evals
                  </div>
                  <div className="text-[10px] text-[#8888a0] w-20 text-right">
                    {Math.round((p.successCount / Math.max(1, p.evaluationCount)) * 100)}% success
                  </div>
                  {p.pinned && <span className="text-[10px] text-blue-400">pinned</span>}
                  {p.blocked && <span className="text-[10px] text-red-400">blocked</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent Evaluations */}
      {activeTab === "evaluations" && (
        <div className="space-y-1.5">
          {recentEvals.length === 0 ? (
            <div className="text-center py-8 text-[#8888a0] text-xs">No evaluations yet.</div>
          ) : (
            recentEvals.map((e) => (
              <div key={e.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-[#161625] text-xs">
                <div className="w-20 shrink-0">
                  <span className="text-[#b0b0c8]">{e.taskType}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-white truncate block">{e.taskContext.slice(0, 80)}</span>
                  {e.evaluationNotes && (
                    <span className="text-[#8888a0] text-[10px] truncate block mt-0.5">{e.evaluationNotes}</span>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {e.qualityScore !== null && <ScoreBar score={e.qualityScore} />}
                  {e.source === "test_harness" && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30">test</span>
                  )}
                  <span className="text-[10px] text-[#8888a0]">
                    {new Date(e.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Test Runs */}
      {activeTab === "tests" && (
        <div className="space-y-2">
          {testRuns.length === 0 ? (
            <div className="text-center py-8 text-[#8888a0] text-xs">
              No test runs yet. Click &quot;Run Probes&quot; or &quot;Run Full Tests&quot; above.
            </div>
          ) : (
            testRuns.map((tr) => {
              const totalProbes = tr.probesPassed + tr.probesFailed;
              const totalScenarios = tr.scenariosPassed + tr.scenariosFailed;
              const allProbesPass = tr.probesFailed === 0 && totalProbes > 0;
              const probes = tr.results?.probes ?? [];
              const scenarios = tr.results?.scenarios ?? [];
              return (
                <div key={tr.runId} className="p-3 rounded-lg bg-[#161625]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-[#b0b0c8]">{tr.runId}</span>
                      {(tr.results?.friendlyName || tr.modelId) && (
                        <span className="text-xs font-medium text-[#7c8cf8]">
                          {tr.results?.friendlyName ?? tr.modelId}
                        </span>
                      )}
                      <span className={`text-xs ${tr.status === "completed" ? "text-green-400" : "text-yellow-400"}`}>
                        {tr.status}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#8888a0]">
                      {new Date(tr.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className={allProbesPass ? "text-green-400" : "text-red-400"}>
                      Probes: {tr.probesPassed}/{totalProbes} passed
                    </span>
                    {totalScenarios > 0 && (
                      <span className={tr.scenariosFailed === 0 ? "text-green-400" : "text-yellow-400"}>
                        Scenarios: {tr.scenariosPassed}/{totalScenarios} passed
                      </span>
                    )}
                    {tr.avgScore !== null && (
                      <span className="text-[#b0b0c8]">
                        Avg score: {tr.avgScore.toFixed(1)}/5
                      </span>
                    )}
                  </div>

                  {/* Probe details */}
                  {probes.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-[#2a2a40] space-y-1">
                      <div className="text-[10px] text-[#8888a0] uppercase tracking-wider mb-1">Probes</div>
                      {probes.map((p) => (
                        <div key={p.id} className="flex items-start gap-2 text-xs">
                          <span className={`shrink-0 ${p.pass ? "text-green-400" : "text-red-400"}`}>
                            {p.pass ? "PASS" : "FAIL"}
                          </span>
                          <span className="text-[#b0b0c8] shrink-0">[{p.category}]</span>
                          <span className="text-white">{p.name}</span>
                          {!p.pass && (
                            <span className="text-red-300/70 text-[10px] ml-auto">{p.reason}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Scenario details */}
                  {scenarios.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-[#2a2a40] space-y-1">
                      <div className="text-[10px] text-[#8888a0] uppercase tracking-wider mb-1">Scenarios</div>
                      {scenarios.map((s) => (
                        <div key={s.id} className="text-xs">
                          <div className="flex items-center gap-2">
                            <span className={`shrink-0 ${s.passed ? "text-green-400" : "text-red-400"}`}>
                              {s.passed ? "PASS" : "FAIL"}
                            </span>
                            <span className="text-[#b0b0c8] shrink-0">[{s.taskType}]</span>
                            <span className="text-white">{s.name}</span>
                            {s.orchestratorScore !== null && (
                              <span className="ml-auto text-[#8888a0]">Score: {s.orchestratorScore}/5</span>
                            )}
                          </div>
                          {s.assertions?.filter((a) => !a.passed).map((a, i) => (
                            <div key={i} className="ml-14 text-[10px] text-red-300/70">
                              {a.description}: {a.detail}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
