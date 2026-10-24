// Statutory rate acquisition pack (BI-8E1FD1BD).
//
// The delivery path a research coworker was missing. Both tools sit behind
// `statutory_reference_propose`, granted to the two coworkers whose charter is
// exactly this work: AGT-WS-COMPLIANCE (evidence freshness, raises findings for
// a human) and AGT-905 (jurisdiction-layered findings, "without guessing legal
// facts").
//
// There is deliberately NO ratify tool here. Confirming a figure is a human
// action on the finance surface; exposing it to MCP would let an agent ratify
// its own research and make the whole gate decorative.

import {
  STATUTORY_RATE_TOOLS,
  listStatutoryRateGapsHandler,
  proposeStatutoryRateHandler,
} from "@/lib/mcp/statutory-rate-handlers";
import type { ToolPack } from "../tool-pack";

export const statutoryRatePack: ToolPack = {
  packId: "statutory-rate",
  definitions: [...STATUTORY_RATE_TOOLS],
  handlers: {
    list_statutory_rate_gaps: listStatutoryRateGapsHandler,
    propose_statutory_rate: proposeStatutoryRateHandler,
  },
  grants: {
    list_statutory_rate_gaps: ["statutory_reference_propose"],
    propose_statutory_rate: ["statutory_reference_propose"],
  },
};
