import type { PageActionManifest } from "@/lib/agent-action-types";

// This manifest registers page-specific tools for the /employee route.
// IMPORTANT: Only list tools that have backend implementations in mcp-tools.ts
// executeTool(). Tools in allPlatformTools (mcp-tools.ts) are already available —
// do NOT duplicate them here with different schemas as it creates conflicting
// tool definitions that confuse the LLM.
//
// Employee page domain tools (from mcp-tools.ts, already in allPlatformTools):
//   list_departments, list_positions, create_employee, transition_employee_status,
//   propose_leave_policy, submit_feedback, query_employees
//
// This manifest adds page-specific actions not in the global platform tool set.

export const employeeActions: PageActionManifest = {
  route: "/employee",
  actions: [
    // No page-specific actions currently — all employee tools are in the global
    // platform tool set (mcp-tools.ts) and are available via allPlatformTools.
    // Add here only when a tool is truly page-specific and has a backend handler.
  ],
};
