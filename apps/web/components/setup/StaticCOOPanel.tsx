"use client";

type Props = {
  messages: Array<{ text: string }>;
};

export function StaticCOOPanel({ messages }: Props) {
  return (
    <div className="flex flex-col h-full bg-[var(--dpf-surface-2)] border-l border-[var(--dpf-border)]">
      <div className="px-4 py-3 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Onboarding COO</h3>
        <p className="text-xs text-[var(--dpf-muted)]">Your AI operations officer</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className="bg-[var(--dpf-surface-1)] rounded-lg p-3 shadow-sm border border-[var(--dpf-border)] text-sm text-[var(--dpf-text)] leading-relaxed">
            {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}
