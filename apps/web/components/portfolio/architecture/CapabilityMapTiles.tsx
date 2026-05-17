import {
  Boxes,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Layers3,
  Network,
  Tags,
} from "lucide-react";

import {
  type BusinessCapabilityNode,
} from "@/lib/business-capabilities/data";
import type { CapabilityOverlayMode, CapabilityOverlayTone } from "@/lib/business-capabilities/types";
import {
  buildCapabilityEvidenceSummary,
  deriveCapabilityOverlayState,
  type BusinessCapabilityMapRow,
} from "@/lib/business-capabilities/view-model";

type CanvasProps = {
  mapRows: BusinessCapabilityMapRow[];
  overlayMode: CapabilityOverlayMode;
  selectedCapabilityId: string | null;
  onSelectCapability: (capabilityId: string) => void;
};

const overlayToneVars: Record<CapabilityOverlayTone, string> = {
  aligned: "var(--dpf-success)",
  watch: "var(--dpf-warning)",
  gap: "var(--dpf-error)",
  neutral: "var(--dpf-muted)",
  covered: "var(--dpf-accent)",
  active: "var(--dpf-info, var(--dpf-accent))",
};

export function CapabilityMapCanvas({
  mapRows,
  overlayMode,
  selectedCapabilityId,
  onSelectCapability,
}: CanvasProps) {
  return (
    <div className="space-y-4">
      {mapRows.map((row) => (
        <div key={row.id} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {row.families.map((family) => (
            <CapabilityFamilyBand
              key={family.id}
              family={family}
              overlayMode={overlayMode}
              selectedCapabilityId={selectedCapabilityId}
              onSelectCapability={onSelectCapability}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CapabilityFamilyBand({
  family,
  overlayMode,
  selectedCapabilityId,
  onSelectCapability,
}: {
  family: BusinessCapabilityNode;
  overlayMode: CapabilityOverlayMode;
  selectedCapabilityId: string | null;
  onSelectCapability: (capabilityId: string) => void;
}) {
  const state = deriveCapabilityOverlayState(family, overlayMode);
  const color = overlayToneVars[state.tone];
  const isSelected = selectedCapabilityId === family.id;

  return (
    <section
      className="min-h-44 rounded-lg border p-3"
      style={{
        borderColor: isSelected ? "var(--dpf-accent)" : color,
        background: `color-mix(in srgb, ${color} 8%, var(--dpf-surface-1))`,
      }}
      aria-labelledby={`capability-family-${family.id}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => onSelectCapability(family.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectCapability(family.id);
          }
        }}
        className="mb-3 flex cursor-pointer flex-wrap items-start justify-between gap-3 rounded-md border border-transparent p-2 outline-none focus:border-[var(--dpf-accent)]"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]">
              L1
            </span>
            <h2 id={`capability-family-${family.id}`} className="text-base font-semibold text-[var(--dpf-text)]">
              {family.name}
            </h2>
          </div>
          {family.description ? (
            <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">{family.description}</p>
          ) : null}
        </div>
        <OverlayBadge stateLabel={state.shortLabel} tone={state.tone} />
      </div>

      {family.children.length === 0 ? (
        <p className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 text-xs text-[var(--dpf-muted)]">
          No L2 capabilities mapped under this family.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {family.children.map((capability) => (
            <CapabilityTile
              key={capability.id}
              capability={capability}
              overlayMode={overlayMode}
              selectedCapabilityId={selectedCapabilityId}
              onSelectCapability={onSelectCapability}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CapabilityTile({
  capability,
  overlayMode,
  selectedCapabilityId,
  onSelectCapability,
}: {
  capability: BusinessCapabilityNode;
  overlayMode: CapabilityOverlayMode;
  selectedCapabilityId: string | null;
  onSelectCapability: (capabilityId: string) => void;
}) {
  const state = deriveCapabilityOverlayState(capability, overlayMode);
  const color = overlayToneVars[state.tone];
  const isSelected = selectedCapabilityId === capability.id;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => onSelectCapability(capability.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectCapability(capability.id);
        }
      }}
      className="min-h-36 cursor-pointer rounded-lg border p-3 outline-none transition focus:border-[var(--dpf-accent)]"
      style={{
        borderColor: isSelected ? "var(--dpf-accent)" : color,
        background: `color-mix(in srgb, ${color} 12%, var(--dpf-surface-2))`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-[var(--dpf-surface-1)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]">
              L{capability.level}
            </span>
            <h3 className="text-sm font-semibold leading-snug text-[var(--dpf-text)]">{capability.name}</h3>
          </div>
          {capability.description ? (
            <p className="line-clamp-2 text-xs text-[var(--dpf-muted)]">{capability.description}</p>
          ) : null}
        </div>
        <OverlayBadge stateLabel={state.shortLabel} tone={state.tone} compact />
      </div>

      <EvidenceChips capability={capability} />

      {capability.children.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--dpf-border)] pt-3">
          {capability.children.map((child) => (
            <SubCapabilityTile
              key={child.id}
              capability={child}
              overlayMode={overlayMode}
              selectedCapabilityId={selectedCapabilityId}
              onSelectCapability={onSelectCapability}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SubCapabilityTile({
  capability,
  overlayMode,
  selectedCapabilityId,
  onSelectCapability,
}: {
  capability: BusinessCapabilityNode;
  overlayMode: CapabilityOverlayMode;
  selectedCapabilityId: string | null;
  onSelectCapability: (capabilityId: string) => void;
}) {
  const state = deriveCapabilityOverlayState(capability, overlayMode);
  const color = overlayToneVars[state.tone];
  const isSelected = selectedCapabilityId === capability.id;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={(event) => {
        event.stopPropagation();
        onSelectCapability(capability.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelectCapability(capability.id);
        }
      }}
      className="flex min-h-16 cursor-pointer items-center justify-between gap-2 rounded-md border bg-[var(--dpf-surface-1)] px-3 py-2 outline-none focus:border-[var(--dpf-accent)]"
      style={{ borderColor: isSelected ? "var(--dpf-accent)" : color }}
    >
      <div>
        <p className="text-xs font-medium leading-snug text-[var(--dpf-text)]">{capability.name}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">L3 sub-capability</p>
      </div>
      <OverlayBadge stateLabel={state.shortLabel} tone={state.tone} compact />
    </div>
  );
}

function EvidenceChips({ capability }: { capability: BusinessCapabilityNode }) {
  const evidence = buildCapabilityEvidenceSummary(capability);
  const chips = [
    { id: "taxonomy", label: "Taxonomy", value: evidence.taxonomyCount, icon: Tags },
    { id: "products", label: "Products", value: evidence.productCount, icon: BriefcaseBusiness },
    { id: "backlog", label: "Backlog", value: evidence.backlogCount, icon: ClipboardList },
    { id: "architecture", label: "Architecture", value: evidence.architectureCount, icon: Network },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <EvidenceChip key={chip.id} label={chip.label} value={chip.value} icon={chip.icon} />
      ))}
      {evidence.activeBacklogCount > 0 ? (
        <span className="inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-1.5 py-1 text-[10px] text-[var(--dpf-text)]">
          <CheckCircle2 className="h-3 w-3 text-[var(--dpf-accent)]" aria-hidden="true" />
          {evidence.activeBacklogCount} active
        </span>
      ) : null}
    </div>
  );
}

function EvidenceChip({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Layers3;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-1.5 py-1 text-[10px] text-[var(--dpf-muted)]"
      title={label}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {value}
    </span>
  );
}

function OverlayBadge({
  stateLabel,
  tone,
  compact,
}: {
  stateLabel: string;
  tone: CapabilityOverlayTone;
  compact?: boolean;
}) {
  const color = overlayToneVars[tone];
  return (
    <span
      className={[
        "shrink-0 rounded border text-center font-medium text-[var(--dpf-text)]",
        compact ? "min-w-14 px-1.5 py-1 text-[10px]" : "min-w-20 px-2 py-1 text-xs",
      ].join(" ")}
      style={{
        borderColor: color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {stateLabel}
    </span>
  );
}
