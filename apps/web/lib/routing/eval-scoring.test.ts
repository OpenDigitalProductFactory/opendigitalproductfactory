import { describe, expect, it } from "vitest";
import {
  scoreExact,
  scorePartial,
  scoreSchema,
  scoreToolCall,
  scoreStructural,
  scoreRetrieval,
  scoreDimension,
} from "./eval-scoring";
import type { GoldenTest } from "./golden-tests";

describe("scoreExact", () => {
  it("returns 10 for exact match (case-insensitive, trimmed)", () => {
    expect(scoreExact("  9  ", "9")).toBe(10);
  });
  it("returns 10 when expected string is contained in response", () => {
    expect(scoreExact("The answer is 9 sheep.", "9")).toBe(10);
  });
  it("returns 0 for no match", () => {
    expect(scoreExact("The answer is 8", "9")).toBe(0);
  });
});

describe("scorePartial", () => {
  it("returns 10 for response containing key expected content", () => {
    expect(scorePartial(
      "There is no missing dollar. The $27 includes the room and bellboy tip.",
      "There is no missing dollar",
    )).toBe(10);
  });
  it("returns 5 for partial match (shares significant keywords)", () => {
    expect(scorePartial(
      "There was no dollar that went missing from the total.",
      "There is no missing dollar",
    )).toBe(5);
  });
  it("returns 0 for completely wrong answer with no keyword overlap", () => {
    expect(scorePartial("The bellboy kept the change for himself.", "There is no missing dollar")).toBe(0);
  });
});

describe("scoreSchema", () => {
  it("returns 10 for valid JSON matching schema", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name", "age"],
    };
    expect(scoreSchema('{"name": "Alice", "age": 30}', schema)).toBe(10);
  });
  it("returns 0 for invalid JSON", () => {
    expect(scoreSchema("not json", { type: "object" })).toBe(0);
  });
  it("returns 5 for valid JSON missing required field", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name", "age"],
    };
    expect(scoreSchema('{"name": "Alice"}', schema)).toBe(5);
  });
});

describe("scoreToolCall", () => {
  it("returns 10 for correct tool called", () => {
    const toolCalls = [{ name: "create_backlog_item", arguments: { title: "Fix login", status: "open" } }];
    expect(scoreToolCall(toolCalls, "create_backlog_item")).toBe(10);
  });
  it("returns 10 for correct abstention (no tool call when __ABSTAIN__ expected)", () => {
    expect(scoreToolCall([], "__ABSTAIN__")).toBe(10);
  });
  it("returns 0 for wrong tool called", () => {
    const toolCalls = [{ name: "web_search", arguments: { query: "test" } }];
    expect(scoreToolCall(toolCalls, "create_backlog_item")).toBe(0);
  });
  it("returns 0 for tool called when abstention expected", () => {
    const toolCalls = [{ name: "create_backlog_item", arguments: {} }];
    expect(scoreToolCall(toolCalls, "__ABSTAIN__")).toBe(0);
  });
});

describe("scoreStructural", () => {
  it("returns 10 for response containing expected function definition", () => {
    const code = "function isPalindrome(str: string): boolean { return str === str.split('').reverse().join(''); }";
    expect(scoreStructural(code, "function isPalindrome")).toBe(10);
  });
  it("returns 5 for response with code but wrong function name", () => {
    const code = "function checkPalindrome(str: string): boolean { return true; }";
    expect(scoreStructural(code, "function isPalindrome")).toBe(5);
  });
  it("returns 0 for no code at all", () => {
    expect(scoreStructural("I can help you write that function.", "function isPalindrome")).toBe(0);
  });
});

describe("scoreRetrieval", () => {
  it("returns 10 for exact retrieval", () => {
    expect(scoreRetrieval("The project codename is Phoenix.", "Phoenix")).toBe(10);
  });
  it("returns 0 for wrong retrieval", () => {
    expect(scoreRetrieval("The project codename is Falcon.", "Phoenix")).toBe(0);
  });
});

describe("scoreDimension", () => {
  it("normalizes per-test scores to 0-100", () => {
    const scores = [10, 10, 10, 0, 0]; // 30/50 = 60%
    expect(scoreDimension(scores)).toBe(60);
  });
  it("returns 0 for all failures", () => {
    expect(scoreDimension([0, 0, 0])).toBe(0);
  });
  it("returns 100 for all perfect", () => {
    expect(scoreDimension([10, 10, 10])).toBe(100);
  });
});
