import { redirect } from "next/navigation";
import { type StepStatus } from "@/lib/actions/setup-constants";
import { getSetupProgress } from "@/lib/actions/setup-progress";
import { checkBootstrapNeeded, executeFirstRunBootstrap } from "@/lib/bootstrap-first-run";
import { SetupOrchestrator } from "./SetupOrchestrator";

export default async function SetupPage() {
  const needsBootstrap = await checkBootstrapNeeded();
  let progress = await getSetupProgress();

  if (!needsBootstrap && !progress) {
    redirect("/workspace");
  }

  if (needsBootstrap && !progress) {
    const result = await executeFirstRunBootstrap();
    if ("error" in result) {
      // Bootstrap itself failed (not just Ollama) — show error with retry
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold">Welcome</h1>
            <p className="text-[var(--dpf-muted)]">
              Something went wrong during setup initialization: {result.error}
            </p>
            <p className="text-sm text-[var(--dpf-muted)]">
              Try refreshing this page. If the problem persists, check the server logs.
            </p>
          </div>
        </div>
      );
    }
    progress = await getSetupProgress();
  }

  if (!progress) {
    redirect("/workspace");
  }

  const serializedProgress = {
    id: progress.id,
    currentStep: progress.currentStep,
    steps: progress.steps as Record<string, StepStatus>,
    context: progress.context as Record<string, unknown>,
  };

  return <SetupOrchestrator progress={serializedProgress} />;
}
