"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import {
  amendParentDesignAction,
  getParentDesignAmendmentContextAction,
  type ParentDesignAmendmentContextResult,
} from "@/lib/actions/decomposition-actions";
import type { BuildDesignDoc, BuildPhase } from "@/lib/feature-build-types";

type Props = {
  buildId: string;
};

type FlightState = "idle" | "loading" | "submitting";

type LoadedContext = Extract<ParentDesignAmendmentContextResult, { ok: true }>;

export function ParentDesignAmendmentCoordinator({ buildId }: Props) {
  const [_isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [flight, setFlight] = useState<FlightState>("idle");
  const [context, setContext] = useState<LoadedContext | null>(null);
  const [proposedApproach, setProposedApproach] = useState("");
  const [acceptanceCriteriaText, setAcceptanceCriteriaText] = useState("");
  const [rationale, setRationale] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadContext = useCallback((targetBuildId: string) => {
    setOpen(true);
    setFlight("loading");
    setErrorMessage(null);
    setSuccessMessage(null);
    startTransition(async () => {
      try {
        const result = await getParentDesignAmendmentContextAction({
          childBuildId: targetBuildId,
        });
        if (!result.ok) {
          setErrorMessage(result.error);
          setFlight("idle");
          return;
        }
        setContext(result);
        setProposedApproach(result.parentEpic.designDoc.proposedApproach);
        setAcceptanceCriteriaText(result.parentEpic.designDoc.acceptanceCriteria.join("\n"));
        setRationale("");
        setFlight("idle");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Could not load parent design.");
        setFlight("idle");
      }
    });
  }, [startTransition]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ buildId?: unknown }>).detail;
      if (detail?.buildId !== buildId) return;
      loadContext(buildId);
    };

    document.addEventListener("open-parent-design-amendment", handleOpen);
    return () => document.removeEventListener("open-parent-design-amendment", handleOpen);
  }, [buildId, loadContext]);

  const proposedDesignDoc = useMemo(() => {
    if (!context) return null;
    return {
      ...context.parentEpic.designDoc,
      proposedApproach,
      acceptanceCriteria: parseAcceptanceCriteria(acceptanceCriteriaText),
    };
  }, [acceptanceCriteriaText, context, proposedApproach]);

  const diff = useMemo(() => {
    if (!context || !proposedDesignDoc) return [];
    return describeDiff(context.parentEpic.designDoc, proposedDesignDoc);
  }, [context, proposedDesignDoc]);

  const rationaleReady = rationale.trim().length > 0;
  const canSubmit = context != null && proposedDesignDoc != null && rationaleReady && flight === "idle";

  const submit = () => {
    if (!context || !proposedDesignDoc || !canSubmit) return;
    setFlight("submitting");
    setErrorMessage(null);
    setSuccessMessage(null);
    startTransition(async () => {
      try {
        const result = await amendParentDesignAction({
          childBuildId: context.currentChildBuildId,
          proposedDesignDoc,
          rationale: rationale.trim(),
        });
        if (!result.ok) {
          setErrorMessage(result.error);
          setFlight("idle");
          return;
        }
        setSuccessMessage(
          `Updated ${result.updatedChildBuildIds.length} child build${result.updatedChildBuildIds.length === 1 ? "" : "s"}; skipped ${result.skippedCompletedChildBuildIds.length} completed child build${result.skippedCompletedChildBuildIds.length === 1 ? "" : "s"}.`,
        );
        setFlight("idle");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Parent design amendment failed.");
        setFlight("idle");
      }
    });
  };

  if (!open) return null;

  return (
    <div
      data-testid="parent-design-amendment-coordinator"
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Amend parent design"
    >
      <button
        type="button"
        aria-label="Close parent design amendment"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--dpf-text)_35%,transparent)]"
      />
      <aside className="relative ml-auto flex h-full w-full max-w-4xl flex-col border-l border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] shadow-2xl">
        <header className="flex items-start justify-between border-b border-[var(--dpf-border)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">
              Parent Design Amendment
            </p>
            <h2 className="mt-1 text-base font-semibold">
              {context?.parentEpic.title ?? "Loading parent design"}
            </h2>
            {context && (
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                {context.parentEpic.epicId}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-semibold text-[var(--dpf-text)]"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {flight === "loading" && (
            <p className="text-sm text-[var(--dpf-muted)]">Loading parent design...</p>
          )}

          {context && proposedDesignDoc && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="min-w-0">
                <h3 className="text-sm font-semibold">Current parent contract</h3>
                <DesignDocSummary designDoc={context.parentEpic.designDoc} />
                <ChildPhaseList children={context.children} />
              </section>

              <section className="min-w-0">
                <h3 className="text-sm font-semibold">Proposed parent contract</h3>
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-[var(--dpf-text)]">
                      Proposed approach
                    </span>
                    <textarea
                      aria-label="Proposed approach"
                      value={proposedApproach}
                      onChange={(event) => setProposedApproach(event.target.value)}
                      rows={5}
                      className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-[var(--dpf-text)]">
                      Acceptance criteria
                    </span>
                    <textarea
                      aria-label="Acceptance criteria"
                      value={acceptanceCriteriaText}
                      onChange={(event) => setAcceptanceCriteriaText(event.target.value)}
                      rows={6}
                      className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-[var(--dpf-text)]">
                      Amendment rationale
                    </span>
                    <input
                      aria-label="Amendment rationale"
                      value={rationale}
                      onChange={(event) => setRationale(event.target.value)}
                      className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                    />
                  </label>
                </div>

                <DiffSummary diff={diff} />
              </section>
            </div>
          )}

          {errorMessage && (
            <div
              data-testid="parent-amendment-error"
              role="alert"
              className="mt-4 rounded-md border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_8%,var(--dpf-surface-1))] px-3 py-2 text-sm text-[var(--dpf-error)]"
            >
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div
              role="status"
              className="mt-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
            >
              {successMessage}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--dpf-border)] px-4 py-3">
          <div className="text-xs text-[var(--dpf-muted)]">
            {diff.length === 0 ? "No design changes yet." : `${diff.length} changed field${diff.length === 1 ? "" : "s"}.`}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {flight === "submitting" ? "Applying amendment..." : "Apply parent amendment"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function DesignDocSummary({ designDoc }: { designDoc: BuildDesignDoc }) {
  return (
    <div className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <p className="text-xs font-semibold text-[var(--dpf-text)]">Problem</p>
      <p className="mt-1 text-sm text-[var(--dpf-muted)]">{designDoc.problemStatement}</p>
      <p className="mt-3 text-xs font-semibold text-[var(--dpf-text)]">Approach</p>
      <p className="mt-1 text-sm text-[var(--dpf-muted)]">{designDoc.proposedApproach}</p>
      <p className="mt-3 text-xs font-semibold text-[var(--dpf-text)]">Acceptance criteria</p>
      <ol className="mt-1 space-y-1 text-sm text-[var(--dpf-muted)]">
        {designDoc.acceptanceCriteria.map((criterion, index) => (
          <li key={`${index}-${criterion}`} className="flex gap-2">
            <span className="font-mono text-[var(--dpf-text)]">{index + 1}.</span>
            <span>{criterion}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ChildPhaseList({
  children,
}: {
  children: Array<{ buildId: string; title: string; phase: BuildPhase | string; childOrder: number | null }>;
}) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">Child build impact</h3>
      <ul className="mt-2 space-y-2">
        {children
          .slice()
          .sort((a, b) => (a.childOrder ?? 99) - (b.childOrder ?? 99))
          .map((child) => (
            <li
              key={child.buildId}
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--dpf-text)]">
                  {child.title}
                </p>
                <p className="text-[11px] text-[var(--dpf-muted)]">{child.buildId}</p>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--dpf-text)]">
                {child.phase}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

function DiffSummary({ diff }: { diff: string[] }) {
  return (
    <div className="mt-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <p className="text-xs font-semibold text-[var(--dpf-text)]">Diff summary</p>
      {diff.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">No changed fields.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {diff.map((field) => (
            <li
              key={field}
              className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
            >
              {field}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function parseAcceptanceCriteria(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function describeDiff(before: BuildDesignDoc, after: BuildDesignDoc): string[] {
  const fields: string[] = [];
  if (before.proposedApproach !== after.proposedApproach) {
    fields.push("proposedApproach");
  }
  if (
    before.acceptanceCriteria.length !== after.acceptanceCriteria.length
    || before.acceptanceCriteria.some((criterion, index) => criterion !== after.acceptanceCriteria[index])
  ) {
    fields.push("acceptanceCriteria");
  }
  return fields;
}
