import { describe, it, expect } from "vitest";
import { getErrorMessage } from "./get-error-message";

describe("getErrorMessage", () => {
  it("returns Error.message for Error instances", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns TypeError/subclass messages", () => {
    expect(getErrorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  it("returns a string thrown directly", () => {
    expect(getErrorMessage("just a string")).toBe("just a string");
  });

  it("extracts a string message from a plain object", () => {
    expect(getErrorMessage({ message: "object message" })).toBe("object message");
  });

  it("coerces non-string message objects via String()", () => {
    // object with non-string message falls through to String(err)
    expect(getErrorMessage({ message: 42 })).toBe("[object Object]");
  });

  it("stringifies numbers, null, and undefined safely", () => {
    expect(getErrorMessage(500)).toBe("500");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("matches the legacy ternary for Error and non-Error inputs", () => {
    const legacy = (err: unknown) => (err instanceof Error ? err.message : String(err));
    for (const v of [new Error("x"), "y", 1, true]) {
      expect(getErrorMessage(v)).toBe(legacy(v));
    }
  });
});
