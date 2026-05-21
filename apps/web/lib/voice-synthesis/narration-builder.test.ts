import { describe, it, expect } from "vitest"
import { buildNarrationText } from "./narration-builder"

describe("buildNarrationText", () => {
  it("removes markdown formatting", () => {
    const result = buildNarrationText({
      outcomeType: "recommend",
      confidenceScore: 0.82,
      rationale: "The plan is **sound**. Sources: [architecture-over-shortcuts].",
      personaSystemPrompt: undefined,
    })
    expect(result).not.toContain("**")
    expect(result).not.toContain("[")
  })

  it("converts confidence number to spoken phrase", () => {
    const result = buildNarrationText({
      outcomeType: "recommend",
      confidenceScore: 0.82,
      rationale: "Plan looks ready.",
      personaSystemPrompt: undefined,
    })
    expect(result).toMatch(/high confidence/i)
  })

  it("opens with outcome phrase for recommend", () => {
    const result = buildNarrationText({
      outcomeType: "recommend",
      confidenceScore: 0.75,
      rationale: "Good plan.",
      personaSystemPrompt: undefined,
    })
    expect(result).toMatch(/^My recommendation is to proceed/i)
  })

  it("opens with escalation phrase for escalate", () => {
    const result = buildNarrationText({
      outcomeType: "escalate",
      confidenceScore: 0.3,
      rationale: "Ambiguous scope.",
      personaSystemPrompt: undefined,
    })
    expect(result).toMatch(/need a human decision/i)
  })

  it("opens with arbitration phrase for arbitrate", () => {
    const result = buildNarrationText({
      outcomeType: "arbitrate",
      confidenceScore: 0.9,
      rationale: "Clear path forward.",
      personaSystemPrompt: undefined,
    })
    expect(result).toMatch(/I.m deciding to proceed/i)
  })

  it("opens with deferral phrase for defer", () => {
    const result = buildNarrationText({
      outcomeType: "defer",
      confidenceScore: 0.1,
      rationale: "No coverage.",
      personaSystemPrompt: undefined,
    })
    expect(result).toMatch(/not enough guidance/i)
  })
})
