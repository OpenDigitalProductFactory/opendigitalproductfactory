import Link from "next/link";
import { ClipboardList, ExternalLink, Layers3 } from "lucide-react";

import {
  type BusinessCapabilityNode,
  type BusinessCapabilityTraceRecord,
} from "@/lib/business-capabilities/data";
import {
  IT4IT_VALUE_STREAMS,
  TRACE_TARGET_TYPES,
  type CapabilityOverlayMode,
} from "@/lib/business-capabilities/types";
import {
  buildCapabilityEvidenceSummary,
  deriveCapabilityOverlayState,
} from "@/lib/business-capabilities/view-model";

type Props = {
  capability: BusinessCapabilityNode | null;
  overlayMode: CapabilityOverlayMode;
};

const valueStreamLabels = Object.fromEntries(
  IT4IT_VALUE_STREAMS.map((stream) => [stream.slug, stream.label]),
);

export function CapabilityDetailPanel({ capability, overlayMode }: Props) {
  if (!capability) {
    return (
      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm font-semibold text-[var(--dpf-text)]">Capability detail</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">Select a capability to inspect its operational context.</p>
      </aside>
    );
  }

  const state = deriveCapabilityOverlayState(capability, overlayMode);
  const evidence = buildCapabilityEvidenceSummary(capability);
  const unsupportedGap = capability.maturityGap > 0 && evidence.activeBacklogCount === 0;

  return (
    <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-auto">
      <div className="flex items-start gap-3">
        <div className="rounded bg-[var(--dpf-surface-2)] p-2">
          <Layers3 className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]">
            L{capability.level} Capability
          </p>
          <h2 className="text-base font-semibold leading-snug text-[var(--dpf-text)]">{capability.name}</h2>
          {capability.description ? (
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">{capability.description}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <DetailStat label="Current" value={capability.currentMaturity} />
        <DetailStat label="Target" value={capability.targetMaturity} />
        <DetailStat label="Gap" value={capability.maturityGap} />
        <DetailStat label={state.label} value={state.shortLabel} />
      </div>

      {capability.maturityRationale ? (
        <section className="mt-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <h3 className="text-xs font-semibold text-[var(--dpf-text)]">Maturity rationale</h3>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{capability.maturityRationale}</p>
        </section>
      ) : null}

      <section className="mt-4">
        <h3 className="text-xs font-semibold text-[var(--dpf-text)]">IT4IT alignment</h3>
        {capability.it4itValueStreams.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">No value streams linked.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {capability.it4itValueStreams.map((stream) => (
              <span
                key={stream}
                className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]"
              >
                {valueStreamLabels[stream] ?? stream}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-semibold text-[var(--dpf-text)]">Planning signals</h3>
        <div className="mt-2 grid gap-2">
          <PlanningSignal label="Target state" value={`Reach maturity ${capability.targetMaturity}`} />
          <PlanningSignal
            label="Supports today"
            value={evidence.hasOperationalEvidence ? "Operational evidence linked" : "No operational evidence"}
          />
          <PlanningSignal
            label="Active or planned work"
            value={evidence.activeBacklogCount > 0 ? `${evidence.activeBacklogCount} active backlog item` : "No active backlog trace"}
          />
          <PlanningSignal label="Unsupported gap" value={unsupportedGap ? "Yes" : "No"} />
        </div>
      </section>

      <section className="mt-4">
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
          <h3 className="text-xs font-semibold text-[var(--dpf-text)]">Traceability</h3>
        </div>
        <div className="space-y-3">
          {TRACE_TARGET_TYPES.map((target) => (
            <TraceGroup
              key={target.value}
              label={target.label}
              links={capability.traceGroups[target.value]}
            />
          ))}
        </div>
      </section>
    </aside>
  );
}

function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
      <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

function PlanningSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
      <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-1 text-xs text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

function TraceGroup({ label, links }: { label: string; links: BusinessCapabilityTraceRecord[] }) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]">{label}</p>
        <span className="text-[10px] text-[var(--dpf-muted)]">{links.length}</span>
      </div>
      {links.length === 0 ? (
        <p className="text-xs text-[var(--dpf-muted)]">No links.</p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <TraceLink key={link.id} link={link} />
          ))}
        </div>
      )}
    </div>
  );
}

function TraceLink({ link }: { link: BusinessCapabilityTraceRecord }) {
  const body = (
    <>
      <span>{link.label}</span>
      <span className="text-[var(--dpf-muted)]"> - {link.relationship.replace(/_/g, " ")}</span>
      {link.status ? <span className="text-[var(--dpf-muted)]"> - {link.status}</span> : null}
      {link.note ? <span className="block text-[var(--dpf-muted)]">{link.note}</span> : null}
    </>
  );

  if (!link.href) {
    return <p className="text-xs text-[var(--dpf-text)]">{body}</p>;
  }

  return (
    <Link href={link.href} className="group block text-xs text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]">
      {body}
      <ExternalLink className="ml-1 inline h-3 w-3 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
    </Link>
  );
}
