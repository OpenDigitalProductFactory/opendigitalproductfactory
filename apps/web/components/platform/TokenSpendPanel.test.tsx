import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TokenSpendPanel } from "./TokenSpendPanel";

describe("TokenSpendPanel", () => {
  it("explains token spend as internal TokenUsage data and labels unknown providers", () => {
    const html = renderToStaticMarkup(
      <TokenSpendPanel
        initialMonth={{ year: 2026, month: 5 }}
        byProvider={[
          {
            providerId: "",
            providerName: "Unknown provider",
            totalInputTokens: 1000,
            totalOutputTokens: 2000,
            totalCostUsd: 0.12,
            provenance: {
              kind: "live-db",
              label: "TokenUsage",
              sourceTable: "TokenUsage",
              description: "DPF recorded token usage for this provider.",
            },
          },
        ]}
        byAgent={[]}
      />,
    );

    expect(html).toContain("Internal token usage");
    expect(html).toContain("TokenUsage");
    expect(html).toContain("Unknown provider");
  });
});
