"use client";

import { useState } from "react";
import Link from "next/link";
import type { GroupedInventory, SubnetGroup, SubnetGroupEntity } from "@/lib/discovery-data";
import { getDeviceVisual } from "@/lib/graph/device-icons";

type FilterMode = "all" | "physical" | "docker";

export function SubnetGroupedInventoryPanel({
  groups,
}: {
  groups: GroupedInventory;
}) {
  const [filter, setFilter] = useState<FilterMode>("physical");
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    // Auto-expand physical subnets with members
    const ids = new Set<string>();
    for (const g of groups.physicalSubnets) {
      if (g.entities.length > 0) ids.add(g.subnet.id);
    }
    return ids;
  });

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const showPhysical = filter === "all" || filter === "physical";
  const showDocker = filter === "all" || filter === "docker";

  const visibleSubnets = [
    ...(showPhysical ? groups.physicalSubnets : []),
    ...(showDocker ? groups.dockerSubnets : []),
  ];
  const visibleEntityCount = visibleSubnets.reduce((n, g) => n + g.entities.length, 0)
    + (filter === "all" ? groups.ungrouped.length : 0);

  return (
    <section className="rounded-xl border border-white/10 bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
            Operational Inventory
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
            Network Segments
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--dpf-muted)]">
            {visibleEntityCount} entities
          </span>
          <div className="flex gap-1">
            {(["physical", "docker", "all"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilter(mode)}
                className={`rounded-md px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] font-medium transition-colors ${
                  filter === mode
                    ? "bg-[#7c8cf8] text-white"
                    : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {visibleSubnets.map((group) => (
          <SubnetSection
            key={group.subnet.id}
            group={group}
            isOpen={openIds.has(group.subnet.id)}
            onToggle={() => toggle(group.subnet.id)}
          />
        ))}

        {filter === "all" && groups.ungrouped.length > 0 && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--dpf-muted)] mb-2">
              Ungrouped ({groups.ungrouped.length})
            </p>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {groups.ungrouped.map((e) => (
                <EntityCard key={e.id} entity={e} />
              ))}
            </div>
          </div>
        )}

        {visibleSubnets.length === 0 && groups.ungrouped.length === 0 && (
          <p className="mt-4 text-sm text-[var(--dpf-muted)]">
            No discovered infrastructure in this view.
          </p>
        )}
      </div>
    </section>
  );
}

function SubnetSection({
  group,
  isOpen,
  onToggle,
}: {
  group: SubnetGroup;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const visual = getDeviceVisual(group.subnet.entityType);
  const borderColor = group.subnet.isDocker ? "#34d399" : "#7c8cf8";

  return (
    <div
      className="rounded-lg border-l-4 bg-[var(--dpf-surface-2)] overflow-hidden"
      style={{ borderLeftColor: borderColor }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--dpf-surface-1)] transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg" style={{ color: visual.color }}>
            {visual.symbol}
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">
              {group.subnet.name}
            </p>
            <p className="text-[10px] text-[var(--dpf-muted)] font-mono">
              {group.subnet.networkAddress}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {group.deviceCount > 0 && (
            <span className="rounded-full bg-[#7c8cf820] px-2 py-0.5 text-[10px] text-[#7c8cf8]">
              {group.deviceCount} device{group.deviceCount !== 1 ? "s" : ""}
            </span>
          )}
          {group.clientCount > 0 && (
            <span className="rounded-full bg-[#22d3ee20] px-2 py-0.5 text-[10px] text-[#22d3ee]">
              {group.clientCount} client{group.clientCount !== 1 ? "s" : ""}
            </span>
          )}
          <span className="text-[var(--dpf-muted)] text-xs">
            {isOpen ? "\u25BC" : "\u25B6"}
          </span>
        </div>
      </button>

      {isOpen && group.entities.length > 0 && (
        <div className="px-4 pb-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {group.entities.map((entity) => (
              <EntityCard key={entity.id} entity={entity} />
            ))}
          </div>
        </div>
      )}

      {isOpen && group.entities.length === 0 && (
        <p className="px-4 pb-3 text-xs text-[var(--dpf-muted)]">
          No discovered devices in this segment.
        </p>
      )}
    </div>
  );
}

function EntityCard({ entity }: { entity: SubnetGroupEntity }) {
  const visual = getDeviceVisual(entity.entityType);
  const props = entity.properties;
  const address = (props.address as string) ?? (props.networkAddress as string) ?? "";
  const mac = (props.mac as string) ?? "";

  return (
    <article className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2.5">
      <div className="flex items-start gap-2">
        <span
          className="text-base mt-0.5 shrink-0"
          style={{ color: visual.color }}
          title={visual.label}
        >
          {visual.symbol}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-[var(--dpf-text)] truncate">
              {entity.name}
            </p>
            <span className="text-[9px] uppercase tracking-[0.1em] text-[var(--dpf-muted)] shrink-0">
              {visual.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-[var(--dpf-muted)] font-mono">
            {address && <span>{address}</span>}
            {mac && <span>{mac}</span>}
          </div>
          {entity.digitalProduct && (
            <Link
              href={`/portfolio/product/${entity.digitalProduct.id}/inventory`}
              className="text-[10px] text-[var(--dpf-accent)] hover:underline mt-1 inline-block"
            >
              {entity.digitalProduct.name}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
