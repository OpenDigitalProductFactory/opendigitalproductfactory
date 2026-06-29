import { AiReadinessSummaryPanel } from "@/components/platform/AiReadinessSummaryPanel";
import { auth } from "@/lib/auth";
import {
  getAiReadinessSummary,
  type AiReadinessSummary,
} from "@/lib/ai-readiness/readiness-summary";

export const dynamic = "force-dynamic";

export default async function PlatformAiReadinessPage() {
  const session = await auth();
  const summary = await loadSummary(session?.user?.id);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[var(--dpf-text)]">
          AI Readiness Console
        </h1>
        <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
          One operator view for model supply, build execution, tool access, and routing confidence.
        </p>
      </header>

      <AiReadinessSummaryPanel summary={summary} />
    </div>
  );
}

async function loadSummary(userId?: string): Promise<AiReadinessSummary> {
  try {
    return await getAiReadinessSummary(userId);
  } catch (error) {
    return fallbackSummary(error);
  }
}

function fallbackSummary(error: unknown): AiReadinessSummary {
  const reason = error instanceof Error ? error.message : "Unknown readiness loader error";
  return {
    state: "blocked",
    summary:
      "AI readiness could not be calculated. Open runtime diagnostics and provider setup before starting governed AI work.",
    generatedAt: new Date().toISOString(),
    domains: [
      {
        id: "model-supply",
        label: "Model Supply",
        state: "diagnostic",
        summary: "Provider readiness could not be loaded from the readiness console.",
        evidence: [{ label: "Loader", value: "Unavailable" }],
        diagnosticsHref: "/platform/ai/providers",
      },
      {
        id: "build-execution",
        label: "Build Execution",
        state: "diagnostic",
        summary: "Build runtime readiness could not be loaded from the readiness console.",
        evidence: [{ label: "Loader", value: "Unavailable" }],
        diagnosticsHref: "/platform/ai/build-studio",
      },
      {
        id: "tool-access",
        label: "Tool Access",
        state: "diagnostic",
        summary: "Contributor token readiness could not be loaded from the readiness console.",
        evidence: [{ label: "Loader", value: "Unavailable" }],
        diagnosticsHref: "/admin/platform-development",
      },
      {
        id: "routing-confidence",
        label: "Routing Confidence",
        state: "blocked",
        summary: "Runtime routing confidence is unavailable until the readiness loader succeeds.",
        evidence: [{ label: "Error", value: reason.slice(0, 96) }],
        blocker: {
          code: "readiness-loader-error",
          message: "Readiness data could not be assembled.",
          primaryActionLabel: "Open runtime diagnostics",
          href: "/platform/ai/runtime-health",
        },
        diagnosticsHref: "/platform/ai/runtime-health",
      },
    ],
  };
}
