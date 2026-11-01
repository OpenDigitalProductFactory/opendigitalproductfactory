import { describe, expect, it } from "vitest";

import { CHILD_RESULT_MESSAGE_LIMIT, childResultMessage } from "./child-result-message";

describe("childResultMessage", () => {
  it("names the coworker and carries the reply", () => {
    expect(childResultMessage({ agentName: "Finance", outcome: "completed", text: "Totals reconcile." }))
      .toBe("Finance finished the delegated work.\n\nTotals reconcile.");
  });

  it("says a failure plainly", () => {
    expect(childResultMessage({ agentName: "Finance", outcome: "failed", text: "No ledger access." }))
      .toBe("Finance could not finish the delegated work. No ledger access.");
    expect(childResultMessage({ agentName: "Finance", outcome: "canceled", text: null }))
      .toBe("Finance was cancelled.");
  });

  it("clips a long reply and points to the delegated thread", () => {
    const text = "x".repeat(CHILD_RESULT_MESSAGE_LIMIT + 50);
    const message = childResultMessage({ agentName: "Finance", outcome: "completed", text });
    expect(message).toContain("(The full reply is on the delegated thread.)");
    expect(message.length).toBeLessThan(text.length + 120);
  });
});
