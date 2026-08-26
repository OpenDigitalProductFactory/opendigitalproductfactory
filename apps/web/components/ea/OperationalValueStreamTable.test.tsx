import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SerializedViewElement } from "@/lib/ea-types";
import {
  buildOperationalValueStreamRows,
  OperationalValueStreamTable,
} from "./OperationalValueStreamTable";

function element(
  id: string,
  name: string,
  properties: Record<string, unknown>,
  children: SerializedViewElement[] = [],
  orderIndex = 0,
): SerializedViewElement {
  return {
    viewElementId: id,
    elementId: `element-${id}`,
    mode: "reference",
    parentViewElementId: null,
    orderIndex,
    rendererHint: children.length ? "nested_chevron_sequence" : null,
    layoutRole: children.length ? "stream_band" : "stream_stage",
    structureIssueCount: 0,
    proposedProperties: null,
    elementType: { slug: children.length ? "value_stream" : "value_stream_stage", name: "Value stream", neoLabel: "ArchiMate__ValueStream" },
    element: { name, description: null, lifecycleStage: "design", lifecycleStatus: "draft", properties },
    childViewElements: children,
  };
}

const stage = element("stage-intake", "Make the capacity decision", {
  projection: { source: "archetype-ovsm", streamKey: "intake-safe-placement", stageKey: "intake-capacity-decision" },
  operationalValueStream: {
    streamKey: "intake-safe-placement",
    stageKey: "intake-capacity-decision",
    input: "Triage result and live occupancy",
    output: "Admit, partner-transfer, or safe waitlist decision",
    responsibleRole: "Intake coordinator",
    trustGateKeys: ["safe-capacity-decision"],
    handoffToStageKey: "intake-quarantine-placement",
  },
});

const band = element(
  "band-intake",
  "Intake and safe placement",
  {
    projection: { source: "archetype-ovsm", streamKey: "intake-safe-placement" },
    operationalValueStream: { streamKey: "intake-safe-placement" },
  },
  [stage],
);

describe("OperationalValueStreamTable", () => {
  it("builds readable rows from the canonical EA projection metadata", () => {
    expect(buildOperationalValueStreamRows([band])).toEqual([
      expect.objectContaining({
        stream: "Intake and safe placement",
        stage: "Make the capacity decision",
        responsibleRole: "Intake coordinator",
        input: "Triage result and live occupancy",
        output: "Admit, partner-transfer, or safe waitlist decision",
        gates: "Safe Capacity Decision",
        handoff: "Intake Quarantine Placement",
      }),
    ]);
  });

  it("renders the list alternative with an accessible table name", () => {
    const html = renderToStaticMarkup(
      React.createElement(OperationalValueStreamTable, { elements: [band] }),
    );
    expect(html).toContain('aria-label="Operational value stream stages"');
    expect(html).toContain("Make the capacity decision");
    expect(html).toContain("Intake coordinator");
  });

  it("keeps streams and stages in the order projected by Architecture", () => {
    const welfareStage = element(
      "stage-welfare",
      "Provide daily care",
      {
        operationalValueStream: {
          streamKey: "health-welfare",
          stageKey: "welfare-daily-care",
        },
      },
    );
    const welfareBand = element(
      "band-welfare",
      "Health and welfare",
      { operationalValueStream: { streamKey: "health-welfare" } },
      [welfareStage],
      1,
    );

    expect(buildOperationalValueStreamRows([welfareBand, band]).map((row) => row.stream)).toEqual([
      "Intake and safe placement",
      "Health and welfare",
    ]);
  });
});
