import { resolveVisibleTabs, type TabSpec } from "./navigation";

describe("resolveVisibleTabs", () => {
  it("defaults to the full operator tab set when nothing is loaded", () => {
    expect(resolveVisibleTabs({})).toEqual([
      "index",
      "ops",
      "portfolio",
      "customers",
      "more",
    ]);
  });

  it("operator persona sees all platform tabs", () => {
    expect(resolveVisibleTabs({ persona: { kind: "operator" } })).toEqual([
      "index",
      "ops",
      "portfolio",
      "customers",
      "more",
    ]);
  });

  it("customer persona sees a reduced tab set (no ops / portfolio)", () => {
    expect(resolveVisibleTabs({ persona: { kind: "customer" } })).toEqual([
      "index",
      "customers",
      "more",
    ]);
  });

  it("employee persona hides portfolio", () => {
    expect(resolveVisibleTabs({ persona: { kind: "employee" } })).toEqual([
      "index",
      "ops",
      "customers",
      "more",
    ]);
  });

  it("an explicit manifest tab order wins and is filtered to known tabs", () => {
    expect(
      resolveVisibleTabs({
        persona: { kind: "operator" },
        manifestTabs: ["customers", "index", "bogus"],
      }),
    ).toEqual(["customers", "index"]);
  });

  it("capability-gates a tab only when capabilities are known", () => {
    const registry: TabSpec[] = [
      { key: "index", personas: ["operator"] },
      { key: "jobs", personas: ["operator"], capability: "work-items" },
    ];
    // capabilities unknown → a capability-gated tab stays hidden until granted
    expect(
      resolveVisibleTabs({ persona: { kind: "operator" }, registry }),
    ).toEqual(["index"]);
    // capabilities known, without work-items → jobs hidden
    expect(
      resolveVisibleTabs({
        persona: { kind: "operator" },
        capabilities: ["notifications"],
        registry,
      }),
    ).toEqual(["index"]);
    // capabilities known, with work-items → jobs shown
    expect(
      resolveVisibleTabs({
        persona: { kind: "operator" },
        capabilities: ["work-items"],
        registry,
      }),
    ).toEqual(["index", "jobs"]);
  });

  it("surfaces the jobs tab for a field install that grants work-items", () => {
    expect(
      resolveVisibleTabs({
        persona: { kind: "employee" },
        capabilities: ["work-items"],
      }),
    ).toEqual(["index", "ops", "jobs", "customers", "more"]);
  });
});
