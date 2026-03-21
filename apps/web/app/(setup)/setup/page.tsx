import { redirect } from "next/navigation";
import { getSetupProgress } from "@/lib/actions/setup-progress";
import { checkBootstrapNeeded, executeFirstRunBootstrap } from "@/lib/bootstrap-first-run";
import { AccountBootstrapForm } from "./AccountBootstrapForm";

/**
 * /setup — The ONE custom page in the onboarding flow.
 *
 * Creates the organization and owner account, then redirects into the
 * real portal where the setup overlay guides the user through actual
 * platform pages with the COO coworker panel providing context.
 */
export default async function SetupPage() {
  const needsBootstrap = await checkBootstrapNeeded();
  let progress = await getSetupProgress();

  // Already set up and past bootstrap — go to the next real route
  if (!needsBootstrap && !progress) {
    redirect("/workspace");
  }

  // First run: execute bootstrap (seeds agent, creates progress record)
  if (needsBootstrap && !progress) {
    const result = await executeFirstRunBootstrap();
    if ("error" in result) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-[var(--dpf-bg)]">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold text-[var(--dpf-text)]">Welcome</h1>
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

  // If bootstrap step is already done, redirect to the portal
  // (the setup overlay in the shell will take over from here)
  if (progress.currentStep !== "account-bootstrap") {
    const { STEP_ROUTES } = await import("@/lib/actions/setup-constants");
    const nextRoute = STEP_ROUTES[progress.currentStep] ?? "/workspace";
    redirect(nextRoute);
  }

  return <AccountBootstrapForm setupId={progress.id} />;
}
