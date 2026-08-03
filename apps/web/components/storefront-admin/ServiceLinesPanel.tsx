"use client";

import { useState, useTransition } from "react";
import {
  addStorefrontServiceLine,
  removeStorefrontServiceLine,
} from "@/lib/storefront/service-line-actions";
import type { StorefrontCompositionView, StorefrontServiceLineView } from "@/lib/storefront/composition-view";
import { intentStyle } from "@/components/ui/report-kit/statusColors";
import { confirmDialog } from "@/components/ui/Dialog";
import { SearchableSelect } from "@/components/ui/form";

interface AvailableArchetype {
  archetypeSlug: string;
  name: string;
  category: string;
  itemCount: number;
  sectionCount: number;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

interface Props {
  storefrontId: string;
  view: StorefrontCompositionView;
  availableArchetypes: AvailableArchetype[];
}

export function ServiceLinesPanel({ storefrontId, view, availableArchetypes }: Props) {
  const [selectedSlug, setSelectedSlug] = useState(availableArchetypes[0]?.archetypeSlug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // BI-7D7EE150: adding a service line is a durable business mutation (it seeds
  // items + sections), so it must never happen on a single unconfirmed click.
  // Preview exactly what will change and confirm BEFORE the transition (dialog
  // helpers must not run inside startTransition).
  async function handleAdd() {
    if (!selectedSlug) return;
    const selected = availableArchetypes.find((a) => a.archetypeSlug === selectedSlug);
    if (!selected) return;

    const confirmed = await confirmDialog({
      title: `Add ${selected.name} as a service line?`,
      message:
        `This adds ${selected.name} to your portal, including ${plural(selected.itemCount, "item")} and ` +
        `${plural(selected.sectionCount, "section")} (sections stay hidden until you show them). ` +
        `You can remove it again afterwards.`,
      confirmLabel: "Add service line",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await addStorefrontServiceLine(storefrontId, selectedSlug);
      if ("error" in result) setError(result.error);
    });
  }

  async function handleRemove(line: StorefrontServiceLineView) {
    const moduleCount = line.contributedModules.length;
    const confirmed = await confirmDialog({
      title: `Remove ${line.operatorLabel}?`,
      message:
        `This hides the ${line.operatorLabel} service line` +
        (moduleCount > 0 ? ` and the ${plural(moduleCount, "module")} it added to your portal` : "") +
        `. You can add it back later.`,
      tone: "danger",
      confirmLabel: "Remove service line",
      cancelLabel: "Keep it",
    });
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await removeStorefrontServiceLine(storefrontId, line.compositionId);
      if ("error" in result) setError(result.error);
    });
  }

  const hasSummaryWarning =
    view.compatibilitySummary.status !== "good" &&
    view.compatibilitySummary.status !== "unknown";

  return (
    <div
      className="border border-[var(--dpf-border)]"
      style={{
        borderRadius: 10,
        overflow: "hidden",
        marginTop: 24,
      }}
    >
      {/* Header */}
      <div
        className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
        }}
      >
        <div>
          <div className="text-[var(--dpf-text)]" style={{ fontSize: 14, fontWeight: 700 }}>
            Active service lines
          </div>
          <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, marginTop: 2 }}>
            Add secondary lines to serve customers across multiple business models.
          </div>
        </div>
        {hasSummaryWarning && (
          <CompatibilityChip
            status={view.compatibilitySummary.status}
            label={view.compatibilitySummary.label}
          />
        )}
      </div>

      {/* Lines list */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <ServiceLineRow line={view.primary} onRemove={undefined} isPending={isPending} />
        {view.secondaries.map((line) => (
          <ServiceLineRow
            key={line.compositionId}
            line={line}
            onRemove={() => handleRemove(line)}
            isPending={isPending}
          />
        ))}
      </div>

      {/* Compatibility reasons */}
      {view.compatibilitySummary.reasons.length > 0 && (
        <div
          className="border-t border-[var(--dpf-border)]"
          style={{
            padding: "10px 20px",
            background: "color-mix(in srgb, var(--dpf-warning) 8%, transparent)",
          }}
        >
          {view.compatibilitySummary.reasons.map((reason, i) => (
            <div key={i} className="text-[var(--dpf-text)]" style={{ fontSize: 12, marginBottom: i < view.compatibilitySummary.reasons.length - 1 ? 4 : 0 }}>
              {reason}
            </div>
          ))}
        </div>
      )}

      {/* Add service line row */}
      {availableArchetypes.length > 0 && (
        <div
          className="border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          style={{
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <SearchableSelect
            value={selectedSlug}
            disabled={isPending}
            onValueChange={setSelectedSlug}
            ariaLabel="Service line to add"
            searchLabel="Search service lines"
            placeholder="Choose service line"
            options={availableArchetypes.map((a) => ({
              value: a.archetypeSlug,
              label: a.name,
              description: `${plural(a.itemCount, "item")} · ${plural(a.sectionCount, "section")}`,
              searchText: a.category,
            }))}
            preferredValues={[selectedSlug]}
            maxVisibleOptions={8}
            className="min-w-[180px] flex-1"
            controlClassName="bg-[var(--dpf-surface-1)] text-sm"
          />
          <button
            onClick={handleAdd}
            disabled={isPending || !selectedSlug}
            className="bg-[var(--dpf-accent)] text-white"
            style={{
              padding: "7px 16px",
              borderRadius: 6,
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              cursor: isPending || !selectedSlug ? "not-allowed" : "pointer",
              opacity: isPending || !selectedSlug ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {isPending ? "Adding…" : "Add service line"}
          </button>
          {error && (
            <div className="text-[var(--dpf-error)]" style={{ width: "100%", fontSize: 12, marginTop: 4 }}>
              {error}
            </div>
          )}
        </div>
      )}

      {availableArchetypes.length === 0 && view.secondaries.length >= 2 && (
        <div
          className="border-t border-[var(--dpf-border)] text-[var(--dpf-muted)] bg-[var(--dpf-surface-1)]"
          style={{
            padding: "10px 20px",
            fontSize: 12,
          }}
        >
          Maximum of 2 secondary service lines reached.
        </div>
      )}
    </div>
  );
}

function ServiceLineRow({
  line,
  onRemove,
  isPending,
}: {
  line: StorefrontServiceLineView;
  onRemove?: () => void;
  isPending: boolean;
}) {
  const chip = intentStyle(line.statusIntent);
  const isSecondary = line.role === "secondary";

  return (
    <div
      className="border-b border-[var(--dpf-border)]"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 20px",
      }}
    >
      {/* Role pill */}
      <div
        className={isSecondary ? "text-[var(--dpf-accent)]" : "text-[var(--dpf-success)]"}
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          padding: "2px 6px",
          borderRadius: 4,
          background: isSecondary
            ? "color-mix(in srgb, var(--dpf-accent) 15%, transparent)"
            : "color-mix(in srgb, var(--dpf-success) 15%, transparent)",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {isSecondary ? "Secondary" : "Primary"}
      </div>

      {/* Name + category */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="text-[var(--dpf-text)]"
          style={{
            fontSize: 14,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {line.operatorLabel}
        </div>
        <div
          className="text-[var(--dpf-muted)]"
          style={{
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {line.category}
        </div>
      </div>

      {/* Modules count */}
      {line.contributedModules.length > 0 && (
        <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}>
          {line.contributedModules.length} module{line.contributedModules.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Compatibility badge (secondaries only) */}
      {isSecondary && (
        <CompatibilityChip status={line.status} label={line.statusLabel} />
      )}

      {/* Remove button (secondaries only) */}
      {isSecondary && onRemove && (
        <button
          onClick={onRemove}
          disabled={isPending}
          aria-label={`Remove ${line.operatorLabel}`}
          className="border border-[var(--dpf-error)] bg-transparent text-[var(--dpf-error)]"
          style={{
            padding: "4px 10px",
            borderRadius: 5,
            fontSize: 12,
            fontWeight: 600,
            cursor: isPending ? "not-allowed" : "pointer",
            opacity: isPending ? 0.5 : 1,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

function CompatibilityChip({
  status,
  label,
}: {
  status: StorefrontServiceLineView["status"];
  label: string;
}) {
  const style = intentStyle(
    status === "good"
      ? "success"
      : status === "concern"
        ? "warning"
        : status === "acute"
          ? "danger"
          : status === "in-motion"
            ? "accent"
            : "neutral",
  );

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        background: style.softBg,
        color: style.fg,
        border: `1px solid ${style.border}`,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}
