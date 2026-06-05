"use client";

import { useState, useTransition } from "react";
import {
  setDeviceFingerprintOptIn,
  setHiveContributionsPaused,
  type HiveContributionsView,
} from "@/lib/actions/hive-contributions";

const TYPE_LABELS: Record<string, string> = {
  device_fingerprint: "Device fingerprints",
  source: "Source & improvements",
  improvement: "Improvement proposals",
};

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50"
      style={{ background: checked ? "var(--dpf-accent)" : "var(--dpf-border)" }}
    >
      <span
        className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
      />
    </button>
  );
}

export function HiveContributionsPanel({ view }: { view: HiveContributionsView }) {
  const [config, setConfig] = useState(view.config);
  const [statuses, setStatuses] = useState(view.statuses);
  const [isPending, startTransition] = useTransition();

  function recompute(next: typeof config) {
    setStatuses((prev) =>
      prev.map((s) => {
        const optedIn = s.type === "device_fingerprint" ? next.deviceFingerprintOptIn : s.optedIn;
        return { ...s, optedIn, enabled: !next.hiveContributionsPaused && optedIn };
      }),
    );
  }

  function onPause(next: boolean) {
    const nextConfig = { ...config, hiveContributionsPaused: next };
    setConfig(nextConfig);
    recompute(nextConfig);
    startTransition(() => void setHiveContributionsPaused(next));
  }

  function onFingerprintOptIn(next: boolean) {
    const nextConfig = { ...config, deviceFingerprintOptIn: next };
    setConfig(nextConfig);
    recompute(nextConfig);
    startTransition(() => void setDeviceFingerprintOptIn(next));
  }

  return (
    <div className="space-y-6">
      {/* Master pause */}
      <div
        className="flex items-center justify-between p-4 rounded-lg border-l-4"
        style={{
          background: "var(--dpf-surface-1)",
          borderLeftColor: config.hiveContributionsPaused ? "var(--dpf-warning, #b45309)" : "var(--dpf-border)",
        }}
      >
        <div>
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Pause all contributions</h3>
          <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
            Immediately stops every contribution type from leaving this install. Already-curated rules remain in the
            shared catalog.
          </p>
        </div>
        <Toggle
          checked={config.hiveContributionsPaused}
          disabled={isPending}
          onChange={onPause}
          label="Pause all contributions"
        />
      </div>

      {/* Per-type toggles */}
      <div className="rounded-lg" style={{ background: "var(--dpf-surface-1)" }}>
        {statuses.map((s) => {
          const isFingerprint = s.type === "device_fingerprint";
          return (
            <div
              key={s.type}
              className="flex items-start justify-between gap-4 p-4 border-b last:border-b-0"
              style={{ borderColor: "var(--dpf-border)" }}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
                    {TYPE_LABELS[s.type] ?? s.type}
                  </h3>
                  {isFingerprint && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: "color-mix(in srgb, var(--dpf-accent) 13%, transparent)", color: "var(--dpf-accent)" }}
                    >
                      default on · PII-free
                    </span>
                  )}
                  {config.hiveContributionsPaused && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--dpf-border)", color: "var(--dpf-muted)" }}>
                      paused
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--dpf-muted)] mt-1">{s.description}</p>
              </div>
              {isFingerprint ? (
                <Toggle
                  checked={s.optedIn}
                  disabled={isPending || config.hiveContributionsPaused}
                  onChange={onFingerprintOptIn}
                  label="Device fingerprint contributions"
                />
              ) : (
                <span className="text-xs text-[var(--dpf-muted)] whitespace-nowrap">
                  {s.optedIn ? "On" : "Off"} · via contribution mode
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
