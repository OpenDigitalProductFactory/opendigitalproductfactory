"use client";

import { DataTable, type Column } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import type { SerializedViewElement } from "@/lib/ea-types";

type ProcessMetadata = {
  streamKey?: unknown;
  stageKey?: unknown;
  input?: unknown;
  output?: unknown;
  responsibleRole?: unknown;
  trustGateKeys?: unknown;
  handoffToStageKey?: unknown;
};

export type OperationalValueStreamRow = {
  id: string;
  stream: string;
  stage: string;
  input: string;
  output: string;
  responsibleRole: string;
  gates: string;
  handoff: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function humanize(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function flatten(elements: SerializedViewElement[]): SerializedViewElement[] {
  const seen = new Set<string>();
  const result: SerializedViewElement[] = [];
  const visit = (element: SerializedViewElement) => {
    if (!seen.has(element.viewElementId)) {
      seen.add(element.viewElementId);
      result.push(element);
    }
    for (const child of element.childViewElements ?? []) visit(child);
  };
  for (const element of elements) visit(element);
  return result;
}

export function buildOperationalValueStreamRows(
  elements: SerializedViewElement[],
): OperationalValueStreamRow[] {
  const all = flatten(elements);
  const streamLabels = new Map<string, string>();
  const streamOrder = new Map<string, number>();
  const stageLabels = new Map<string, string>();

  for (const element of all) {
    const metadata = asRecord(element.element.properties?.operationalValueStream) as ProcessMetadata | null;
    const streamKey = typeof metadata?.streamKey === "string" ? metadata.streamKey : null;
    const stageKey = typeof metadata?.stageKey === "string" ? metadata.stageKey : null;
    if (streamKey && element.layoutRole === "stream_band") {
      streamLabels.set(streamKey, element.element.name);
      streamOrder.set(streamKey, element.orderIndex ?? streamOrder.size);
    }
    if (stageKey && element.layoutRole === "stream_stage") stageLabels.set(stageKey, element.element.name);
  }

  return all
    .filter((element) => element.layoutRole === "stream_stage")
    .map((element): OperationalValueStreamRow | null => {
      const metadata = asRecord(element.element.properties?.operationalValueStream) as ProcessMetadata | null;
      const streamKey = typeof metadata?.streamKey === "string" ? metadata.streamKey : null;
      const stageKey = typeof metadata?.stageKey === "string" ? metadata.stageKey : element.viewElementId;
      if (!streamKey) return null;
      const gates = Array.isArray(metadata?.trustGateKeys)
        ? metadata.trustGateKeys.filter((gate): gate is string => typeof gate === "string").map(humanize)
        : [];
      const handoffKey = typeof metadata?.handoffToStageKey === "string"
        ? metadata.handoffToStageKey
        : null;
      return {
        id: element.viewElementId,
        stream: streamLabels.get(streamKey) ?? humanize(streamKey),
        stage: element.element.name,
        input: text(metadata?.input),
        output: text(metadata?.output),
        responsibleRole: text(metadata?.responsibleRole),
        gates: gates.length ? gates.join(", ") : "Within approved policy",
        handoff: handoffKey ? stageLabels.get(handoffKey) ?? humanize(handoffKey) : "Next stage",
      };
    })
    .filter((row): row is OperationalValueStreamRow => row !== null)
    .sort((left, right) => {
      const leftElement = all.find((element) => element.viewElementId === left.id);
      const rightElement = all.find((element) => element.viewElementId === right.id);
      const leftMetadata = asRecord(leftElement?.element.properties?.operationalValueStream) as ProcessMetadata | null;
      const rightMetadata = asRecord(rightElement?.element.properties?.operationalValueStream) as ProcessMetadata | null;
      const leftStreamKey = typeof leftMetadata?.streamKey === "string" ? leftMetadata.streamKey : "";
      const rightStreamKey = typeof rightMetadata?.streamKey === "string" ? rightMetadata.streamKey : "";
      const streamCompare = (streamOrder.get(leftStreamKey) ?? 0) - (streamOrder.get(rightStreamKey) ?? 0);
      if (streamCompare !== 0) return streamCompare;
      return (leftElement?.orderIndex ?? 0) - (rightElement?.orderIndex ?? 0);
    });
}

const columns: Column<OperationalValueStreamRow>[] = [
  { key: "stream", header: "Value stream", cell: (row) => <strong>{row.stream}</strong>, width: "15%" },
  { key: "stage", header: "Stage", cell: (row) => row.stage, width: "14%" },
  { key: "input", header: "Input", cell: (row) => row.input, width: "16%" },
  { key: "output", header: "Output", cell: (row) => row.output, width: "18%" },
  { key: "responsible", header: "Responsible", cell: (row) => row.responsibleRole, width: "13%" },
  { key: "gates", header: "Gate", cell: (row) => row.gates, width: "12%" },
  { key: "handoff", header: "Handoff", cell: (row) => row.handoff, width: "12%" },
];

export function OperationalValueStreamTable({
  elements,
}: {
  elements: SerializedViewElement[];
}) {
  const rows = buildOperationalValueStreamRows(elements);
  return (
    <section className="h-full overflow-auto bg-[var(--dpf-bg)] p-dpf-lg" aria-labelledby="operational-stream-table-title">
      <Surface className="mx-auto max-w-[1500px] shadow-dpf-sm" padding="lg">
        <div data-dpf-lead>
          <p className="text-dpf-caption font-dpf-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
            Readable process view
          </p>
          <h2 id="operational-stream-table-title" className="mt-dpf-xs text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
            Stages, decisions, and handoffs
          </h2>
          <p className="mt-dpf-xs max-w-4xl text-dpf-body text-[var(--dpf-muted)]">
            Follow each value stream in order, including what enters and leaves the stage, who is responsible, and the gate that controls advancement.
          </p>
        </div>
        <DataTable
          ariaLabel="Operational value stream stages"
          className="mt-dpf-lg overflow-x-auto"
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          empty="No operational stages are projected for this view."
        />
      </Surface>
    </section>
  );
}
