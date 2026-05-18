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
