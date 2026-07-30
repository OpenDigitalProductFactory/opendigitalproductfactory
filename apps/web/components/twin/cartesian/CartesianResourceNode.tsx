"use client";

import { memo, type CSSProperties } from "react";
import type { NodeProps } from "@xyflow/react";

import { intentStyle } from "@/components/ui/report-kit/statusColors";
import type { CartesianPlacementNodeData } from "@/lib/twin/cartesian-scene";

type InteractivePlacementNodeData = CartesianPlacementNodeData & {
  onActivate?: () => void;
};

function resourceRadius(data: InteractivePlacementNodeData): CSSProperties["borderRadius"] {
  const shape = data.shapeKind.toLowerCase();
  if (shape.includes("round") || shape.includes("seat")) return "50%";
  if (shape.includes("bay") || shape.includes("rack")) {
    return "var(--radius-dpf-sm)";
  }
  return "var(--radius-dpf-md)";
}

function accessibleName(data: InteractivePlacementNodeData): string {
  return [
    data.label,
    data.statusLabel,
    data.sublabel,
    data.cogSuggested ? "Recommended assignment" : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function CartesianResourceNodeImpl({ data, selected }: NodeProps) {
  const node = data as unknown as InteractivePlacementNodeData;
  const intent = intentStyle(node.intent);
  const style: CSSProperties = {
    width: node.width,
    height: node.height,
    minWidth: 44,
    minHeight: 44,
    borderRadius: resourceRadius(node),
    border: `2px solid ${node.cogSuggested ? "var(--dpf-accent)" : intent.border}`,
    background: intent.softBg,
    color: "var(--dpf-text)",
    boxShadow: node.cogSuggested
      ? "0 0 0 3px color-mix(in srgb, var(--dpf-accent) 24%, transparent)"
      : selected
        ? "0 0 0 2px var(--dpf-accent)"
        : "var(--shadow-dpf-xs)",
    transform: `rotate(${node.rotation}deg)`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--spacing-dpf-2xs)",
    padding: "var(--spacing-dpf-xs)",
    textAlign: "center",
    overflow: "hidden",
    boxSizing: "border-box",
  };
  const content = (
    <>
      <span className="text-dpf-caption font-dpf-semibold leading-tight">
        {node.label}
      </span>
      <span
        className="text-dpf-caption font-dpf-medium leading-tight"
        style={{ color: intent.fg }}
      >
        {node.statusLabel}
      </span>
      {node.sublabel ? (
        <span className="text-dpf-caption leading-tight text-dpf-muted">
          {node.sublabel}
        </span>
      ) : null}
      {node.cogSuggested ? (
        <span className="sr-only">Recommended assignment</span>
      ) : null}
    </>
  );

  if (node.interactive && node.onActivate) {
    return (
      <button
        type="button"
        aria-label={accessibleName(node)}
        aria-busy={node.pending || undefined}
        className="dpf-tap-target cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        data-cog-suggested={node.cogSuggested || undefined}
        onClick={node.onActivate}
        style={style}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      aria-label={accessibleName(node)}
      aria-busy={node.pending || undefined}
      data-cog-suggested={node.cogSuggested || undefined}
      role="img"
      style={style}
    >
      {content}
    </div>
  );
}

const CartesianResourceNode = memo(CartesianResourceNodeImpl);

export const TableSceneNode = CartesianResourceNode;
export const ChairSceneNode = CartesianResourceNode;
export const BaySceneNode = CartesianResourceNode;
export const RackSceneNode = CartesianResourceNode;
export const SeatSceneNode = CartesianResourceNode;
export const StationSceneNode = CartesianResourceNode;
export const GenericResourceSceneNode = CartesianResourceNode;
