import { describe, expect, it } from "vitest";
import {
  isUnspecifiedHostname,
  normalizeReachableUrl,
  rewriteUnspecifiedNetloc,
} from "./reachable-url";

describe("reachable-url (BI-86165533)", () => {
  it("recognizes bind-all hostnames the browser cannot reach", () => {
    expect(isUnspecifiedHostname("0.0.0.0")).toBe(true);
    expect(isUnspecifiedHostname("::")).toBe(true);
    expect(isUnspecifiedHostname("[::]")).toBe(true);
    expect(isUnspecifiedHostname("localhost")).toBe(false);
    expect(isUnspecifiedHostname("127.0.0.1")).toBe(false);
    expect(isUnspecifiedHostname("dpf.example.com")).toBe(false);
  });

  it("rewrites a bind-all netloc to loopback, preserving the port", () => {
    expect(rewriteUnspecifiedNetloc("0.0.0.0:3000")).toBe("localhost:3000");
    expect(rewriteUnspecifiedNetloc("0.0.0.0")).toBe("localhost");
    expect(rewriteUnspecifiedNetloc("[::]:3000")).toBe("localhost:3000");
    expect(rewriteUnspecifiedNetloc("localhost:3000")).toBe("localhost:3000");
    expect(rewriteUnspecifiedNetloc("127.0.0.1:3000")).toBe("127.0.0.1:3000");
    expect(rewriteUnspecifiedNetloc("dpf.example.com")).toBe("dpf.example.com");
  });

  it("normalizes a bind-all URL to a loadable loopback URL", () => {
    expect(normalizeReachableUrl("http://0.0.0.0:3000/workspace")).toBe(
      "http://localhost:3000/workspace",
    );
    expect(normalizeReachableUrl("http://0.0.0.0:3000")).toBe("http://localhost:3000");
    // Real hosts and non-URLs pass through untouched.
    expect(normalizeReachableUrl("https://dpf.example.com/x")).toBe(
      "https://dpf.example.com/x",
    );
    expect(normalizeReachableUrl("http://localhost:3000/workspace")).toBe(
      "http://localhost:3000/workspace",
    );
    expect(normalizeReachableUrl("/workspace")).toBe("/workspace");
    expect(normalizeReachableUrl("not a url")).toBe("not a url");
  });
});
