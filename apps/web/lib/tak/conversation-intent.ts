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

const CONVERSATIONAL_EXPANSION_PATTERN =
  /^(?:elaborate|tell me more|more detail(?:s)?(?: please)?|expand(?: on (?:that|this|it))?|go deeper|say more|can you elaborate|could you elaborate|please elaborate)\.?$/i;

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

// Trivial social messages — greetings, acknowledgements, thanks, farewells —
// that carry no task. These must never load the tool surface. Attaching the
// full MCP toolset turns a ~2s greeting into a 10-130s agentic dispatch: the
// Claude/Codex CLI loads every tool schema on a fresh process, the model then
// hedges ("I don't have access to that tool") or explores, and the
// continuation-nudge loop re-dispatches the whole heavyweight call. Stripping
// tools sends these through the fast tool-free path. Measured 2026-06-04 on
// /portfolio: "hello" with 38 tools = 8.4s (best case) vs ~2s tool-free, and a
// substantive turn chained three CLI dispatches (16.4s + 23.2s + 5.8s) via the
// nudge loop. See the Portfolio Analyst latency investigation.
//
// Conservative by construction: the WHOLE message (minus punctuation) must
// consist solely of short social filler tokens. Any task verb, question word,
// or domain noun leaves at least one non-matching token, so a real request —
// even a terse one like "yes, do the truck list" — keeps its tools.
const SOCIAL_TOKEN_PATTERN =
  /^(?:hi|hello|hey|heya|hiya|yo|howdy|howzit|sup|hallo|greetings|gm|morning|afternoon|evening|good|there|thanks|thank|thankyou|thx|ty|tysm|cheers|appreciate|appreciated|ok|okay|k|kk|cool|nice|great|awesome|amazing|perfect|excellent|brilliant|sweet|wonderful|fantastic|got|sounds|np|yw|welcome|bye|goodbye|farewell|see|later|cya|ciao|night|you|u|it|that|this|much|very|so|really|the|a|and|please|pls|mate|friend|buddy|team|everyone)$/i;

/**
 * Detects trivial social messages (greetings, thanks, acknowledgements,
 * farewells) that carry no actionable request. The full trimmed message must
 * be short and consist only of social filler tokens. Used to strip the tool
 * surface so a "hello" answers in ~2s instead of dispatching the heavyweight
 * tool-loaded CLI agentic loop.
 */
export function isTrivialSocialMessage(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  // A genuine greeting is short; longer text is almost always a real message.
  if (text.length > 40) return false;
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 5) return false;
  return tokens.every((t) => SOCIAL_TOKEN_PATTERN.test(t));
}

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

export function isConversationalExpansionRequest(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (EXPLICIT_ACTION_PATTERN.test(text)) return false;
  if (BACKLOG_LOOKUP_PATTERN.test(text)) return false;
  return CONVERSATIONAL_EXPANSION_PATTERN.test(text);
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
/**
 * Detects when an assistant response is REDUNDANTLY re-asking a question the
 * model already asked — the "asks the same scope question five times" loop the
 * proceed-nudge is meant to break. Critically distinct from a substantive
 * answer that merely ENDS with an engagement question ("…What would you like
 * to focus on?"), which is normal and encouraged (actionable coworker
 * responses end with user choices).
 *
 * The earlier inline heuristic — `response.includes("?")` plus >60% word
 * overlap with ANY prior assistant message — misfired badly: a good 1500-char
 * answer ending in one engagement question shares generic vocabulary with the
 * greeting, tripped the guard, and triggered a 16-23s re-dispatch that ALSO
 * degraded the answer (the model went meta about its toolkit). Measured on
 * /portfolio, 2026-06-04: this false-positive nudge was the main reason a
 * trivial turn ballooned past a minute.
 *
 * Tightened gates: the response must be SHORT (a real re-ask is brief, not a
 * full answer), and it is only compared against prior assistant messages that
 * were THEMSELVES questions. A long answer can never be a re-ask.
 */
export function isRedundantReaskQuestion(
  response: string,
  priorAssistantMessages: string[],
): boolean {
  const trimmed = response.trim();
  // A genuine re-ask is short and question-dominated. A substantive answer
  // (which may end with an engagement question) is long — exclude it outright.
  if (trimmed.length <= 20 || trimmed.length > 350) return false;
  if (!trimmed.includes("?")) return false;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const responseWords = new Set(normalize(trimmed).split(/\s+/).filter(Boolean));
  return priorAssistantMessages.some((prev) => {
    // Only a prior QUESTION can be re-asked. Comparing against statements
    // produces spurious matches on shared vocabulary.
    if (!prev.includes("?")) return false;
    const prevNorm = normalize(prev);
    if (prevNorm.length < 20) return false;
    const prevWords = prevNorm.split(/\s+/).filter(Boolean);
    const overlap = prevWords.filter((w) => responseWords.has(w)).length;
    return overlap / Math.max(prevWords.length, 1) > 0.6;
  });
}

export function isPlatformMechanismQuestion(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (!text.endsWith("?")) return false;
  if (!MECHANISM_QUESTION_OPENER_PATTERN.test(text)) return false;
  if (!PLATFORM_MECHANISM_VERB_PATTERN.test(text)) return false;
  return true;
}

// BI-FBBA70DF: Read-only intent — negation marker followed (within 120 chars)
// by a mutation verb. Anchored to word boundaries so "don't" in "I don't want
// to miss anything" doesn't fire. The look-ahead cap (120 chars) prevents a
// late-sentence mutation from being swept in by an early "do not" unrelated to
// the request ("Do not worry — just create the brief").
const READ_ONLY_NEGATION_PATTERN =
  /\b(?:do\s+not|don't|dont|without|no)\b.{0,120}\b(?:publish|create|save|update|change|add|modify|schedule|send|post|submit|record|log|store|write|make\s+any\s+changes?|apply)\b/i;

// Explicit read-only shorthand phrases that stand alone without a negation+verb pair.
const READ_ONLY_SHORTHAND_PATTERN =
  /\b(?:just\s+(?:a\s+)?(?:plan|draft|show|tell|preview|advise|recommend|suggest)|preview\s+only|planning\s+only|read[\s-]only|no\s+changes?|don't\s+(?:touch|do)\s+anything|without\s+(?:making|saving|creating|publishing|changing)\s+anything)\b/i;

// Explicit mutation authorization — operator explicitly grants permission to act.
// Defined for symmetry and future use; not acted on by the current fix.
const MUTATION_AUTHORIZED_PATTERN =
  /\b(?:go\s+ahead\s+and\s+(?:create|save|publish|send|add|update|post)|please\s+(?:create|save|publish|send|add|update)|save\s+(?:it|that|this)|publish\s+(?:it|that|this)|do\s+it\s+now|make\s+the\s+changes?|apply\s+(?:it|that|those))\b/i;

/**
 * Classify the operator's mutation intent for the current turn.
 *
 * - `"read-only"` — the message contains explicit suppression language
 *   (e.g. "do not publish or change anything", "just a plan, no changes").
 *   The caller should suppress side-effecting tool exposure for this turn.
 *
 * - `"authorized"` — the message contains an explicit mutation grant
 *   (e.g. "save it", "go ahead and create"). Defined for future use;
 *   the current fix only acts on `"read-only"`.
 *
 * - `"unspecified"` — no explicit signal either way; existing mode logic applies.
 *
 * Conservative by design: only UNAMBIGUOUS suppression phrases qualify for
 * `"read-only"`. Ambiguous planning language ("help me plan a campaign") returns
 * `"unspecified"` so normal proposal surfacing continues.
 *
 * Pure function — no I/O. (BI-FBBA70DF)
 */
export function classifyTurnMutationIntent(
  content: string,
): "read-only" | "authorized" | "unspecified" {
  const text = content.trim();
  if (!text) return "unspecified";
  if (READ_ONLY_NEGATION_PATTERN.test(text) || READ_ONLY_SHORTHAND_PATTERN.test(text)) {
    return "read-only";
  }
  if (MUTATION_AUTHORIZED_PATTERN.test(text)) {
    return "authorized";
  }
  return "unspecified";
}
