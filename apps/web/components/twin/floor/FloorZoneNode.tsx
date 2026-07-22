"use client";

// A named floor region (dining room, window, bar…) rendered as a soft labelled
// backdrop behind the tables. Non-interactive; purely orientational.

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { FloorZone } from "@/lib/storefront/floor-layout";

export type FloorZoneNodeData = Pick<FloorZone, "label" | "w" | "h">;

function FloorZoneNodeImpl({ data }: NodeProps) {
  const d = data as unknown as FloorZoneNodeData;
  return (
    <div
      style={{
        width: d.w,
        height: d.h,
        borderRadius: 14,
        border: "1px dashed var(--dpf-border)",
        background: "var(--dpf-surface-1)",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      <span
        className="text-[var(--dpf-muted)]"
        style={{
          position: "absolute",
          top: 8,
          left: 12,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        {d.label}
      </span>
    </div>
  );
}

export const FloorZoneNode = memo(FloorZoneNodeImpl);
