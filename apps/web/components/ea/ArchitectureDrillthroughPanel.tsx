"use client";

import Link from "next/link";

import type { ArchitectureDrillthrough } from "@/lib/ea/architecture-drillthrough";

type Props = {
  drillthrough: ArchitectureDrillthrough | null | undefined;
};

export function ArchitectureDrillthroughPanel({ drillthrough }: Props) {
  if (!drillthrough) return null;
  const hasArchitectureContext =
    drillthrough.relatedViews.length > 0 ||
    drillthrough.operationsMapHref != null ||
    drillthrough.source != null ||
    drillthrough.decision != null;
  if (!hasArchitectureContext) return null;

  return (
    <section
      aria-labelledby="architecture-context-title"
      className="mt-3 border-t border-[var(--dpf-border)] pt-3"
    >
      <h3
        id="architecture-context-title"
        className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--dpf-accent)]"
      >
        Architecture context
      </h3>

      {drillthrough.operationsMapHref ? (
        <Link
          href={drillthrough.operationsMapHref}
          className="mt-2 flex min-h-11 items-center justify-between rounded-md border border-[var(--dpf-accent)] bg-[color-mix(in_srgb,var(--dpf-accent)_10%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--dpf-accent)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          <span>Open operational evidence</span>
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}

      {drillthrough.relatedViews.length > 0 ? (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-[11px] font-semibold text-[var(--dpf-text)]">
            Related viewpoints ({drillthrough.relatedViews.length})
          </summary>
          <ul className="mt-2 grid list-none gap-1.5 p-0">
            {drillthrough.relatedViews.map((link) => (
              <li key={`${link.viewId}:${link.elementId}`}>
                <Link
                  href={link.href}
                  className="block min-h-11 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-2 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
                  aria-label={`Open ${link.elementName} in ${link.viewName}, ${link.notationName}`}
                >
                  <span className="block text-[10px] font-semibold text-[var(--dpf-text)]">
                    {link.elementName}
                  </span>
                  <span className="mt-0.5 block text-[9px] text-[var(--dpf-muted)]">
                    {link.notationName} · {link.viewName} · {link.distance} link{link.distance === 1 ? "" : "s"} away
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {drillthrough.decision ? (
        <details className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2.5">
          <summary className="cursor-pointer text-[11px] font-semibold text-[var(--dpf-text)]">
            Why this decision works this way
          </summary>
          <div className="mt-2 grid gap-2 text-[10px] text-[var(--dpf-muted)]">
            <div>
              <p className="m-0 font-semibold text-[var(--dpf-text)]">
                {drillthrough.decision.title}
              </p>
              <p className="mt-0.5">{drillthrough.decision.technicalName}</p>
            </div>
            <InspectorList
              label="Safe inputs"
              values={drillthrough.decision.safeInputs}
            />
            <InspectorList
              label="Possible outcomes"
              values={drillthrough.decision.outcomes}
            />
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
              <dt>Design</dt>
              <dd className="m-0 text-[var(--dpf-text)]">
                {drillthrough.decision.sourceVersion}
              </dd>
              <dt>Status</dt>
              <dd className="m-0 text-[var(--dpf-text)]">
                {drillthrough.decision.implementationStatus}
              </dd>
              <dt>Evidence</dt>
              <dd className="m-0 text-[var(--dpf-text)]">
                {drillthrough.decision.latestEvidenceAt ? (
                  <time dateTime={drillthrough.decision.latestEvidenceAt}>
                    latest record {formatEvidenceTime(drillthrough.decision.latestEvidenceAt)}
                  </time>
                ) : (
                  "No recorded route evidence"
                )}
              </dd>
            </dl>
          </div>
        </details>
      ) : null}

      {drillthrough.source ? (
        <div className="mt-2 rounded-md border border-[var(--dpf-border)] px-2.5 py-2 text-[10px]">
          <p className="m-0 font-semibold text-[var(--dpf-text)]">Implementation source</p>
          <a
            href={drillthrough.source.href}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block break-all text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            {drillthrough.source.path}
            {drillthrough.source.symbol ? `#${drillthrough.source.symbol}` : ""}
          </a>
          {drillthrough.source.version || drillthrough.source.implementationStatus ? (
            <p className="mb-0 mt-1 text-[var(--dpf-muted)]">
              {[drillthrough.source.implementationStatus, drillthrough.source.version]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function InspectorList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="m-0 font-semibold text-[var(--dpf-text)]">{label}</p>
      <ul className="mb-0 mt-1 list-disc space-y-0.5 pl-4">
        {values.map((value) => <li key={value}>{value}</li>)}
      </ul>
    </div>
  );
}

function formatEvidenceTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "at an unknown time"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}
