import { describe, expect, it } from "vitest";
import { parseCliTerminalResultMetadata } from "./cli-result-errors";

const result = (fields: Record<string, unknown> = {}) => JSON.stringify({
  type: "result", subtype: "success", is_error: false, result: "Completed.", ...fields,
});

describe("native CLI terminal result metadata", () => {
  it("recognizes a complete success without classifying explanatory prose as failure", () => {
    expect(parseCliTerminalResultMetadata(result({ result: "Invalid API key and overloaded are possible errors." })))
      .toEqual({ status: "success", type: "result", subtype: "success", isError: false, hint: "unclassified" });
  });

  it.each([
    ["You've hit your org's monthly spend limit", "quota"],
    ["Invalid API key · Please run /login", "auth"],
    ["529 overloaded", "overloaded"],
    ["The model claude-example does not exist or you do not have access to it.", "model"],
  ])("returns only the bounded hint for %s", (text, hint) => {
    expect(parseCliTerminalResultMetadata(result({ is_error: true, result: text })))
      .toEqual({ status: "error", type: "result", subtype: "success", isError: true, hint });
  });

  it.each(["error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries"])(
    "preserves an allowlisted error subtype: %s", (subtype) => {
      expect(parseCliTerminalResultMetadata(result({ subtype })))
        .toEqual({ status: "error", type: "result", subtype, isError: false, hint: "unclassified" });
    },
  );

  it.each([
    "", "  ", "not JSON", "{", "null", "[]", "{}",
    `${result()}\n${result()}`,
    result({ type: "assistant" }), result({ type: undefined }),
    result({ subtype: undefined }), result({ subtype: "error_PRIVATE_PROMPT" }),
    result({ is_error: undefined }), result({ is_error: "false" }),
    result({ result: undefined }), result({ result: null }), result({ result: "  " }),
    result({ result: "" }), result({ result: [], is_error: true }),
    result({ result: undefined, is_error: true, errors: ["Invalid API key PRIVATE_TOKEN"] }),
    result({ errors: ["unknown failure PRIVATE_PROMPT"] }),
  ])("keeps malformed, partial and unfamiliar output unknown (%#)", (output) => {
    expect(parseCliTerminalResultMetadata(output).status).toBe("unknown");
    expect(parseCliTerminalResultMetadata(output).hint).toBe("unclassified");
  });

  it("does not return arbitrary text or execution/retry authority", () => {
    const metadata = parseCliTerminalResultMetadata(result({
      is_error: true, result: "Unfamiliar PRIVATE_PROMPT C:/private/home credential=PRIVATE_TOKEN",
      session_id: "PRIVATE_SESSION", errors: [],
    }));
    expect(metadata).toEqual({ status: "error", type: "result", subtype: "success", isError: true, hint: "unclassified" });
    expect(JSON.stringify(metadata)).not.toMatch(/PRIVATE|credential|home|settled|retry|noStart/);
  });

  it("does not classify long or merely discussed known errors", () => {
    for (const text of ["We discussed a model that does not exist.", `${"x".repeat(600)} overloaded`, "Some quota examples: hit your weekly limit"]) {
      expect(parseCliTerminalResultMetadata(result({ is_error: true, result: text })).hint).toBe("unclassified");
    }
  });
});
