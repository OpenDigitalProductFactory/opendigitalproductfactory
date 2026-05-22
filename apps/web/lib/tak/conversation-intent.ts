const EXPLANATION_PATTERN =
  /\b(?:explain|explained|explaining|clarify|walk me through|help me understand|what am i looking at|what is this|what's this|what does this mean|confusing|confused|orientation)\b/i;

const PAGE_REFERENCE_PATTERN =
  /\b(?:ui|user interface|interface|page|screen|workspace|view|layout|this|it|here)\b/i;

const EXPLICIT_ACTION_PATTERN =
  /\b(?:create|add|file|report|submit|log|capture|record|queue|triage|build|fix|update|change|delete|remove|assign|promote|start|run|execute)\b/i;

const BACKLOG_LOOKUP_PATTERN =
  /\b(?:backlog|epic|open item|open items|priorit(?:y|ies)|BI-[A-Z0-9-]+|EP-[A-Z0-9-]+)\b/i;

const NEGATED_ACTION_PATTERN =
  /\b(?:not|don't|do not|isn't|not asking)\b.{0,100}\b(?:backlog|item|issue|task|file|report|log|create|queue)\b/i;

// Question form openers that signal "asking about platform behavior" rather
// than "asking the agent to do something." Excludes second-person forms like
// "will you" / "can you" / "could you" / "would you" which are imperative-as-
// question (a request the agent should act on, not a mechanism question).
const MECHANISM_QUESTION_OPENER_PATTERN =
  /^\s*(?:if\s+i\b|when\s+i\b|will\s+(?:it|this|that|the|deploying|promoting|rebasing|shipping|merging|building|releasing|installing|migrating|running|starting)|does\s+(?:it|this|that|the|deploying|promoting|rebasing|shipping|merging|building|releasing|installing|migrating)|what\s+(?:happens|does|will)|how\s+(?:does|do|is|are)|is\s+(?:rebase|deploy|promote|ship|release|merge|build|the|this|that)|are\s+(?:these|those|the|this))/i;

// Platform action verbs whose presence (alongside a mechanism-question opener)
// signals the user is asking how a DPF mechanism behaves. Conservative — the
// caller already requires the question form + question mark.
const PLATFORM_MECHANISM_VERB_PATTERN =
  /\b(?:deploy|deploying|promot|rebas|merg|ship|releas|install|migrat|sandbox|bundle|pipeline|workflow|trigger|cascade|gate|push|pull\s+request|\bpr\b|build\s+studio|coworker|tool|grant|scope|token|fallback|provider|model|route|infer|orchestrat)/i;

export function isPageExplanationOnlyRequest(content: string): boolean {
  const text = content.trim();
  if (!text) return false;

  const asksForExplanation = EXPLANATION_PATTERN.test(text);
  if (!asksForExplanation) return false;

  const explicitlyRejectsAction = NEGATED_ACTION_PATTERN.test(text);
  if (explicitlyRejectsAction) return true;

  if (EXPLICIT_ACTION_PATTERN.test(text)) return false;

  const referencesPage = PAGE_REFERENCE_PATTERN.test(text);
  if (!referencesPage) return false;

  const asksForBacklogObject = BACKLOG_LOOKUP_PATTERN.test(text);
  if (asksForBacklogObject && !/\b(?:ui|user interface|interface|page|screen|workspace|view|layout)\b/i.test(text)) {
    return false;
  }

  return true;
}

/**
 * Detects "how does the platform work" / "what happens when I X" style
 * questions where the user is asking about DPF mechanism behavior rather
 * than asking the coworker to take an action. These should answer from
 * the system prompt + portal context, not by spinning tools — especially
 * important when the coworker is routed to a small local fallback model
 * that struggles with large tool surfaces.
 *
 * Conservative: requires both a question-form opener AND a platform action
 * verb AND a trailing question mark. Excludes "will/can/could/would you"
 * (those are requests in question form). Excludes utterances that contain
 * a backlog object reference like BI-XXX (those tend to be lookups/actions).
 */
export function isPlatformMechanismQuestion(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (!text.endsWith("?")) return false;
  if (!MECHANISM_QUESTION_OPENER_PATTERN.test(text)) return false;
  if (!PLATFORM_MECHANISM_VERB_PATTERN.test(text)) return false;
  return true;
}
