"use client";

import { type SerializedViewElement, LAYER_COLOURS } from "@/lib/ea-types";

type Props = {
  data: SerializedViewElement;
  selected?: boolean;
};

// Event circle variants per BPMN 2.0 convention:
// Start = thin border, End = thick border, Intermediate = double border
function getEventStyle(slug: string, colours: { bg: string; border: string }) {
  const base = {
    background: colours.bg,
    borderColor: colours.border,
    borderStyle: "solid" as const,
  };
  if (slug === "bpmn_start_event") {
    return { ...base, borderWidth: 2 };
  }
  if (slug === "bpmn_end_event") {
    return { ...base, borderWidth: 4 };
  }
  // Intermediate and typed events get double border
  return { ...base, borderWidth: 2, outline: `2px solid ${colours.border}`, outlineOffset: 2 };
}

// Small icon inside event circle
const EVENT_ICONS: Record<string, string> = {
  bpmn_timer_event:   "\u{1F551}",  // clock
  bpmn_error_event:   "\u26A1",     // lightning
  bpmn_signal_event:  "\u25B3",     // triangle
  bpmn_message_event: "\u2709",     // envelope
  bpmn_boundary_event: "\u26A0",    // warning
};

export function BpmnEventNode({ data, selected }: Props) {
  const colours = LAYER_COLOURS.bpmn_event;
  const eventStyle = getEventStyle(data.elementType.slug, colours);
  const icon = EVENT_ICONS[data.elementType.slug] ?? "";
  const size = 36;

  return (
    <div style={{ position: "relative", userSelect: "none" }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: selected ? `0 0 0 2px ${colours.border}44` : undefined,
          ...eventStyle,
        }}
      >
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
      </div>
      {/* Label below circle */}
      <div
        style={{
          position: "absolute",
          top: size + 6,
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
