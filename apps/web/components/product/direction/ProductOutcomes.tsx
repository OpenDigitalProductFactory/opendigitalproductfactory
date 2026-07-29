"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FormStatus } from "@/components/ui/form/FormStatus";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import {
  ProductObjectiveReviewForm,
  ProductOutcomeObservationForm,
} from "./ProductOutcomeEvidenceForms";
import {
  createProductObjectiveAction,
  transitionProductObjectiveAction,
  type ProductOutcomeActionResult,
} from "@/lib/actions/product-outcomes";
import {
  PRODUCT_OBJECTIVE_REVIEW_CADENCES,
  PRODUCT_OUTCOME_MEASURE_KINDS,
  type ProductObjectiveView,
  type ProductOutcomeMeasureKind,
} from "@/lib/product-management/outcomes";

type Panel =
  | { kind: "create" }
  | { kind: "review"; objectiveId: string }
  | {
      kind: "observe";
      objectiveId: string;
      supersedesObservationId: string | null;
    }
  | null;

const inputClass =
  "min-h-11 rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-dpf-md py-dpf-sm text-[var(--dpf-text)]";
const secondaryButtonClass =
  "min-h-11 rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50";
const primaryButtonClass =
  "min-h-11 rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)] disabled:opacity-50";

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDate(date: Date | null): string {
  return date
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)
    : "Not scheduled";
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function measureLabel(kind: ProductOutcomeMeasureKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function postureLabel(objective: ProductObjectiveView): string {
  const posture = objective.posture;
  if (posture.availability === "available") {
    return posture.state
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  if (posture.availability === "qualitative") return "Review needed";
  if (posture.reason === "baseline-missing") return "Baseline missing";
  if (posture.reason === "observation-missing") return "Observation needed";
  if (posture.reason === "target-missing") return "Target missing";
  return "Insufficient compatible evidence";
}

function measureValue(
  value: number | null,
  unit: string | null,
): string {
  if (value === null) return "Not recorded";
  if (unit === "%") return `${value}%`;
  if (unit && /^[A-Z]{3}$/.test(unit)) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: unit,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return unit ? `${value} ${unit}` : String(value);
}

function CreateOutcomeForm({
  productId,
  productName,
  requestedAt,
  onCancel,
  onSaved,
}: {
  productId: string;
  productName: string;
  requestedAt: Date;
  onCancel: () => void;
  onSaved: (result: ProductOutcomeActionResult) => void;
}) {
  const [kind, setKind] = useState<ProductOutcomeMeasureKind>("number");
  const [result, setResult] = useState<ProductOutcomeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const qualitative = kind === "qualitative";
  const defaultReview = new Date(requestedAt);
  defaultReview.setUTCMonth(defaultReview.getUTCMonth() + 1);

  function submit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const response = await createProductObjectiveAction({
        productId,
        title: String(formData.get("title") ?? ""),
        problemStatement: String(formData.get("problemStatement") ?? ""),
        outcomeHypothesis: String(formData.get("outcomeHypothesis") ?? ""),
        measureKind: kind,
        measureDefinition: String(formData.get("measureDefinition") ?? ""),
        measureUnit: qualitative
          ? ""
          : kind === "percentage"
            ? "%"
            : String(formData.get("measureUnit") ?? ""),
        baselineValue: qualitative
          ? null
          : numberOrNull(String(formData.get("baselineValue") ?? "")),
        targetValue: qualitative
          ? null
          : numberOrNull(String(formData.get("targetValue") ?? "")),
        baselineNarrative: qualitative
          ? String(formData.get("baselineNarrative") ?? "")
          : "",
        targetNarrative: qualitative
          ? String(formData.get("targetNarrative") ?? "")
          : "",
        reviewCadence: String(
          formData.get("reviewCadence") ?? "monthly",
        ) as (typeof PRODUCT_OBJECTIVE_REVIEW_CADENCES)[number],
        reviewAt: String(formData.get("reviewAt") ?? ""),
      });
      setResult(response);
      if (response.ok) onSaved(response);
    });
  }

  return (
    <form
      action={submit}
      className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
      aria-labelledby="define-outcome-title"
    >
      <h2
        id="define-outcome-title"
        className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
      >
        Define what should improve
      </h2>
      <p className="mt-dpf-xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
        Start with the business change you want to learn about for {productName}.
        You can connect delivery work after the outcome is saved.
      </p>
      <div className="mt-dpf-lg grid gap-dpf-md sm:grid-cols-2">
        <label className="grid gap-dpf-2xs sm:col-span-2">
          <span className="font-dpf-medium">Short name</span>
          <input
            name="title"
            required
            placeholder="Increase repeat bookings"
            className={inputClass}
          />
        </label>
        <label className="grid gap-dpf-2xs sm:col-span-2">
          <span className="font-dpf-medium">What is happening now?</span>
          <textarea
            name="problemStatement"
            rows={2}
            placeholder="Clients complete a visit but often leave without rebooking."
            className={inputClass}
          />
        </label>
        <label className="grid gap-dpf-2xs sm:col-span-2">
          <span className="font-dpf-medium">
            What change do you expect, and why?
          </span>
          <textarea
            name="outcomeHypothesis"
            required
            rows={2}
            placeholder="A clearer follow-up will help more clients rebook within 30 days."
            className={inputClass}
          />
        </label>
        <label className="grid gap-dpf-2xs">
          <span className="font-dpf-medium">How will you notice?</span>
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as ProductOutcomeMeasureKind)
            }
            className={inputClass}
          >
            {PRODUCT_OUTCOME_MEASURE_KINDS.map((measureKind) => (
              <option key={measureKind} value={measureKind}>
                {measureLabel(measureKind)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-dpf-2xs">
          <span className="font-dpf-medium">Measure definition</span>
          <input
            name="measureDefinition"
            required
            placeholder="Visits rebooked within 30 days"
            className={inputClass}
          />
        </label>
        {qualitative ? (
          <>
            <label className="grid gap-dpf-2xs">
              <span className="font-dpf-medium">Starting evidence</span>
              <textarea
                name="baselineNarrative"
                rows={2}
                placeholder="What people experience or say today"
                className={inputClass}
              />
            </label>
            <label className="grid gap-dpf-2xs">
              <span className="font-dpf-medium">Change to look for</span>
              <textarea
                name="targetNarrative"
                required
                rows={2}
                placeholder="What credible evidence of improvement would sound like"
                className={inputClass}
              />
            </label>
          </>
        ) : (
          <>
            <label className="grid gap-dpf-2xs">
              <span className="font-dpf-medium">Unit</span>
              <input
                name="measureUnit"
                required={kind !== "percentage"}
                defaultValue={kind === "percentage" ? "%" : ""}
                placeholder={
                  kind === "currency"
                    ? "USD"
                    : kind === "duration"
                      ? "minutes"
                      : "bookings/week"
                }
                className={inputClass}
              />
            </label>
            <div className="grid grid-cols-2 gap-dpf-sm">
              <label className="grid gap-dpf-2xs">
                <span className="font-dpf-medium">Starting point</span>
                <input
                  name="baselineValue"
                  type="number"
                  step="any"
                  className={inputClass}
                />
              </label>
              <label className="grid gap-dpf-2xs">
                <span className="font-dpf-medium">Target</span>
                <input
                  name="targetValue"
                  type="number"
                  step="any"
                  required
                  className={inputClass}
                />
              </label>
            </div>
          </>
        )}
        <label className="grid gap-dpf-2xs">
          <span className="font-dpf-medium">Review rhythm</span>
          <select
            name="reviewCadence"
            defaultValue="monthly"
            className={inputClass}
          >
            {PRODUCT_OBJECTIVE_REVIEW_CADENCES.map((cadence) => (
              <option key={cadence} value={cadence}>
                {cadence.charAt(0).toUpperCase() + cadence.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-dpf-2xs">
          <span className="font-dpf-medium">First review</span>
          <input
            name="reviewAt"
            type="date"
            required
            defaultValue={dateInputValue(defaultReview)}
            className={inputClass}
          />
        </label>
      </div>
      <FormStatus
        error={result && !result.ok ? result.error : null}
        className="mt-dpf-md"
      />
      <div className="mt-dpf-lg flex flex-wrap gap-dpf-sm">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className={primaryButtonClass}
        >
          {pending ? "Saving…" : "Save draft outcome"}
        </button>
      </div>
    </form>
  );
}

export function ProductOutcomes({
  product,
  objectives,
  requestedAt,
}: {
  product: { id: string; name: string };
  objectives: ProductObjectiveView[];
  requestedAt: Date;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [result, setResult] = useState<ProductOutcomeActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const needsReview = useMemo(
    () => objectives.filter((objective) => objective.reviewDue || objective.postureChanged),
    [objectives],
  );

  function saved(response: ProductOutcomeActionResult) {
    setResult(response);
    setPanel(null);
    router.refresh();
  }

  function transition(objectiveId: string, to: "active" | "closed" | "archived") {
    setResult(null);
    startTransition(async () => {
      const response = await transitionProductObjectiveAction({
        productId: product.id,
        objectiveId,
        to,
      });
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  if (objectives.length === 0 && panel?.kind !== "create") {
    return (
      <section
        className="rounded-dpf-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-xl"
        aria-labelledby="first-outcome-title"
      >
        <h1
          id="first-outcome-title"
          className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]"
        >
          What should improve?
        </h1>
        <p className="mt-dpf-sm max-w-prose text-dpf-body-lg text-[var(--dpf-muted)]">
          Define the starting point, the change you hope to see, and when you
          will review the evidence. No formal goal framework is required.
        </p>
        <button
          type="button"
          data-dpf-primary-action
          onClick={() => setPanel({ kind: "create" })}
          className={`${primaryButtonClass} mt-dpf-lg`}
        >
          Define the first outcome
        </button>
      </section>
    );
  }

  if (panel?.kind === "create") {
    return (
      <CreateOutcomeForm
        productId={product.id}
        productName={product.name}
        requestedAt={requestedAt}
        onCancel={() => setPanel(null)}
        onSaved={saved}
      />
    );
  }

  return (
    <div className="space-y-dpf-lg">
      <div className="flex flex-col gap-dpf-md sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
            Outcomes
          </h1>
          <p className="mt-dpf-xs max-w-prose text-dpf-body-lg text-[var(--dpf-muted)]">
            Review whether the hoped-for business change is appearing in real
            evidence. Missing evidence stays missing; observations never rewrite history.
          </p>
        </div>
        <button
          type="button"
          data-dpf-primary-action
          onClick={() => setPanel({ kind: "create" })}
          className={primaryButtonClass}
        >
          Define another outcome
        </button>
      </div>

      <FormStatus
        error={result && !result.ok ? result.error : null}
        success={result?.ok ? result.message : null}
      />

      {needsReview.length > 0 ? (
        <section aria-labelledby="outcomes-needs-review">
          <h2
            id="outcomes-needs-review"
            className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
          >
            Needs review
          </h2>
          <div className="mt-dpf-md grid gap-dpf-md lg:grid-cols-2">
            {needsReview.map((objective) => (
              <article
                key={objective.objectiveId}
                className="rounded-dpf-lg border border-[var(--dpf-warning)] bg-[var(--dpf-surface-1)] p-dpf-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
                  <div>
                    <h3 className="font-dpf-semibold text-[var(--dpf-text)]">
                      {objective.title}
                    </h3>
                    <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
                      {objective.reviewDue
                        ? `Review was due ${formatDate(objective.reviewAt)}`
                        : "Outcome posture changed since the prior observation"}
                    </p>
                  </div>
                  <StatusBadge
                    intent={objective.reviewDue ? "warning" : "info"}
                    label={postureLabel(objective)}
                    uppercase={false}
                  />
                </div>
                {objective.status === "active" ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPanel({
                        kind: "review",
                        objectiveId: objective.objectiveId,
                      })
                    }
                    className={`${secondaryButtonClass} mt-dpf-md`}
                  >
                    Review outcome
                  </button>
                ) : null}
                {panel?.kind === "review" &&
                panel.objectiveId === objective.objectiveId ? (
                  <ProductObjectiveReviewForm
                    productId={product.id}
                    objectiveId={objective.objectiveId}
                    requestedAt={requestedAt}
                    onCancel={() => setPanel(null)}
                    onSaved={saved}
                  />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="outcome-learning-list">
        <h2
          id="outcome-learning-list"
          className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
        >
          Outcome learning
        </h2>
        <div className="mt-dpf-md space-y-dpf-md">
          {objectives.map((objective) => (
            <article
              key={objective.objectiveId}
              className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
            >
              <div className="flex flex-wrap items-start justify-between gap-dpf-md">
                <div>
                  <div className="flex flex-wrap items-center gap-dpf-sm">
                    <h3 className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]">
                      {objective.title}
                    </h3>
                    <StatusBadge
                      intent={
                        objective.status === "active"
                          ? "success"
                          : objective.status === "draft"
                            ? "neutral"
                            : "info"
                      }
                      label={objective.status}
                      uppercase={false}
                    />
                  </div>
                  <p className="mt-dpf-xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
                    {objective.outcomeHypothesis}
                  </p>
                </div>
                <StatusBadge
                  intent={
                    objective.posture.availability === "available" &&
                    (objective.posture.state === "improving" ||
                      objective.posture.state === "on-target")
                      ? "success"
                      : objective.posture.availability === "insufficient-evidence"
                        ? "warning"
                        : "info"
                  }
                  label={postureLabel(objective)}
                  uppercase={false}
                />
              </div>

              <dl className="mt-dpf-lg grid gap-dpf-md sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-dpf-caption font-dpf-medium uppercase tracking-wide text-[var(--dpf-muted)]">
                    Measure
                  </dt>
                  <dd className="mt-dpf-2xs text-dpf-body text-[var(--dpf-text)]">
                    {objective.measureDefinition}
                  </dd>
                </div>
                <div>
                  <dt className="text-dpf-caption font-dpf-medium uppercase tracking-wide text-[var(--dpf-muted)]">
                    Starting point
                  </dt>
                  <dd className="mt-dpf-2xs text-dpf-body text-[var(--dpf-text)]">
                    {objective.measureKind === "qualitative"
                      ? objective.baselineNarrative ?? "Not recorded"
                      : measureValue(
                          objective.baselineValue,
                          objective.measureUnit,
                        )}
                  </dd>
                </div>
                <div>
                  <dt className="text-dpf-caption font-dpf-medium uppercase tracking-wide text-[var(--dpf-muted)]">
                    Target
                  </dt>
                  <dd className="mt-dpf-2xs text-dpf-body text-[var(--dpf-text)]">
                    {objective.measureKind === "qualitative"
                      ? objective.targetNarrative ?? "Not recorded"
                      : measureValue(objective.targetValue, objective.measureUnit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-dpf-caption font-dpf-medium uppercase tracking-wide text-[var(--dpf-muted)]">
                    Next review
                  </dt>
                  <dd className="mt-dpf-2xs text-dpf-body text-[var(--dpf-text)]">
                    {formatDate(objective.reviewAt)}
                  </dd>
                </div>
              </dl>

              {objective.contributingWork.length > 0 ? (
                <div className="mt-dpf-lg">
                  <h4 className="font-dpf-semibold text-[var(--dpf-text)]">
                    Contributing work
                  </h4>
                  <ul className="mt-dpf-sm space-y-dpf-xs">
                    {objective.contributingWork.map((work) => (
                      <li
                        key={work.itemId}
                        className="flex flex-wrap items-center gap-dpf-sm text-dpf-body"
                      >
                        <span className="font-dpf-medium text-[var(--dpf-text)]">
                          {work.title}
                        </span>
                        <span className="text-[var(--dpf-muted)]">
                          {work.itemId} · {work.contributionKind} · {work.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Notice
                  variant="info"
                  title="No contributing work linked"
                  className="mt-dpf-lg"
                >
                  Link only real demand or delivery work already scoped to this
                  product. The outcome does not create placeholder backlog.
                </Notice>
              )}

              <div className="mt-dpf-lg">
                <h4 className="font-dpf-semibold text-[var(--dpf-text)]">
                  Observation history
                </h4>
                {objective.observations.length > 0 ? (
                  <ol className="mt-dpf-sm space-y-dpf-sm">
                    {objective.observations.map((observation) => (
                      <li
                        key={observation.observationId}
                        className="rounded-dpf-md bg-[var(--dpf-surface-2)] p-dpf-md"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-dpf-sm">
                          <p className="font-dpf-medium text-[var(--dpf-text)]">
                            {objective.measureKind === "qualitative"
                              ? observation.narrative
                              : measureValue(
                                  observation.numericValue,
                                  objective.measureUnit,
                                )}
                          </p>
                          <time className="text-dpf-caption text-[var(--dpf-muted)]">
                            {formatDate(observation.observedAt)}
                          </time>
                        </div>
                        {objective.measureKind !== "qualitative" &&
                        observation.narrative ? (
                          <p className="mt-dpf-xs text-dpf-body text-[var(--dpf-muted)]">
                            {observation.narrative}
                          </p>
                        ) : null}
                        <p className="mt-dpf-xs text-dpf-caption text-[var(--dpf-muted)]">
                          {observation.sourceKind}
                          {observation.sourceRef
                            ? ` · ${observation.sourceRef}`
                            : ""}
                          {observation.confidence !== null
                            ? ` · ${Math.round(observation.confidence * 100)}% confidence`
                            : ""}
                          {observation.supersedesObservationId
                            ? ` · corrects ${observation.supersedesObservationId}`
                            : ""}
                          {observation.supersededByObservationId
                            ? ` · superseded by ${observation.supersededByObservationId}`
                            : ""}
                        </p>
                        {objective.status === "active" &&
                        !observation.supersededByObservationId ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPanel({
                                kind: "observe",
                                objectiveId: objective.objectiveId,
                                supersedesObservationId:
                                  observation.observationId,
                              })
                            }
                            className="mt-dpf-sm min-h-11 text-dpf-body font-dpf-medium text-[var(--dpf-accent)]"
                          >
                            Correct observation
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-dpf-sm text-dpf-body text-[var(--dpf-muted)]">
                    No observation has been recorded. This is insufficient
                    evidence, not a zero result.
                  </p>
                )}
              </div>

              {panel?.kind === "observe" &&
              panel.objectiveId === objective.objectiveId ? (
                  <ProductOutcomeObservationForm
                  productId={product.id}
                  objective={objective}
                  supersedesObservationId={panel.supersedesObservationId}
                  requestedAt={requestedAt}
                  onCancel={() => setPanel(null)}
                  onSaved={saved}
                />
              ) : null}

              <div className="mt-dpf-lg flex flex-wrap gap-dpf-sm">
                {objective.status === "draft" ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => transition(objective.objectiveId, "active")}
                    className={primaryButtonClass}
                  >
                    Start learning
                  </button>
                ) : null}
                {objective.status === "active" ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setPanel({
                          kind: "observe",
                          objectiveId: objective.objectiveId,
                          supersedesObservationId: null,
                        })
                      }
                      className={primaryButtonClass}
                    >
                      Record observation
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => transition(objective.objectiveId, "closed")}
                      className={secondaryButtonClass}
                    >
                      Close outcome
                    </button>
                  </>
                ) : null}
                {objective.status !== "archived" ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => transition(objective.objectiveId, "archived")}
                    className={secondaryButtonClass}
                  >
                    Archive
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
