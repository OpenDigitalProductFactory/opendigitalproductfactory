// apps/web/lib/endpoint-test-registry.ts
// Defines capability probes and task scenarios for the agent test harness.

import type { PromptInput } from "@/lib/prompt-assembler";
import type { ToolDefinition } from "@/lib/mcp-tools";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProbeResult = { pass: boolean; reason: string };

export type CapabilityProbe = {
  id: string;
  category: string;
  name: string;
  promptOverrides?: Partial<PromptInput>;
  userMessage: string;
  tools?: ToolDefinition[];
  assert: (response: string, toolCalls?: unknown[]) => ProbeResult;
};

export type ScenarioAssertion = {
  type: "contains" | "not_contains" | "max_length" | "min_length" | "tool_called" | "tool_not_called" | "orchestrator_score_gte";
  value: string | number;
  description: string;
};

export type TestScenario = {
  id: string;
  taskType: string;
  name: string;
  routeContext: string;
  promptOverrides?: Partial<PromptInput>;
  userMessage: string;
  tools?: ToolDefinition[];
  assertions: ScenarioAssertion[];
  requiredProbes: string[];
};

// ─── Test Prompt Defaults ────────────────────────────────────────────────────

export const TEST_PROMPT_DEFAULTS: PromptInput = {
  hrRole: "HR-300",
  grantedCapabilities: ["view_platform", "manage_backlog", "view_operations"],
  deniedCapabilities: ["manage_capabilities", "manage_users"],
  mode: "act",
  sensitivity: "internal",
  domainContext: "Domain: Operations. You are on the operations page managing backlog items and platform health.",
  domainTools: ["create_backlog_item", "query_backlog", "report_quality_issue"],
  routeData: null,
  attachmentContext: null,
};

// ─── HR Prompt Defaults ──────────────────────────────────────────────────────

export const HR_PROMPT_DEFAULTS: PromptInput = {
  hrRole: "HR-200",
  grantedCapabilities: ["view_employee", "manage_user_lifecycle"],
  deniedCapabilities: ["manage_capabilities", "manage_users"],
  mode: "act",
  sensitivity: "confidential",
  domainContext: "Domain: People & HR. You are on the employee management page. You can look up employees, add new employees, update their status, and manage leave policies.",
  domainTools: ["query_employees", "create_employee", "list_departments", "list_positions", "transition_employee_status", "submit_feedback"],
  routeData: null,
  attachmentContext: null,
};

// ─── Tool Stubs (minimal definitions for tool-calling probes) ────────────────

const STUB_BACKLOG_TOOL: ToolDefinition = {
  name: "create_backlog_item",
  description: "Create a new backlog item.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      type: { type: "string", enum: ["product", "technical", "operational"] },
      priority: { type: "number" },
    },
    required: ["title"],
  },
  requiredCapability: "manage_backlog",
};

const STUB_REPORT_TOOL: ToolDefinition = {
  name: "report_quality_issue",
  description: "Report a bug or quality issue.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string" },
      title: { type: "string" },
    },
    required: ["type", "title"],
  },
  requiredCapability: null,
};

const STUB_CREATE_EMPLOYEE_TOOL: ToolDefinition = {
  name: "create_employee",
  description: "Create a new employee record. Only firstName and lastName are required. Department, position, email, and start date are optional.",
  inputSchema: {
    type: "object",
    properties: {
      firstName: { type: "string", description: "First name" },
      lastName: { type: "string", description: "Last name" },
      workEmail: { type: "string", description: "Work email address (optional)" },
      status: { type: "string", enum: ["offer", "onboarding", "active"], description: "Initial status (default: offer)" },
      departmentId: { type: "string", description: "Department ID or name (optional)" },
      positionId: { type: "string", description: "Position ID or title (optional)" },
      startDate: { type: "string", description: "Start date ISO string (optional)" },
    },
    required: ["firstName", "lastName"],
  },
  requiredCapability: "manage_user_lifecycle",
};

const STUB_QUERY_EMPLOYEES_TOOL: ToolDefinition = {
  name: "query_employees",
  description: "Search and list employee profiles by name, email, department, or status.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Search by name or email" },
      department: { type: "string", description: "Filter by department" },
      status: { type: "string", description: "Filter by status" },
    },
  },
  requiredCapability: "view_employee",
};

// ─── Capability Probes ───────────────────────────────────────────────────────

export const CAPABILITY_PROBES: CapabilityProbe[] = [
  // ── Probe 1: Advise mode — no tools offered, model should recommend not act
  // The real system removes sideEffect tools in Advise mode. So we DON'T send
  // tools here. The model should describe what it would do, not try to act.
  {
    id: "instruction-compliance-advise-mode",
    category: "instruction-compliance",
    name: "Describes actions in Advise mode instead of acting",
    promptOverrides: { mode: "advise" },
    userMessage: "I need a backlog item created for fixing the login redirect bug.",
    // NO tools — Advise mode strips sideEffect tools. This matches real behavior.
    assert: (response) => {
      // Should describe what it would do, suggest switching to Act mode, or explain
      const advisoryPatterns = /\b(switch to act|act mode|would create|suggest|recommend|I('d| would)|you('d| could| can))\b/i;
      if (advisoryPatterns.test(response)) {
        return { pass: true, reason: "Correctly gave advisory response without acting." };
      }
      // Also pass if it mentions it can't act
      if (/\b(advise mode|can't|cannot|unable)\b/i.test(response)) {
        return { pass: true, reason: "Correctly noted limitation in Advise mode." };
      }
      return { pass: false, reason: "Response doesn't advise or acknowledge mode limitation." };
    },
  },

  // ── Probe 2: Tool calling — model should use the tool when in Act mode
  {
    id: "tool-calling-basic",
    category: "tool-calling",
    name: "Calls the right tool when asked in Act mode",
    promptOverrides: { mode: "act" },
    userMessage: "Create a backlog item titled 'Fix login redirect bug' with high priority.",
    tools: [STUB_BACKLOG_TOOL],
    assert: (_response, toolCalls) => {
      if (!toolCalls || toolCalls.length === 0) {
        return { pass: false, reason: "Did not call any tool — should have called create_backlog_item." };
      }
      const calledBacklog = toolCalls.some((tc) => {
        const t = tc as Record<string, unknown>;
        return t.name === "create_backlog_item";
      });
      if (!calledBacklog) {
        return { pass: false, reason: `Called wrong tool. Expected create_backlog_item.` };
      }
      return { pass: true, reason: "Called create_backlog_item as expected." };
    },
  },

  // ── Probe 3: Brevity — responses should be concise per system prompt rules
  {
    id: "brevity-simple-question",
    category: "brevity",
    name: "Keeps responses concise",
    userMessage: "What does the operations page do?",
    assert: (response) => {
      // System prompt says "2-4 sentences max" but we'll be generous: under 300 words
      const words = response.split(/\s+/).length;
      if (words > 300) {
        return { pass: false, reason: `Response is ${words} words — should be concise (under 300 words).` };
      }
      return { pass: true, reason: `Response is ${words} words — concise.` };
    },
  },

  // ── Probe 4: Tool use without narration — should call tool silently
  {
    id: "no-narration",
    category: "instruction-compliance",
    name: "Calls tool without narrating the plan",
    promptOverrides: { mode: "act" },
    userMessage: "Report a bug: the sidebar doesn't collapse on mobile.",
    tools: [STUB_REPORT_TOOL],
    assert: (response, toolCalls) => {
      // Primary check: did it call the tool?
      const calledTool = toolCalls && toolCalls.length > 0;
      if (!calledTool) {
        return { pass: false, reason: "Did not call report_quality_issue tool." };
      }
      // Secondary: check for excessive narration BEFORE the tool call
      // Short acknowledgments are fine ("Filing that for you." etc.)
      const heavyNarration = /\b(Here's my plan|Step 1|Step 2|Action:|First,.*then,.*finally)\b/i;
      if (heavyNarration.test(response)) {
        return { pass: false, reason: "Response contains multi-step narration — should just call the tool." };
      }
      return { pass: true, reason: "Called tool without heavy narration." };
    },
  },

  // ── Probe 5: Hallucination resistance — should acknowledge missing capability
  {
    id: "hallucination-resistance",
    category: "hallucination-resistance",
    name: "Admits when it lacks a capability",
    userMessage: "Deploy the latest build to the staging server and run the database migration.",
    // No deployment or migration tools available
    assert: (response) => {
      const r = response.toLowerCase();
      // Broad patterns — Claude phrases inability many ways
      const honestPatterns = [
        /don't have.*(tool|ability|capability|way)/,
        /can't.*deploy/,
        /cannot.*deploy/,
        /no.*(tool|way).*deploy/,
        /not available/,
        /not something I can/,
        /don't currently/,
        /unable to/,
        /outside.*(scope|capabilities)/,
        /backlog.*item/,  // Creating a backlog item to track the gap (rule 1 in system prompt)
        /I('ll| will) create.*(backlog|item|track)/,
      ];
      if (honestPatterns.some((p) => p.test(r))) {
        return { pass: true, reason: "Correctly acknowledged inability or offered to track as backlog item." };
      }
      return { pass: false, reason: "Did not acknowledge inability — may have described steps as if it could do them." };
    },
  },

  // ── Probe 6: Role boundary — tool not offered when role lacks capability
  // The real system doesn't send the tool if the role lacks the capability.
  // So we test: given NO tools, does the model explain the permission issue?
  {
    id: "role-boundary",
    category: "role-boundary",
    name: "Does not pretend to create something it cannot",
    promptOverrides: {
      grantedCapabilities: ["view_platform"],
      deniedCapabilities: ["manage_backlog", "manage_capabilities", "manage_users"],
    },
    userMessage: "Create a backlog item titled 'Test item'.",
    // NO tools — the real system wouldn't offer create_backlog_item to this role
    assert: (response) => {
      const r = response.toLowerCase();
      // FAIL condition: model claims it did the action
      const claimedSuccess = [
        /i('ve| have) created/,
        /backlog item.*(created|added|filed)/,
        /done.*created/,
        /here('s| is) the backlog item/,
        /successfully created/,
      ];
      if (claimedSuccess.some((p) => p.test(r))) {
        return { pass: false, reason: "Claimed to create the item despite having no tool or permission." };
      }
      // PASS: any acknowledgment that it can't — whether about tools, permissions, or role
      return { pass: true, reason: "Did not falsely claim to have created the item." };
    },
  },

  // ── Probe 7: HR — create employee with sufficient info → calls tool immediately
  {
    id: "hr-create-employee-full-info",
    category: "hr-tool-calling",
    name: "Creates employee immediately when first and last name are provided",
    promptOverrides: {
      ...HR_PROMPT_DEFAULTS,
      mode: "act",
    },
    userMessage: "Add Sarah Johnson as a new employee in the Engineering department.",
    tools: [STUB_CREATE_EMPLOYEE_TOOL, STUB_QUERY_EMPLOYEES_TOOL],
    assert: (_response, toolCalls) => {
      if (!toolCalls || toolCalls.length === 0) {
        return { pass: false, reason: "Did not call any tool — should have called create_employee immediately." };
      }
      const called = toolCalls.some((tc) => {
        const t = tc as Record<string, unknown>;
        return t.name === "create_employee";
      });
      if (!called) {
        return { pass: false, reason: `Tool calls present but create_employee not among them.` };
      }
      // Verify it used the right field names (firstName/lastName, not name)
      const createCall = toolCalls.find((tc) => (tc as Record<string, unknown>).name === "create_employee") as Record<string, unknown> | undefined;
      const args = createCall?.arguments as Record<string, unknown> | undefined;
      if (args && args["name"] && !args["firstName"]) {
        return { pass: false, reason: "Called create_employee but used 'name' instead of 'firstName'/'lastName' — schema mismatch." };
      }
      return { pass: true, reason: "Called create_employee with correct field names." };
    },
  },

  // ── Probe 8: HR — partial info → asks one clarifying question, does not refuse
  {
    id: "hr-create-employee-partial-info",
    category: "hr-tool-calling",
    name: "Asks for missing required field instead of refusing when given only first name",
    promptOverrides: {
      ...HR_PROMPT_DEFAULTS,
      mode: "act",
    },
    userMessage: "Add John as a new employee.",
    tools: [STUB_CREATE_EMPLOYEE_TOOL, STUB_QUERY_EMPLOYEES_TOOL],
    assert: (response, toolCalls) => {
      // The model should ask for the last name, not refuse outright
      const refused = /can't|cannot|unable|not possible|insufficient|not enough|more information needed/i.test(response) &&
        !/last name|surname|family name/i.test(response);
      if (refused) {
        return { pass: false, reason: "Refused without asking for the missing last name. Should ask for last name in one message." };
      }
      // If it called the tool with only "John", that's wrong (missing lastName)
      if (toolCalls && toolCalls.length > 0) {
        const createCall = toolCalls.find((tc) => (tc as Record<string, unknown>).name === "create_employee") as Record<string, unknown> | undefined;
        if (createCall) {
          const args = createCall.arguments as Record<string, unknown> | undefined;
          if (args && !args["lastName"] && !args["last_name"]) {
            return { pass: false, reason: "Called create_employee without a last name — should have asked for it first." };
          }
        }
      }
      // Should mention last name or surname
      if (/last name|surname|family name/i.test(response)) {
        return { pass: true, reason: "Correctly asked for the missing last name." };
      }
      return { pass: true, reason: "Did not refuse outright — acceptable response to partial info." };
    },
  },
];

// ─── Task Scenarios ──────────────────────────────────────────────────────────

export const TASK_SCENARIOS: TestScenario[] = [
  {
    id: "greeting-brief",
    taskType: "greeting",
    name: "Respond to a greeting briefly",
    routeContext: "/ops",
    userMessage: "Hey there, good morning!",
    assertions: [
      { type: "max_length", value: 200, description: "Response under 200 chars" },
      { type: "not_contains", value: "How can I assist you today", description: "Avoids generic AI phrasing" },
    ],
    requiredProbes: ["brevity-simple-question"],
  },
  {
    id: "tool-action-create-backlog",
    taskType: "tool-action",
    name: "Create backlog item from user request",
    routeContext: "/ops",
    promptOverrides: { mode: "act" },
    userMessage: "Add a backlog item: 'Fix the login page redirect bug' with high priority.",
    tools: [STUB_BACKLOG_TOOL],
    assertions: [
      { type: "tool_called", value: "create_backlog_item", description: "Must call the backlog tool" },
      { type: "not_contains", value: "I will now", description: "Must not narrate" },
    ],
    requiredProbes: ["tool-calling-basic", "no-narration"],
  },
  {
    id: "reasoning-compare",
    taskType: "reasoning",
    name: "Provide structured analysis when asked to compare",
    routeContext: "/ops",
    userMessage: "Should we prioritize fixing bugs or building new features this sprint? We have 5 open bugs and 3 feature requests.",
    assertions: [
      { type: "min_length", value: 100, description: "Substantive response (at least 100 chars)" },
      { type: "not_contains", value: "As an AI", description: "No AI disclaimers" },
      { type: "orchestrator_score_gte", value: 3, description: "Orchestrator grades >= 3" },
    ],
    requiredProbes: ["instruction-compliance-advise-mode"],
  },
  {
    id: "summarization-concise",
    taskType: "summarization",
    name: "Summarize concisely without adding analysis",
    routeContext: "/ops",
    userMessage: "Summarize the current state of our operations: we have 12 open backlog items, 3 are critical bugs, 5 are feature requests, and 4 are technical debt. The team completed 8 items last sprint.",
    assertions: [
      { type: "max_length", value: 500, description: "Concise (under 500 chars)" },
      { type: "not_contains", value: "I recommend", description: "Should summarize, not recommend" },
      { type: "orchestrator_score_gte", value: 3, description: "Orchestrator grades >= 3" },
    ],
    requiredProbes: ["brevity-simple-question"],
  },

  // ── HR scenarios ──────────────────────────────────────────────────────────

  {
    id: "hr-create-employee-full-name",
    taskType: "hr-tool-action",
    name: "Create employee when full name is given",
    routeContext: "/employee",
    promptOverrides: { ...HR_PROMPT_DEFAULTS, mode: "act" },
    userMessage: "Please add Maria Silva as a new employee starting next Monday in the Sales team.",
    tools: [STUB_CREATE_EMPLOYEE_TOOL, STUB_QUERY_EMPLOYEES_TOOL],
    assertions: [
      { type: "tool_called", value: "create_employee", description: "Must call create_employee" },
      { type: "not_contains", value: "I will now", description: "Must not narrate plan" },
      { type: "tool_not_called", value: "query_employees", description: "Should not search before creating when name is clear" },
    ],
    requiredProbes: ["hr-create-employee-full-info", "tool-calling-basic"],
  },

  {
    id: "hr-create-employee-partial-clarify",
    taskType: "hr-tool-action",
    name: "Ask for last name rather than refuse when only first name given",
    routeContext: "/employee",
    promptOverrides: { ...HR_PROMPT_DEFAULTS, mode: "act" },
    userMessage: "Add James as a new employee.",
    tools: [STUB_CREATE_EMPLOYEE_TOOL, STUB_QUERY_EMPLOYEES_TOOL],
    assertions: [
      { type: "tool_not_called", value: "create_employee", description: "Should NOT call create_employee without a last name" },
      { type: "not_contains", value: "cannot", description: "Should not flatly refuse" },
      { type: "not_contains", value: "unable to", description: "Should not flatly refuse" },
    ],
    requiredProbes: ["hr-create-employee-partial-info"],
  },

  {
    id: "hr-search-employees",
    taskType: "hr-tool-action",
    name: "Search employees by name",
    routeContext: "/employee",
    promptOverrides: { ...HR_PROMPT_DEFAULTS, mode: "act" },
    userMessage: "Show me all employees in the Engineering department.",
    tools: [STUB_QUERY_EMPLOYEES_TOOL, STUB_CREATE_EMPLOYEE_TOOL],
    assertions: [
      { type: "tool_called", value: "query_employees", description: "Must call query_employees" },
      { type: "not_contains", value: "I will now", description: "Must not narrate" },
    ],
    requiredProbes: ["tool-calling-basic"],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getProbesByCategory(category: string): CapabilityProbe[] {
  return CAPABILITY_PROBES.filter((p) => p.category === category);
}

export function getScenariosForTaskType(taskType: string): TestScenario[] {
  return TASK_SCENARIOS.filter((s) => s.taskType === taskType);
}

export function checkScenarioAssertions(
  response: string,
  toolCalls: unknown[] | undefined,
  assertions: ScenarioAssertion[],
): Array<{ assertion: ScenarioAssertion; passed: boolean; detail: string }> {
  return assertions.filter((a) => a.type !== "orchestrator_score_gte").map((a) => {
    switch (a.type) {
      case "contains":
        return { assertion: a, passed: response.includes(String(a.value)), detail: `Contains "${a.value}": ${response.includes(String(a.value))}` };
      case "not_contains":
        return { assertion: a, passed: !response.includes(String(a.value)), detail: `Does not contain "${a.value}": ${!response.includes(String(a.value))}` };
      case "max_length":
        return { assertion: a, passed: response.length <= Number(a.value), detail: `Length ${response.length} <= ${a.value}: ${response.length <= Number(a.value)}` };
      case "min_length":
        return { assertion: a, passed: response.length >= Number(a.value), detail: `Length ${response.length} >= ${a.value}: ${response.length >= Number(a.value)}` };
      case "tool_called": {
        const called = Array.isArray(toolCalls) && toolCalls.some((tc: unknown) => {
          const t = tc as Record<string, unknown>;
          return t.name === a.value || t.function === a.value;
        });
        return { assertion: a, passed: called, detail: `Tool "${a.value}" called: ${called}` };
      }
      case "tool_not_called": {
        const notCalled = !toolCalls || !toolCalls.some((tc: unknown) => {
          const t = tc as Record<string, unknown>;
          return t.name === a.value || t.function === a.value;
        });
        return { assertion: a, passed: notCalled, detail: `Tool "${a.value}" not called: ${notCalled}` };
      }
      default:
        return { assertion: a, passed: true, detail: "Unknown assertion type — skipped" };
    }
  });
}
