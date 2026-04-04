"use client";

import { type SerializedViewElement, layerFromNeoLabel, LAYER_COLOURS } from "@/lib/ea-types";

// Icons by task type (small text markers in top-left corner)
const TASK_ICONS: Record<string, string> = {
  bpmn_user_task:          "\u{1F464}",  // person silhouette
  bpmn_service_task:       "\u2699",     // gear
  bpmn_script_task:        "\u{1F4DC}",  // scroll
  bpmn_business_rule_task: "\u{1F4CB}",  // clipboard
  bpmn_manual_task:        "\u270B",     // hand
  bpmn_send_task:          "\u2709",     // envelope
  bpmn_receive_task:       "\u{1F4E8}",  // incoming envelope
  bpmn_call_activity:      "\u21AA",     // hook arrow
};

type Props = {
  data: SerializedViewElement;
  selected?: boolean;
};

export function BpmnTaskNode({ data, selected }: Props) {
  const layer = layerFromNeoLabel(data.elementType.neoLabel);
  const colours = LAYER_COLOURS[layer] ?? LAYER_COLOURS.bpmn_process;
  const icon = TASK_ICONS[data.elementType.slug] ?? "";

  return (
    <div
      style={{
        padding: "6px 10px",
        background: colours.bg,
        border: `2px solid ${colours.border}`,
        borderRadius: 10,
        boxShadow: selected ? `0 0 0 2px ${colours.border}44` : undefined,
        minWidth: 110,
        maxWidth: 180,
        userSelect: "none",
        position: "relative",
      }}
    >
      {icon && (
        <div style={{ position: "absolute", top: 3, left: 6, fontSize: 10 }}>{icon}</div>
      )}
      <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#446", marginBottom: 2, paddingLeft: icon ? 16 : 0 }}>
        {data.elementType.name}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#112" }}>
        {data.element.name}
      </div>
      <div style={{ fontSize: 10, color: "#446", marginTop: 2 }}>
        {data.element.lifecycleStage} · {data.element.lifecycleStatus}
      </div>
    </div>
  );
}
