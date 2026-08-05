import { describe, expect, test } from "vitest";

import { interpretBuildResult } from "./next-build.mjs";

// BI-6540EB2B: the production build was killed mid-run by a runner SIGTERM and
// exited 1 — indistinguishable from a real build error, so it silently ejected
// PRs from the merge queue (they still reported mergeStateStatus: CLEAN). These
// lock the retry/attribution policy that makes signal-death (OOM/preemption)
// recoverable while a genuine build error still fails fast.
describe("interpretBuildResult", () => {
  test("status 0 -> ok, no retry", () => {
    const d = interpretBuildResult({ status: 0, signal: null }, { attempt: 0, maxRetries: 1 });
    expect(d.action).toBe("ok");
    expect(d.code).toBe(0);
  });

  test("real build error (non-zero status) -> fail fast, preserves exit code, never retries", () => {
    const d = interpretBuildResult({ status: 2, signal: null }, { attempt: 0, maxRetries: 1 });
    expect(d.action).toBe("fail");
    expect(d.code).toBe(2);
  });

  test("signal death with an attempt remaining -> retry", () => {
    const d = interpretBuildResult({ status: null, signal: "SIGTERM" }, { attempt: 0, maxRetries: 1 });
    expect(d.action).toBe("retry");
    expect(d.signal).toBe("SIGTERM");
  });

  test("signal death with retries exhausted -> fail, marked infra (137)", () => {
    const d = interpretBuildResult({ status: null, signal: "SIGKILL" }, { attempt: 1, maxRetries: 1 });
    expect(d.action).toBe("fail");
    expect(d.code).toBe(137);
    expect(d.reason).toMatch(/OOM|preemption/);
  });

  test("maxRetries=0 -> signal death fails immediately (no retry)", () => {
    const d = interpretBuildResult({ status: null, signal: "SIGTERM" }, { attempt: 0, maxRetries: 0 });
    expect(d.action).toBe("fail");
  });

  test("spawn error -> fail with code 1", () => {
    const d = interpretBuildResult({ error: new Error("boom") }, { attempt: 0, maxRetries: 1 });
    expect(d.action).toBe("fail");
    expect(d.code).toBe(1);
  });
});
