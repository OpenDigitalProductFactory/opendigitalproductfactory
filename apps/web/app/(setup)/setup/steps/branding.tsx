"use client";

import { useState } from "react";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  { text: "This is what your customers and team will see. Your logo and colors appear on your storefront and any materials the platform generates." },
  { text: "Don't worry about getting this perfect now \u2014 you can always update it later from Platform Settings." },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
};

export function BrandingStep({ onContinue, onSkip, onPause }: Props) {
  const [tagline, setTagline] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#3B82F6");

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">Branding</h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tagline</label>
                <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g., Quality care, close to home" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-10 h-10 border rounded cursor-pointer" />
                  <span className="text-sm text-gray-500">{primaryColor}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
                <div className="border-2 border-dashed rounded-lg p-8 text-center text-gray-400">
                  <p>Logo upload will be available here</p>
                  <p className="text-xs mt-1">You can add this later from Platform Settings</p>
                </div>
              </div>
            </div>
          </div>
          <SetupStepNav onContinue={() => onContinue({ tagline, primaryColor })} onSkip={onSkip} onPause={onPause} />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
