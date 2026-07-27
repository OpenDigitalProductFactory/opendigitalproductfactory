import { describe, expect, it } from "vitest";
import {
  createRoutedInferenceScreen,
  rescreenRoutedInferenceWithoutTools,
} from "./routed-screening";

describe("routed inference screening", () => {
  it("issues a new receipt when a tool-stripping reroute changes the payload boundary", () => {
    const routed = createRoutedInferenceScreen({
      messages: [{ role: "user", content: "Summarize the public release." }],
      systemPrompt: "Use only public material.",
      tools: [
        {
          name: "lookup",
          parameters: {
            type: "object",
            properties: { password: { type: "string" } },
          },
        },
      ],
      taskType: "summarization",
      routeContext: { sensitivity: "internal" },
    });

    const stripped = rescreenRoutedInferenceWithoutTools(routed.screenInput);

    expect(routed.screen.receipt.classifiedDataClasses).toContain("secrets-credentials");
    expect(stripped.receipt.classifiedDataClasses).not.toContain("secrets-credentials");
    expect(stripped.receipt.inputHash).not.toBe(routed.screen.receipt.inputHash);
    expect(stripped.screenInput.tools).toBeUndefined();
  });
});
