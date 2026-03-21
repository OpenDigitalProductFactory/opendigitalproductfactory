import { redirect } from "next/navigation";
import { getSetupProgress, type StepStatus } from "@/lib/actions/setup-progress";
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
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold">Welcome</h1>
            <p className="text-gray-600">
              We couldn&apos;t start the AI assistant automatically: {result.error}
            </p>
            <p className="text-sm text-gray-500">
              Please ensure Ollama is running and try refreshing this page.
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
