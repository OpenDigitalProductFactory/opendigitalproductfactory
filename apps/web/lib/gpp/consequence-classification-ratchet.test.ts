// GPP Phase 1, T2 — consequence-classification ratchet.
// Acceptance AC-RATCHET-CLASS: fails when a new side-effecting tool is added
// without a consequence class; passes on main at merge.
import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";

import { KNOWN_UNCLASSIFIED_SIDE_EFFECT_TOOLS } from "./known-unclassified-side-effect-tools";

type ToolLike = { name: string; sideEffect?: boolean; consequence?: unknown };

function unclassifiedSideEffect(tools: readonly ToolLike[]): string[] {
  return tools.filter((tool) => tool.sideEffect === true && !tool.consequence).map((tool) => tool.name);
}

function newlyUnclassified(tools: readonly ToolLike[], known: readonly string[]): string[] {
  const listed = new Set(known);
  return unclassifiedSideEffect(tools).filter((name) => !listed.has(name));
}

describe("GPP consequence classification — live registry against the shrink-only list", () => {
  it("no new side-effecting tool ships without a consequence class", () => {
    expect(
      newlyUnclassified(PLATFORM_TOOLS, KNOWN_UNCLASSIFIED_SIDE_EFFECT_TOOLS),
      "Declare `consequence` on the tool (outward, authority or irreversible), or justify it as an internal write in review",
    ).toEqual([]);
  });

  it("the list only shrinks: a listed tool that now has a class must be removed", () => {
    const stillUnclassified = new Set(unclassifiedSideEffect(PLATFORM_TOOLS));
    expect(KNOWN_UNCLASSIFIED_SIDE_EFFECT_TOOLS.filter((name) => !stillUnclassified.has(name))).toEqual([]);
  });

  it("every listed name is a real tool, listed once", () => {
    const names = new Set(PLATFORM_TOOLS.map((tool) => tool.name));
    expect(KNOWN_UNCLASSIFIED_SIDE_EFFECT_TOOLS.filter((name) => !names.has(name))).toEqual([]);
    expect(new Set(KNOWN_UNCLASSIFIED_SIDE_EFFECT_TOOLS).size).toBe(KNOWN_UNCLASSIFIED_SIDE_EFFECT_TOOLS.length);
  });
});

describe("ratchet self-test on a fixture registry", () => {
  const fixture: ToolLike[] = [
    { name: "read_thing", sideEffect: false },
    { name: "publish_thing", sideEffect: true, consequence: "outward" },
    { name: "write_thing", sideEffect: true },
  ];

  it("passes when every unclassified side-effecting tool is listed", () => {
    expect(newlyUnclassified(fixture, ["write_thing"])).toEqual([]);
  });

  it("goes red when a new side-effecting tool arrives without a class", () => {
    expect(newlyUnclassified([...fixture, { name: "delete_thing", sideEffect: true }], ["write_thing"])).toEqual([
      "delete_thing",
    ]);
  });
});
