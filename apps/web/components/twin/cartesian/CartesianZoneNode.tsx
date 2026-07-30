"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { CartesianZoneNodeData } from "@/lib/twin/cartesian-scene";

function polygonClipPath(data: CartesianZoneNodeData): string | undefined {
  if (!data.polygonPoints || data.polygonPoints.length < 3) return undefined;
  const points = data.polygonPoints.map((point) => {
    const x = data.width > 0 ? (point.x / data.width) * 100 : 0;
    const y = data.height > 0 ? (point.y / data.height) * 100 : 0;
    return `${x}% ${y}%`;
  });
  return `polygon(${points.join(", ")})`;
}

function CartesianZoneNodeImpl({ data }: NodeProps) {
  const zone = data as unknown as CartesianZoneNodeData;
  return (
    <div
      aria-label={`${zone.label} zone`}
      role="group"
      style={{
        width: zone.width,
        height: zone.height,
        borderRadius: "var(--radius-dpf-lg)",
        border: "1px dashed var(--dpf-border)",
        background: "var(--dpf-surface-1)",
        boxSizing: "border-box",
        clipPath: polygonClipPath(zone),
        position: "relative",
        pointerEvents: "none",
        transform: `rotate(${zone.rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      <span className="absolute left-3 top-2 text-dpf-caption font-dpf-semibold uppercase tracking-wide text-dpf-muted">
        {zone.label}
      </span>
    </div>
  );
}

export const CartesianZoneNode = memo(CartesianZoneNodeImpl);
