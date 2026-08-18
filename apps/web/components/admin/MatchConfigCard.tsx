"use client";

import { useState, useTransition } from "react";
import { saveMatchConfigAction } from "@/lib/actions/data-stewardship";
import type { MatchConfig } from "@/lib/mdm/match-config";
import type { DedupGatedDomain } from "@/lib/mdm/dedup-gate";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-2 py-1 text-xs focus:border-[var(--dpf-accent)] focus:outline-none";

/**
 * Matching sensitivity presets (UX-fit: a steward picks how eager duplicate
 * detection should be in plain terms; the raw thresholds stay derived —
 * nobody types a similarity score). The preset maps onto the governed
 * MdmMatchConfig thresholds; "custom" appears only when a saved config
 * doesn't match any preset (e.g. set via API).
 */
const PRESETS = {
  relaxed: {
    label: "Relaxed — only flag near-certain duplicates",
    values: { trgmFloor: 0.45, possibleThreshold: 0.6, likelyThreshold: 0.9 },
  },
  standard: {
    label: "Standard — balanced (recommended)",
    values: { trgmFloor: 0.3, possibleThreshold: 0.45, likelyThreshold: 0.7 },
  },
  strict: {
    label: "Strict — flag anything remotely similar",
    values: { trgmFloor: 0.2, possibleThreshold: 0.3, likelyThreshold: 0.55 },
  },
} as const;

type PresetKey = keyof typeof PRESETS;

function detectPreset(config: MatchConfig): PresetKey | "custom" {
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (
      Math.abs(preset.values.trgmFloor - config.trgmFloor) < 0.001 &&
      Math.abs(preset.values.possibleThreshold - config.possibleThreshold) < 0.001 &&
      Math.abs(preset.values.likelyThreshold - config.likelyThreshold) < 0.001
    ) {
      return key as PresetKey;
    }
  }
  return "custom";
}

export function MatchConfigCard({
  domain,
  config,
}: {
  domain: DedupGatedDomain;
  config: MatchConfig;
}) {
  const [preset, setPreset] = useState<PresetKey | "custom">(detectPreset(config));
  const [staleAfterDays, setStaleAfterDays] = useState(config.staleAfterDays);
  const [survivorship, setSurvivorship] = useState(config.survivorship);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const title = domain === "customer-account" ? "Companies / accounts" : "People / contacts";

  function save() {
    setMessage(null);
    const thresholds = preset === "custom" ? {} : PRESETS[preset].values;
    startTransition(async () => {
      const result = await saveMatchConfigAction(domain, {
        ...thresholds,
        staleAfterDays,
        survivorship,
      });
      setMessage(result.ok ? "Saved." : result.error);
    });
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
      <p className="text-xs font-semibold text-[var(--dpf-text)] mb-2">{title}</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-[10px] text-[var(--dpf-muted)]">
          Duplicate matching
          <select
            className={`${inputClasses} block mt-0.5`}
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetKey | "custom")}
          >
            {Object.entries(PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
            {preset === "custom" && <option value="custom">Custom (set via API)</option>}
          </select>
        </label>
        <label className="text-[10px] text-[var(--dpf-muted)]">
          Flag as stale after
          <span className="flex items-center gap-1 mt-0.5">
            <input
              type="number"
              step="1"
              min="7"
              max="3650"
              className={`${inputClasses} w-20`}
              value={staleAfterDays}
              onChange={(e) => setStaleAfterDays(Number(e.target.value))}
            />
            <span>days without update</span>
          </span>
        </label>
        <label className="text-[10px] text-[var(--dpf-muted)]">
          When merging duplicates
          <select
            className={`${inputClasses} block mt-0.5`}
            value={survivorship}
            onChange={(e) => setSurvivorship(e.target.value as MatchConfig["survivorship"])}
          >
            <option value="fill-empty">Fill blanks on the kept record from the duplicate</option>
            <option value="keep-survivor">Keep only the kept record&apos;s values</option>
          </select>
        </label>
        <button
          onClick={save}
          disabled={isPending}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {message && <span className="text-[10px] text-[var(--dpf-muted)]">{message}</span>}
      </div>
    </div>
  );
}
