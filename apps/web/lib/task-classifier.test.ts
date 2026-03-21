import { describe, it, expect } from "vitest";
import { classifyTask } from "./task-classifier";

describe("classifyTask", () => {
  it('classifies "Hello there!" as greeting with confidence >= 0.5', () => {
    const result = classifyTask("Hello there!", []);
    expect(result.taskType).toBe("greeting");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('classifies "Show me the current backlog status" as status-query with confidence >= 0.5', () => {
    const result = classifyTask("Show me the current backlog status", []);
    expect(result.taskType).toBe("status-query");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('classifies "Give me a summary of the key points" as summarization', () => {
    const result = classifyTask("Give me a summary of the key points", []);
    expect(result.taskType).toBe("summarization");
  });

  it('classifies "Why should we choose approach A over B?" as reasoning', () => {
    const result = classifyTask("Why should we choose approach A over B?", []);
    expect(result.taskType).toBe("reasoning");
  });

  it('classifies "Find all products in the retirement stage" as data-extraction', () => {
    const result = classifyTask("Find all products in the retirement stage", []);
    expect(result.taskType).toBe("data-extraction");
  });

  it('classifies "Write a function to validate email addresses in typescript" as code-gen', () => {
    const result = classifyTask(
      "Write a function to validate email addresses in typescript",
      [],
    );
    expect(result.taskType).toBe("code-gen");
  });

  it('classifies "Create a new backlog item for the auth feature" as tool-action', () => {
    const result = classifyTask(
      "Create a new backlog item for the auth feature",
      [],
    );
    expect(result.taskType).toBe("tool-action");
  });

  it('classifies "Search the web for GDPR compliance requirements" as web-search', () => {
    const result = classifyTask(
      "Search the web for GDPR compliance requirements",
      [],
    );
    expect(result.taskType).toBe("web-search");
  });

  it('returns "unknown" with low confidence for "ok"', () => {
    const result = classifyTask("ok", []);
    expect(result.taskType).toBe("unknown");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('returns "unknown" when no patterns match for "xyz abc 123"', () => {
    const result = classifyTask("xyz abc 123", []);
    expect(result.taskType).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("uses conversation context to classify ambiguous messages", () => {
    const result = classifyTask("What about option C?", [
      "We should compare the three deployment strategies",
      "Option A has lower cost",
    ]);
    expect(result.taskType).toBe("reasoning");
  });

  it("returns high confidence (0.8) when a single type matches clearly", () => {
    const result = classifyTask("Hello there!", []);
    expect(result.confidence).toBe(0.8);
  });

  it("returns lower confidence (<=0.5) when multiple types match", () => {
    const result = classifyTask("Find and compare all products", []);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });
});

describe("classifyTask – capability hints", () => {
  it("detects requiresCodeExecution for 'run this code'", () => {
    const result = classifyTask("run this code and show me the output", []);
    expect(result.requiresCodeExecution).toBe(true);
  });

  it("detects requiresCodeExecution for 'execute the python script'", () => {
    const result = classifyTask("execute the python script", []);
    expect(result.requiresCodeExecution).toBe(true);
  });

  it("does NOT detect requiresCodeExecution for 'write a sort function'", () => {
    const result = classifyTask("write a function to sort a list", []);
    expect(result.requiresCodeExecution).toBeUndefined();
  });

  it("detects requiresComputerUse for 'click the submit button'", () => {
    const result = classifyTask("click the submit button on the form", []);
    expect(result.requiresComputerUse).toBe(true);
  });

  it("detects requiresComputerUse for 'fill out the registration form'", () => {
    const result = classifyTask("fill out the registration form on the website", []);
    expect(result.requiresComputerUse).toBe(true);
  });

  it("does NOT detect capability hints for 'hello'", () => {
    const result = classifyTask("hello", []);
    expect(result.requiresCodeExecution).toBeUndefined();
    expect(result.requiresComputerUse).toBeUndefined();
  });

  it("sets requiresWebSearch via task type hint for web-search messages", () => {
    const result = classifyTask("search the web for recent AI news", []);
    expect(result.requiresWebSearch).toBe(true);
  });
});
