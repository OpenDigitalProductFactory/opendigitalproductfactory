/** Shared, dependency-light intent matching for progressive tool disclosure. */

export const LOAD_TOOLS_TOOL_NAME = "load_tools";
export const LOAD_TOOLS_BATCH_MAX = 16;

const INTENT_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "you", "your", "with", "this", "that", "can", "will",
  "please", "how", "what", "when", "get", "let", "are", "from", "about", "need",
  "want", "help", "into", "have", "use", "using", "tool", "tools", "call", "my",
  "its", "our", "their", "then",
]);

export interface ToolIntentCandidate {
  name: string;
  description?: string;
}

export function tokenizeIntent(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || INTENT_STOPWORDS.has(raw)) continue;
    tokens.add(raw);
    // Preserve substring-era usability for simple plural forms while keeping
    // matching deterministic (quote ↔ quotes, claim ↔ claims).
    if (raw.length > 4 && raw.endsWith("s")) tokens.add(raw.slice(0, -1));
  }
  return tokens;
}

/** Distinct intent tokens found in a tool's name and description. */
export function scoreToolIntentRelevance(
  tool: ToolIntentCandidate,
  intentTokens: ReadonlySet<string>,
): number {
  if (intentTokens.size === 0) return 0;
  const toolTokens = tokenizeIntent(`${tool.name} ${tool.description ?? ""}`);
  let score = 0;
  for (const token of intentTokens) if (toolTokens.has(token)) score += 1;
  return score;
}

/**
 * Select from an already-authorized pool by exact name first, then by ranked
 * natural-language intent. Results are bounded so a broad query cannot restore
 * the whole deferred catalog in one call.
 */
export function selectLoadableTools<T extends ToolIntentCandidate>(
  candidates: readonly T[],
  request: { names?: unknown; query?: unknown },
  batchMax: number = LOAD_TOOLS_BATCH_MAX,
): T[] {
  const requestedNames = new Set(
    (Array.isArray(request.names) ? request.names : [])
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const selected = new Map<string, T>();

  for (const candidate of candidates) {
    if (selected.size >= batchMax) break;
    if (requestedNames.has(candidate.name)) selected.set(candidate.name, candidate);
  }

  const queryTokens =
    typeof request.query === "string" ? tokenizeIntent(request.query.trim()) : new Set<string>();
  if (queryTokens.size === 0 || selected.size >= batchMax) return [...selected.values()];

  const ranked = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreToolIntentRelevance(candidate, queryTokens),
    }))
    .filter(({ candidate, score }) => score > 0 && !selected.has(candidate.name))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  for (const { candidate } of ranked) {
    if (selected.size >= batchMax) break;
    selected.set(candidate.name, candidate);
  }
  return [...selected.values()];
}
