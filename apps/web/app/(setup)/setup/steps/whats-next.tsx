"use client";

import { SETUP_STEPS, type StepStatus } from "@/lib/actions/setup-constants";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const STEP_NAMES: Record<string, string> = {
  "business-identity": "Business Identity",
  "owner-account": "Owner Account",
  "ai-capabilities": "AI Capabilities",
  "branding": "Branding",
  "financial-basics": "Financial Basics",
  "first-workspace": "First Workspace",
  "extensibility-preview": "Platform Extensibility",
};

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
  context: Record<string, unknown>;
  steps: Record<string, StepStatus>;
};

export function WhatsNextStep({ onContinue, onSkip, onPause, context, steps }: Props) {
  const completed = SETUP_STEPS.filter((s) => steps[s] === "completed" && s !== "whats-next");
  const skipped = SETUP_STEPS.filter((s) => steps[s] === "skipped");
  const hasCloudProvider = context.hasCloudProvider === true;

  const cooMessages = [
    { text: `Here's what we've set up: ${completed.map((s) => STEP_NAMES[s] || s).join(", ") || "nothing yet"}.` },
    ...(skipped.length > 0
      ? [{ text: `You skipped ${skipped.map((s) => STEP_NAMES[s] || s).join(", ")} \u2014 you can come back to those anytime from Platform Settings.` }]
      : []),
    ...(!hasCloudProvider
      ? [{ text: "Adding a cloud AI provider will unlock the platform's full capability. You'll find that under Platform > AI Providers." }]
      : []),
    { text: "Your workspace is ready \u2014 you can start using the platform right away. I'll be here whenever you need help. Just open the chat panel." },
    { text: "Welcome aboard." },
  ];

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">You're All Set</h2>
            <div className="space-y-4">
              {completed.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Completed</h3>
                  <ul className="space-y-1">
                    {completed.map((s) => (
                      <li key={s} className="flex items-center gap-2 text-sm text-green-700">
                        <span>&#10003;</span> {STEP_NAMES[s] || s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {skipped.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Skipped (available in Settings)</h3>
                  <ul className="space-y-1">
                    {skipped.map((s) => (
                      <li key={s} className="flex items-center gap-2 text-sm text-gray-400">
                        <span>&#8212;</span> {STEP_NAMES[s] || s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="border-t pt-4 mt-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Next Steps</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  {!hasCloudProvider && <li>Add a cloud AI provider for full platform capability</li>}
                  <li>Explore your workspace and meet your AI coworkers</li>
                  <li>Open the chat panel anytime for help</li>
                </ul>
              </div>
            </div>
          </div>
          <SetupStepNav
            onContinue={() => onContinue({})}
            onSkip={onSkip}
            onPause={onPause}
            isLastStep
            continueLabel="Enter Workspace"
          />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={cooMessages} />}
    />
  );
}
