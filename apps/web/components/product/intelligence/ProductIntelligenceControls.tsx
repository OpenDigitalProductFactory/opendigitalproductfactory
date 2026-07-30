"use client";

import { useState, useTransition } from "react";
import {
  createProductIntelligenceWatchAction,
  proposeProductResearchAction,
  type ProductIntelligenceActionResult,
} from "@/lib/actions/product-intelligence";
import { Notice } from "@/components/ui/report-kit";

type Mode = "proposal" | "watch";
type Stage = "edit" | "preview";

const CADENCES = [
  { value: "0 9 * * 1", label: "Weekly · Monday at 09:00 UTC" },
  { value: "0 9 1 * *", label: "Monthly · first day at 09:00 UTC" },
] as const;

export function ProductIntelligenceControls({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [stage, setStage] = useState<Stage>("edit");
  const [topic, setTopic] = useState("");
  const [query, setQuery] = useState("");
  const [schedule, setSchedule] = useState<string>(CADENCES[0].value);
  const [result, setResult] = useState<ProductIntelligenceActionResult | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  function start(nextMode: Mode) {
    setMode(nextMode);
    setStage("edit");
    setResult(null);
  }

  function cancel() {
    setMode(null);
    setStage("edit");
    setResult(null);
  }

  function submit() {
    if (!mode) return;
    setResult(null);
    startTransition(async () => {
      const response =
        mode === "proposal"
          ? await proposeProductResearchAction({ productId, topic, query })
          : await createProductIntelligenceWatchAction({
              productId,
              topic,
              query,
              schedule,
            });
      setResult(response);
      if (response.ok) setStage("edit");
    });
  }

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-dpf-sm">
        <button
          type="button"
          data-dpf-primary-action
          onClick={() => start("proposal")}
          className="rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)]"
        >
          Propose research
        </button>
        <button
          type="button"
          onClick={() => start("watch")}
          className="rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
        >
          Schedule a recurring scan
        </button>
      </div>
    );
  }

  if (result?.ok) {
    return (
      <Notice variant="success" title="Saved">
        <p>{result.message}</p>
        <button
          type="button"
          onClick={cancel}
          className="mt-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-accent)]"
        >
          Done
        </button>
      </Notice>
    );
  }

  const selectedCadence =
    CADENCES.find((cadence) => cadence.value === schedule)?.label ?? schedule;

  return (
    <section
      aria-labelledby="product-intelligence-action-title"
      className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
    >
      <h2
        id="product-intelligence-action-title"
        className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
      >
        {stage === "preview" ? "Review before saving" : mode === "proposal"
          ? "Propose focused research"
          : "Schedule a recurring scan"}
      </h2>

      {stage === "edit" ? (
        <div className="mt-dpf-md grid gap-dpf-md">
          <label className="grid gap-dpf-2xs text-dpf-body text-[var(--dpf-text)]">
            <span className="font-dpf-medium">Topic</span>
            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="For example, customer choice factors"
              className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-dpf-md py-dpf-sm"
            />
          </label>
          <label className="grid gap-dpf-2xs text-dpf-body text-[var(--dpf-text)]">
            <span className="font-dpf-medium">Research question</span>
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              rows={3}
              placeholder={`What has changed for ${productName}, and what evidence supports it?`}
              className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-dpf-md py-dpf-sm"
            />
          </label>
          {mode === "watch" ? (
            <label className="grid gap-dpf-2xs text-dpf-body text-[var(--dpf-text)]">
              <span className="font-dpf-medium">Cadence</span>
              <select
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
                className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-dpf-md py-dpf-sm"
              >
                {CADENCES.map((cadence) => (
                  <option key={cadence.value} value={cadence.value}>
                    {cadence.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : (
        <>
          <dl className="mt-dpf-md grid gap-dpf-md text-dpf-body sm:grid-cols-2">
            <div>
              <dt className="font-dpf-medium text-[var(--dpf-text)]">Scope</dt>
              <dd className="mt-dpf-2xs text-[var(--dpf-muted)]">
                {productName}
              </dd>
            </div>
            <div>
              <dt className="font-dpf-medium text-[var(--dpf-text)]">
                Proposed write
              </dt>
              <dd className="mt-dpf-2xs text-[var(--dpf-muted)]">
                {mode === "proposal"
                  ? "One pending research proposal"
                  : "One recurring scan schedule"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-dpf-medium text-[var(--dpf-text)]">
                Research question
              </dt>
              <dd className="mt-dpf-2xs text-[var(--dpf-muted)]">{query}</dd>
            </div>
            <div>
              <dt className="font-dpf-medium text-[var(--dpf-text)]">
                Schedule effect
              </dt>
              <dd className="mt-dpf-2xs text-[var(--dpf-muted)]">
                {mode === "watch" ? selectedCadence : "None"}
              </dd>
            </div>
          </dl>
          <Notice variant="info" title="Approval boundary" className="mt-dpf-md">
            {mode === "proposal"
              ? "Saving creates a proposal only. Research runs after a person approves it, and the result remains a draft until reviewed."
              : "Each scheduled run creates a proposal only. It does not search the web, spend inference capacity, or publish knowledge automatically."}
          </Notice>
        </>
      )}

      {result && !result.ok ? (
        <p className="mt-dpf-md text-dpf-body text-[var(--dpf-error)]" role="alert">
          {result.error}
        </p>
      ) : null}

      <div className="mt-dpf-lg flex flex-wrap gap-dpf-sm">
        <button
          type="button"
          onClick={stage === "preview" ? () => setStage("edit") : cancel}
          disabled={pending}
          className="rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm text-dpf-body text-[var(--dpf-text)] disabled:opacity-50"
        >
          {stage === "preview" ? "Back" : "Cancel"}
        </button>
        {stage === "edit" ? (
          <button
            type="button"
            onClick={() => setStage("preview")}
            disabled={!topic.trim() || !query.trim()}
            className="rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Preview
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)] disabled:cursor-wait disabled:opacity-50"
          >
            {pending ? "Saving…" : mode === "proposal"
              ? "Create proposal"
              : "Create schedule"}
          </button>
        )}
      </div>
    </section>
  );
}
