// apps/web/lib/voice-synthesis/persona-style.ts
//
// Persona generation style pass: rewrites narration text through a persona's
// system prompt so the voice output matches the WWWD persona's tone and style.
// Returns narrationText unchanged when no personaSystemPrompt is present.

import { callLLM } from "../llm-call"

export interface PersonaStyleInput {
  narrationText: string
  personaSystemPrompt?: string
}

export async function applyPersonaStyle(input: PersonaStyleInput): Promise<string> {
  if (!input.personaSystemPrompt) return input.narrationText

  const result = await callLLM({
    systemPrompt: input.personaSystemPrompt,
    userMessage: `Rephrase the following narration in your voice and style. Keep the same meaning and facts. Return only the rephrased text, no preamble:\n\n${input.narrationText}`,
    maxTokens: 400,
  })

  return result.text?.trim() || input.narrationText
}
