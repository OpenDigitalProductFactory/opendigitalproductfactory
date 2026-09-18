/**
 * BI-9A405652 — publishing must not force-overwrite a ref it does not own.
 *
 * Branch names on this path are DERIVED (`dpf/<clientId>/<slug>`), so two builds
 * described similarly on the same install collide. The previous behaviour
 * force-updated the ref, which destroyed the earlier content unrecoverably, told
 * nobody, and left the loser uncontactable because the identity is pseudonymous.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { isAncestorCommit, readRefSha } from "./github-api-commit";

const API = "https://api.github.com/repos/o/r";
const TOKEN = "t";

function mockFetch(handler: (url: string) => { ok: boolean; body?: unknown }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    const { ok, body } = handler(url);
    return {
      ok,
      status: ok ? 200 : 404,
      json: async () => body,
      text: async () => JSON.stringify(body ?? {}),
    } as unknown as Response;
  });
}

afterEach(() => vi.restoreAllMocks());

describe("readRefSha", () => {
  it("returns the commit a ref points at", async () => {
    mockFetch(() => ({ ok: true, body: { object: { sha: "abc123" } } }));
    await expect(readRefSha(API, "dpf/ab12/feature", TOKEN)).resolves.toBe("abc123");
  });

  it("returns null when the ref cannot be read", async () => {
    mockFetch(() => ({ ok: false }));
    await expect(readRefSha(API, "dpf/ab12/feature", TOKEN)).resolves.toBeNull();
  });

  it("returns null rather than a partial value when the payload has no sha", async () => {
    mockFetch(() => ({ ok: true, body: { object: {} } }));
    await expect(readRefSha(API, "b", TOKEN)).resolves.toBeNull();
  });

  it("encodes a branch name with slashes", async () => {
    const spy = mockFetch(() => ({ ok: true, body: { object: { sha: "s" } } }));
    await readRefSha(API, "dpf/ab12/my feature", TOKEN);
    const called = String(spy.mock.calls[0]?.[0]);
    expect(called).not.toContain(" ");
  });
});

describe("isAncestorCommit", () => {
  it("allows a fast-forward: the new commit is ahead", async () => {
    mockFetch(() => ({ ok: true, body: { status: "ahead" } }));
    await expect(isAncestorCommit(API, "old", "new", TOKEN)).resolves.toBe(true);
  });

  it("allows an identical commit", async () => {
    mockFetch(() => ({ ok: true, body: { status: "identical" } }));
    await expect(isAncestorCommit(API, "old", "new", TOKEN)).resolves.toBe(true);
  });

  it("short-circuits when the shas are the same", async () => {
    const spy = mockFetch(() => ({ ok: true, body: { status: "ahead" } }));
    await expect(isAncestorCommit(API, "same", "same", TOKEN)).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("REFUSES a diverged ref", async () => {
    // This is the case that used to silently destroy someone's branch.
    mockFetch(() => ({ ok: true, body: { status: "diverged" } }));
    await expect(isAncestorCommit(API, "old", "new", TOKEN)).resolves.toBe(false);
  });

  it("refuses a ref that is behind", async () => {
    mockFetch(() => ({ ok: true, body: { status: "behind" } }));
    await expect(isAncestorCommit(API, "old", "new", TOKEN)).resolves.toBe(false);
  });

  it("refuses when the comparison cannot be read", async () => {
    // Unreadable is not permission. The cost of a wrong "yes" here is someone
    // else's work, so the safe direction is to refuse.
    mockFetch(() => ({ ok: false }));
    await expect(isAncestorCommit(API, "old", "new", TOKEN)).resolves.toBe(false);
  });
});
