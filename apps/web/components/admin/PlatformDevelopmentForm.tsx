"use client";

import { useState, useTransition } from "react";
import { savePlatformDevConfig } from "@/lib/actions/platform-dev-config";

type ContributionMode = "fork_only" | "selective" | "contribute_all";

const MODE_OPTIONS: { value: ContributionMode; label: string; description: string }[] = [
  {
    value: "fork_only",
    label: "Keep everything here",
    description: "Changes you make in Build Studio stay on your platform only. Nothing is shared externally.",
  },
  {
    value: "selective",
    label: "Share selectively",
    description: "The AI coworker will suggest which changes might benefit the wider community. You decide each time.",
  },
  {
    value: "contribute_all",
    label: "Share everything",
    description: "Contribute all changes back to the community by default. You can still keep individual ones private.",
  },
];

export function PlatformDevelopmentForm({
  currentMode,
  configuredAt,
  configuredByEmail,
}: {
  currentMode: ContributionMode | null;
  configuredAt: string | null;
  configuredByEmail: string | null;
}) {
  const [selected, setSelected] = useState<ContributionMode>(currentMode ?? "selective");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const hasChanged = selected !== currentMode;

  function handleSave() {
    setSaved(false);
    startTransition(async () => {
      await savePlatformDevConfig(selected);
      setSaved(true);
    });
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          How do you want to manage your customisations?
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          This controls what happens when Build Studio ships a feature.
        </p>
      </div>

      <div className="space-y-3">
        {MODE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={[
              "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
              selected === opt.value
                ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/5"
                : "border-[var(--dpf-border)] hover:border-[var(--dpf-muted)]",
            ].join(" ")}
          >
            <input
              type="radio"
              name="contributionMode"
              value={opt.value}
              checked={selected === opt.value}
              onChange={() => { setSelected(opt.value); setSaved(false); }}
              className="mt-0.5 accent-[var(--dpf-accent)]"
            />
            <div>
              <span className="text-sm font-medium text-[var(--dpf-text)]">{opt.label}</span>
              <p className="text-xs text-[var(--dpf-muted)] mt-0.5">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending || (!hasChanged && currentMode !== null)}
          className={[
            "rounded px-4 py-1.5 text-sm font-medium transition-colors",
            isPending || (!hasChanged && currentMode !== null)
              ? "bg-[var(--dpf-border)] text-[var(--dpf-muted)] cursor-not-allowed"
              : "bg-[var(--dpf-accent)] text-white hover:opacity-90",
          ].join(" ")}
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-xs text-green-500">Saved</span>}
      </div>

      {configuredAt && (
        <p className="text-xs text-[var(--dpf-muted)]">
          Last configured {new Date(configuredAt).toLocaleDateString()} by {configuredByEmail ?? "unknown"}
        </p>
      )}
    </div>
  );
}
