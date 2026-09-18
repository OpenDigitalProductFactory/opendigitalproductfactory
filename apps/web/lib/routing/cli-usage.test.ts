import { describe, expect, it } from "vitest";
import { toCliParsedUsage } from "./cli-usage";

// BI-CCF1ACBB: the CLI reports Anthropic usage. input_tokens is the UNCACHED
// input only; on a cached prefix the prompt the model actually read is in the
// two cache fields. Dropping them is how anthropic-sub reported ~17 input
// tokens per run on a live install.
describe("toCliParsedUsage", () => {
  it("keeps cache creation and cache read tokens when the CLI reports them", () => {
    expect(toCliParsedUsage({
      input_tokens: 17, output_tokens: 900, cache_creation_input_tokens: 12_000, cache_read_input_tokens: 30_000,
    })).toEqual({ inputTokens: 17, outputTokens: 900, cacheCreationInputTokens: 12_000, cacheReadInputTokens: 30_000 });
  });

  it("omits cache fields reported as zero or absent, so non-caching rows are unchanged", () => {
    const parsed = toCliParsedUsage({ input_tokens: 3_000, output_tokens: 700, cache_creation_input_tokens: 0 });
    expect(parsed).toEqual({ inputTokens: 3_000, outputTokens: 700 });
    expect("cacheReadInputTokens" in parsed).toBe(false);
    expect("cacheCreationInputTokens" in parsed).toBe(false);
  });

  it("defaults to zero tokens when the CLI reported no usage at all", () => {
    expect(toCliParsedUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(toCliParsedUsage({})).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
