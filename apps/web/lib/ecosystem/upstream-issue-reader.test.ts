import { describe, expect, it, vi } from "vitest";

import { parseUpstreamIssue, readUpstreamIssues } from "./upstream-issue-reader";

const raw = (overrides: Record<string, unknown> = {}) => ({
  number: 412,
  title: "Dispatch board loses the second appointment",
  body: "Booking two jobs in one slot drops the later one.",
  state: "open",
  html_url: "https://example.test/i/412",
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-12T00:00:00Z",
  labels: [{ name: "bug" }, "ecosystem"],
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
}) as unknown as Response;

describe("parseUpstreamIssue", () => {
  it("skips pull requests, which the GitHub issues endpoint also returns", () => {
    // Every PR is an issue in that API. An unfiltered read would ingest the
    // project's own pull requests as if they were ecosystem submissions.
    expect(parseUpstreamIssue(raw({ pull_request: { url: "https://example.test/pulls/1" } }))).toBeNull();
  });

  it("normalizes labels given as objects or plain strings", () => {
    expect(parseUpstreamIssue(raw())?.labels).toEqual(["bug", "ecosystem"]);
  });

  it("rejects a malformed entry rather than filing a blank item", () => {
    expect(parseUpstreamIssue(raw({ title: "   " }))).toBeNull();
    expect(parseUpstreamIssue(raw({ number: "412" }))).toBeNull();
  });
});

describe("readUpstreamIssues", () => {
  it("reports not-configured when the install holds no token, instead of failing", async () => {
    const result = await readUpstreamIssues({ token: null, fetchImpl: vi.fn() });
    expect(result).toMatchObject({ ok: false, state: "not-configured" });
  });

  it("reads issues and filters pull requests out of the result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([raw(), raw({ number: 413, pull_request: {} })]),
    );
    const result = await readUpstreamIssues({
      token: "t", repo: { owner: "o", name: "r" }, fetchImpl,
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.issues.map((i) => i.number)).toEqual([412]);
  });

  it("keeps paging on the RAW page length so an all-PR page cannot truncate the sweep", async () => {
    const prPage = Array.from({ length: 100 }, (_, i) => raw({ number: i, pull_request: {} }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(prPage))
      .mockResolvedValueOnce(jsonResponse([raw({ number: 999 })]));

    const result = await readUpstreamIssues({ token: "t", repo: { owner: "o", name: "r" }, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok && result.issues.map((i) => i.number)).toEqual([999]);
  });

  it("surfaces an auth failure as an error verdict, not an empty sweep", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "Bad credentials" }, 401));
    const result = await readUpstreamIssues({ token: "t", repo: { owner: "o", name: "r" }, fetchImpl });
    expect(result).toMatchObject({ ok: false, state: "error" });
    expect(result.ok === false && result.error).toContain("401");
  });

  it("passes an incremental since bound so a sweep need not re-read history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    await readUpstreamIssues({
      token: "t", repo: { owner: "o", name: "r" }, fetchImpl,
      since: new Date("2026-09-01T00:00:00Z"),
    });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("since=2026-09-01T00%3A00%3A00.000Z");
  });
});
