// apps/web/lib/task-types.ts
// Registry of task types with heuristic patterns, capability requirements, and default instructions.

import { CapabilityTier } from "./agent-router-types";

export type TaskTypeDefinition = {
  id: string;
  description: string;
  heuristicPatterns: RegExp[];
  minCapabilityTier: CapabilityTier;
  defaultInstructions: string;
  evaluationTokenLimit: number;
};

export const TASK_TYPES: TaskTypeDefinition[] = [
  {
    id: "greeting",
    description: "Casual greetings and social pleasantries.",
    heuristicPatterns: [
      /^(hi|hello|hey|good\s*(morning|afternoon|evening)|thanks|thank you)\b/i,
      /^(how are you|what's up|howdy)\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions: "Respond warmly and briefly. Keep it to 1-2 sentences.",
    evaluationTokenLimit: 200,
  },
  {
    id: "status-query",
    description: "Requests for current state, counts, or overviews of data.",
    heuristicPatterns: [
      /\b(show me|what('s| is) the (status|state|current))\b/i,
      /\b(how many|how much|list (all|the))\b/i,
      /\b(give me|tell me about) (the |a )?(overview|summary|status)\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions:
      "Answer with specific data from the page context. Use bullet points for multiple items. Be factual, not analytical.",
    evaluationTokenLimit: 500,
  },
  {
    id: "summarization",
    description: "Condensing content into key points or a brief overview.",
    heuristicPatterns: [
      /\b(summarize|summary|key points|main (points|takeaways)|brief overview)\b/i,
      /\b(tldr|tl;dr|in (short|brief))\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions:
      "Be concise — 3-5 bullet points maximum. Focus on key facts and decisions. Do not add your own analysis or recommendations.",
    evaluationTokenLimit: 500,
  },
  {
    id: "reasoning",
    description: "Analysis, comparisons, recommendations, and explanatory reasoning.",
    heuristicPatterns: [
      /\b(why|explain|analyze|compare|evaluate|assess|what if)\b/i,
      /\b(should (we|i)|pros and cons|trade.?offs|recommend)\b/i,
      /\b(what('s| is) the (best|right|better) (way|approach|option))\b/i,
    ],
    minCapabilityTier: "analytical",
    defaultInstructions:
      "Think through this step by step. Consider multiple perspectives. State your reasoning clearly. If you're uncertain, say so.",
    evaluationTokenLimit: 500,
  },
  {
    id: "data-extraction",
    description: "Finding, filtering, or pulling specific data from a source.",
    heuristicPatterns: [
      /\b(find|extract|pull|get|look up|which (ones|items))\b/i,
      /\b(filter|search for|where is|locate)\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions:
      "Extract exactly what was asked for. Present results clearly. If nothing matches, say so explicitly.",
    evaluationTokenLimit: 500,
  },
  {
    id: "code-gen",
    description: "Writing, fixing, or refactoring code and technical artifacts.",
    heuristicPatterns: [
      /\b(write|implement|create|build|code|fix|debug|refactor)\b.*\b(function|component|api|endpoint|test|class|module)\b/i,
      /\b(typescript|javascript|react|prisma|sql)\b/i,
    ],
    minCapabilityTier: "analytical",
    defaultInstructions:
      "Write clean, well-structured code following the project's existing patterns. Include error handling. Explain your approach briefly.",
    evaluationTokenLimit: 1000,
  },
  {
    id: "web-search",
    description: "Searching the web for current or factual information.",
    heuristicPatterns: [
      /\b(search (for|the web)|look up|find online|google)\b/i,
      /\b(what is|who is|when did)\b.*\b(latest|recent|current)\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions:
      "Search for the requested information. Present results with sources. Distinguish facts from opinions.",
    evaluationTokenLimit: 500,
  },
  {
    id: "creative",
    description: "Generating ideas, names, descriptions, or other creative content.",
    heuristicPatterns: [
      /\b(suggest|come up with|generate|brainstorm|name|describe|write a)\b/i,
      /\b(creative|catchy|compelling|engaging)\b/i,
    ],
    minCapabilityTier: "routine",
    defaultInstructions:
      "Be creative but relevant. Offer 3-5 options when generating ideas. Keep suggestions practical.",
    evaluationTokenLimit: 500,
  },
  {
    id: "tool-action",
    description: "Direct mutations: creating, updating, or deleting records via tools.",
    heuristicPatterns: [
      /\b(create|update|delete|remove|add|change|set|modify)\b.*\b(item|product|backlog|epic|task|provider|user|role)\b/i,
      /\b(file|report|submit|register)\b.*\b(issue|bug|improvement|feedback)\b/i,
    ],
    minCapabilityTier: "routine",
    defaultInstructions:
      "Execute the requested action using the appropriate tool. Confirm what you did in 1-2 sentences. Do not narrate your plan.",
    evaluationTokenLimit: 300,
  },
];

export function getTaskType(id: string): TaskTypeDefinition | undefined {
  return TASK_TYPES.find((t) => t.id === id);
}
