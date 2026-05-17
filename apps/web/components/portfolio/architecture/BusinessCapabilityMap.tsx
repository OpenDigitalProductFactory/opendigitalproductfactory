import Link from "next/link";
import { Activity, GitBranch, Layers3, Link2, Network, Target } from "lucide-react";

import type {
  BusinessCapabilityNode,
  BusinessCapabilitySummary,
  BusinessCapabilityTraceRecord,
} from "@/lib/business-capabilities/data";
import { IT4IT_VALUE_STREAMS, TRACE_TARGET_TYPES } from "@/lib/business-capabilities/types";

type Props = {
  tree: BusinessCapabilityNode[];
  summary: BusinessCapabilitySummary;
};

const bandVars = {
  aligned: "var(--dpf-success)",
  watch: "var(--dpf-warning)",
  gap: "var(--dpf-error)",
} as const;

const bandLabels = {
  aligned: "Aligned",
  watch: "Watch",
  gap: "Gap",
} as const;

function bandStyle(band: BusinessCapabilityNode["maturityBand"]) {
  const color = bandVars[band];
  return {
    borderColor: color,
    background: `color-mix(in srgb, ${color} 10%, var(--dpf-surface-1))`,
  };
}

export function BusinessCapabilityMap({ tree, summary }: Props) {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SummaryMetric icon={Layers3} label="Capabilities" value={summary.totalCapabilities} />
        <SummaryMetric icon={Network} label="Families" value={summary.l1Count} />
        <SummaryMetric icon={GitBranch} label="L2" value={summary.l2Count} />
        <SummaryMetric icon={Target} label="L3" value={summary.l3Count} />
        <SummaryMetric icon={Activity} label="Gaps" value={summary.gapCount} tone="gap" />
        <SummaryMetric icon={Activity} label="Aligned" value={summary.alignedCount} tone="aligned" />
      </section>

      {tree.length === 0 ? (
        <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
          <p className="text-sm font-medium text-[var(--dpf-text)]">No business capabilities yet.</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Add an L1 family, then add L2 capabilities beneath it.
          </p>
        </section>
      ) : (
        <section className="space-y-7">
          {tree.map((family) => (
            <CapabilityFamily key={family.id} family={family} />
          ))}
        </section>
      )}
    </div>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Layers3;
  label: string;
  value: number;
  tone?: "aligned" | "gap";
}) {
  const color = tone ? bandVars[tone] : "var(--dpf-accent)";
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden="true" />
        <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">{label}</p>
      </div>
      <p className="mt-2 text-xl font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

function CapabilityFamily({ family }: { family: BusinessCapabilityNode }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--dpf-border)] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]">
              L1
            </span>
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">{family.name}</h2>
          </div>
          {family.description ? (
            <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">{family.description}</p>
          ) : null}
        </div>
        <MaturityPill capability={family} />
      </div>

      {family.children.length === 0 ? (
        <p className="text-xs text-[var(--dpf-muted)]">No L2 capabilities mapped under this family.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {family.children.map((capability) => (
            <CapabilityCard key={capability.id} capability={capability} />
          ))}
        </div>
      )}
    </section>
  );
}

function CapabilityCard({ capability }: { capability: BusinessCapabilityNode }) {
  return (
    <article className="rounded-lg border p-4" style={bandStyle(capability.maturityBand)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]">
              L{capability.level}
            </span>
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{capability.name}</h3>
          </div>
          {capability.description ? (
            <p className="text-xs text-[var(--dpf-muted)]">{capability.description}</p>
          ) : null}
        </div>
        <MaturityPill capability={capability} />
      </div>

      <ValueStreams streams={capability.it4itValueStreams} />
      <TraceLinks capability={capability} />

      {capability.children.length > 0 ? (
        <div className="mt-3 space-y-2 border-t border-[var(--dpf-border)] pt-3">
          {capability.children.map((child) => (
            <div
              key={child.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2"
            >
              <div>
                <p className="text-xs font-medium text-[var(--dpf-text)]">{child.name}</p>
                <ValueStreams streams={child.it4itValueStreams} compact />
              </div>
              <MaturityPill capability={child} compact />
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function MaturityPill({
  capability,
  compact,
}: {
  capability: BusinessCapabilityNode;
  compact?: boolean;
}) {
  const color = bandVars[capability.maturityBand];
  return (
    <div
      className={[
        "shrink-0 rounded border px-2 py-1 text-right",
        compact ? "min-w-20" : "min-w-24",
      ].join(" ")}
      style={{
        borderColor: color,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
      title={capability.maturityRationale ?? undefined}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color }}>
        {bandLabels[capability.maturityBand]}
      </p>
      <p className="text-xs text-[var(--dpf-text)]">
        {capability.currentMaturity} / {capability.targetMaturity}
      </p>
    </div>
  );
}

function ValueStreams({ streams, compact }: { streams: string[]; compact?: boolean }) {
  if (streams.length === 0) return null;
  const labels: Record<string, string> = Object.fromEntries(
    IT4IT_VALUE_STREAMS.map((stream) => [stream.slug, stream.label]),
  );
  return (
    <div className={compact ? "mt-1 flex flex-wrap gap-1" : "mt-3 flex flex-wrap gap-1.5"}>
      {streams.map((stream) => (
        <span
          key={stream}
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--dpf-muted)]"
        >
          {labels[stream] ?? stream}
        </span>
      ))}
    </div>
  );
}

function TraceLinks({ capability }: { capability: BusinessCapabilityNode }) {
  const hasLinks = TRACE_TARGET_TYPES.some((target) => capability.traceGroups[target.value].length > 0);
  if (!hasLinks) return null;

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
      {TRACE_TARGET_TYPES.map((target) => {
        const links = capability.traceGroups[target.value];
        if (links.length === 0) return null;
        return (
          <div key={target.value} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2">
            <div className="mb-1 flex items-center gap-1.5">
              <Link2 className="h-3 w-3 text-[var(--dpf-muted)]" aria-hidden="true" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]">
                {target.label}
              </p>
            </div>
            <div className="space-y-1">
              {links.map((link) => (
                <TraceLink key={link.id} link={link} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TraceLink({ link }: { link: BusinessCapabilityTraceRecord }) {
  const content = (
    <>
      <span>{link.label}</span>
      <span className="text-[var(--dpf-muted)]"> · {link.relationship.replace(/_/g, " ")}</span>
    </>
  );

  if (!link.href) {
    return <p className="text-[11px] text-[var(--dpf-text)]">{content}</p>;
  }

  return (
    <Link href={link.href} className="block text-[11px] text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]">
      {content}
    </Link>
  );
}
