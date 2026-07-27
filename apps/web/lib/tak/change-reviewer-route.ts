import type { RouteAgentEntry } from "@/lib/agent-coworker-types";
import type { RouteContextDef } from "./route-context-map";

export const CHANGE_REVIEWER_ROUTE_AGENT: RouteAgentEntry = {
  agentId: "change-reviewer",
  agentName: "Change Reviewer",
  agentDescription:
    "Independent, evidence-grounded semantic review of committed software changes before publication",
  capability: "view_platform",
  sensitivity: "confidential",
  systemPrompt: `You are the Change Reviewer.

PERSPECTIVE: You independently evaluate a committed software change before it is first published. You reason from the exact base/head tree, diff, acceptance criteria, tests, code graph, architecture, and applicable DPF standards. You are not the author and you do not edit the change.

HEURISTICS:
- Evidence before findings: cite the file, location, behavior, and concrete failure mode
- Correctness before style: prioritize defects, security, data loss, architecture violations, missing tests, and maintainability risks
- Independent verification: try to refute critical findings before treating them as blocking
- Proportionality: distinguish blocking, important, and advisory findings; do not manufacture issues to appear useful
- Specialist routing: request architecture, security, data-governance, accessibility, or SBOM review only when the changed content warrants it
- Receipt integrity: review only an immutable committed tree; a material change makes the result stale

BOUNDARY: You may inspect source and governed context. You cannot edit code, advance a build, waive a finding, publish a branch, or approve your own authorship. State when evidence is insufficient instead of guessing.

ON THIS PAGE: The user sees governed Work Capsules and their shared activity/evidence timeline. Help them understand whether a committed change has sufficient independent review evidence before publication.`,
  skills: [
    {
      label: "Review a change",
      description: "Inspect a committed change for correctness and delivery risk",
      capability: "view_platform",
      prompt:
        "Review the committed change attached to this work capsule. Ground every finding in source and test evidence, and state what is blocking versus advisory.",
    },
    {
      label: "Check review evidence",
      description: "Explain whether the current review evidence is complete and fresh",
      capability: "view_platform",
      prompt:
        "Check the review evidence for this work capsule. Explain what is fresh, stale, missing, or still needs independent verification.",
    },
    {
      label: "Report an issue",
      description: "Report a bug or give feedback",
      capability: null,
      prompt: "I'd like to report an issue or give feedback about this page.",
    },
  ],
  modelRequirements: {
    defaultMinimumTier: "strong",
    defaultBudgetClass: "quality_first",
    defaultEffort: "high" as const,
  },
};

export const CHANGE_REVIEWER_ROUTE_CONTEXT: RouteContextDef = {
  routePrefix: "/build/work",
  domain: "Change Review",
  sensitivity: "confidential",
  domainContext:
    "This surface shows governed Work Capsules and their shared activity/evidence timeline. The Change Reviewer independently evaluates immutable committed changes before publication. It may inspect source, code graph, plans, architecture, backlog context, and registry context, but it does not edit code, advance builds, waive findings, or publish releases.",
  domainTools: [
    "read_project_file",
    "search_project_files",
    "list_project_directory",
    "get_code_graph_freshness",
    "search_code_graph",
    "trace_code_surface",
    "find_related_tests",
    "wiki_query",
    "search_knowledge",
  ],
  docsPath: "/docs/build-studio/index",
  skills: CHANGE_REVIEWER_ROUTE_AGENT.skills.map(
    ({ label, description, capability, prompt }) => ({
      label,
      description,
      capability,
      prompt,
    }),
  ),
};
