import { describe, it, expect, vi } from "vitest"
import { applyPersonaStyle } from "./persona-style"

vi.mock("../llm-call", () => ({
  callLLM: vi.fn().mockResolvedValue({ text: "Styled narration output." }),
}))

describe("applyPersonaStyle", () => {
  it("returns original text unchanged when personaSystemPrompt is undefined", async () => {
    const result = await applyPersonaStyle({
      narrationText: "Original text.",
      personaSystemPrompt: undefined,
    })
    expect(result).toBe("Original text.")
  })

  it("calls LLM with persona system prompt when provided", async () => {
    const { callLLM } = await import("../llm-call")
    const result = await applyPersonaStyle({
      narrationText: "Plan is ready.",
      personaSystemPrompt: "Write in a calm, measured tone.",
    })
    expect(callLLM).toHaveBeenCalledOnce()
    expect(result).toBe("Styled narration output.")
  })
})
