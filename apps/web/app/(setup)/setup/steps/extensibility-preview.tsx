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
              <div className="border border-[#3b82f6]/20 rounded-lg p-6 bg-[#3b82f6]/10">
                <h3 className="font-semibold text-[var(--dpf-text)] mb-2">Build What You Need</h3>
                <p className="text-sm text-[var(--dpf-text)]">Describe what you need in plain language, and the platform's AI workforce will develop it for you. New workflows, reports, integrations \u2014 whatever your business requires.</p>
              </div>
              <div className="border border-[#4ade80]/20 rounded-lg p-6 bg-[#4ade80]/10">
                <h3 className="font-semibold text-[var(--dpf-text)] mb-2">Share With the Community</h3>
                <p className="text-sm text-[var(--dpf-text)]">Anything you build can be donated back to the community so other businesses benefit too. Or keep it private \u2014 your choice.</p>
              </div>
              <p className="text-sm text-[var(--dpf-muted)]">You'll find the Build Studio in your workspace when you're ready to explore this.</p>
            </div>
          </div>
          <SetupStepNav onContinue={() => onContinue({})} onSkip={onSkip} onPause={onPause} continueLabel="Next" />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
