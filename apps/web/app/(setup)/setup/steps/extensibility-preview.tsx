"use client";

import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  { text: "One thing that makes this platform different \u2014 if you need something that isn't built in, the platform can help you build it." },
  { text: "You describe what you need, and the AI workforce develops it: new workflows, reports, integrations, whatever your business requires." },
  { text: "Anything you build can be kept private or donated back to the community so other businesses benefit too." },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
};

export function ExtensibilityPreviewStep({ onContinue, onSkip, onPause }: Props) {
  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">Platform Extensibility</h2>
            <div className="space-y-4">
              <div className="border rounded-lg p-6 bg-blue-50 border-blue-200">
                <h3 className="font-semibold text-blue-900 mb-2">Build What You Need</h3>
                <p className="text-sm text-blue-800">Describe what you need in plain language, and the platform's AI workforce will develop it for you. New workflows, reports, integrations \u2014 whatever your business requires.</p>
              </div>
              <div className="border rounded-lg p-6 bg-green-50 border-green-200">
                <h3 className="font-semibold text-green-900 mb-2">Share With the Community</h3>
                <p className="text-sm text-green-800">Anything you build can be donated back to the community so other businesses benefit too. Or keep it private \u2014 your choice.</p>
              </div>
              <p className="text-sm text-gray-500">You'll find the Build Studio in your workspace when you're ready to explore this.</p>
            </div>
          </div>
          <SetupStepNav onContinue={() => onContinue({})} onSkip={onSkip} onPause={onPause} continueLabel="Next" />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
