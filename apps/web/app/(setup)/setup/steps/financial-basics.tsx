"use client";

import { useState } from "react";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  { text: "A few financial basics so the platform can handle pricing and billing correctly." },
  { text: "If you handle billing externally, you can skip this step entirely and come back later." },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
  context: Record<string, unknown>;
};

export function FinancialBasicsStep({ onContinue, onSkip, onPause }: Props) {
  const [currency, setCurrency] = useState("USD");

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">Financial Basics</h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">Default Currency</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full px-3 py-2 rounded-lg">
                  <option value="USD">US Dollar (USD)</option>
                  <option value="EUR">Euro (EUR)</option>
                  <option value="GBP">British Pound (GBP)</option>
                  <option value="CAD">Canadian Dollar (CAD)</option>
                  <option value="AUD">Australian Dollar (AUD)</option>
                  <option value="JPY">Japanese Yen (JPY)</option>
                </select>
              </div>
              <div className="border border-[var(--dpf-border)] rounded-lg p-4 bg-[var(--dpf-surface-2)]">
                <p className="text-sm text-[var(--dpf-muted)]">Payment provider integration and tax configuration can be set up later from Platform Settings.</p>
              </div>
            </div>
          </div>
          <SetupStepNav onContinue={() => onContinue({ currency })} onSkip={onSkip} onPause={onPause} />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
