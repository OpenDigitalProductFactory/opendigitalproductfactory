"use client";

import { useState } from "react";

export type AgentWorkLauncherTopic = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  contextSummary: string;
  expectedNextStep: string;
};

type Props = {
  agentName: string;
  primaryActionLabel: string;
  topics: AgentWorkLauncherTopic[];
};

function dispatchAgentPrompt(prompt: string) {
  document.dispatchEvent(
    new CustomEvent("open-agent-panel", {
      detail: { autoMessage: prompt },
    }),
  );
}

export function AgentWorkLauncher({
  agentName,
  primaryActionLabel,
  topics,
}: Props) {
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId) ?? null;

  function selectFirstTopic() {
    setSelectedTopicId(topics[0]?.id ?? null);
  }

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">
            Start guided work
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
            Choose a starting point, review the message, then decide whether to
            send it to {agentName}.
          </p>
        </div>
        <button
          type="button"
          onClick={selectFirstTopic}
          className="rounded-full bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          {primaryActionLabel}
        </button>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
          Choose where to start
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {topics.map((topic) => {
            const active = topic.id === selectedTopicId;
            return (
              <button
                key={topic.id}
                type="button"
                data-topic-id={topic.id}
                onClick={() => setSelectedTopicId(topic.id)}
                className={[
                  "rounded-lg border p-4 text-left transition",
                  "focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] focus:ring-offset-2 focus:ring-offset-[var(--dpf-bg)]",
                  active
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                    : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]",
                ].join(" ")}
              >
                <span className="block text-sm font-semibold">{topic.label}</span>
                <span className="mt-1 block text-sm text-[var(--dpf-muted)]">
                  {topic.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedTopic && (
        <div className="mt-5 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                Prompt preview
              </p>
              <p className="mt-2 text-sm text-[var(--dpf-text)]">{selectedTopic.prompt}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedTopicId(null)}
                className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                data-confirm-agent-work="true"
                onClick={() => dispatchAgentPrompt(selectedTopic.prompt)}
                className="rounded-full bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white"
              >
                Start with {agentName}
              </button>
            </div>
          </div>

          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--dpf-muted)]">Context used</dt>
              <dd className="mt-1 text-[var(--dpf-text)]">{selectedTopic.contextSummary}</dd>
            </div>
            <div>
              <dt className="text-[var(--dpf-muted)]">Next step</dt>
              <dd className="mt-1 text-[var(--dpf-text)]">{selectedTopic.expectedNextStep}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
