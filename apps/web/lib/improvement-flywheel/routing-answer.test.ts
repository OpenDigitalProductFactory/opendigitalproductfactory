import { describe, expect, it } from "vitest";

import { routingAnswerProblem } from "./routing-answer";

describe("routingAnswerProblem", () => {
  const gate = { kind: "gate" as const, question: 1 as const, bindsTo: "work-shape:delivery-small#stage:repair", reason: "Decidable at the stage." };

  it("accepts an answer whose kind matches the first question that holds", () => {
    expect(routingAnswerProblem(gate)).toBeNull();
    expect(routingAnswerProblem({ ...gate, kind: "doctrine", question: 4 })).toBeNull();
  });

  it("refuses a mismatched question, an unknown kind, or an empty binding or reason", () => {
    expect(routingAnswerProblem({ ...gate, question: 2 })).toMatch(/question must be 1/);
    expect(routingAnswerProblem({ ...gate, kind: "hunch" as never })).toMatch(/kind must be one of/);
    expect(routingAnswerProblem({ ...gate, bindsTo: " " })).toMatch(/bindsTo/);
    expect(routingAnswerProblem({ ...gate, reason: "" })).toMatch(/reason/);
  });
});
