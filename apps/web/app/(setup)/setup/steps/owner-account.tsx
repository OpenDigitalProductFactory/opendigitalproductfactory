"use client";

import { useState } from "react";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  {
    text: "Now let's set up your account. You'll be the platform owner \u2014 full access to everything.",
  },
  {
    text: "You can add team members later and control what each person can see and do.",
  },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
};

export function OwnerAccountStep({ onContinue, onSkip, onPause }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canContinue =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8;

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">Owner Account</h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">
                  Password * (8+ characters)
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg"
                />
              </div>
            </div>
          </div>
          <SetupStepNav
            onContinue={() => onContinue({ ownerName: name, ownerEmail: email })}
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
