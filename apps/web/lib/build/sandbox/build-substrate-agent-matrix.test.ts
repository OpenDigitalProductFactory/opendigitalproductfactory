import { describe, expect, it } from "vitest";
import { assertAgentProviderCompatibility } from "./agent-runner-types";
import { getBuildAgentRunner } from "./agents";
import { getBuildExecutionProvider } from "./providers";

describe("Build substrate x agent matrix", () => {
  it("allows local-docker x codex", () => {
    expect(() => assertAgentProviderCompatibility(
      getBuildAgentRunner("codex").capabilities(),
      getBuildExecutionProvider("local-docker").capabilities(),
    )).not.toThrow();
  });

  it("allows local-docker x claude", () => {
    expect(() => assertAgentProviderCompatibility(
      getBuildAgentRunner("claude").capabilities(),
      getBuildExecutionProvider("local-docker").capabilities(),
    )).not.toThrow();
  });

  it("allows local-docker x grok", () => {
    expect(() => assertAgentProviderCompatibility(
      getBuildAgentRunner("grok").capabilities(),
      getBuildExecutionProvider("local-docker").capabilities(),
    )).not.toThrow();
  });
});
