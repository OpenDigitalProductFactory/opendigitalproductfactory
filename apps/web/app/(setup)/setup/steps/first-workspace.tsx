"use client";

import { useState } from "react";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  { text: "Workspaces are where your team does their day-to-day work. Let's create your first one." },
  { text: "AI coworkers operate within workspaces and can be customized for each workspace's needs." },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
  context: Record<string, unknown>;
};

export function FirstWorkspaceStep({ onContinue, onSkip, onPause, context }: Props) {
  const orgName = (context.orgName as string) || "My Workspace";
  const [workspaceName, setWorkspaceName] = useState(`${orgName} Workspace`);

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">First Workspace</h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[var(--dpf-text)] mb-1">Workspace Name</label>
                <input type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} className="w-full px-3 py-2 rounded-lg" />
              </div>
            </div>
          </div>
          <SetupStepNav onContinue={() => onContinue({ workspaceName })} onSkip={onSkip} onPause={onPause} />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
