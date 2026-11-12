import { describe, expect, it } from "vitest";

import {
  isTransientNetworkFailure,
  retryOnTransientNetwork,
  summarizeBuildOutput,
} from "./transient-network";

// Real failure text from live runs (BI-7FFF5CB0): SUR-256EAF95 (git fetch) and
// the apk lines buildkit prints before "did not complete successfully".
const GIT_FETCH_TIMEOUT =
  "fatal: unable to access 'https://github.com/x/y/': Failed to connect to github.com port 443 after 75004 ms: Could not connect to server";
const APK_NETWORK =
  "#6 3.112 WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.24/main: network error (check Internet connectivity and network settings)";
const APK_TEMPORARY = "ERROR: unable to fetch git-lfs-3.7.1-r0: temporary error (try again later)";

describe("isTransientNetworkFailure", () => {
  it.each([
    GIT_FETCH_TIMEOUT,
    APK_NETWORK,
    APK_TEMPORARY,
    "fatal: unable to access 'https://github.com/x/': Could not resolve host: github.com",
    "error: RPC failed; curl 56 Recv failure: Connection reset by peer",
    "fatal: the remote end hung up unexpectedly",
    "failed to do request: Head \"https://registry-1.docker.io/v2/library/node/manifests/24-alpine\": dial tcp: lookup registry-1.docker.io: i/o timeout",
    "net/http: TLS handshake timeout",
  ])("recognizes %s", (text) => {
    expect(isTransientNetworkFailure(text)).toBe(true);
  });

  it.each([
    "ERROR: unable to select packages:\n  postgresql99-client (no such package):\n    required by: world[postgresql99-client]",
    "ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with \"frozen-lockfile\"",
    "Module not found: Can't resolve '../../config/x.json'",
    "",
  ])("does not treat a real defect as transient: %s", (text) => {
    expect(isTransientNetworkFailure(text)).toBe(false);
  });
});

describe("retryOnTransientNetwork", () => {
  const result = (code: number, stderr = "") => ({ code, stderr });

  it("retries a transient network failure and returns the first success", async () => {
    const outcomes = [result(1, GIT_FETCH_TIMEOUT), result(1, APK_NETWORK), result(0)];
    const delays: number[] = [];
    const r = await retryOnTransientNetwork(async () => outcomes.shift()!, {
      failed: (o) => o.code !== 0,
      output: (o) => o.stderr,
      attempts: 4,
      baseDelayMs: 10,
      sleep: async (ms) => { delays.push(ms); },
    });
    expect(r.code).toBe(0);
    expect(delays).toEqual([10, 20]);
  });

  it("does not retry a non-network failure", async () => {
    let calls = 0;
    const r = await retryOnTransientNetwork(async () => { calls++; return result(1, "no such package"); }, {
      failed: (o) => o.code !== 0,
      output: (o) => o.stderr,
      attempts: 4,
      baseDelayMs: 0,
    });
    expect(calls).toBe(1);
    expect(r.code).toBe(1);
  });

  it("returns the last failure once attempts are exhausted", async () => {
    let calls = 0;
    const r = await retryOnTransientNetwork(async () => { calls++; return result(1, APK_NETWORK); }, {
      failed: (o) => o.code !== 0,
      output: (o) => o.stderr,
      attempts: 3,
      baseDelayMs: 0,
    });
    expect(calls).toBe(3);
    expect(r.stderr).toBe(APK_NETWORK);
  });
});

describe("summarizeBuildOutput", () => {
  it("keeps the network cause that a plain tail would cut off (SUR-FF879116 showed only 'ty.')", () => {
    const log = [
      "#5 [2/7] RUN apk add --no-cache bash docker-cli",
      APK_NETWORK,
      ...Array.from({ length: 40 }, (_, i) => `#6 ${i} noise line padding padding padding padding`),
      "ERROR: failed to build: failed to solve: process \"/bin/sh -c apk add ...\" did not complete successfully: exit code: 9",
    ].join("\n");
    const summary = summarizeBuildOutput(log);
    expect(summary).toContain("network error (check Internet connectivity");
    expect(summary).toContain("exit code: 9");
    expect(summary.length).toBeLessThanOrEqual(1200);
  });
});
