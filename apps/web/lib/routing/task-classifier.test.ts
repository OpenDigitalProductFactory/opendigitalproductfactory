import { describe, it, expect } from "vitest";
import { classifyTask } from "./task-classifier";

function u(text: string) {
  return [{ role: "user", content: text }];
}

describe("classifyTask — trivial", () => {
  it.each(["hi", "Hello!", "thanks", "Thank you", "ok", "got it", "sounds good"])(
    "treats pure greeting %j as trivial/minimal",
    (text) => {
      const c = classifyTask(u(text));
      expect(c.complexity).toBe("trivial");
      expect(c.reasoningDepth).toBe("minimal");
      expect(c.archetype).toBe("greeting");
    },
  );

  it("treats a short status ask as trivial/low", () => {
    const c = classifyTask(u("what's the status?"));
    expect(c.complexity).toBe("trivial");
    expect(c.reasoningDepth).toBe("low");
    expect(c.archetype).toBe("status");
  });

  it("does not treat a greeting embedded in a longer sentence as trivial", () => {
    const c = classifyTask(u("Hello, can you walk me through how the routing pipeline ranks endpoints?"));
    expect(c.complexity).not.toBe("trivial");
  });
});

describe("classifyTask — complex", () => {
  it("flags explicit multi-step / architectural language as complex/high", () => {
    for (const text of [
      "Refactor the auth module and migrate the sessions table",
      "Walk me through this step-by-step and analyze the trade-offs",
      "Investigate the root cause of the latency regression",
      "Design the architecture for a new billing service",
    ]) {
      const c = classifyTask(u(text));
      expect(c.complexity, text).toBe("complex");
      expect(c.reasoningDepth, text).toBe("high");
    }
  });

  it("flags a code block as complex", () => {
    const c = classifyTask(u("why does this throw?\n```ts\nconst x = foo()\n```"));
    expect(c.complexity).toBe("complex");
    expect(c.archetype).toBe("analysis");
  });

  it("flags very long input as complex", () => {
    const c = classifyTask(u("please summarize. ".repeat(120))); // > 1500 chars
    expect(c.complexity).toBe("complex");
  });

  it("flags three or more questions as complex", () => {
    const c = classifyTask(u("What is it? How does it work? Why was it chosen?"));
    expect(c.complexity).toBe("complex");
    expect(c.signals).toContain("multi-question");
  });
});

describe("classifyTask — standard (the conservative default)", () => {
  it("leaves an ordinary single request at standard/medium", () => {
    const c = classifyTask(u("Add a phone number field to the customer form"));
    expect(c.complexity).toBe("standard");
    expect(c.reasoningDepth).toBe("medium");
  });

  it("tags generation verbs as the generation archetype but still standard", () => {
    const c = classifyTask(u("Write a welcome email for new signups"));
    expect(c.complexity).toBe("standard");
    expect(c.archetype).toBe("generation");
  });

  it("reads the latest user message, not assistant turns", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello! How can I help?" },
      { role: "user", content: "Refactor the scheduler to support cron expressions" },
    ];
    const c = classifyTask(msgs);
    expect(c.complexity).toBe("complex");
  });

  it("handles multimodal content arrays without throwing", () => {
    const msgs = [{ role: "user", content: [{ type: "text", text: "what's the status?" }, { type: "image" }] }];
    const c = classifyTask(msgs);
    expect(c.archetype).toBe("status");
  });

  it("handles empty input deterministically", () => {
    expect(classifyTask([]).complexity).toBe("standard");
  });
});
