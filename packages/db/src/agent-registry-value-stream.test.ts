import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Invariant guard (BI-B431D1D1): agent value_stream tags feed the IT4IT coverage projection
// via the it4it-crosswalk. Legacy v2 labels ("Strategy to Portfolio", "Request to Deploy")
// only worked through a normalization fallback and broke naive group-by; this guard keeps the
// seed canonical so the coverage evidence stays clean. Fix-the-seed + invariant-guard.

const CANONICAL_VALUE_STREAMS = new Set([
  "evaluate",
  "explore",
  "integrate",
  "deploy",
  "release",
  "consume",
  "operate",
  "governance",
  "cross-cutting",
]);

describe("agent_registry value_stream hygiene", () => {
  const registryPath = join(__dirname, "..", "data", "agent_registry.json");
  const raw = JSON.parse(readFileSync(registryPath, "utf8")) as {
    agents: Array<{ agent_id: string; value_stream?: string | null }>;
  };

  it("tags every value-streamed agent with a canonical token (no legacy v2 labels)", () => {
    const offenders = raw.agents
      .filter((a) => a.value_stream != null && a.value_stream !== "")
      .filter((a) => !CANONICAL_VALUE_STREAMS.has(a.value_stream as string))
      .map((a) => `${a.agent_id}:${a.value_stream}`);
    expect(offenders).toEqual([]);
  });

  it("uses no whitespace-containing value_stream labels", () => {
    const spaced = raw.agents
      .filter((a) => typeof a.value_stream === "string" && /\s/.test(a.value_stream))
      .map((a) => a.agent_id);
    expect(spaced).toEqual([]);
  });
});
