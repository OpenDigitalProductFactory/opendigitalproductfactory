import type { CoworkerNoteKind } from "./coworker-memory";

export type MemoryExperienceSourceKind =
  | "phase-handoff"
  | "task-run"
  | "build";

export type MemoryExperienceSource = {
  sourceKind: MemoryExperienceSourceKind;
  sourceId: string;
  agentId: string | null;
  title?: string | null;
  status?: string | null;
  summary?: string | null;
  decisionsMade?: string[];
  openIssues?: string[];
  userPreferences?: string[];
};

export type MemoryNoteCandidate = {
  noteKind: CoworkerNoteKind;
  noteKey: string;
  content: string;
  sourceRef: string;
};

const MAX_NOTES_PER_SOURCE = 5;
const MAX_CONTENT_LENGTH = 500;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "keep",
  "no",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "use",
  "would",
  "with",
]);

const DOCTRINE_WORDS = /\b(?:wwmd|founder doctrine|founder kernel|kernel principle|commandment)\b/i;
const UNSAFE_MUTATION_WORDS = /\b(?:auto-?mutate|automatically|silently|rewrite|modify|replace|overrule)\b/i;
const NEGATION_WORDS = /\b(?:avoid|do not|don't|never|must not|no auto-?mutation|without mutating)\b/i;

export function shouldRejectMemoryContent(content: string): boolean {
  const text = content.trim();
  if (text.length < 12) return true;
  if (DOCTRINE_WORDS.test(text) && UNSAFE_MUTATION_WORDS.test(text) && !NEGATION_WORDS.test(text)) {
    return true;
  }
  return false;
}

export function distillMemoryNotesFromExperience(
  source: MemoryExperienceSource,
): MemoryNoteCandidate[] {
  const sourceRef = `memory-distill:${source.sourceKind}:${source.sourceId}`;
  const candidates: MemoryNoteCandidate[] = [];

  for (const preference of source.userPreferences ?? []) {
    pushCandidate(candidates, "preference", preference, sourceRef);
  }
  for (const decision of source.decisionsMade ?? []) {
    pushCandidate(candidates, "context", decision, sourceRef);
  }
  for (const issue of source.openIssues ?? []) {
    pushCandidate(candidates, "caution", issue, sourceRef);
  }

  const summary = cleanContent(source.summary ?? "");
  if (summary && source.sourceKind !== "phase-handoff") {
    const kind: CoworkerNoteKind = source.status === "failed" ? "caution" : "context";
    pushCandidate(candidates, kind, summary, sourceRef);
  }

  const seen = new Set<string>();
  const deduped: MemoryNoteCandidate[] = [];
  for (const candidate of candidates) {
    const signature = `${candidate.noteKind}:${candidate.noteKey}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(candidate);
    if (deduped.length >= MAX_NOTES_PER_SOURCE) break;
  }
  return deduped;
}

function pushCandidate(
  candidates: MemoryNoteCandidate[],
  noteKind: CoworkerNoteKind,
  rawContent: string,
  sourceRef: string,
) {
  const content = cleanContent(rawContent);
  if (shouldRejectMemoryContent(content)) return;
  const noteKey = makeNoteKey(content);
  if (!noteKey) return;
  candidates.push({ noteKind, noteKey, content, sourceRef });
}

function cleanContent(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_LENGTH);
}

function makeNoteKey(content: string): string {
  const tokens = content
    .toLowerCase()
    .replace(/recordcoworkernote/g, "recordcoworkernote")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .slice(0, 8);
  return tokens.join("-");
}
