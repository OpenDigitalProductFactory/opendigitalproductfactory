"use client";

import { useState } from "react";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  {
    text: "Welcome. I'm your AI operations officer \u2014 think of me as your second-in-command for running this platform.",
  },
  {
    text: "I should be upfront: I'm running on a local AI model right now. That means I can handle this walkthrough and day-to-day conversations, but for complex tasks like regulatory analysis, document processing, or deep research, we'll want to connect a more capable AI service. I'll help you with that in a few steps.",
  },
  {
    text: "Let's start with the basics \u2014 tell me about your business.",
  },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
};

export function BusinessIdentityStep({ onContinue, onSkip, onPause }: Props) {
  const [orgName, setOrgName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [timezone, setTimezone] = useState("");

  const canContinue = orgName.trim().length > 0;

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">Business Identity</h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
                  Organization Name *
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g., Riverside Medical Group"
                  className="w-full px-3 py-2 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
                  Industry / Sector
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg"
                >
                  <option value="">Select an industry...</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="financial-services">Financial Services</option>
                  <option value="legal">Legal</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="retail">Retail</option>
                  <option value="technology">Technology</option>
                  <option value="consulting">Consulting / Professional Services</option>
                  <option value="education">Education</option>
                  <option value="government">Government</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
                  Primary Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g., Portland, Oregon"
                  className="w-full px-3 py-2 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
                  Timezone
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg"
                >
                  <option value="">Select timezone...</option>
                  <option value="America/New_York">Eastern (US)</option>
                  <option value="America/Chicago">Central (US)</option>
                  <option value="America/Denver">Mountain (US)</option>
                  <option value="America/Los_Angeles">Pacific (US)</option>
                  <option value="Europe/London">London (GMT)</option>
                  <option value="Europe/Berlin">Central Europe</option>
                  <option value="Asia/Tokyo">Tokyo</option>
                  <option value="Australia/Sydney">Sydney</option>
                </select>
              </div>
            </div>
          </div>
          <SetupStepNav
            onContinue={() => onContinue({ orgName, industry, location, timezone })}
            onSkip={onSkip}
            onPause={onPause}
            continueDisabled={!canContinue}
          />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
