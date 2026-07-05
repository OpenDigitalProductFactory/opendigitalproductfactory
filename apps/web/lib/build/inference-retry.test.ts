import { describe, expect, it, vi } from "vitest";
import { runWithTransientInferenceRetry } from "./inference-retry";

const CONNECTION_ERROR = "API Error: Unable to connect to API (ConnectionRefused)";
const CONFIG_ERROR = "No AI provider credentials are configured for this feature.";
const OK = "Let's define it together — what job types do you handle most?";

function sequenceRunner(contents: string[]) {
  let i = 0;
  const run = vi.fn(async () => ({ content: contents[Math.min(i++, contents.length - 1)]! }));
  return { run };
}

describe("runWithTransientInferenceRetry", () => {
  it("returns the first result without retrying when disabled", async () => {
    const { run } = sequenceRunner([CONNECTION_ERROR, OK]);
    const result = await runWithTransientInferenceRetry(run, { enabled: false, sleep: async () => {} });
    expect(result.content).toBe(CONNECTION_ERROR);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not retry a successful first turn", async () => {
    const { run } = sequenceRunner([OK, CONNECTION_ERROR]);
    const result = await runWithTransientInferenceRetry(run, { enabled: true, sleep: async () => {} });
    expect(result.content).toBe(OK);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and returns the eventual success", async () => {
    const { run } = sequenceRunner([CONNECTION_ERROR, CONNECTION_ERROR, OK]);
    const onRetry = vi.fn();
    const result = await runWithTransientInferenceRetry(run, {
      enabled: true,
      sleep: async () => {},
      onRetry,
    });
    expect(result.content).toBe(OK);
    expect(run).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("gives up after the backoff cap and returns the final failure", async () => {
    const { run } = sequenceRunner([CONNECTION_ERROR, CONNECTION_ERROR, CONNECTION_ERROR, CONNECTION_ERROR]);
    const result = await runWithTransientInferenceRetry(run, {
      enabled: true,
      backoffMs: [10, 20],
      sleep: async () => {},
    });
    expect(result.content).toBe(CONNECTION_ERROR);
    // first attempt + 2 retries = 3 total
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a non-transient (config) failure", async () => {
    const { run } = sequenceRunner([CONFIG_ERROR, OK]);
    const result = await runWithTransientInferenceRetry(run, { enabled: true, sleep: async () => {} });
    expect(result.content).toBe(CONFIG_ERROR);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("honors the backoff schedule via the injected sleep", async () => {
    const { run } = sequenceRunner([CONNECTION_ERROR, CONNECTION_ERROR, OK]);
    const sleeps: number[] = [];
    await runWithTransientInferenceRetry(run, {
      enabled: true,
      backoffMs: [500, 1500],
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(sleeps).toEqual([500, 1500]);
  });
});
