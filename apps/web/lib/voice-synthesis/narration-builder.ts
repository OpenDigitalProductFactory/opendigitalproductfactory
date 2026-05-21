import type { NarrationInput } from "./types"

const OUTCOME_OPENERS: Record<string, string> = {
  recommend: "My recommendation is to proceed.",
  arbitrate: "I'm deciding to proceed.",
  escalate: "I need a human decision on this one.",
  defer:    "I don't have enough guidance to weigh in here.",
}

function confidencePhrase(score: number): string {
  if (score >= 0.85) return "high confidence"
  if (score >= 0.55) return "moderate confidence"
  return "low confidence"
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")  // bold
    .replace(/\*(.*?)\*/g, "$1")       // italic
    .replace(/\[([^\]]+)\]/g, "$1")    // link text / citation labels
    .replace(/\(https?:\/\/[^)]+\)/g, "") // link URLs
    .replace(/#{1,6}\s/g, "")           // headings
    .replace(/`[^`]+`/g, (m) => m.replace(/`/g, "")) // inline code
    .trim()
}

export function buildNarrationText(input: NarrationInput): string {
  const opener = OUTCOME_OPENERS[input.outcomeType] ?? "Here is the perspective."
  const conf   = confidencePhrase(input.confidenceScore)
  const body   = stripMarkdown(input.rationale)

  return `${opener} With ${conf}: ${body}`
}
