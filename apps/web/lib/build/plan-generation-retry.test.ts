// BI-7AD0759A — a retry must not re-ask the endpoint that just failed.

import { describe, expect, it } from "vitest";

import { denialForNextAttempt, denyAfterUnparseable } from "./plan-generation-retry";

describe("denyAfterUnparseable", () => {
  it("records the endpoint that returned unparseable output", () => {
    expect(denyAfterUnparseable([], "local")).toEqual(["local"]);
  });

  it("accumulates across attempts", () => {
    expect(denyAfterUnparseable(["local"], "codex")).toEqual(["local", "codex"]);
  });

  it("never denies the same endpoint twice", () => {
    expect(denyAfterUnparseable(["local"], "local")).toEqual(["local"]);
  });

  it("ignores a missing or blank provider id rather than denying nothing-in-particular", () => {
    expect(denyAfterUnparseable(["local"], "")).toEqual(["local"]);
    expect(denyAfterUnparseable(["local"], null)).toEqual(["local"]);
    expect(denyAfterUnparseable(["local"], undefined)).toEqual(["local"]);
  });

  it("does not mutate the list it was given", () => {
    const denied = ["local"];
    denyAfterUnparseable(denied, "codex");
    expect(denied).toEqual(["local"]);
  });
});

describe("denialForNextAttempt", () => {
  // The first attempt must carry no denial, so routing picks its preferred
  // endpoint exactly as before this change.
  it("sends no denial before anything has failed", () => {
    expect(denialForNextAttempt([])).toBeUndefined();
  });

  it("sends the failed endpoints once there are any", () => {
    expect(denialForNextAttempt(["local"])).toEqual(["local"]);
  });

  it("copies, so a caller cannot mutate the accumulated list through the result", () => {
    const denied = ["local"];
    const sent = denialForNextAttempt(denied)!;
    sent.push("codex");
    expect(denied).toEqual(["local"]);
  });
});
