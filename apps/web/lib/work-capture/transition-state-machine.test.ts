import { describe, expect, it } from "vitest";
import {
  assertTransition,
  evaluateTransition,
  isAllowedTransition,
  type TransitionMap,
} from "./transition-state-machine";
import {
  isAllowedScheduledTransition,
  isAllowedDraftTransition,
} from "../marketing/execution";

type S = "a" | "b" | "c";
const MAP: TransitionMap<S> = {
  a: ["b", "c"],
  b: ["c"],
  c: [],
};

describe("isAllowedTransition", () => {
  it("accepts declared successors and rejects the rest", () => {
    expect(isAllowedTransition(MAP, "a", "b")).toBe(true);
    expect(isAllowedTransition(MAP, "a", "c")).toBe(true);
    expect(isAllowedTransition(MAP, "b", "a")).toBe(false);
    expect(isAllowedTransition(MAP, "c", "a")).toBe(false);
  });

  it("treats a self-move as disallowed unless the map declares a self-loop", () => {
    expect(isAllowedTransition(MAP, "a", "a")).toBe(false);
  });

  it("never throws on an unknown from-state", () => {
    expect(isAllowedTransition(MAP, "zzz" as S, "b")).toBe(false);
  });
});

describe("assertTransition", () => {
  it("throws a greppable message on an illegal move, including the allowed set and hint", () => {
    expect(() => assertTransition(MAP, "c", "a", { label: "Widget", hint: "c is terminal." })).toThrow(
      /Illegal Widget transition: "c" -> "a"\. Allowed from "c": \[\]\. c is terminal\./,
    );
  });

  it("does not throw on a legal move", () => {
    expect(() => assertTransition(MAP, "a", "b")).not.toThrow();
  });
});

describe("evaluateTransition (idempotent)", () => {
  it("is a no-op (changed:false) when from === to — no duplicate side effect", () => {
    expect(evaluateTransition(MAP, "b", "b")).toEqual({ changed: false });
  });

  it("reports changed:true on a real legal move", () => {
    expect(evaluateTransition(MAP, "a", "b")).toEqual({ changed: true });
  });

  it("throws on an illegal (non-self) move", () => {
    expect(() => evaluateTransition(MAP, "c", "a", { label: "Widget" })).toThrow(/Illegal Widget transition/);
  });
});

// Conformance: the two marketing guards now DELEGATE to the shared guard
// (BI-4C5F7A2D §9.2). These assert the delegation preserved behaviour.
describe("marketing execution guards route through the shared guard unchanged", () => {
  it("scheduled-action transitions behave as before", () => {
    expect(isAllowedScheduledTransition("pending", "fired")).toBe(true);
    expect(isAllowedScheduledTransition("pending", "paused")).toBe(true);
    expect(isAllowedScheduledTransition("failed", "pending")).toBe(true);
    expect(isAllowedScheduledTransition("fired", "pending")).toBe(false); // terminal
    expect(isAllowedScheduledTransition("cancelled", "pending")).toBe(false); // terminal
  });

  it("outbound-draft transitions behave as before", () => {
    expect(isAllowedDraftTransition("draft", "pending-review")).toBe(true);
    expect(isAllowedDraftTransition("pending-review", "approved")).toBe(true);
    expect(isAllowedDraftTransition("approved", "published")).toBe(true);
    expect(isAllowedDraftTransition("rejected", "pending-review")).toBe(false); // terminal
    expect(isAllowedDraftTransition("published", "draft")).toBe(false); // terminal
    expect(isAllowedDraftTransition("draft", "draft")).toBe(false); // no self-loop
  });
});
