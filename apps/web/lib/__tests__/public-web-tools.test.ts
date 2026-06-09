import { describe, expect, it } from "vitest";
import { detectArchetype } from "../public-web-tools";

describe("detectArchetype", () => {
  it("detects plumber from plumbing keywords", () => {
    expect(detectArchetype("Local plumber for pipe and drain repair")?.id).toBe("plumber");
  });

  it("detects electrician from electrical keywords", () => {
    expect(detectArchetype("Licensed electrician for wiring and circuit installation")?.id).toBe("electrician");
  });
});
