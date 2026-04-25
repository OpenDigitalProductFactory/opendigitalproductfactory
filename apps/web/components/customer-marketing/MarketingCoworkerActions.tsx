"use client";

type MarketingCoworkerAction = {
  label: string;
  title: string;
  description: string;
  prompt: string;
  primary?: boolean;
};

type Props = {
  actions: MarketingCoworkerAction[];
};

function openMarketingStrategist(prompt: string) {
  document.dispatchEvent(
    new CustomEvent("open-agent-panel", {
      detail: { autoMessage: prompt },
    }),
  );
}

export function MarketingCoworkerActions({ actions }: Props) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => openMarketingStrategist(action.prompt)}
          className={[
            "rounded-lg border p-4 text-left transition",
            "focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] focus:ring-offset-2 focus:ring-offset-[var(--dpf-bg)]",
            action.primary
              ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)] text-white"
              : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]",
          ].join(" ")}
        >
          <span
            className={[
              "text-xs font-semibold uppercase tracking-wide",
              action.primary ? "text-white" : "text-[var(--dpf-accent)]",
            ].join(" ")}
          >
            {action.label}
          </span>
          <span className="mt-2 block text-sm font-semibold">{action.title}</span>
          <span
            className={[
              "mt-1 block text-sm",
              action.primary ? "text-white" : "text-[var(--dpf-muted)]",
            ].join(" ")}
          >
            {action.description}
          </span>
        </button>
      ))}
    </div>
  );
}
