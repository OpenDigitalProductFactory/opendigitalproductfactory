import { describe, expect, it } from "vitest";
import {
  COWORKER_UNAVAILABLE_ERROR,
  coworkerUnavailableResult,
} from "./coworker-send-eligibility";

describe("coworkerUnavailableResult", () => {
  it("returns one stable owner-facing denial", () => {
    expect(coworkerUnavailableResult()).toEqual({
      error: COWORKER_UNAVAILABLE_ERROR,
    });
  });
});
