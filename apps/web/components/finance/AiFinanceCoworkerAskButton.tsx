"use client";

import { MessageCircle } from "lucide-react";

import { dispatchAgentPrompt } from "@/components/agent/AgentWorkLauncher";

type Props = {
  prompt: string;
  routeContext?: string;
  label?: string;
};

export function AiFinanceCoworkerAskButton({
  prompt,
  routeContext = "/finance/spend/ai",
  label = "Ask Finance Specialist",
}: Props) {
  return (
    <button
      type="button"
      onClick={() => dispatchAgentPrompt(prompt, { routeContext })}
      className="inline-flex items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] focus:ring-offset-2 focus:ring-offset-[var(--dpf-bg)]"
    >
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
