import { describe, it, expect } from "vitest"
import { healthPath } from "./route"

describe("healthPath", () => {
  it("uses /v1/models for the mlx provider (chatterbox path 404s on mlx-audio)", () => {
    expect(healthPath("mlx")).toBe("/v1/models")
  })

  it("uses /v1/audio/voices for chatterbox", () => {
    expect(healthPath("chatterbox")).toBe("/v1/audio/voices")
  })

  it("defaults non-mlx providers to the chatterbox health path", () => {
    expect(healthPath("cartesia")).toBe("/v1/audio/voices")
    expect(healthPath("fish-audio")).toBe("/v1/audio/voices")
  })
})
