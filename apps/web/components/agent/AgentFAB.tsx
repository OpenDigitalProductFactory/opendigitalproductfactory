"use client";

import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bot } from "lucide-react";

type Props = {
  onClick: () => void;
};

/** The existing shell owns panel state; this entry occupies header space. */
export function AgentFAB({ onClick }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setHost(document.querySelector<HTMLElement>("[data-agent-launcher-slot]"));
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const launcher = (
    <button
      type="button"
      data-agent-fab="true"
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md border border-dpf-border bg-dpf-surface-2 px-2 text-dpf-body text-dpf-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-dpf-accent xl:px-3"
      onClick={onClick}
      aria-label="Open AI Coworker"
      aria-haspopup="dialog"
      title="Open AI Coworker"
    >
      <Bot className="size-5" aria-hidden="true" />
      <span className="hidden whitespace-nowrap xl:inline">AI Coworker</span>
    </button>
  );

  // Standalone shells remain usable without covering their content.
  return host ? createPortal(launcher, host) : launcher;
}
