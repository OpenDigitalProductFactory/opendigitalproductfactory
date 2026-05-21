// @vitest-environment jsdom

import { afterEach, describe, it, expect } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { VoiceTrainingStatus } from "./VoiceTrainingStatus"

afterEach(() => cleanup())

describe("VoiceTrainingStatus", () => {
  it("shows 'Training in progress' for processing status", () => {
    render(<VoiceTrainingStatus status="training" qualityScore={undefined} />)
    // getByText throws if element not found — presence is the assertion
    expect(screen.getByText(/training in progress/i)).toBeTruthy()
  })

  it("shows quality score for ready status", () => {
    render(<VoiceTrainingStatus status="ready" qualityScore={0.91} />)
    expect(screen.getByText(/91%/)).toBeTruthy()
  })

  it("shows error message for failed status", () => {
    render(<VoiceTrainingStatus status="failed" qualityScore={undefined} errorMessage="Rate limited" />)
    expect(screen.getByText(/rate limited/i)).toBeTruthy()
  })

  it("shows pending label for pending status", () => {
    render(<VoiceTrainingStatus status="pending" />)
    expect(screen.getByText(/^pending$/i)).toBeTruthy()
  })

  it("shows ready label without quality score when qualityScore is undefined", () => {
    render(<VoiceTrainingStatus status="ready" qualityScore={undefined} />)
    expect(screen.getByText(/^ready$/i)).toBeTruthy()
    expect(screen.queryByText(/%/)).toBeNull()
  })
})
