// First scoped tool pack — BI-ARCH-TOOLPACKS.
//
// Deliberation + SIEM are the cleanest first extraction: both already live in
// self-contained sibling modules (mcp-tools-deliberation.ts / mcp-tools-siem.ts)
// that mcp-tools.ts spreads into PLATFORM_TOOLS and dispatches by name. This pack
// bundles their definitions, handlers, and grant metadata behind the ToolPack
// shape so mcp-tools.ts composes the definitions from here instead of importing
// the two modules directly. Grants mirror agent-grants.ts TOOL_TO_GRANTS exactly
// (asserted by tool-registry.test.ts).

import {
  DELIBERATION_TOOLS,
  deliberateOnMcpHandler,
} from "@/lib/mcp-tools-deliberation";
import {
  SIEM_TOOLS,
  getSecurityCaseHandler,
  openSecurityCaseHandler,
  proposeDetectionTuningHandler,
  proposeResponseHandler,
  queryDetectionsHandler,
  querySecurityEventsHandler,
  updateSecurityCaseHandler,
} from "@/lib/mcp-tools-siem";
import type { ToolPack } from "../tool-pack";

export const deliberationSiemPack: ToolPack = {
  packId: "deliberation-siem",
  definitions: [...DELIBERATION_TOOLS, ...SIEM_TOOLS],
  handlers: {
    deliberate_on: deliberateOnMcpHandler,
    query_security_events: querySecurityEventsHandler,
    query_detections: queryDetectionsHandler,
    get_security_case: getSecurityCaseHandler,
    open_security_case: openSecurityCaseHandler,
    update_security_case: updateSecurityCaseHandler,
    propose_detection_tuning: proposeDetectionTuningHandler,
    propose_response: proposeResponseHandler,
  },
  grants: {
    deliberate_on: ["deliberation_create"],
    query_security_events: ["siem_read"],
    query_detections: ["siem_read"],
    get_security_case: ["siem_read"],
    open_security_case: ["siem_investigate"],
    update_security_case: ["siem_investigate"],
    propose_detection_tuning: ["siem_tune"],
    propose_response: ["incident_respond"],
  },
};
