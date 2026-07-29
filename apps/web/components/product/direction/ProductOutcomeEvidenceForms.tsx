"use client";

import { useState, useTransition } from "react";
import { FormStatus } from "@/components/ui/form/FormStatus";
import { Notice } from "@/components/ui/report-kit";
import {
  recordProductOutcomeObservationAction,
  reviewProductObjectiveAction,
  type ProductOutcomeActionResult,
} from "@/lib/actions/product-outcomes";
import {
  PRODUCT_OUTCOME_SOURCE_KINDS,
  type ProductObjectiveView,
  type ProductOutcomeSourceKind,
} from "@/lib/product-management/outcomes";

const inputClass =
  "min-h-11 rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-dpf-md py-dpf-sm text-[var(--dpf-text)]";
const secondaryButtonClass =
  "min-h-11 rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50";
const primaryButtonClass =
  "min-h-11 rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)] disabled:opacity-50";

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ProductObjectiveReviewForm({
  productId,
  objectiveId,
  requestedAt,
  onCancel,
  onSaved,
}: {
  productId: string;
  objectiveId: string;
  requestedAt: Date;
  onCancel: () => void;
  onSaved: (result: ProductOutcomeActionResult) => void;
}) {
  const [result, setResult] = useState<ProductOutcomeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const nextReview = new Date(requestedAt);
  nextReview.setUTCMonth(nextReview.getUTCMonth() + 1);

  function submit(formData: FormData) {
    startTransition(async () => {
      const response = await reviewProductObjectiveAction({
        productId,
        objectiveId,
        nextReviewAt: String(formData.get("nextReviewAt") ?? ""),
      });
      setResult(response);
      if (response.ok) onSaved(response);
    });
  }

  return (
    <form
      action={submit}
      className="mt-dpf-md rounded-dpf-md bg-[var(--dpf-surface-2)] p-dpf-md"
    >
      <label className="grid max-w-xs gap-dpf-2xs">
        <span className="font-dpf-medium">Next review</span>
        <input
          name="nextReviewAt"
          type="date"
          required
          defaultValue={dateInputValue(nextReview)}
          className={inputClass}
        />
      </label>
      <FormStatus
        error={result && !result.ok ? result.error : null}
        className="mt-dpf-sm"
      />
      <div className="mt-dpf-md flex gap-dpf-sm">
        <button
          type="button"
          onClick={onCancel}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Recording…" : "Record review"}
        </button>
      </div>
    </form>
  );
}

export function ProductOutcomeObservationForm({
  productId,
  objective,
  supersedesObservationId,
  requestedAt,
  onCancel,
  onSaved,
}: {
  productId: string;
  objective: ProductObjectiveView;
  supersedesObservationId: string | null;
  requestedAt: Date;
  onCancel: () => void;
  onSaved: (result: ProductOutcomeActionResult) => void;
}) {
  const [result, setResult] = useState<ProductOutcomeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const qualitative = objective.measureKind === "qualitative";

  function submit(formData: FormData) {
    startTransition(async () => {
      const response = await recordProductOutcomeObservationAction({
        productId,
        objectiveId: objective.objectiveId,
        observedAt: String(formData.get("observedAt") ?? ""),
        numericValue: qualitative
          ? null
          : numberOrNull(String(formData.get("numericValue") ?? "")),
        narrative: String(formData.get("narrative") ?? ""),
        sourceKind: String(
          formData.get("sourceKind") ?? "manual",
        ) as ProductOutcomeSourceKind,
        sourceRef: String(formData.get("sourceRef") ?? ""),
        confidence: numberOrNull(String(formData.get("confidence") ?? "")),
        supersedesObservationId,
      });
      setResult(response);
      if (response.ok) onSaved(response);
    });
  }

  return (
    <form
      action={submit}
      className="mt-dpf-md rounded-dpf-md bg-[var(--dpf-surface-2)] p-dpf-md"
    >
      <h4 className="font-dpf-semibold text-[var(--dpf-text)]">
        {supersedesObservationId
          ? "Append a correction"
          : "Record what you observed"}
      </h4>
      {supersedesObservationId ? (
        <Notice variant="info" title="History is preserved" className="mt-dpf-sm">
          This creates a new observation that corrects{" "}
          {supersedesObservationId}. The original remains visible in the
          evidence history.
        </Notice>
      ) : null}
      <div className="mt-dpf-md grid gap-dpf-md sm:grid-cols-2">
        <label className="grid gap-dpf-2xs">
          <span className="font-dpf-medium">Observed on</span>
          <input
            name="observedAt"
            type="date"
            required
            defaultValue={dateInputValue(requestedAt)}
            className={inputClass}
          />
        </label>
        {!qualitative ? (
          <label className="grid gap-dpf-2xs">
            <span className="font-dpf-medium">
              Value {objective.measureUnit ? `(${objective.measureUnit})` : ""}
            </span>
            <input
              name="numericValue"
              type="number"
              step="any"
              required
              className={inputClass}
            />
          </label>
        ) : null}
        <label className="grid gap-dpf-2xs sm:col-span-2">
          <span className="font-dpf-medium">
            {qualitative ? "Evidence observed" : "Context"}
          </span>
          <textarea
            name="narrative"
            rows={2}
            required={qualitative}
            className={inputClass}
          />
        </label>
        <label className="grid gap-dpf-2xs">
          <span className="font-dpf-medium">Evidence source</span>
          <select name="sourceKind" defaultValue="manual" className={inputClass}>
            {PRODUCT_OUTCOME_SOURCE_KINDS.map((sourceKind) => (
              <option key={sourceKind} value={sourceKind}>
                {sourceKind.replace("-", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-dpf-2xs">
          <span className="font-dpf-medium">Source reference</span>
          <input
            name="sourceRef"
            placeholder="Booking report, order id, or reviewed source"
            className={inputClass}
          />
        </label>
        <label className="grid max-w-xs gap-dpf-2xs">
          <span className="font-dpf-medium">Confidence (0–1)</span>
          <input
            name="confidence"
            type="number"
            min="0"
            max="1"
            step="0.05"
            className={inputClass}
          />
        </label>
      </div>
      <FormStatus
        error={result && !result.ok ? result.error : null}
        className="mt-dpf-sm"
      />
      <div className="mt-dpf-md flex gap-dpf-sm">
        <button
          type="button"
          onClick={onCancel}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending
            ? "Recording…"
            : supersedesObservationId
              ? "Append correction"
              : "Append observation"}
        </button>
      </div>
    </form>
  );
}
