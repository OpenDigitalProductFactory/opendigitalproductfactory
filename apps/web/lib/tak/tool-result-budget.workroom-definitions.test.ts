import { expect, it } from "vitest";
import { clampToolResultForModel } from "./tool-result-budget";

it("preserves definition refusal recovery as JSON", () => {
  const result = { success: false, error: "definition_page_budget_exceeded", data: {
    page: { version: 1, readKind: "workroom-definitions", disposition: "budget-exceeded" },
    recovery: { toolName: "list_workrooms", arguments: { view: "definitions", cursor: "original", limit: 1 } },
  } };
  const output = clampToolResultForModel(result);
  expect(output.truncated).toBe(false);
  expect(JSON.parse(output.text)).toMatchObject(result);
});

it("never delivers a successful prefix or advances a definition cursor when the final budget shrinks", () => {
  const output = clampToolResultForModel({ success: true, data: {
    view: "definitions", definitions: [{ sourceKey: "x".repeat(1000) }],
    page: { version: 1, readKind: "workroom-definitions", nextCursor: "unseen-row" },
  } }, { maxChars: 350 });
  expect(output.truncated).toBe(true);
  expect(output.text.length).toBeLessThanOrEqual(350);
  expect(JSON.parse(output.text)).toMatchObject({ success: false, error: "page_budget_too_small" });
  expect(output.text).toContain("unchanged cursor");
  expect(output.text).not.toContain("unseen-row");
});
