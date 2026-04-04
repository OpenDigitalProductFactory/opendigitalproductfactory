"use client";

import { type SerializedViewElement, LAYER_COLOURS } from "@/lib/ea-types";

// Gateway type markers (rendered inside diamond)
const GATEWAY_MARKERS: Record<string, string> = {
  bpmn_exclusive_gateway:   "X",
  bpmn_parallel_gateway:    "+",
  bpmn_inclusive_gateway:    "O",
  bpmn_event_based_gateway: "\u25CE",  // bullseye
  bpmn_complex_gateway:     "*",
};

type Props = {
  data: SerializedViewElement;
  selected?: boolean;
};

export function BpmnGatewayNode({ data, selected }: Props) {
  const colours = LAYER_COLOURS.bpmn_gateway;
  const marker = GATEWAY_MARKERS[data.elementType.slug] ?? "?";
  const size = 44;

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        userSelect: "none",
      }}
    >
      {/* Diamond shape */}
      <div
        style={{
          width: size,
          height: size,
          background: colours.bg,
          border: `2px solid ${colours.border}`,
          borderRadius: 3,
          transform: "rotate(45deg)",
          boxShadow: selected ? `0 0 0 2px ${colours.border}44` : undefined,
          position: "absolute",
          top: 0,
          left: 0,
        }}
      />
      {/* Marker text (not rotated) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 700,
          color: colours.border,
          zIndex: 1,
        }}
      >
        {marker}
      </div>
      {/* Label below diamond */}
      <div
        style={{
          position: "absolute",
          top: size + 4,
          left: -20,
          width: size + 40,
          textAlign: "center",
          fontSize: 9,
          color: "#446",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {data.element.name}
      </div>
    </div>
  );
}
