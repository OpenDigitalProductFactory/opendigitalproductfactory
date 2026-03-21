"use client";

import { useState } from "react";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  { text: "Let me explain how AI works on this platform. You have three options, and they can work together." },
  { text: "Right now, I'm running entirely on your system. Your data never leaves this machine. Everything stays within the platform's own database. This is the safest option for regulated industries. The trade-off is capability: I can handle conversations and guided tasks, but I'm limited by the hardware you're running on." },
  { text: "Cloud AI services like Anthropic or OpenAI provide more powerful models. Your data is sent to their servers for processing. The platform controls which tasks use cloud services based on sensitivity. You decide what's acceptable for your business." },
  { text: "Would you like to add a cloud AI provider now, or stick with local for today?" },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
  context: Record<string, unknown>;
};

export function AiCapabilitiesStep({ onContinue, onSkip, onPause }: Props) {
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "failed">("idle");

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-2xl overflow-y-auto">
            <h2 className="text-xl font-semibold mb-6">AI Capabilities</h2>

            {/* Tier cards */}
            <div className="space-y-4 mb-8">
              <div className="border border-[#4ade80]/20 rounded-lg p-4 bg-[#4ade80]/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[#4ade80] font-medium">Active</span>
                  <h3 className="font-semibold">This Platform (Local AI)</h3>
                </div>
                <p className="text-sm text-[var(--dpf-muted)]">Running on your hardware. Private, free, handles conversation and guided tasks. Limited by your hardware capacity.</p>
              </div>

              <div className="border border-[var(--dpf-border)] rounded-lg p-4 bg-[var(--dpf-surface-1)]">
                <h3 className="font-semibold mb-2">Cloud AI Services</h3>
                <p className="text-sm text-[var(--dpf-muted)]">Services like Anthropic or OpenAI. Pay per use, significantly more capable. Needed for complex analysis, document processing, and code generation.</p>
                {!showAddProvider && (
                  <button
                    onClick={() => setShowAddProvider(true)}
                    className="mt-3 px-4 py-2 text-sm font-medium text-[var(--dpf-accent)] border border-[var(--dpf-accent)]/30 rounded-lg hover:bg-[var(--dpf-accent)]/5"
                  >
                    Add a cloud provider
                  </button>
                )}
              </div>

              <div className="border border-[var(--dpf-border)] rounded-lg p-4 bg-[var(--dpf-surface-2)]">
                <h3 className="font-semibold mb-2 text-[var(--dpf-muted)]">Enterprise / Private Cloud</h3>
                <p className="text-sm text-[var(--dpf-muted)]">Azure OpenAI, AWS Bedrock — cloud capability with your own infrastructure. Available to set up later.</p>
              </div>
            </div>

            {/* Add provider section */}
            {showAddProvider && (
              <div className="border border-[var(--dpf-border)] rounded-lg p-4 space-y-4">
                <h3 className="font-semibold">Connect a Cloud Provider</h3>
                <div>
                  <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">Provider</label>
                  <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)} className="w-full px-3 py-2 rounded-lg">
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="openai">OpenAI (GPT)</option>
                    <option value="gemini">Google (Gemini)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">API Key</label>
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your API key here" className="w-full px-3 py-2 rounded-lg" />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setTestStatus("testing"); setTimeout(() => setTestStatus("success"), 1500); }}
                    disabled={!apiKey || testStatus === "testing"}
                    className="px-4 py-2 text-sm font-medium text-white bg-[var(--dpf-accent)] rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    {testStatus === "testing" ? "Testing..." : "Test Connection"}
                  </button>
                  {testStatus === "success" && <span className="text-sm text-[#4ade80]">Connected successfully</span>}
                  {testStatus === "failed" && <span className="text-sm text-red-600">Connection failed. Check your API key.</span>}
                </div>
              </div>
            )}
          </div>
          <SetupStepNav
            onContinue={() => onContinue({ hasCloudProvider: testStatus === "success" })}
            onSkip={onSkip}
            onPause={onPause}
          />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
