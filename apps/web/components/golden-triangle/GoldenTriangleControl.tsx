"use client";
// EP-GOLDEN-TRIANGLE Slice 2 (BI-D48EB34C) — the canonical, reusable posture
// control. Presets are the primary, one-click path; the triangle is an opt-in
// fine-tune; three numeric inputs are the canonical accessible control (a 2D
// drag surface is not a 1-D ARIA slider). The triangle is colour-coded by
// balance — green when centred, shading to yellow then red as one or two axes
// get starved — and every posture shows, in plain language, what it configures
// (driven by the real Slice 1 compiler so the UI never drifts).
import { useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { GoldenTriangleGradient } from "./GoldenTriangleGradient";
import {
  PRESET_META,
  PRESET_ORDER,
  TRIANGLE_AXIS_GUIDE,
  balanceState,
  decodePostureForDisplay,
  pointToWeights,
  postureLabel,
  preferenceFromPreset,
  weightsToPoint,
} from "./posture-display";

export interface GoldenTriangleControlProps {
  value: GoldenTrianglePreference;
  onChange: (next: GoldenTrianglePreference) => void;
  taskClass?: string;
  authorityScopeKind?: string;
  /** Tighter layout for a small embedded area (e.g. the coworker dialog). */
  compact?: boolean;
  className?: string;
}

const INSET = 12; // viewBox units of padding so vertex labels fit
const SPAN = 100 - 2 * INSET;
const STEP = 0.05;

type AxisKey = "qualityWeight" | "costWeight" | "timeWeight";

function normalize(p: GoldenTrianglePreference): Record<AxisKey, number> {
  const q = Math.max(0, p.qualityWeight);
  const c = Math.max(0, p.costWeight);
  const t = Math.max(0, p.timeWeight);
  const s = q + c + t || 1;
  return { qualityWeight: q / s, costWeight: c / s, timeWeight: t / s };
}

/** Set one axis to `val`, rebalancing the other two by their current ratio. */
function rebalance(p: GoldenTrianglePreference, axis: AxisKey, val: number): GoldenTrianglePreference {
  const w = normalize(p);
  const v = Math.min(1, Math.max(0, val));
  const others = (["qualityWeight", "costWeight", "timeWeight"] as AxisKey[]).filter((k) => k !== axis);
  const otherSum = others.reduce((s, k) => s + w[k], 0);
  const rem = 1 - v;
  const out: Record<AxisKey, number> = { qualityWeight: 0, costWeight: 0, timeWeight: 0 };
  out[axis] = v;
  if (otherSum <= 0) {
    others.forEach((k) => (out[k] = rem / 2));
  } else {
    others.forEach((k) => (out[k] = (w[k] / otherSum) * rem));
  }
  return { preset: "custom", ...out };
}

function unitToVb(ux: number, uy: number) {
  return { x: INSET + ux * SPAN, y: INSET + uy * SPAN };
}

const AXES: Array<{ key: AxisKey; label: string }> = [
  { key: "qualityWeight", label: "Quality" },
  { key: "costWeight", label: "Cost" },
  { key: "timeWeight", label: "Time" },
];

export function GoldenTriangleControl({
  value,
  onChange,
  taskClass,
  authorityScopeKind,
  compact = false,
  className = "",
}: GoldenTriangleControlProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);
  const labelId = useId();

  const w = normalize(value);
  const { plain, chips } = decodePostureForDisplay(value, taskClass, authorityScopeKind);
  const balance = balanceState(w.qualityWeight, w.costWeight, w.timeWeight);
  const point = weightsToPoint(w.qualityWeight, w.costWeight, w.timeWeight);
  const thumb = unitToVb(point.x, point.y);
  const vQuality = unitToVb(0.5, 0);
  const vCost = unitToVb(0, 1);
  const vTime = unitToVb(1, 1);
  // A meaningful label at every position — an extreme reads as e.g. "Max Quality"
  // (the corner = that dimension's full setting), never a bare "Custom".
  const activeLabel = postureLabel(value);

  const balanceColor = `var(${balance.token})`;
  const triStroke = `color-mix(in srgb, ${balanceColor} 45%, var(--dpf-border-strong))`;

  function setFromEvent(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const vx = ((clientX - rect.left) / rect.width) * 100;
    const vy = ((clientY - rect.top) / rect.height) * 100;
    const ux = (vx - INSET) / SPAN;
    const uy = (vy - INSET) / SPAN;
    onChange({ preset: "custom", ...pointToWeights(ux, uy) });
  }

  function onThumbKeyDown(e: ReactKeyboardEvent) {
    let handled = true;
    if (e.key === "ArrowLeft") onChange(rebalance(value, "costWeight", w.costWeight + STEP));
    else if (e.key === "ArrowRight") onChange(rebalance(value, "timeWeight", w.timeWeight + STEP));
    else if (e.key === "ArrowUp") onChange(rebalance(value, "qualityWeight", w.qualityWeight + STEP));
    else if (e.key === "ArrowDown") onChange(rebalance(value, "qualityWeight", w.qualityWeight - STEP));
    else if (e.key === "Home") onChange(preferenceFromPreset("balanced"));
    else handled = false;
    if (handled) e.preventDefault();
  }

  const pct = (n: number) => Math.round(n * 100);

  const balancePill = (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{ color: balanceColor, background: `color-mix(in srgb, ${balanceColor} 14%, transparent)` }}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: balanceColor }} aria-hidden="true" />
      {balance.label}
    </span>
  );

  const triangle = (
    <div
      className={["relative h-auto w-full", compact ? "max-w-[150px]" : "max-w-[220px]"].join(" ")}
      style={{ aspectRatio: "1 / 1" }}
    >
      <GoldenTriangleGradient
        qualityWeight={w.qualityWeight}
        costWeight={w.costWeight}
        timeWeight={w.timeWeight}
        className="absolute inset-0"
      />
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full touch-none select-none"
        role="img"
      aria-label={`Cost, quality and time priority triangle. Quality ${pct(w.qualityWeight)} percent, cost ${pct(
        w.costWeight,
      )} percent, time ${pct(w.timeWeight)} percent. Balance: ${balance.label}. Drag the point or use the inputs to fine-tune.`}
      onPointerDown={(e) => {
        draggingRef.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setFromEvent(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) setFromEvent(e.clientX, e.clientY);
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
    >
      {/* No vertex labels — the gradient colour conveys the state (founder direction).
          Axis identity stays accessible via the SVG aria-label + the numeric inputs. */}
      <polygon
        points={`${vQuality.x},${vQuality.y} ${vCost.x},${vCost.y} ${vTime.x},${vTime.y}`}
        fill="transparent"
        stroke={triStroke}
        strokeWidth={0.9}
      />
      <circle
        cx={thumb.x}
        cy={thumb.y}
        r={4.5}
        fill={balanceColor}
        stroke="var(--dpf-surface-1)"
        strokeWidth={1.6}
        tabIndex={0}
        role="slider"
        aria-label="Fine-tune priority point"
        aria-valuetext={`Quality ${pct(w.qualityWeight)}%, cost ${pct(w.costWeight)}%, time ${pct(w.timeWeight)}%`}
        onKeyDown={onThumbKeyDown}
        style={{ cursor: "grab", outline: "none" }}
      />
      </svg>
    </div>
  );

  const readout = (
    <div>
      {!compact && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {AXES.map(({ key, label }) => (
            <label key={key} className="block text-[11px] text-[var(--dpf-text-secondary)]">
              {label}
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={pct(w[key])}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  onChange(rebalance(value, key, raw / 100));
                }}
                className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[13px] text-[var(--dpf-text)]"
                aria-label={`${label} priority percent`}
              />
            </label>
          ))}
        </div>
      )}

      <div className="mb-1.5">{balancePill}</div>
      <p className="mb-2 text-[14px] font-medium leading-snug text-[var(--dpf-text)]" aria-live="polite">
        {plain}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip, i) => (
          <span
            key={`${chip.label}-${i}`}
            className="rounded-md bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-text-secondary)]"
          >
            {chip.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-[var(--dpf-text-secondary)]">{TRIANGLE_AXIS_GUIDE}</p>
    </div>
  );

  return (
    <div
      className={[
        "rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]",
        compact ? "p-3" : "p-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby={labelId}
    >
      <div className="mb-3 flex items-center justify-between">
        <span id={labelId} className="text-[14px] font-medium text-[var(--dpf-text)]">
          Priority for this work
        </span>
        <span className="rounded-md bg-[var(--dpf-accent-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--dpf-accent)]">
          {activeLabel}
        </span>
      </div>

      {/* Layer 1 (primary): one-click presets */}
      <div
        className={["mb-4 grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"].join(" ")}
        role="radiogroup"
        aria-label="Priority preset"
      >
        {PRESET_ORDER.map((preset) => {
          const sel = value.preset === preset;
          const meta = PRESET_META[preset];
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => onChange(preferenceFromPreset(preset))}
              className={[
                "rounded-lg border px-3 py-2 text-left transition-colors",
                sel
                  ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]"
                  : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] hover:bg-[var(--dpf-surface-2)]",
              ].join(" ")}
            >
              <span
                className={[
                  "block text-[13px] font-medium",
                  sel ? "text-[var(--dpf-accent)]" : "text-[var(--dpf-text)]",
                ].join(" ")}
              >
                {meta.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-[var(--dpf-text-secondary)]">{meta.effect}</span>
            </button>
          );
        })}
      </div>

      <div className={compact ? "grid gap-3" : "grid gap-4 sm:grid-cols-[200px_1fr]"}>
        <div>{triangle}</div>
        {readout}
      </div>
    </div>
  );
}
